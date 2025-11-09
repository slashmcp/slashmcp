import { memo } from "react";
import { User, Bot } from "lucide-react";
import { cn } from "@/lib/utils";
import { StockQuoteCard } from "@/components/StockQuoteCard";
import type { Message } from "@/hooks/useChat";

interface ChatMessageProps {
  message: Message;
}

export const ChatMessage = memo(({ message }: ChatMessageProps) => {
  const isUser = message.role === "user";
  const isStock = message.type === "stock" && message.role === "assistant";

  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser ? "justify-end" : "justify-start")}>
      {!isUser && (
        <div className="h-8 w-8 rounded-full bg-gradient-glass backdrop-blur-xl border border-glass-border/30 flex items-center justify-center flex-shrink-0">
          <Bot size={16} className="text-foreground/70" />
        </div>
      )}
      <div
        className={cn(
          "max-w-[80%] rounded-2xl",
          isStock ? "p-0 overflow-hidden" : "px-4 py-3",
          isUser
            ? "bg-primary/10 backdrop-blur-xl border border-primary/20 text-foreground"
            : "bg-gradient-glass backdrop-blur-xl border border-glass-border/30 text-foreground/90",
        )}
      >
        {isStock && message.type === "stock" ? (
          <StockQuoteCard title={message.content} insights={message.stock} />
        ) : (
          <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
        )}
      </div>
      {isUser && (
        <div className="h-8 w-8 rounded-full bg-primary/20 backdrop-blur-xl border border-primary/30 flex items-center justify-center flex-shrink-0">
          <User size={16} className="text-primary" />
        </div>
      )}
    </div>
  );
});
