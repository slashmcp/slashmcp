import { useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { fetchStockInsights, type StockInsights } from "@/lib/alphaVantage";

export type Provider = "openai" | "anthropic" | "gemini";

const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI (GPT-4o Mini)",
  anthropic: "Anthropic (Claude 3 Haiku)",
  gemini: "Google Gemini 1.5 Flash",
};

type BaseMessage = {
  role: "user" | "assistant";
  type: "text" | "stock";
  content: string;
};

type StockMessage = BaseMessage & {
  role: "assistant";
  type: "stock";
  stock: StockInsights;
};

type TextMessage = BaseMessage & {
  type: "text";
};

export type Message = TextMessage | StockMessage;

type ParsedStockCommand = {
  symbol: string;
  range?: "1M" | "3M" | "6M" | "1Y";
};

const STOCK_COMMAND_REGEX =
  /^\/?\s*(?:quote|stock|ticker)\s+([a-zA-Z.\-:]{1,10})(?:\s+(1m|3m|6m|1y))?\s*$/i;

const MODEL_COMMAND_REGEX = /^\/model\s+(openai|anthropic|gemini)\s*$/i;

function parseStockCommand(rawInput: string): ParsedStockCommand | null {
  const match = rawInput.trim().match(STOCK_COMMAND_REGEX);
  if (!match) return null;
  const [, symbol, rawRange] = match;
  const normalizedRange = rawRange?.toUpperCase() as ParsedStockCommand["range"] | undefined;
  return {
    symbol: symbol.toUpperCase(),
    range: normalizedRange,
  };
}

function parseModelCommand(rawInput: string): Provider | null {
  const match = rawInput.trim().match(MODEL_COMMAND_REGEX);
  if (!match) return null;
  return match[1].toLowerCase() as Provider;
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [provider, setProvider] = useState<Provider>("openai");
  const { toast } = useToast();

  const sendMessage = useCallback(async (input: string) => {
    const userMsg: Message = { role: "user", type: "text", content: input };
    setMessages(prev => [...prev, userMsg]);

    const modelCommand = parseModelCommand(input);
    if (modelCommand) {
      setProvider(modelCommand);
      setMessages(prev => [
        ...prev,
        {
          role: "assistant",
          type: "text",
          content: `Switched to ${PROVIDER_LABEL[modelCommand]}.`,
        },
      ]);
      return;
    }

    const stockCommand = parseStockCommand(input);
    if (stockCommand) {
      setIsLoading(true);
      try {
        const stockData = await fetchStockInsights(stockCommand.symbol, stockCommand.range);
        const summary = `${stockData.symbol} ${stockData.price.toFixed(2)} ${stockData.currency ?? ""}`.trim();
        const stockMessage: StockMessage = {
          role: "assistant",
          type: "stock",
          content: summary,
          stock: stockData,
        };
        setMessages(prev => [...prev, stockMessage]);
      } catch (error) {
        console.error("Stock quote error:", error);
        toast({
          title: "Stock lookup failed",
          description:
            error instanceof Error ? error.message : "Unable to fetch stock data right now.",
          variant: "destructive",
        });
        setMessages(prev => [
          ...prev,
          {
            role: "assistant",
            type: "text",
            content:
              "Sorry, I wasn't able to retrieve that stock quote. Please try again in a moment.",
          },
        ]);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    setIsLoading(true);
    let assistantContent = "";

    const updateAssistantMessage = (chunk: string) => {
      assistantContent += chunk;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.role === "assistant" && last.type === "text") {
          return prev.map((m, i) =>
            i === prev.length - 1 ? { ...m, content: assistantContent } : m
          );
        }
        return [...prev, { role: "assistant", type: "text", content: assistantContent }];
      });
    };

    try {
      const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;
      const history = [...messages, userMsg].map(({ role, content }) => ({ role, content }));
      const response = await fetch(CHAT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ messages: history, provider }),
      });

      if (!response.ok || !response.body) {
        if (response.status === 429) {
          toast({
            title: "Rate limit exceeded",
            description: "Please try again in a moment.",
            variant: "destructive",
          });
        } else if (response.status === 402) {
          toast({
            title: "Payment required",
            description: "Please add credits to your workspace.",
            variant: "destructive",
          });
        } else {
          throw new Error("Failed to start stream");
        }
        setIsLoading(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let streamDone = false;

      while (!streamDone) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") {
            streamDone = true;
            break;
          }

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) updateAssistantMessage(content);
          } catch {
            textBuffer = line + "\n" + textBuffer;
            break;
          }
        }
      }

      if (textBuffer.trim()) {
        for (let raw of textBuffer.split("\n")) {
          if (!raw) continue;
          if (raw.endsWith("\r")) raw = raw.slice(0, -1);
          if (raw.startsWith(":") || raw.trim() === "") continue;
          if (!raw.startsWith("data: ")) continue;
          const jsonStr = raw.slice(6).trim();
          if (jsonStr === "[DONE]") continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) updateAssistantMessage(content);
          } catch { /* ignore partial leftovers */ }
        }
      }

      setIsLoading(false);
    } catch (error) {
      console.error("Chat error:", error);
      toast({
        title: "Error",
        description: "Failed to send message. Please try again.",
        variant: "destructive",
      });
      setMessages(prev => prev.slice(0, -1));
      setIsLoading(false);
    }
  }, [messages, toast, provider]);

  return { messages, sendMessage, isLoading, provider, providerLabel: PROVIDER_LABEL[provider] };
}
