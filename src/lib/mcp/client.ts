import type { McpInvocation, McpInvocationResponse, McpInvocationResult } from "./types";

const fallbackFunctionsUrl = import.meta.env.VITE_SUPABASE_FUNCTIONS_URL;
const MCP_GATEWAY_URL =
  import.meta.env.VITE_MCP_GATEWAY_URL && import.meta.env.VITE_MCP_GATEWAY_URL.trim() !== ""
    ? import.meta.env.VITE_MCP_GATEWAY_URL.trim()
    : fallbackFunctionsUrl
    ? `${fallbackFunctionsUrl.replace(/\/+$/, "")}/mcp`
    : undefined;

const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const MCP_TIMEOUT_MS = 60_000;

export class McpClientNotConfiguredError extends Error {
  constructor() {
    super("MCP gateway URL is not configured. Set VITE_MCP_GATEWAY_URL to enable MCP commands.");
    this.name = "McpClientNotConfiguredError";
  }
}

export async function invokeMcpCommand(invocation: McpInvocation): Promise<McpInvocationResponse> {
  if (!MCP_GATEWAY_URL) {
    throw new McpClientNotConfiguredError();
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort("timeout"), MCP_TIMEOUT_MS);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (SUPABASE_ANON_KEY) {
      headers.apikey = SUPABASE_ANON_KEY;
      headers.Authorization = `Bearer ${SUPABASE_ANON_KEY}`;
    }

    const response = await fetch(MCP_GATEWAY_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(invocation),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => undefined);
      const message = errorPayload?.error || `MCP gateway request failed with status ${response.status}`;
      throw new Error(message);
    }

    const data = (await response.json()) as McpInvocationResponse | McpInvocationResult;

    if ("result" in data && data.result) {
      return data;
    }

    // Normalize bare result payloads into the wrapper shape.
    const result = data as McpInvocationResult;
    return {
      invocation,
      result,
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function isTextualResult(result: McpInvocationResult): result is { type: "text" | "markdown"; content: string } {
  return result.type === "text" || result.type === "markdown";
}

export function isErrorResult(result: McpInvocationResult): result is { type: "error"; message: string } {
  return result.type === "error";
}

