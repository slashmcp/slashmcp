import { Badge } from "@/components/ui/badge";

const integrations = [
  { name: "OpenAI GPT-4", category: "LLM" },
  { name: "Google Gemini", category: "LLM" },
  { name: "Anthropic Claude", category: "LLM" },
  { name: "DeepSeek", category: "LLM" },
  { name: "GrokiPedia", category: "Knowledge" },
  { name: "Alpha Vantage", category: "Finance" },
  { name: "Polymarket", category: "Prediction" },
  { name: "Google Search", category: "Search" },
  { name: "Whisper ASR", category: "Voice" },
  { name: "DALL·E", category: "Image" },
  { name: "AWS Textract", category: "OCR" },
  { name: "AWS Lambda", category: "Cloud" },
];

const categoryColors: Record<string, string> = {
  LLM: "bg-primary/10 text-primary border-primary/20",
  Knowledge: "bg-accent/10 text-accent border-accent/20",
  Finance: "bg-green-500/10 text-green-500 border-green-500/20",
  Prediction: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  Search: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Voice: "bg-pink-500/10 text-pink-500 border-pink-500/20",
  Image: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  OCR: "bg-orange-500/10 text-orange-500 border-orange-500/20",
  Cloud: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
};

export const Integrations = () => {
  return (
    <section className="py-24 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent" />
      
      <div className="container mx-auto px-4 relative z-10">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Seamlessly Connect to
            <span className="block bg-gradient-primary bg-clip-text text-transparent mt-2">
              Your Favorite Services
            </span>
          </h2>
          <p className="text-xl text-muted-foreground">
            Integrate with industry-leading APIs and services through the Model Context Protocol
          </p>
        </div>

        <div className="flex flex-wrap justify-center gap-3 max-w-4xl mx-auto">
          {integrations.map((integration, index) => (
            <Badge
              key={index}
              variant="outline"
              className={`px-4 py-2 text-sm font-medium ${categoryColors[integration.category]} backdrop-blur-sm hover:scale-105 transition-transform duration-200 cursor-default`}
            >
              {integration.name}
            </Badge>
          ))}
        </div>

        <div className="mt-12 text-center">
          <p className="text-muted-foreground">
            ...and many more through the extensible MCP architecture
          </p>
        </div>
      </div>
    </section>
  );
};
