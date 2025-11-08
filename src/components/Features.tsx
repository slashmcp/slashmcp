import { 
  Brain, 
  Database, 
  Mic, 
  FileText, 
  TrendingUp, 
  Search,
  Image as ImageIcon,
  Zap
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const features = [
  {
    icon: Brain,
    title: "Multi-LLM Integration",
    description: "Connect to OpenAI, Google Gemini, DeepSeek, Claude, and more. Switch between models seamlessly for optimal results.",
  },
  {
    icon: Database,
    title: "MCP Protocol Support",
    description: "Leverage Model Context Protocol to integrate external tools and data sources with standardized function calls.",
  },
  {
    icon: Mic,
    title: "Voice Interaction",
    description: "Natural speech input via Whisper ASR and conversational text-to-speech output for hands-free operation.",
  },
  {
    icon: FileText,
    title: "Document Analysis",
    description: "Upload PDFs and images for OCR processing. Ask questions about your documents with semantic search.",
  },
  {
    icon: TrendingUp,
    title: "Financial Data",
    description: "Real-time stock, crypto, and market data through Alpha Vantage and Polymarket integrations.",
  },
  {
    icon: Search,
    title: "Web Search & Research",
    description: "Access GrokiPedia AI encyclopedia and Google Search for up-to-date information synthesis.",
  },
  {
    icon: ImageIcon,
    title: "Image Generation",
    description: "Create and edit images with DALL·E integration. Generate visuals from text prompts or refine existing images.",
  },
  {
    icon: Zap,
    title: "Serverless Architecture",
    description: "Run locally or deploy to AWS Lambda for scalable, pay-per-use backend infrastructure.",
  },
];

export const Features = () => {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Powerful Features for
            <span className="block text-primary mt-2">Advanced Research</span>
          </h2>
          <p className="text-xl text-muted-foreground">
            Everything you need to supercharge your research workflow with AI
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <Card 
                key={index} 
                className="group hover:border-primary/50 transition-all duration-300 hover:shadow-glow-primary bg-card/50 backdrop-blur-sm"
              >
                <CardContent className="p-6 space-y-4">
                  <div className="w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center group-hover:shadow-glow-primary transition-all duration-300">
                    <Icon className="w-6 h-6 text-primary-foreground" />
                  </div>
                  <h3 className="text-xl font-semibold">{feature.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">
                    {feature.description}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
};
