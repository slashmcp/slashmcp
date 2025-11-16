// Known static server ids include values like "alphavantage-mcp" or "playwright-mcp",
// but at runtime we also support dynamic user-registered servers (e.g. srv_... ids).
// To keep the client flexible, McpServerId is a plain string type.
export type McpServerId = string;

export interface McpRegistryEntry {
  id: string;
  name: string;
  gateway_url: string;
  auth_type: "none" | "api_key" | "oauth";
  is_active: boolean;
  last_health_check: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface McpProviderPreset {
  id: string;
  label: string;
  description?: string;
  gatewayUrl?: string;
  authType: "none" | "api_key" | "oauth";
  requiresSecret?: boolean;
  metadata?: Record<string, unknown> | null;
  notes?: string;
}

export type McpResultType = "text" | "markdown" | "json" | "table" | "binary";

export interface McpParameterDefinition {
  name: string;
  description: string;
  required?: boolean;
  type?: "string" | "number" | "boolean" | "enum";
  options?: string[];
  example?: string;
}

export interface McpCommandDefinition {
  name: string;
  title: string;
  description: string;
  parameters?: McpParameterDefinition[];
  example?: string;
  defaultParams?: Record<string, string>;
}

export interface McpServerDefinition {
  id: McpServerId;
  label: string;
  description: string;
  category: "financial" | "prediction" | "knowledge" | "design" | "automation";
  install: string;
  docUrl?: string;
  environment?: string[];
  commands: McpCommandDefinition[];
}

export interface McpInvocation {
  serverId: McpServerId;
  command?: string;
  args: Record<string, string>;
  positionalArgs: string[];
  rawInput: string;
}

export interface McpTextResult {
  type: "text" | "markdown";
  content: string;
}

export interface McpJsonResult {
  type: "json";
  data: unknown;
  summary?: string;
}

export interface McpTableResult {
  type: "table";
  columns: string[];
  rows: Array<string[]>;
  summary?: string;
}

export interface McpBinaryResult {
  type: "binary";
  contentType: string;
  data: string;
  filename?: string;
  note?: string;
}

export interface McpErrorResult {
  type: "error";
  message: string;
  details?: unknown;
}

export type McpInvocationResult =
  | McpTextResult
  | McpJsonResult
  | McpTableResult
  | McpBinaryResult
  | McpErrorResult;

export interface McpInvocationResponse {
  invocation: McpInvocation;
  result: McpInvocationResult;
  timestamp: string;
  latencyMs?: number;
  raw?: unknown;
}

