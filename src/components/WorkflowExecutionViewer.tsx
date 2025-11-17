import { useState, useEffect } from "react";
import { X, CheckCircle2, XCircle, Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { supabaseClient } from "@/lib/supabaseClient";

interface ExecutionStatus {
  execution: {
    id: string;
    status: string;
    output_data?: Record<string, unknown>;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
  };
  node_executions: Array<{
    id: string;
    node_id: string;
    status: string;
    output_data?: Record<string, unknown>;
    error_message?: string;
    started_at?: string;
    completed_at?: string;
  }>;
  current_step: number;
  total_steps: number;
  progress: number;
}

interface WorkflowExecutionViewerProps {
  executionId: string;
  onClose?: () => void;
}

export function WorkflowExecutionViewer({ executionId, onClose }: WorkflowExecutionViewerProps) {
  const [status, setStatus] = useState<ExecutionStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = async () => {
    try {
      const FUNCTIONS_URL =
        import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
        (import.meta.env.VITE_SUPABASE_URL
          ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
          : undefined);

      if (!FUNCTIONS_URL) {
        throw new Error("Supabase functions URL not configured");
      }

      const {
        data: { session },
      } = await supabaseClient.auth.getSession();

      if (!session?.access_token) {
        throw new Error("Not authenticated");
      }

      const response = await fetch(`${FUNCTIONS_URL}/workflow-execution/${executionId}`, {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch execution status");
      }

      const data = await response.json();
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();

    // Poll for updates if execution is still running
    const interval = setInterval(() => {
      if (status?.execution.status === "running" || status?.execution.status === "pending") {
        fetchStatus();
      }
    }, 2000); // Poll every 2 seconds

    return () => clearInterval(interval);
  }, [executionId, status?.execution.status]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <div className="text-red-500">Error: {error}</div>
      </div>
    );
  }

  if (!status) {
    return <div className="p-4">No execution data found</div>;
  }

  const { execution, node_executions, progress } = status;

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case "failed":
        return <XCircle className="h-4 w-4 text-red-500" />;
      case "running":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      default:
        return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "destructive" | "secondary"> = {
      completed: "default",
      failed: "destructive",
      running: "secondary",
      pending: "secondary",
    };

    return (
      <Badge variant={variants[status] || "secondary"} className="text-xs">
        {status}
      </Badge>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Execution Status</h3>
          <p className="text-sm text-muted-foreground">Execution ID: {executionId.slice(0, 8)}...</p>
        </div>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Overall Status */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Workflow Execution</CardTitle>
            <div className="flex items-center gap-2">
              {getStatusIcon(execution.status)}
              {getStatusBadge(execution.status)}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {execution.status === "running" && (
            <div>
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Progress</span>
                <span>{progress}%</span>
              </div>
              <Progress value={progress} />
            </div>
          )}

          {execution.error_message && (
            <div className="p-3 rounded-md bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800">
              <p className="text-sm text-red-800 dark:text-red-200">{execution.error_message}</p>
            </div>
          )}

          {execution.output_data && execution.status === "completed" && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Output:</p>
              <pre className="p-3 rounded-md bg-muted text-xs overflow-auto max-h-48">
                {JSON.stringify(execution.output_data, null, 2)}
              </pre>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Node Executions */}
      {node_executions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Node Executions</CardTitle>
            <CardDescription>{node_executions.length} nodes executed</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {node_executions.map((nodeExec, index) => (
                <div
                  key={nodeExec.id}
                  className={cn(
                    "p-3 rounded-md border",
                    nodeExec.status === "completed" && "bg-emerald-50 dark:bg-emerald-950 border-emerald-200 dark:border-emerald-800",
                    nodeExec.status === "failed" && "bg-red-50 dark:bg-red-950 border-red-200 dark:border-red-800",
                    nodeExec.status === "running" && "bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800",
                  )}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      {getStatusIcon(nodeExec.status)}
                      <span className="text-sm font-medium">Node {index + 1}</span>
                    </div>
                    {getStatusBadge(nodeExec.status)}
                  </div>

                  {nodeExec.error_message && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {nodeExec.error_message}
                    </p>
                  )}

                  {nodeExec.output_data && nodeExec.status === "completed" && (
                    <details className="mt-2">
                      <summary className="text-xs cursor-pointer text-muted-foreground">
                        View output
                      </summary>
                      <pre className="mt-2 p-2 rounded bg-background text-xs overflow-auto max-h-32">
                        {JSON.stringify(nodeExec.output_data, null, 2)}
                      </pre>
                    </details>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

