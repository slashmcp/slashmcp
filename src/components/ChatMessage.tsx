import { memo } from "react";
import { User, Bot } from "lucide-react";

interface ChatMessageProps {
  role: "user" | "assistant";
  content: string;
}

export const ChatMessage = memo(({ role, content }: ChatMessageProps) => {
  return (
    <div className={`flex gap-3 ${role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}>
      {role === "assistant" && (
        <div className="h-8 w-8 rounded-full bg-gradient-glass backdrop-blur-xl border border-glass-border/30 flex items-center justify-center flex-shrink-0">
          <Bot size={16} className="text-foreground/70" />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-3 ${
          role === "user"
            ? "bg-primary/10 backdrop-blur-xl border border-primary/20 text-foreground"
            : "bg-gradient-glass backdrop-blur-xl border border-glass-border/30 text-foreground/90"
        }`}
      >
        <p className="text-sm leading-relaxed whitespace-pre-wrap">{content}</p>
      </div>
      {role === "user" && (
        <div className="h-8 w-8 rounded-full bg-primary/20 backdrop-blur-xl border border-primary/30 flex items-center justify-center flex-shrink-0">
          <User size={16} className="text-primary" />
        </div>
      )}
    </div>
  );
});
