import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Database } from "../_shared/database.types.ts";

interface KeyManagerRequest {
  action: "add" | "list" | "get" | "update" | "delete" | "audit" | "check" | "stale";
  name?: string;
  provider?: string;
  keyType?: "api_key" | "mcp_key" | "oauth_token";
  keyValue?: string; // Only for add/update - should be sent securely
  expiresAt?: string; // ISO date string
  scope?: string;
  metadata?: Record<string, unknown>;
  keyId?: string;
  daysThreshold?: number; // For stale key detection
}

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const ENCRYPTION_KEY = Deno.env.get("ENCRYPTION_KEY") ?? "default-encryption-key-change-in-production";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
};

// Helper to get client IP and user agent for audit logging
function getRequestMetadata(req: Request): { ip?: string; userAgent?: string } {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
             req.headers.get("x-real-ip") ||
             undefined;
  const userAgent = req.headers.get("user-agent") || undefined;
  return { ip, userAgent };
}

// Log an audit event
async function logAudit(
  supabase: ReturnType<typeof createClient<Database>>,
  userId: string,
  action: string,
  keyId: string | null,
  provider: string | null,
  keyName: string | null,
  details: Record<string, unknown>,
  ip?: string,
  userAgent?: string
): Promise<void> {
  try {
    await supabase.rpc("log_key_action", {
      p_user_id: userId,
      p_action: action,
      p_key_id: keyId,
      p_provider: provider,
      p_key_name: keyName,
      p_details: { ...details, ip, userAgent },
    });
  } catch (error) {
    console.error("Failed to log audit event:", error);
    // Don't fail the request if audit logging fails
  }
}

