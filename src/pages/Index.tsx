import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ui/chat-input";
import { useChat } from "@/hooks/useChat";
import { useEffect, useRef } from "react";

const Index = () => {
  const { messages, sendMessage, isLoading } = useChat();
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Chat Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.length === 0 && (
            <div className="text-center mt-20">
              <h1 className="text-4xl font-bold text-foreground mb-4">SlashMCP Assistant</h1>
              <p className="text-muted-foreground">Your personal AI research assistant</p>
            </div>
          )}
          {messages.map((message, index) => (
            <ChatMessage key={index} role={message.role} content={message.content} />
          ))}
          {isLoading && (
            <div className="flex gap-3 justify-start animate-fade-in">
              <div className="h-8 w-8 rounded-full bg-gradient-glass backdrop-blur-xl border border-glass-border/30 flex items-center justify-center flex-shrink-0">
                <div className="h-2 w-2 bg-foreground/50 rounded-full animate-pulse" />
              </div>
              <div className="bg-gradient-glass backdrop-blur-xl border border-glass-border/30 rounded-2xl px-4 py-3">
                <div className="flex gap-1">
                  <div className="h-2 w-2 bg-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <div className="h-2 w-2 bg-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <div className="h-2 w-2 bg-foreground/50 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Chat Input */}
      <ChatInput onSubmit={sendMessage} disabled={isLoading} className="px-4 pb-4" />
    </div>
  );
};

export default Index;
