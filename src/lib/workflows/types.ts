// TypeScript types for workflow data model

export type NodeType = "agent" | "tool" | "data" | "condition" | "merge" | "start" | "end";

export type ExecutionStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "skipped";

export interface Workflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  is_template: boolean;
  template_category?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface WorkflowNode {
  id: string;
  workflow_id: string;
  node_type: NodeType;
  label: string;
  position_x: number;
  position_y: number;
  config: Record<string, unknown>;
  mcp_server_id?: string;
  mcp_command_name?: string;
  execution_order?: number;
  created_at: string;
  updated_at: string;
}

export interface WorkflowEdge {
  id: string;
  workflow_id: string;
  source_node_id: string;
  target_node_id: string;
  condition?: string;
  data_mapping?: Record<string, unknown>;
  created_at: string;
}

export interface WorkflowExecution {
  id: string;
  workflow_id: string;
  user_id: string;
  status: ExecutionStatus;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
}

export interface NodeExecution {
  id: string;
  execution_id: string;
  node_id: string;
  status: ExecutionStatus;
  input_data?: Record<string, unknown>;
  output_data?: Record<string, unknown>;
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  latency_ms?: number;
  created_at: string;
}

// Frontend representation of a workflow (with nodes and edges loaded)
export interface WorkflowWithGraph {
  workflow: Workflow;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

// Node configuration types based on node type
export interface AgentNodeConfig {
  mcp_server_id: string;
  mcp_command_name: string;
  parameters: Record<string, string | number | boolean>;
  output_mapping?: Record<string, string>;
}

export interface ToolNodeConfig {
  mcp_server_id: string;
  mcp_command_name: string;
  parameters: Record<string, string | number | boolean>;
}

export interface DataNodeConfig {
  operation: "transform" | "filter" | "merge" | "split";
  expression?: string;
  mapping?: Record<string, string>;
}

export interface ConditionNodeConfig {
  condition: string; // JavaScript expression or template
  true_path?: string; // Node ID for true branch
  false_path?: string; // Node ID for false branch
}

export interface MergeNodeConfig {
  merge_strategy: "concat" | "merge" | "zip";
  input_count: number;
}

// Workflow execution request
export interface ExecuteWorkflowRequest {
  workflow_id: string;
  input_data?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
}

// Workflow execution response
export interface ExecuteWorkflowResponse {
  execution_id: string;
  status: ExecutionStatus;
  workflow_id: string;
}

