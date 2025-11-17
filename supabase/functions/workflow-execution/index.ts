import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
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

    const url = new URL(req.url);
    const executionId = url.pathname.split("/").pop();

    if (!executionId) {
      return new Response(JSON.stringify({ error: "Execution ID required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get execution
    const { data: execution, error: execError } = await supabase
      .from("workflow_executions")
      .select("*")
      .eq("id", executionId)
      .eq("user_id", user.id)
      .single();

    if (execError || !execution) {
      return new Response(JSON.stringify({ error: "Execution not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Get node executions
    const { data: nodeExecutions, error: nodeError } = await supabase
      .from("node_executions")
      .select("*")
      .eq("execution_id", executionId)
      .order("started_at", { ascending: true });

    if (nodeError) {
      return new Response(JSON.stringify({ error: "Failed to load node executions" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Calculate progress
    const totalNodes = nodeExecutions?.length || 0;
    const completedNodes = nodeExecutions?.filter(n => n.status === "completed").length || 0;
    const progress = totalNodes > 0 ? Math.round((completedNodes / totalNodes) * 100) : 0;

    return new Response(
      JSON.stringify({
        execution,
        node_executions: nodeExecutions || [],
        current_step: completedNodes,
        total_steps: totalNodes,
        progress,
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

