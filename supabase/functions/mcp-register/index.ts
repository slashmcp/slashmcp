import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Database } from "../_shared/database.types.ts";

interface RegisterPayload {
  name?: string;
  gatewayUrl?: string;
  authType?: "none" | "api_key" | "oauth";
  authSecret?: string | null;
  metadata?: Record<string, unknown> | null;
}

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function encodeSecret(secret?: string | null): string | null {
  if (!secret) return null;
  const bytes = new TextEncoder().encode(secret);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function isHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") {
      return true;
    }
    // Allow http for localhost-style development URLs so that MCP servers
    // running on the developer machine can be registered without requiring
    // a public HTTPS tunnel.
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

async function performHealthCheck(
  gatewayUrl: string,
): Promise<{ ok: boolean; toolCount?: number; message?: string }> {
  try {
    const url = new URL("listTools", gatewayUrl.endsWith("/") ? gatewayUrl : `${gatewayUrl}/`);
    const response = await fetch(url.toString(), { method: "GET", headers: { Accept: "application/json" } });

    // If the gateway responds at all, consider it reachable. We only use the
    // status and body to populate metadata for the user; a non-2xx status
    // shouldn't block registration (some MCP servers may not expose /listTools).
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      return {
        ok: true,
        message: `Health check reachable but non-2xx (${response.status}): ${text?.slice(0, 200)}`,
      };
    }

    const data = await response.json().catch(() => undefined);
    const toolCount = Array.isArray((data as { tools?: unknown[] })?.tools)
      ? (data as { tools: unknown[] }).tools.length
      : undefined;
    return { ok: true, toolCount };
  } catch (error) {
    // As a last resort, still allow localhost-style gateways to register even
    // if the health check fails entirely (e.g. server starting up).
    try {
      const url = new URL(gatewayUrl);
      if (url.hostname === "localhost" || url.hostname === "127.0.0.1") {
        return {
          ok: true,
          message:
            error instanceof Error
              ? `Health check skipped for localhost gateway: ${error.message}`
              : "Health check skipped for localhost gateway.",
        };
      }
    } catch {
      // ignore parse errors and fall through
    }

    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server is not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const accessToken = authHeader.replace(/Bearer\s+/i, "").trim();
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: RegisterPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const name = body.name?.trim();
  const gatewayUrl = body.gatewayUrl?.trim();
  const authType = body.authType ?? "none";

  if (!name) {
    return new Response(JSON.stringify({ error: "name is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!gatewayUrl || !isHttpsUrl(gatewayUrl)) {
    return new Response(JSON.stringify({ error: "gatewayUrl must be a valid HTTPS endpoint" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!["none", "api_key", "oauth"].includes(authType)) {
    return new Response(JSON.stringify({ error: "authType must be one of none, api_key, oauth" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(accessToken);
  if (userError || !user) {
    return new Response(JSON.stringify({ error: "Unable to authenticate user" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const healthCheck = await performHealthCheck(gatewayUrl);
  if (!healthCheck.ok) {
    return new Response(JSON.stringify({ error: "Gateway health check failed", details: healthCheck.message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: existingName } = await supabase
    .from("mcp_servers")
    .select("id")
    .eq("user_id", user.id)
    .eq("name", name)
    .maybeSingle();
  if (existingName) {
    return new Response(JSON.stringify({ error: "You already have a server registered with this name" }), {
      status: 409,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data, error } = await supabase
    .from("mcp_servers")
    .insert({
      user_id: user.id,
      name,
      gateway_url: gatewayUrl,
      auth_type: authType,
      auth_secret: encodeSecret(body.authSecret),
      metadata: body.metadata ?? null,
      last_health_check: new Date().toISOString(),
    })
    .select("id, name, gateway_url")
    .single();

  if (error || !data) {
    console.error("mcp/register insert error", error);
    return new Response(JSON.stringify({ error: "Failed to register server" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      id: data.id,
      name: data.name,
      gatewayUrl: data.gateway_url,
      toolCount: healthCheck.toolCount ?? null,
    }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    },
  );
});
