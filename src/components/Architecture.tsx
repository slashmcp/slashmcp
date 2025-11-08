import { Card, CardContent } from "@/components/ui/card";
import { 
  Laptop, 
  Cloud, 
  Database, 
  Cpu,
  ArrowRight
} from "lucide-react";

export const Architecture = () => {
  return (
    <section className="py-24 relative">
      <div className="container mx-auto px-4">
        <div className="text-center max-w-3xl mx-auto mb-16">
          <h2 className="text-4xl md:text-5xl font-bold mb-4">
            Flexible Architecture
          </h2>
          <p className="text-xl text-muted-foreground">
            Deploy locally or scale to the cloud. Your choice, your control.
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Local Deployment */}
          <Card className="border-primary/20 bg-card/50 backdrop-blur-sm hover:border-primary/50 transition-all duration-300">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-gradient-primary flex items-center justify-center">
                  <Laptop className="w-6 h-6 text-primary-foreground" />
                </div>
                <h3 className="text-2xl font-semibold">Local First</h3>
              </div>
              
              <p className="text-muted-foreground leading-relaxed">
                Run everything on your machine. Complete privacy with offline capabilities for local LLM inference.
              </p>

              <div className="space-y-3 pt-4">
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span>Zero external dependencies</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span>Complete data privacy</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-primary" />
                  <span>Offline-capable operations</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Cloud Deployment */}
          <Card className="border-accent/20 bg-card/50 backdrop-blur-sm hover:border-accent/50 transition-all duration-300">
            <CardContent className="p-8 space-y-6">
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-accent to-primary flex items-center justify-center">
                  <Cloud className="w-6 h-6 text-white" />
                </div>
                <h3 className="text-2xl font-semibold">Serverless Cloud</h3>
              </div>
              
              <p className="text-muted-foreground leading-relaxed">
                Scale effortlessly with AWS Lambda and API Gateway. Pay only for what you use.
              </p>

              <div className="space-y-3 pt-4">
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span>Automatic scaling</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span>Pay-per-use pricing</span>
                </div>
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-accent" />
                  <span>Managed infrastructure</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Architecture Flow */}
        <div className="mt-16 max-w-4xl mx-auto">
          <div className="flex flex-wrap items-center justify-center gap-4 md:gap-8">
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-card border border-border">
              <Cpu className="w-5 h-5 text-primary" />
              <span className="font-medium">LLM Engine</span>
            </div>
            
            <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
            
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-card border border-border">
              <Database className="w-5 h-5 text-accent" />
              <span className="font-medium">MCP Layer</span>
            </div>
            
            <ArrowRight className="w-5 h-5 text-muted-foreground hidden md:block" />
            
            <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-card border border-border">
              <Cloud className="w-5 h-5 text-primary" />
              <span className="font-medium">External APIs</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
