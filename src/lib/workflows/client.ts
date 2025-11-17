// Client-side functions for interacting with workflow API

import { supabaseClient } from "../supabaseClient";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  WorkflowWithGraph,
  ExecuteWorkflowRequest,
  ExecuteWorkflowResponse,
} from "./types";

const FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    : undefined);

async function callFunction(path: string, init: RequestInit = {}): Promise<Response> {
  if (!FUNCTIONS_URL) {
    throw new Error("Supabase functions URL is not configured");
  }

  const headers = new Headers(init.headers ?? {});
  headers.set("Content-Type", "application/json");
  if (!headers.has("Authorization")) {
    const {
      data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session?.access_token) {
      throw new Error("Unable to authenticate user. Please sign in.");
    }

    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
    ...init,
    headers,
  });

  return response;
}

// Get all workflows for the current user
export async function listWorkflows(includeTemplates = false): Promise<Workflow[]> {
  const { data, error } = await supabaseClient
    .from("workflows")
    .select("*")
    .eq("user_id", (await supabaseClient.auth.getUser()).data.user?.id || "")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  if (includeTemplates) {
    const { data: templates, error: templateError } = await supabaseClient
      .from("workflows")
      .select("*")
      .eq("is_template", true)
      .order("name", { ascending: true });

    if (templateError) throw templateError;
    return [...(data || []), ...(templates || [])];
  }

  return data || [];
}

// Get a single workflow with its nodes and edges
export async function getWorkflow(workflowId: string): Promise<WorkflowWithGraph> {
  const { data: workflow, error: workflowError } = await supabaseClient
    .from("workflows")
    .select("*")
    .eq("id", workflowId)
    .single();

  if (workflowError) throw workflowError;

  const { data: nodes, error: nodesError } = await supabaseClient
    .from("workflow_nodes")
    .select("*")
    .eq("workflow_id", workflowId)
    .order("execution_order", { ascending: true, nullsFirst: false });

  if (nodesError) throw nodesError;

  const { data: edges, error: edgesError } = await supabaseClient
    .from("workflow_edges")
    .select("*")
    .eq("workflow_id", workflowId);

  if (edgesError) throw edgesError;

  return {
    workflow,
    nodes: nodes || [],
    edges: edges || [],
  };
}

// Create a new workflow
export async function createWorkflow(
  name: string,
  description?: string,
  isTemplate = false,
): Promise<Workflow> {
  const {
    data: { user },
  } = await supabaseClient.auth.getUser();

  if (!user) throw new Error("User not authenticated");

  const { data, error } = await supabaseClient
    .from("workflows")
    .insert({
      user_id: user.id,
      name,
      description,
      is_template: isTemplate,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Update a workflow
export async function updateWorkflow(
  workflowId: string,
  updates: Partial<Pick<Workflow, "name" | "description" | "metadata">>,
): Promise<Workflow> {
  const { data, error } = await supabaseClient
    .from("workflows")
    .update(updates)
    .eq("id", workflowId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Delete a workflow
export async function deleteWorkflow(workflowId: string): Promise<void> {
  const { error } = await supabaseClient.from("workflows").delete().eq("id", workflowId);

  if (error) throw error;
}

// Save workflow graph (nodes and edges)
// Nodes should have temporary IDs that we'll map to database IDs
export async function saveWorkflowGraph(
  workflowId: string,
  nodes: Array<Omit<WorkflowNode, "workflow_id" | "created_at" | "updated_at"> & { temp_id?: string }>,
  edges: Array<Omit<WorkflowEdge, "id" | "workflow_id" | "created_at"> & { 
    source_temp_id?: string; 
    target_temp_id?: string;
  }>,
): Promise<{ nodeIdMap: Map<string, string> }> {
  // Delete existing nodes and edges
  await supabaseClient.from("workflow_edges").delete().eq("workflow_id", workflowId);
  await supabaseClient.from("workflow_nodes").delete().eq("workflow_id", workflowId);

  const nodeIdMap = new Map<string, string>();

  // Insert new nodes
  if (nodes.length > 0) {
    const nodesToInsert = nodes.map(({ temp_id, id, ...node }) => {
      const nodeData: any = {
        ...node,
        workflow_id: workflowId,
      };
      // Use existing id if it's a UUID, otherwise let DB generate
      if (id && id.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
        nodeData.id = id;
      }
      return nodeData;
    });

    const { data: insertedNodes, error: nodesError } = await supabaseClient
      .from("workflow_nodes")
      .insert(nodesToInsert)
      .select("id, label");

    if (nodesError) throw nodesError;

    // Map temp IDs to real IDs
    insertedNodes?.forEach((inserted, index) => {
      const original = nodes[index];
      if (original.temp_id) {
        nodeIdMap.set(original.temp_id, inserted.id);
      }
      // Also map by label as fallback
      nodeIdMap.set(original.label, inserted.id);
    });
  }

  // Insert new edges
  if (edges.length > 0) {
    const edgesToInsert = edges
      .map(edge => {
        // Try to resolve source and target IDs
        let sourceId = edge.source_node_id;
        let targetId = edge.target_node_id;

        // If edge uses temp IDs, resolve them
        if (edge.source_temp_id && nodeIdMap.has(edge.source_temp_id)) {
          sourceId = nodeIdMap.get(edge.source_temp_id)!;
        }
        if (edge.target_temp_id && nodeIdMap.has(edge.target_temp_id)) {
          targetId = nodeIdMap.get(edge.target_temp_id)!;
        }

        // If still using temp IDs, try to resolve by label
        if (!sourceId || !targetId) {
          return null;
        }

        return {
          workflow_id: workflowId,
          source_node_id: sourceId,
          target_node_id: targetId,
          condition: edge.condition,
          data_mapping: edge.data_mapping,
        };
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);

    if (edgesToInsert.length > 0) {
      const { error: edgesError } = await supabaseClient
        .from("workflow_edges")
        .insert(edgesToInsert);

      if (edgesError) throw edgesError;
    }
  }

  return { nodeIdMap };
}

// Execute a workflow
export async function executeWorkflow(
  request: ExecuteWorkflowRequest,
): Promise<ExecuteWorkflowResponse> {
  const response = await callFunction("workflow-execute", {
    method: "POST",
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to execute workflow");
  }

  return response.json();
}

