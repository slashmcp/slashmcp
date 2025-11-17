import { useState, useCallback, useMemo, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Connection,
  Edge,
  Node,
  NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { ArrowLeft, Save, Play, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/use-toast";
import { cn } from "@/lib/utils";
import { MCP_SERVER_REGISTRY } from "@/lib/mcp/registry";
import { WorkflowExecutionViewer } from "@/components/WorkflowExecutionViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { NodeType } from "@/lib/workflows/types";
import {
  getWorkflow,
  createWorkflow,
  updateWorkflow,
  saveWorkflowGraph,
  executeWorkflow,
} from "@/lib/workflows/client";

// Custom node component
function WorkflowNode({ data, selected }: { data: { label: string; nodeType: NodeType }; selected: boolean }) {
  const nodeColors: Record<NodeType, string> = {
    start: "bg-emerald-500",
    end: "bg-red-500",
    agent: "bg-blue-500",
    tool: "bg-purple-500",
    data: "bg-amber-500",
    condition: "bg-orange-500",
    merge: "bg-cyan-500",
  };

  return (
    <div
      className={cn(
        "px-4 py-2 rounded-lg border-2 shadow-sm min-w-[120px]",
        selected ? "border-primary" : "border-border",
        nodeColors[data.nodeType] || "bg-gray-500",
      )}
    >
      <div className="text-sm font-semibold text-white">{data.label}</div>
      <div className="text-xs text-white/80 mt-1">{data.nodeType}</div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  workflow: WorkflowNode,
};

const initialNodes: Node[] = [
  {
    id: "start",
    type: "workflow",
    position: { x: 250, y: 100 },
    data: { label: "Start", nodeType: "start" },
  },
];

const initialEdges: Edge[] = [];

export function WorkflowBuilder() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [workflowName, setWorkflowName] = useState("");
  const [workflowDescription, setWorkflowDescription] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const [executionId, setExecutionId] = useState<string | null>(null);

  // Load workflow if editing
  useEffect(() => {
    if (id && id !== "new") {
      setIsLoading(true);
      getWorkflow(id)
        .then(({ workflow, nodes: workflowNodes, edges: workflowEdges }) => {
          setWorkflowName(workflow.name);
          setWorkflowDescription(workflow.description || "");

          // Convert workflow nodes to React Flow nodes
          const flowNodes: Node[] = workflowNodes.map(node => ({
            id: node.id,
            type: "workflow",
            position: { x: node.position_x, y: node.position_y },
            data: {
              label: node.label,
              nodeType: node.node_type,
              config: node.config,
              mcp_server_id: node.mcp_server_id,
              mcp_command_name: node.mcp_command_name,
            },
          }));

          // Add start node if not present
          if (!flowNodes.find(n => n.data.nodeType === "start")) {
            flowNodes.unshift({
              id: "start",
              type: "workflow",
              position: { x: 250, y: 100 },
              data: { label: "Start", nodeType: "start" },
            });
          }

          setNodes(flowNodes);

          // Convert workflow edges to React Flow edges
          const flowEdges: Edge[] = workflowEdges.map(edge => ({
            id: edge.id,
            source: edge.source_node_id,
            target: edge.target_node_id,
            type: "smoothstep",
          }));

          setEdges(flowEdges);
        })
        .catch(error => {
          console.error("Failed to load workflow:", error);
          toast({
            title: "Error",
            description: "Failed to load workflow",
            variant: "destructive",
          });
        })
        .finally(() => setIsLoading(false));
    }
  }, [id, setNodes, setEdges, toast]);

  const onConnect = useCallback(
    (params: Connection) => {
      setEdges(eds => addEdge({ ...params, type: "smoothstep" }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
  }, []);

  const handleSave = async () => {
    if (!workflowName.trim()) {
      toast({
        title: "Error",
        description: "Workflow name is required",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      let workflowId = id;

      // Create or update workflow
      if (workflowId) {
        await updateWorkflow(workflowId, {
          name: workflowName,
          description: workflowDescription,
        });
      } else {
        const workflow = await createWorkflow(workflowName, workflowDescription);
        workflowId = workflow.id;
      }

      // Convert React Flow nodes to workflow nodes
      const workflowNodes = nodes.map((node, index) => ({
        id: node.id,
        node_type: (node.data.nodeType || "tool") as NodeType,
        label: node.data.label || `Node ${index + 1}`,
        position_x: node.position.x,
        position_y: node.position.y,
        config: node.data.config || {},
        mcp_server_id: node.data.mcp_server_id,
        mcp_command_name: node.data.mcp_command_name,
        execution_order: index,
        temp_id: node.id.startsWith("temp_") ? node.id : undefined,
      }));

      // Convert React Flow edges to workflow edges
      const workflowEdges = edges.map(edge => ({
        source_node_id: edge.source,
        target_node_id: edge.target,
        condition: undefined,
        data_mapping: {},
        source_temp_id: edge.source,
        target_temp_id: edge.target,
      }));

      await saveWorkflowGraph(workflowId, workflowNodes, workflowEdges);

      toast({
        title: "Success",
        description: "Workflow saved successfully",
      });

      // Update URL if this was a new workflow
      if (!id || id === "new") {
        navigate(`/workflows/${workflowId}`, { replace: true });
      }
    } catch (error) {
      console.error("Failed to save workflow:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to save workflow",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleRun = async () => {
    if (!id || id === "new") {
      toast({
        title: "Error",
        description: "Please save the workflow before running",
        variant: "destructive",
      });
      return;
    }

    setIsSaving(true);
    try {
      const response = await executeWorkflow({
        workflow_id: id,
        input_data: {},
        parameters: {},
      });

      toast({
        title: "Workflow Started",
        description: `Execution ID: ${response.execution_id}`,
      });

      setExecutionId(response.execution_id);
    } catch (error) {
      console.error("Failed to execute workflow:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to execute workflow",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddNode = (nodeType: NodeType) => {
    const newNode: Node = {
      id: `node-${Date.now()}`,
      type: "workflow",
      position: {
        x: Math.random() * 400 + 200,
        y: Math.random() * 400 + 200,
      },
      data: {
        label: nodeType.charAt(0).toUpperCase() + nodeType.slice(1),
        nodeType,
      },
    };

    setNodes(nds => [...nds, newNode]);
  };

  const handleDeleteNode = () => {
    if (selectedNode) {
      setNodes(nds => nds.filter(n => n.id !== selectedNode.id));
      setEdges(eds => eds.filter(e => e.source !== selectedNode.id && e.target !== selectedNode.id));
      setSelectedNode(null);
    }
  };

  const availableServers = useMemo(() => MCP_SERVER_REGISTRY, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-current border-r-transparent" />
          <p className="mt-4 text-muted-foreground">Loading workflow...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="sm" onClick={() => navigate("/")}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <div className="flex-1">
                <Input
                  placeholder="Workflow name..."
                  value={workflowName}
                  onChange={e => setWorkflowName(e.target.value)}
                  className="max-w-md"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4 mr-2" />
                {isSaving ? "Saving..." : "Save"}
              </Button>
              <Button onClick={handleRun} disabled={isSaving || !id || id === "new"}>
                <Play className="h-4 w-4 mr-2" />
                Run
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar */}
        <div className="w-80 border-r bg-muted/20 p-4 overflow-y-auto">
          <div className="space-y-4">
            <div>
              <Label>Description</Label>
              <Textarea
                value={workflowDescription}
                onChange={e => setWorkflowDescription(e.target.value)}
                placeholder="Describe your workflow..."
                className="mt-1"
                rows={3}
              />
            </div>

            <div>
              <Label>Add Nodes</Label>
              <div className="mt-2 space-y-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleAddNode("tool")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Tool Node
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleAddNode("agent")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Agent Node
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleAddNode("data")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Data Node
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleAddNode("condition")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Condition Node
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full justify-start"
                  onClick={() => handleAddNode("merge")}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Merge Node
                </Button>
              </div>
            </div>

            {selectedNode && (
              <div className="border-t pt-4">
                <div className="flex items-center justify-between mb-2">
                  <Label>Selected Node</Label>
                  <Button variant="ghost" size="sm" onClick={handleDeleteNode}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  value={selectedNode.data.label || ""}
                  onChange={e =>
                    setNodes(nds =>
                      nds.map(n =>
                        n.id === selectedNode.id ? { ...n, data: { ...n.data, label: e.target.value } } : n,
                      ),
                    )
                  }
                  placeholder="Node label..."
                />

                {selectedNode.data.nodeType === "tool" && (
                  <div className="mt-4 space-y-2">
                    <Label>MCP Server</Label>
                    <select
                      className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      value={selectedNode.data.mcp_server_id || ""}
                      onChange={e => {
                        setNodes(nds =>
                          nds.map(n =>
                            n.id === selectedNode.id
                              ? { ...n, data: { ...n.data, mcp_server_id: e.target.value } }
                              : n,
                          ),
                        );
                      }}
                    >
                      <option value="">Select server...</option>
                      {availableServers.map(server => (
                        <option key={server.id} value={server.id}>
                          {server.label}
                        </option>
                      ))}
                    </select>

                    {selectedNode.data.mcp_server_id && (
                      <>
                        <Label>Command</Label>
                        <select
                          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                          value={selectedNode.data.mcp_command_name || ""}
                          onChange={e => {
                            setNodes(nds =>
                              nds.map(n =>
                                n.id === selectedNode.id
                                  ? { ...n, data: { ...n.data, mcp_command_name: e.target.value } }
                                  : n,
                              ),
                            );
                          }}
                        >
                          <option value="">Select command...</option>
                          {availableServers
                            .find(s => s.id === selectedNode.data.mcp_server_id)
                            ?.commands.map(cmd => (
                              <option key={cmd.name} value={cmd.name}>
                                {cmd.title || cmd.name}
                              </option>
                            ))}
                        </select>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Canvas */}
        <div className="flex-1">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            nodeTypes={nodeTypes}
            fitView
          >
            <Background />
            <Controls />
            <MiniMap />
          </ReactFlow>
        </div>
      </div>

      {/* Execution Viewer Dialog */}
      <Dialog open={!!executionId} onOpenChange={(open) => !open && setExecutionId(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Workflow Execution</DialogTitle>
          </DialogHeader>
          {executionId && (
            <WorkflowExecutionViewer
              executionId={executionId}
              onClose={() => setExecutionId(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

