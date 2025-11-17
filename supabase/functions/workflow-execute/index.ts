import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ExecuteWorkflowRequest {
  workflow_id: string;
  input_data?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
}

interface WorkflowNode {
  id: string;
  node_type: string;
  label: string;
  position_x: number;
  position_y: number;
  config: Record<string, unknown>;
  mcp_server_id?: string;
  mcp_command_name?: string;
  execution_order?: number;
}

interface WorkflowEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  condition?: string;
  data_mapping?: Record<string, unknown>;
}

interface ExecutionContext {
  executionId: string;
  workflowId: string;
  userId: string;
  nodeOutputs: Map<string, unknown>;
  nodeStatuses: Map<string, "pending" | "running" | "completed" | "failed">;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get authentication
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Parse request
    const body: ExecuteWorkflowRequest = await req.json();
    const { workflow_id, input_data = {}, parameters = {} } = body;

    // Load workflow
    const { data: workflow, error: workflowError } = await supabase
      .from("workflows")
      .select("*")
      .eq("id", workflow_id)
      .eq("user_id", user.id)
      .single();

    if (workflowError || !workflow) {
      return new Response(JSON.stringify({ error: "Workflow not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Load nodes and edges
    const { data: nodes, error: nodesError } = await supabase
      .from("workflow_nodes")
      .select("*")
      .eq("workflow_id", workflow_id)
      .order("execution_order", { ascending: true, nullsFirst: false });

    if (nodesError) {
      return new Response(JSON.stringify({ error: "Failed to load workflow nodes" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: edges, error: edgesError } = await supabase
      .from("workflow_edges")
      .select("*")
      .eq("workflow_id", workflow_id);

    if (edgesError) {
      return new Response(JSON.stringify({ error: "Failed to load workflow edges" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Create execution record
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .insert({
        workflow_id,
        user_id: user.id,
        status: "pending",
        input_data,
      })
      .select()
      .single();

    if (execError || !execution) {
      return new Response(JSON.stringify({ error: "Failed to create execution record" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Start execution asynchronously (don't await)
    executeWorkflow(
      supabase,
      execution.id,
      workflow_id,
      user.id,
      nodes || [],
      edges || [],
      input_data,
      parameters,
    ).catch(error => {
      console.error("Workflow execution error:", error);
      supabase
        .from("workflow_executions")
        .update({
          status: "failed",
          error_message: error.message,
          completed_at: new Date().toISOString(),
        })
        .eq("id", execution.id);
    });

    // Return immediately
    return new Response(
      JSON.stringify({
        execution_id: execution.id,
        status: "pending",
        workflow_id,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

async function executeWorkflow(
  supabase: any,
  executionId: string,
  workflowId: string,
  userId: string,
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  inputData: Record<string, unknown>,
  parameters: Record<string, string | number | boolean>,
) {
  // Update execution status
  await supabase
    .from("workflow_executions")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", executionId);

  // Build execution context
  const context: ExecutionContext = {
    executionId,
    workflowId,
    userId,
    nodeOutputs: new Map(),
    nodeStatuses: new Map(),
  };

  // Build graph structure
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const edgesBySource = new Map<string, WorkflowEdge[]>();
  const edgesByTarget = new Map<string, WorkflowEdge[]>();

  for (const edge of edges) {
    if (!edgesBySource.has(edge.source_node_id)) {
      edgesBySource.set(edge.source_node_id, []);
    }
    edgesBySource.get(edge.source_node_id)!.push(edge);

    if (!edgesByTarget.has(edge.target_node_id)) {
      edgesByTarget.set(edge.target_node_id, []);
    }
    edgesByTarget.get(edge.target_node_id)!.push(edge);
  }

  // Find start node
  const startNode = nodes.find(n => n.node_type === "start");
  if (!startNode) {
    throw new Error("Workflow must have a start node");
  }

  // Topological sort for execution order
  const executionOrder = topologicalSort(nodes, edges);

  // Execute nodes in order
  for (const nodeId of executionOrder) {
    const node = nodeMap.get(nodeId);
    if (!node) continue;

    // Skip start/end nodes (they're just markers)
    if (node.node_type === "start" || node.node_type === "end") {
      if (node.node_type === "start") {
        context.nodeOutputs.set(nodeId, inputData);
      }
      continue;
    }

    // Get input data from source nodes
    const inputEdges = edgesByTarget.get(nodeId) || [];
    const inputData: Record<string, unknown> = {};

    for (const edge of inputEdges) {
      const sourceOutput = context.nodeOutputs.get(edge.source_node_id);
      if (sourceOutput) {
        // Apply data mapping if defined
        if (edge.data_mapping) {
          Object.entries(edge.data_mapping).forEach(([targetKey, sourcePath]) => {
            inputData[targetKey] = extractValue(sourceOutput, sourcePath as string);
          });
        } else {
          // Default: merge all source outputs
          Object.assign(inputData, sourceOutput as Record<string, unknown>);
        }
      }
    }

    // Execute node
    try {
      context.nodeStatuses.set(nodeId, "running");

      // Create node execution record
      const { data: nodeExecution } = await supabase
        .from("node_executions")
        .insert({
          execution_id: executionId,
          node_id: nodeId,
          status: "running",
          input_data: inputData,
          started_at: new Date().toISOString(),
        })
        .select()
        .single();

      const output = await executeNode(supabase, node, inputData, parameters);

      // Update node execution
      await supabase
        .from("node_executions")
        .update({
          status: "completed",
          output_data: output,
          completed_at: new Date().toISOString(),
        })
        .eq("id", nodeExecution?.id);

      context.nodeOutputs.set(nodeId, output);
      context.nodeStatuses.set(nodeId, "completed");
    } catch (error) {
      console.error(`Node ${nodeId} execution failed:`, error);
      context.nodeStatuses.set(nodeId, "failed");

      // Update node execution with error
      const { data: nodeExecution } = await supabase
        .from("node_executions")
        .select("id")
        .eq("execution_id", executionId)
        .eq("node_id", nodeId)
        .single();

      if (nodeExecution) {
        await supabase
          .from("node_executions")
          .update({
            status: "failed",
            error_message: error instanceof Error ? error.message : String(error),
            completed_at: new Date().toISOString(),
          })
          .eq("id", nodeExecution.id);
      }

      // Fail fast for now (can be configurable later)
      throw error;
    }
  }

  // Collect final outputs from end nodes
  const endNodes = nodes.filter(n => n.node_type === "end");
  const finalOutput: Record<string, unknown> = {};

  for (const endNode of endNodes) {
    const inputEdges = edgesByTarget.get(endNode.id) || [];
    for (const edge of inputEdges) {
      const sourceOutput = context.nodeOutputs.get(edge.source_node_id);
      if (sourceOutput) {
        Object.assign(finalOutput, sourceOutput as Record<string, unknown>);
      }
    }
  }

  // Update execution as completed
  await supabase
    .from("workflow_executions")
    .update({
      status: "completed",
      output_data: finalOutput,
      completed_at: new Date().toISOString(),
    })
    .eq("id", executionId);
}

async function executeNode(
  supabase: any,
  node: WorkflowNode,
  inputData: Record<string, unknown>,
  parameters: Record<string, string | number | boolean>,
): Promise<Record<string, unknown>> {
  switch (node.node_type) {
    case "tool":
    case "agent":
      if (!node.mcp_server_id || !node.mcp_command_name) {
        throw new Error(`Node ${node.label} is missing MCP server or command`);
      }
      return await executeMcpCommand(supabase, node, inputData, parameters);

    case "data":
      return await executeDataNode(node, inputData);

    case "condition":
      return await executeConditionNode(node, inputData, parameters);

    case "merge":
      return await executeMergeNode(node, inputData);

    default:
      throw new Error(`Unknown node type: ${node.node_type}`);
  }
}

async function executeMcpCommand(
  supabase: any,
  node: WorkflowNode,
  inputData: Record<string, unknown>,
  parameters: Record<string, string | number | boolean>,
): Promise<Record<string, unknown>> {
  // Build command parameters from config, input data, and workflow parameters
  const nodeConfig = node.config as Record<string, unknown>;
  const commandParams: Record<string, string> = {};

  // Merge parameters: config -> inputData -> workflow parameters
  Object.assign(commandParams, nodeConfig);
  Object.assign(commandParams, inputData);
  Object.assign(commandParams, parameters);

  // Call MCP proxy function
  const FUNCTIONS_URL = Deno.env.get("SUPABASE_URL") + "/functions/v1";
  const response = await fetch(`${FUNCTIONS_URL}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
    },
    body: JSON.stringify({
      serverId: node.mcp_server_id,
      command: node.mcp_command_name,
      args: commandParams,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || `MCP command failed: ${response.statusText}`);
  }

  const result = await response.json();
  return { result: result.result || result };
}

async function executeDataNode(
  node: WorkflowNode,
  inputData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = node.config as { operation?: string; expression?: string };
  const operation = config.operation || "transform";

  switch (operation) {
    case "transform":
      // Simple pass-through for now (can add expression evaluation later)
      return inputData;
    case "filter":
      // TODO: Implement filtering
      return inputData;
    case "merge":
      // TODO: Implement merging
      return inputData;
    default:
      return inputData;
  }
}

async function executeConditionNode(
  node: WorkflowNode,
  inputData: Record<string, unknown>,
  parameters: Record<string, string | number | boolean>,
): Promise<Record<string, unknown>> {
  const config = node.config as { condition?: string };
  const condition = config.condition || "true";

  // Simple condition evaluation (can be enhanced with a proper expression parser)
  try {
    // For now, just check if condition string exists
    const result = condition.toLowerCase() !== "false" && condition !== "0";
    return { condition_result: result, ...inputData };
  } catch {
    return { condition_result: true, ...inputData };
  }
}

async function executeMergeNode(
  node: WorkflowNode,
  inputData: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const config = node.config as { merge_strategy?: string };
  const strategy = config.merge_strategy || "merge";

  // For now, just return input data (merge logic handled at edge level)
  return inputData;
}

function topologicalSort(nodes: WorkflowNode[], edges: WorkflowEdge[]): string[] {
  const nodeIds = new Set(nodes.map(n => n.id));
  const inDegree = new Map<string, number>();
  const adjList = new Map<string, string[]>();

  // Initialize
  for (const nodeId of nodeIds) {
    inDegree.set(nodeId, 0);
    adjList.set(nodeId, []);
  }

  // Build graph
  for (const edge of edges) {
    if (!nodeIds.has(edge.source_node_id) || !nodeIds.has(edge.target_node_id)) {
      continue;
    }

    const currentInDegree = inDegree.get(edge.target_node_id) || 0;
    inDegree.set(edge.target_node_id, currentInDegree + 1);

    const neighbors = adjList.get(edge.source_node_id) || [];
    neighbors.push(edge.target_node_id);
    adjList.set(edge.source_node_id, neighbors);
  }

  // Kahn's algorithm
  const queue: string[] = [];
  const result: string[] = [];

  // Find start nodes (inDegree = 0)
  for (const [nodeId, degree] of inDegree.entries()) {
    if (degree === 0) {
      queue.push(nodeId);
    }
  }

  while (queue.length > 0) {
    const nodeId = queue.shift()!;
    result.push(nodeId);

    const neighbors = adjList.get(nodeId) || [];
    for (const neighbor of neighbors) {
      const currentInDegree = inDegree.get(neighbor) || 0;
      inDegree.set(neighbor, currentInDegree - 1);

      if (inDegree.get(neighbor) === 0) {
        queue.push(neighbor);
      }
    }
  }

  return result;
}

function extractValue(obj: unknown, path: string): unknown {
  if (!path || path === ".") return obj;

  // Handle JSONPath-like syntax ($.field.nested)
  const cleanPath = path.replace(/^\$\.?/, "");
  const parts = cleanPath.split(".");

  let current: any = obj;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = current[part];
    } else {
      return undefined;
    }
  }

  return current;
}