// Encrypt key value using pgcrypto via RPC
async function encryptKey(supabase: ReturnType<typeof createClient<Database>>, keyValue: string): Promise<bytea | null> {
  try {
    const { data, error } = await supabase.rpc("encrypt_key_value", {
      key_value: keyValue,
      encryption_key: ENCRYPTION_KEY,
    });

    if (error) {
      console.error("Encryption error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Encryption failed:", error);
    return null;
  }
}

// Decrypt key value using pgcrypto via RPC
async function decryptKey(supabase: ReturnType<typeof createClient<Database>>, encryptedValue: bytea): Promise<string | null> {
  try {
    const { data, error } = await supabase.rpc("decrypt_key_value", {
      encrypted_value: encryptedValue,
      encryption_key: ENCRYPTION_KEY,
    });

    if (error) {
      console.error("Decryption error:", error);
      return null;
    }

    return data;
  } catch (error) {
    console.error("Decryption failed:", error);
    return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return new Response(JSON.stringify({ error: "Server not configured" }), {
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

  const requestMeta = getRequestMetadata(req);
  let body: KeyManagerRequest;

  if (req.method === "GET") {
    // For GET requests, parse action from query params
    const url = new URL(req.url);
    const action = url.searchParams.get("action") || "list";
    body = { action: action as KeyManagerRequest["action"] };
  } else {
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  }

  const { action } = body;
  if (!action) {
    return new Response(JSON.stringify({ error: "action is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    switch (action) {
      case "add": {
        const { name, provider, keyType, keyValue, expiresAt, scope, metadata } = body;
        if (!name || !provider || !keyType || !keyValue) {
          return new Response(
            JSON.stringify({ error: "name, provider, keyType, and keyValue are required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Check for duplicate name
        const { data: existing } = await supabase
          .from("api_keys")
          .select("id")
          .eq("user_id", user.id)
          .eq("name", name)
          .maybeSingle();

        if (existing) {
          return new Response(
            JSON.stringify({ error: "A key with this name already exists" }),
            { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Encrypt the key
        const encryptedKey = await encryptKey(supabase, keyValue);
        if (!encryptedKey) {
          return new Response(
            JSON.stringify({ error: "Failed to encrypt key" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Insert the key
        const { data: keyData, error: insertError } = await supabase
          .from("api_keys")
          .insert({
            user_id: user.id,
            name,
            provider,
            key_type: keyType,
            encrypted_key: encryptedKey,
            expires_at: expiresAt || null,
            scope: scope || null,
            metadata: metadata || {},
          })
          .select("id, name, provider, key_type, created_at, expires_at, scope")
          .single();

        if (insertError || !keyData) {
          console.error("Insert error:", insertError);
          return new Response(
            JSON.stringify({ error: "Failed to add key" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(supabase, user.id, "add", keyData.id, provider, name, {}, requestMeta.ip, requestMeta.userAgent);

        return new Response(JSON.stringify({ success: true, key: keyData }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "list": {
        const { data: keys, error } = await supabase
          .from("api_keys")
          .select("id, name, provider, key_type, is_active, created_at, expires_at, last_used_at, usage_count, scope, metadata")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false });

        if (error) {
          console.error("List error:", error);
          return new Response(
            JSON.stringify({ error: "Failed to list keys" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        return new Response(JSON.stringify({ success: true, keys: keys || [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "get": {
        const { keyId, name } = body;
        if (!keyId && !name) {
          return new Response(
            JSON.stringify({ error: "keyId or name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const query = supabase
          .from("api_keys")
          .select("id, name, provider, key_type, encrypted_key, is_active, created_at, expires_at, last_used_at, usage_count, scope, metadata")
          .eq("user_id", user.id);

        if (keyId) {
          query.eq("id", keyId);
        } else {
          query.eq("name", name);
        }

        const { data: keyData, error } = await query.maybeSingle();

        if (error || !keyData) {
          return new Response(
            JSON.stringify({ error: "Key not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Decrypt the key value (only return it if explicitly requested)
        const decryptedValue = await decryptKey(supabase, keyData.encrypted_key as bytea);
        
        // Don't include encrypted_key in response, only decrypted if needed
        const { encrypted_key, ...safeKeyData } = keyData;
        
        return new Response(
          JSON.stringify({
            success: true,
            key: {
              ...safeKeyData,
              keyValue: decryptedValue, // Include decrypted value
            },
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      case "update": {
        const { keyId, name, keyValue, expiresAt, scope, metadata, is_active } = body;
        if (!keyId) {
          return new Response(
            JSON.stringify({ error: "keyId is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get existing key
        const { data: existing, error: fetchError } = await supabase
          .from("api_keys")
          .select("id, name, provider, encrypted_key")
          .eq("user_id", user.id)
          .eq("id", keyId)
          .maybeSingle();

        if (fetchError || !existing) {
          return new Response(
            JSON.stringify({ error: "Key not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updateData: Record<string, unknown> = {};
        if (name !== undefined) updateData.name = name;
        if (expiresAt !== undefined) updateData.expires_at = expiresAt || null;
        if (scope !== undefined) updateData.scope = scope || null;
        if (metadata !== undefined) updateData.metadata = metadata || {};
        if (is_active !== undefined) updateData.is_active = is_active;

        // If keyValue is provided, re-encrypt it
        if (keyValue) {
          const encryptedKey = await encryptKey(supabase, keyValue);
          if (!encryptedKey) {
            return new Response(
              JSON.stringify({ error: "Failed to encrypt key" }),
              { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
          updateData.encrypted_key = encryptedKey;
        }

        const { data: updated, error: updateError } = await supabase
          .from("api_keys")
          .update(updateData)
          .eq("id", keyId)
          .eq("user_id", user.id)
          .select("id, name, provider, key_type, created_at, expires_at, scope, is_active")
          .single();

        if (updateError || !updated) {
          console.error("Update error:", updateError);
          return new Response(
            JSON.stringify({ error: "Failed to update key" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(
          supabase,
          user.id,
          "update",
          keyId,
          existing.provider,
          existing.name,
          { updatedFields: Object.keys(updateData) },
          requestMeta.ip,
          requestMeta.userAgent
        );

        return new Response(JSON.stringify({ success: true, key: updated }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "delete": {
        const { keyId, name } = body;
        if (!keyId && !name) {
          return new Response(
            JSON.stringify({ error: "keyId or name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        // Get key info before deletion for audit
        const query = supabase
          .from("api_keys")
          .select("id, name, provider")
          .eq("user_id", user.id);

        if (keyId) {
          query.eq("id", keyId);
        } else {
          query.eq("name", name);
        }

        const { data: keyData } = await query.maybeSingle();

        if (!keyData) {
          return new Response(
            JSON.stringify({ error: "Key not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const { error: deleteError } = await supabase
          .from("api_keys")
          .delete()
          .eq("id", keyData.id)
          .eq("user_id", user.id);

        if (deleteError) {
          console.error("Delete error:", deleteError);
          return new Response(
            JSON.stringify({ error: "Failed to delete key" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(
          supabase,
          user.id,
          "delete",
          keyData.id,
          keyData.provider,
          keyData.name,
          {},
          requestMeta.ip,
          requestMeta.userAgent
        );

        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "audit": {
        const limit = 100;
        const { data: logs, error } = await supabase
          .from("key_audit_log")
          .select("*")
          .eq("user_id", user.id)
          .order("created_at", { ascending: false })
          .limit(limit);

        if (error) {
          console.error("Audit log error:", error);
          return new Response(
            JSON.stringify({ error: "Failed to retrieve audit logs" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(supabase, user.id, "audit", null, null, null, { logCount: logs?.length || 0 }, requestMeta.ip, requestMeta.userAgent);

        return new Response(JSON.stringify({ success: true, logs: logs || [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "stale": {
        const daysThreshold = body.daysThreshold || 90;
        const { data: staleKeys, error } = await supabase.rpc("get_stale_keys", {
          p_user_id: user.id,
          p_days_threshold: daysThreshold,
        });

        if (error) {
          console.error("Stale keys error:", error);
          return new Response(
            JSON.stringify({ error: "Failed to check for stale keys" }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(
          supabase,
          user.id,
          "audit",
          null,
          null,
          null,
          { staleKeyCount: staleKeys?.length || 0, daysThreshold },
          requestMeta.ip,
          requestMeta.userAgent
        );

        return new Response(JSON.stringify({ success: true, staleKeys: staleKeys || [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      case "check": {
        // Check permissions/access for a specific key
        const { keyId, name } = body;
        if (!keyId && !name) {
          return new Response(
            JSON.stringify({ error: "keyId or name is required" }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const query = supabase
          .from("api_keys")
          .select("id, name, provider, key_type, is_active, expires_at, last_used_at, usage_count, scope, metadata")
          .eq("user_id", user.id);

        if (keyId) {
          query.eq("id", keyId);
        } else {
          query.eq("name", name);
        }

        const { data: keyData, error } = await query.maybeSingle();

        if (error || !keyData) {
          return new Response(
            JSON.stringify({ error: "Key not found" }),
            { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        await logAudit(
          supabase,
          user.id,
          "check",
          keyData.id,
          keyData.provider,
          keyData.name,
          {},
          requestMeta.ip,
          requestMeta.userAgent
        );

        return new Response(JSON.stringify({ success: true, key: keyData }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }
  } catch (error) {
    console.error("Key manager error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error", details: error instanceof Error ? error.message : String(error) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

