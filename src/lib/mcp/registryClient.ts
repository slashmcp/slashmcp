import type { McpRegistryEntry } from "./types";
import { supabaseClient } from "../supabaseClient";

const FUNCTIONS_URL =
  import.meta.env.VITE_SUPABASE_FUNCTIONS_URL ||
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1`
    : undefined);

if (!FUNCTIONS_URL) {
  console.warn("VITE_SUPABASE_FUNCTIONS_URL is not configured. MCP registry requests will fail.");
}

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
      throw new Error("Unable to authenticate user. Please sign in to use /slashmcp.");
    }

    headers.set("Authorization", `Bearer ${session.access_token}`);
  }

  const response = await fetch(`${FUNCTIONS_URL}/${path}`, {
    ...init,
    headers,
  });

  return response;
}

export interface RegisterMcpServerPayload {
  name: string;
  gatewayUrl: string;
  authType?: "none" | "api_key" | "oauth";
  authSecret?: string | null;
  metadata?: Record<string, unknown> | null;
}

export async function registerMcpServer(payload: RegisterMcpServerPayload) {
  const response = await callFunction("mcp-register", {
    method: "POST",
    body: JSON.stringify({
      name: payload.name,
      gatewayUrl: payload.gatewayUrl,
      authType: payload.authType ?? "none",
      authSecret: payload.authSecret ?? null,
      metadata: payload.metadata ?? null,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to register MCP server");
  }

  return response.json();
}

export async function listMcpServers(): Promise<McpRegistryEntry[]> {
  const response = await callFunction("mcp-get-registry", {
    method: "GET",
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to fetch MCP registry");
  }

  const data = (await response.json()) as { servers?: McpRegistryEntry[] };
  return data.servers ?? [];
}

export async function removeMcpServer(identifier: { serverId?: string; name?: string }) {
  if (!identifier.serverId && !identifier.name) {
    throw new Error("serverId or name is required");
  }

  const response = await callFunction("mcp-remove", {
    method: "POST",
    body: JSON.stringify(identifier),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error?.error || "Failed to remove MCP server");
  }

  return response.json();
}
