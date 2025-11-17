import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Play, Trash2, Edit, Copy, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { listWorkflows, deleteWorkflow } from "@/lib/workflows/client";
import type { Workflow } from "@/lib/workflows/types";
import { supabaseClient } from "@/lib/supabaseClient";

export function Workflows() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [workflows, setWorkflows] = useState<Workflow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [authReady, setAuthReady] = useState(false);

  useEffect(() => {
    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      setAuthReady(!!session);
      if (session) {
        loadWorkflows();
      } else {
        setIsLoading(false);
      }
    });

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      setAuthReady(!!session);
      if (session) {
        loadWorkflows();
      } else {
        setWorkflows([]);
        setIsLoading(false);
      }
    });
  }, []);

  const loadWorkflows = async () => {
    try {
      setIsLoading(true);
      const data = await listWorkflows(false);
      setWorkflows(data);
    } catch (error) {
      console.error("Failed to load workflows:", error);
      toast({
        title: "Error",
        description: "Failed to load workflows",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async (workflowId: string, workflowName: string) => {
    if (!confirm(`Are you sure you want to delete "${workflowName}"?`)) {
      return;
    }

    try {
      await deleteWorkflow(workflowId);
      toast({
        title: "Success",
        description: "Workflow deleted",
      });
      loadWorkflows();
    } catch (error) {
      console.error("Failed to delete workflow:", error);
      toast({
        title: "Error",
        description: "Failed to delete workflow",
        variant: "destructive",
      });
    }
  };

  const handleDuplicate = async (workflow: Workflow) => {
    try {
      // Navigate to builder with duplicate flag
      navigate(`/workflows/new?duplicate=${workflow.id}`);
    } catch (error) {
      console.error("Failed to duplicate workflow:", error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
          <p className="mt-4 text-muted-foreground">Loading workflows...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Workflows</h1>
              <p className="text-sm text-muted-foreground">
                Create and manage multi-agent workflows
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => navigate("/")}>
                Back to Chat
              </Button>
              {authReady && (
                <Button onClick={() => navigate("/workflows/new")}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Workflow
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="container mx-auto px-4 py-8">
        {!authReady ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground mb-4">Please sign in to create and manage workflows</p>
            <Button onClick={() => navigate("/")}>Sign In</Button>
          </div>
        ) : workflows.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">📊</div>
            <h3 className="text-lg font-semibold mb-2">No workflows yet</h3>
            <p className="text-muted-foreground mb-4">
              Create your first workflow to automate multi-agent tasks
            </p>
            <Button onClick={() => navigate("/workflows/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Create Workflow
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {workflows.map(workflow => (
              <Card key={workflow.id} className="flex flex-col">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <CardTitle className="text-lg">{workflow.name}</CardTitle>
                      <CardDescription className="mt-1">
                        {workflow.description || "No description"}
                      </CardDescription>
                    </div>
                    {workflow.is_template && (
                      <Badge variant="secondary" className="ml-2">
                        Template
                      </Badge>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="flex-1 flex flex-col">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <Clock className="h-3 w-3" />
                    <span>
                      Updated {new Date(workflow.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="flex gap-2 mt-auto">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1"
                      onClick={() => navigate(`/workflows/${workflow.id}`)}
                    >
                      <Edit className="h-3 w-3 mr-1" />
                      Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDuplicate(workflow)}
                    >
                      <Copy className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleDelete(workflow.id, workflow.name)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

