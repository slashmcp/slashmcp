import { supabaseClient } from "./supabaseClient";

export interface ApiKey {
  id: string;
  name: string;
  provider: string;
  key_type: "api_key" | "mcp_key" | "oauth_token";
  is_active: boolean;
  created_at: string;
  expires_at?: string | null;
  last_used_at?: string | null;
  usage_count: number;
  scope?: string | null;
  metadata?: Record<string, unknown>;
  keyValue?: string; // Only present when explicitly retrieved
}

export interface KeyManagerRequest {
  action: "add" | "list" | "get" | "update" | "delete" | "audit" | "check" | "stale";
  name?: string;
  provider?: string;
  keyType?: "api_key" | "mcp_key" | "oauth_token";
  keyValue?: string;
  expiresAt?: string;
  scope?: string;
  metadata?: Record<string, unknown>;
  keyId?: string;
  daysThreshold?: number;
}

export interface KeyManagerResponse {
  success: boolean;
  key?: ApiKey;
  keys?: ApiKey[];
  logs?: Array<{
    id: string;
    user_id: string;
    key_id?: string | null;
    action: string;
    provider?: string | null;
    key_name?: string | null;
    details: Record<string, unknown>;
    created_at: string;
  }>;
  staleKeys?: Array<{
    id: string;
    name: string;
    provider: string;
    key_type: string;
    last_used_at?: string | null;
    days_since_use: number;
  }>;
  error?: string;
}

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

async function callKeyManagerFunction(payload: KeyManagerRequest): Promise<KeyManagerResponse> {
  const {
    data: { session },
  } = await supabaseClient.auth.getSession();

  if (!session?.access_token) {
    throw new Error("Please sign in to manage API keys.");
  }

  const response = await fetch(`${SUPABASE_URL}/functions/v1/key-manager`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...(SUPABASE_ANON_KEY && { apikey: SUPABASE_ANON_KEY }),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(error.error || `Request failed with status ${response.status}`);
  }

  return await response.json();
}

export async function addApiKey(
  provider: string,
  name: string,
  keyType: "api_key" | "mcp_key" | "oauth_token",
  keyValue: string,
  options?: {
    expiresAt?: string;
    scope?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<ApiKey> {
  const response = await callKeyManagerFunction({
    action: "add",
    provider,
    name,
    keyType,
    keyValue,
    expiresAt: options?.expiresAt,
    scope: options?.scope,
    metadata: options?.metadata,
  });

  if (!response.success || !response.key) {
    throw new Error(response.error || "Failed to add API key");
  }

  return response.key;
}

export async function listApiKeys(): Promise<ApiKey[]> {
  const response = await callKeyManagerFunction({ action: "list" });

  if (!response.success) {
    throw new Error(response.error || "Failed to list API keys");
  }

  return response.keys || [];
}

export async function getApiKey(keyIdOrName: string, includeValue = false): Promise<ApiKey> {
  const response = await callKeyManagerFunction({
    action: "get",
    ...(keyIdOrName.startsWith("key_") ? { keyId: keyIdOrName } : { name: keyIdOrName }),
  });

  if (!response.success || !response.key) {
    throw new Error(response.error || "Failed to get API key");
  }

  return response.key;
}

export async function updateApiKey(
  keyId: string,
  updates: {
    name?: string;
    keyValue?: string;
    expiresAt?: string | null;
    scope?: string | null;
    metadata?: Record<string, unknown>;
    is_active?: boolean;
  }
): Promise<ApiKey> {
  const response = await callKeyManagerFunction({
    action: "update",
    keyId,
    ...updates,
  });

  if (!response.success || !response.key) {
    throw new Error(response.error || "Failed to update API key");
  }

  return response.key;
}

export async function deleteApiKey(keyIdOrName: string): Promise<void> {
  const response = await callKeyManagerFunction({
    action: "delete",
    ...(keyIdOrName.startsWith("key_") ? { keyId: keyIdOrName } : { name: keyIdOrName }),
  });

  if (!response.success) {
    throw new Error(response.error || "Failed to delete API key");
  }
}

export async function getAuditLogs(): Promise<KeyManagerResponse["logs"]> {
  const response = await callKeyManagerFunction({ action: "audit" });

  if (!response.success) {
    throw new Error(response.error || "Failed to retrieve audit logs");
  }

  return response.logs || [];
}

export async function getStaleKeys(daysThreshold = 90): Promise<KeyManagerResponse["staleKeys"]> {
  const response = await callKeyManagerFunction({
    action: "stale",
    daysThreshold,
  });

  if (!response.success) {
    throw new Error(response.error || "Failed to check for stale keys");
  }

  return response.staleKeys || [];
}

export async function checkApiKey(keyIdOrName: string): Promise<ApiKey> {
  const response = await callKeyManagerFunction({
    action: "check",
    ...(keyIdOrName.startsWith("key_") ? { keyId: keyIdOrName } : { name: keyIdOrName }),
  });

  if (!response.success || !response.key) {
    throw new Error(response.error || "Failed to check API key");
  }

  return response.key;
}

