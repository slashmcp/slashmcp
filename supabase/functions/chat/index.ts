import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import {
  Agent,
  type AgentInputItem,
  type Handoff,
  type Tool,
  Runner,
} from "https://esm.sh/@openai/agents@0.0.9";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createMemoryService } from "../_shared/memory.ts";
import type { Database } from "../_shared/database.types.ts";

type Provider = "openai" | "anthropic" | "gemini";

const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(origin => origin.trim()) ?? ["*"];
const BASE_SYSTEM_PROMPT =
  "You are a helpful AI research assistant speaking aloud through text-to-speech. Respond in natural spoken sentences, avoid stage directions, asterisks, or emojis, and keep punctuation simple so it sounds good when read aloud. Provide clear answers, cite important facts conversationally, and offer actionable insight when useful.";

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

const encoder = new TextEncoder();

const PROJECT_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL") ?? "";
const MCP_GATEWAY_URL = PROJECT_URL ? `${PROJECT_URL.replace(/\/+$/, "")}/functions/v1/mcp` : "";

function getCorsHeaders(origin: string | null): Record<string, string> {
  const isAllowed = !origin || allowedOrigins.includes("*") || allowedOrigins.includes(origin);
  return {
    "Access-Control-Allow-Origin": isAllowed && origin ? origin : "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function respondWithStreamedText(text: string, corsHeaders: Record<string, string>) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      if (text) {
        const payload = JSON.stringify({ choices: [{ delta: { content: text } }] });
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });

  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
  });
}

// Enhanced streaming response that supports both content and MCP events
function createEventStream(corsHeaders: Record<string, string>) {
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });

  const sendContent = (content: string) => {
    if (controller) {
      const payload = JSON.stringify({ choices: [{ delta: { content } }] });
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    }
  };

  const sendEvent = (event: {
    type: string;
    timestamp: number;
    agent?: string;
    tool?: string;
    command?: string;
    result?: unknown;
    error?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (controller) {
      const payload = JSON.stringify({ mcpEvent: event });
      controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
    }
  };

  const close = () => {
    if (controller) {
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    }
  };

  return { stream, sendContent, sendEvent, close };
}

function mapMessagesForAnthropic(messages: Array<{ role: string; content: string }>) {
  return messages.map(message => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: [{ type: "text", text: message.content }],
  }));
}

function mapMessagesForGemini(messages: Array<{ role: string; content: string }>) {
  return messages.map(message => ({
    role: message.role === "assistant" ? "model" : "user",
    parts: [{ text: message.content }],
  }));
}

// --- Multi-agent setup using OpenAI Agents SDK for the OpenAI provider ---

// Memory tools - will be created dynamically when memoryService is available
function createMemoryTools(memoryService: ReturnType<typeof createMemoryService>): Tool[] {
  return [
    {
      name: "query_memory",
      description:
        "Query the user's persistent memory to retrieve stored information like passwords, preferences, facts, or conversation summaries. Use this when the user asks about something they've told you before or when you need to recall stored information.",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The memory key to retrieve (e.g., 'password', 'preferences', 'important_facts', or 'conversation_summary_2025-01-19')",
          },
          search: {
            type: "string",
            description: "Optional: Search term to find relevant memories. If provided, will search all memory keys.",
          },
        },
      },
      async run({ key, search }: { key?: string; search?: string }) {
        try {
          if (search) {
            // Search all memories
            const allMemories = await memoryService.getAllMemory();
            const searchLower = search.toLowerCase();
            const matches = allMemories.filter(
              (mem) =>
                mem.key.toLowerCase().includes(searchLower) ||
                JSON.stringify(mem.value).toLowerCase().includes(searchLower),
            );
            if (matches.length === 0) {
              return `No memories found matching "${search}"`;
            }
            return JSON.stringify(matches, null, 2);
          } else if (key) {
            // Get specific memory
            const value = await memoryService.getMemory(key);
            if (value === null) {
              return `No memory found for key "${key}"`;
            }
            return JSON.stringify({ key, value }, null, 2);
          } else {
            // Get all memories
            const allMemories = await memoryService.getAllMemory();
            return JSON.stringify(allMemories, null, 2);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return `Error querying memory: ${message}`;
        }
      },
    },
    {
      name: "store_memory",
      description:
        "Store information in the user's persistent memory. Use this when the user explicitly asks you to remember something, set a password, save a preference, or store an important fact. The key should be descriptive (e.g., 'password', 'secret_code_word', 'favorite_color', 'important_fact').",
      parameters: {
        type: "object",
        properties: {
          key: {
            type: "string",
            description: "The memory key to store (e.g., 'password', 'secret_code_word', 'preferences', 'important_fact')",
          },
          value: {
            type: "string",
            description: "The value to store. Can be a simple string or JSON string for complex data.",
          },
        },
        required: ["key", "value"],
      },
      async run({ key, value }: { key: string; value: string }) {
        try {
          // Try to parse as JSON, otherwise store as string
          let parsedValue: unknown = value;
          try {
            parsedValue = JSON.parse(value);
          } catch {
            // Not JSON, store as string
            parsedValue = value;
          }
          
          await memoryService.setMemory(key, parsedValue);
          return `Successfully stored memory with key "${key}"`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return `Error storing memory: ${message}`;
        }
      },
    },
  ];
}

const mcpProxyTool: Tool = {
  name: "mcp_proxy",
  description:
    "Executes a registered MCP command via the slashmcp backend. Input must be a string in the format: /<server-id> <command> [param=value...]",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: 'The full MCP command string, e.g., "/alphavantage-mcp get_stock_chart symbol=NVDA"',
      },
    },
    required: ["command"],
  },
  async run({ command }: { command: string }) {
    if (!MCP_GATEWAY_URL) {
      return "MCP gateway URL is not configured on the server.";
    }

    const trimmed = (command ?? "").trim();
    if (!trimmed.startsWith("/")) {
      return 'Invalid MCP command format. Expected something like "/alphavantage-mcp get_quote symbol=NVDA".';
    }

    const [serverAndSuffix, ...paramTokens] = trimmed.split(/\s+/);
    const serverId = serverAndSuffix.slice(1); // strip leading "/"

    // Assume the first token after the server id is the MCP command name.
    let mcpCommand: string | undefined;
    const args: Record<string, string> = {};

    if (paramTokens.length > 0) {
      mcpCommand = paramTokens.shift()!;
    }

    for (const token of paramTokens) {
      const eqIndex = token.indexOf("=");
      if (eqIndex <= 0) continue;
      const key = token.slice(0, eqIndex);
      const value = token.slice(eqIndex + 1);
      args[key] = value;
    }

    try {
      const response = await fetch(MCP_GATEWAY_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          serverId,
          command: mcpCommand,
          args,
          positionalArgs: [],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        throw new Error(
          `MCP gateway request failed with status ${response.status}${
            errorText ? `: ${errorText.slice(0, 200)}` : ""
          }`,
        );
      }

      const data = await response.json();
      return JSON.stringify(data, null, 2);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return `Error executing MCP command: ${message}`;
    }
  },
};

// MCP Tool Agent will be created dynamically to ensure consistent tool handling
function createMcpToolAgent(tools: Tool[]): Agent {
  // Ensure tools is always an array
  const toolsArray: Tool[] = Array.isArray(tools) ? tools : [];
  
  // Find the MCP proxy tool - it must be available for this agent
  const mcpTool = toolsArray.find(t => t.name === "mcp_proxy");
  if (!mcpTool) {
    console.error("MCP proxy tool not found in tools array - this should not happen");
    // Return agent with empty tools array - this will cause handoffs to fail gracefully
    // CRITICAL: Always return an array, never undefined
    return new Agent({
      name: "MCP_Tool_Agent",
      instructions: "You are an expert in executing Model Context Protocol (MCP) commands, but the MCP proxy tool is not available.",
      tools: [], // Empty tools array (never undefined) - handoff will fail but won't crash
    });
  }
  
  return new Agent({
    name: "MCP_Tool_Agent",
    instructions:
      "You are an expert in executing Model Context Protocol (MCP) commands. Your only tool is the `mcp_proxy`. " +
      "When a user request requires external data or a specific tool, you must formulate the correct MCP command and use the `mcp_proxy` tool. " +
      "You can call any registered MCP server, including:\n" +
      "- `alphavantage-mcp` for stock and market data (use ticker symbols like AAPL, NVDA)\n" +
      "- `polymarket-mcp` for prediction market odds (IMPORTANT: Market IDs must be exact slugs from Polymarket)\n" +
      "- `gemini-mcp` for lightweight text generation\n" +
      "- `playwright-mcp` or `playwright-wrapper` for browser automation, web scraping, and recursive testing\n" +
      "- `search-mcp` for web search results\n" +
      "\n" +
      "CRITICAL POLYMARKET WORKFLOW - FOLLOW EXACTLY:\n" +
      "When a user asks about Polymarket markets:\n" +
      "STEP 1: Try the market lookup first: `/polymarket-mcp get_market_price market_id=GUESSED_SLUG`\n" +
      "STEP 2: Check the result - if it contains 'not found', 'was not found', or any error about the market:\n" +
      "   → DO NOT STOP OR RETURN THE ERROR\n" +
      "   → IMMEDIATELY proceed to STEP 3 (browser search)\n" +
      "STEP 3: Extract search terms from user query (convert 'eagles-and-lions-tonight' to 'eagles and lions tonight')\n" +
      "STEP 4: Search Polymarket.com using browser automation:\n" +
      "   a. Call: `/playwright-wrapper browser_navigate url=https://polymarket.com/search?q=EXTRACTED_SEARCH_TERMS`\n" +
      "   b. Call: `/playwright-wrapper browser_wait_for time=3`\n" +
      "   c. Call: `/playwright-wrapper browser_snapshot`\n" +
      "   d. Analyze the snapshot response - look for market links, event URLs, or market cards\n" +
      "   e. Extract market slugs from URLs (format: /event/MARKET-SLUG or similar)\n" +
      "STEP 5: If you found market slugs in the search results:\n" +
      "   → Call: `/polymarket-mcp get_market_price market_id=EXTRACTED_SLUG`\n" +
      "   → Return the market data\n" +
      "STEP 6: If no markets found in search:\n" +
      "   → Inform user: 'No matching markets found on Polymarket.com for [search terms]'\n" +
      "\n" +
      "REMEMBER: When you see 'market not found' in a tool response, you MUST continue to STEP 3-5. Do not stop or return the error.\n" +
      "\n" +
      "For browser automation, web scraping, or research tasks:\n" +
      "- Use `playwright-wrapper` (or `srv_...` ID) with commands like `browser_navigate`, `browser_snapshot`, `browser_extract_text`\n" +
      "- For recursive testing of the app itself, navigate to the app URL, get snapshots, and interact with elements\n" +
      "- For research, extract text content from pages and analyze it\n" +
      "When researching websites or testing apps, use browser automation to:\n" +
      "1. Navigate to the URL with `browser_navigate url=...`\n" +
      "2. Get page structure with `browser_snapshot url=...`\n" +
      "3. Extract text with `browser_extract_text url=...` (if available)\n" +
      "4. Take screenshots with `browser_take_screenshot url=...` if visual analysis is needed\n" +
      "\n" +
      "MANDATORY: If a Polymarket market lookup fails with any 'not found' error, you MUST:\n" +
      "1. Immediately use browser automation (playwright-wrapper) to search Polymarket.com\n" +
      "2. Extract market slugs from the search results\n" +
      "3. Retry the market lookup with the correct slug\n" +
      "4. Do NOT just return the error - always attempt to find the market via browser search first\n" +
      "Do not answer questions directly; instead, call the tool and return its results.",
    tools: [mcpTool], // Set the tool on the agent so it's available during handoffs
  });
}

const finalAnswerAgent = new Agent({
  name: "Final_Answer_Agent",
  instructions:
    "You are the final response generator. Your task is to take the results from the MCP_Tool_Agent and the user's original query, " +
    "and synthesize a concise, helpful, and professional final answer. Do not use any tools.",
});

// Handoffs will be created dynamically with the correct agents
function createHandoffs(mcpToolAgent: Agent): [Handoff, Handoff] {
  const mcpHandoff: Handoff = {
    name: "handoff_to_mcp_tool",
    description:
      "Use this handoff when the user's request requires external data or tool execution (e.g., stock prices, market odds, document analysis).",
    targetAgent: mcpToolAgent,
    inputFilter: (input: AgentInputItem[]) => input,
  };

  const finalHandoff: Handoff = {
    name: "handoff_to_final_answer",
    description: "Use this handoff after the MCP_Tool_Agent has executed its command and returned a result.",
    targetAgent: finalAnswerAgent,
    inputFilter: (input: AgentInputItem[]) => input,
  };

  return [mcpHandoff, finalHandoff];
}


serve(async (req) => {
  const origin = req.headers.get("Origin");
  const corsHeaders = getCorsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { messages, provider } = await req.json();
    if (!Array.isArray(messages)) {
      return new Response(JSON.stringify({ error: "messages must be an array" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Try to get authenticated user (optional - memory features work only if authenticated)
    let memoryService: ReturnType<typeof createMemoryService> | null = null;
    let userPreferences: Record<string, unknown> = {};
    let systemPrompt = BASE_SYSTEM_PROMPT;
    let relevantMemories: Array<{ key: string; value: unknown }> = [];

    const authHeader = req.headers.get("Authorization");
    if (authHeader && SUPABASE_URL && SUPABASE_ANON_KEY) {
      try {
        const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
          global: { headers: { Authorization: authHeader } },
        });

        const {
          data: { user },
          error: userError,
        } = await supabase.auth.getUser();

        if (!userError && user) {
          try {
            // User is authenticated - create memory service
            memoryService = createMemoryService(supabase, user.id);

            // Load user preferences and recent memories (truly non-blocking)
            // Start loading but don't wait - we'll use what we have when the stream starts
            // Memory tools will still work even if context injection fails
            Promise.all([
              memoryService.getUserPreferences(),
              memoryService.getAllMemory(),
            ])
              .then(([prefs, allMemories]) => {
                userPreferences = prefs;
                relevantMemories = allMemories
                  .filter((mem) => mem.key !== "preferences")
                  .slice(0, 10);
                
                // Note: We can't update systemPrompt here as it's already been used
                // But we log for debugging
                if (Object.keys(prefs).length > 0 || relevantMemories.length > 0) {
                  console.log(`Loaded ${relevantMemories.length} memories and preferences (for future requests)`);
                }
              })
              .catch((prefError) => {
                console.error("Error loading user preferences/memories (background):", prefError);
                // Continue without preferences - don't block the request
              });
          } catch (memError) {
            console.error("Error creating memory service:", memError);
            // Continue without memory features - don't block the request
          }
        }
      } catch (authError) {
        console.error("Error authenticating user (non-blocking):", authError);
        // Continue without memory features - don't block the request
      }
    } else {
      // Log if keys are missing (for debugging) but don't fail
      if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
        console.log("Memory service disabled: SUPABASE_URL or SUPABASE_ANON_KEY not configured");
      }
    }

    const normalizedProvider = (provider ?? "openai") as string;
    const selectedProvider: Provider =
      normalizedProvider === "anthropic" || normalizedProvider === "gemini" ? normalizedProvider : "openai";

    const conversation = messages.map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: typeof message.content === "string" ? message.content : String(message.content),
    }));

    if (selectedProvider === "openai") {
      const apiKey = Deno.env.get("OPENAI_API_KEY");
      if (!apiKey) {
        const errorStream = createEventStream(corsHeaders);
        errorStream.sendEvent({
          type: "error",
          timestamp: Date.now(),
          error: "OPENAI_API_KEY is not configured",
        });
        errorStream.sendContent("I apologize, but the OpenAI API key is not configured. Please contact support.");
        errorStream.close();
        
        return new Response(errorStream.stream, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // Try using OpenAI Agents SDK first, fall back to direct API if it fails
      let useAgentsSdk = true;
      // Declare these outside the if block so they're accessible in the fallback section
      let finalOutput = "";
      let errorOccurred = false;
      let errorMessage = "";

      // Create event stream FIRST to ensure we always return a stream, even on errors
      const eventStream = createEventStream(corsHeaders);

      if (useAgentsSdk) {
        try {
          // Create runner with API key for this request
          const runner = new Runner({
            model: "gpt-4o-mini",
            apiKey: apiKey,
          });

          // Build tools array - include memory tools if available
          const tools: Tool[] = [mcpProxyTool];
          if (memoryService) {
            const memoryTools = createMemoryTools(memoryService);
            tools.push(...memoryTools);
            console.log(`Added ${memoryTools.length} memory tools to agent`);
          }

          // Create agents dynamically with tools to avoid SDK serialization issues
          let currentMcpToolAgent: Agent;
          let mcpHandoff: Handoff;
          let finalHandoff: Handoff;
          
          try {
            currentMcpToolAgent = createMcpToolAgent(tools);
            [mcpHandoff, finalHandoff] = createHandoffs(currentMcpToolAgent);
          } catch (agentError) {
            console.error("Error creating agents:", agentError);
            // If agent creation fails, fall back to direct API
            useAgentsSdk = false;
            errorOccurred = true;
            errorMessage = agentError instanceof Error ? agentError.message : String(agentError);
            eventStream.sendEvent({
              type: "error",
              timestamp: Date.now(),
              error: errorMessage,
            });
            throw agentError; // Re-throw to be caught by outer catch
          }

          // Create orchestrator agent WITH tools on the agent itself
          // This ensures tools are available during handoffs (the SDK needs tools on agents for handoffs)
          // CRITICAL: Ensure tools is always an array, never undefined
          const orchestratorTools: Tool[] = Array.isArray(tools) ? tools : [];
          const currentOrchestratorAgent = new Agent({
            name: "Orchestrator_Agent",
            instructions:
              "Your primary goal is to determine the best course of action to answer the user's question. " +
              "If the request is a simple chat, answer directly. " +
              "If the user asks you to remember something (like a password, preference, or fact), use the `store_memory` tool to save it. " +
              "If the user asks about something they've told you before (like passwords, preferences, or facts), use the `query_memory` tool to retrieve that information. " +
              "If it requires external data or a tool (like stock prices, prediction markets, document analysis, or browser automation with Playwright), " +
              "use the `handoff_to_mcp_tool` handoff so the MCP_Tool_Agent can call MCP servers via the `mcp_proxy` tool. " +
              "For example, when the user asks you to visit a website, scrape information from a page, or generate/repair Playwright tests, " +
              "you should trigger `handoff_to_mcp_tool` so it can use the `playwright-mcp` server. " +
              "For Polymarket queries where the market ID might be unclear, the MCP_Tool_Agent will automatically use browser automation to search if needed. " +
              "If you receive tool results and further synthesis is needed, use the `handoff_to_final_answer` handoff.",
            handoffs: [mcpHandoff, finalHandoff],
            tools: orchestratorTools, // Set tools on the agent so they're available during handoffs - always an array
          });

          // Pass conversation history - Agents SDK Runner handles full context
          // Convert conversation to AgentInputItem format
          // CRITICAL: The SDK REQUIRES content to ALWAYS be an array of content blocks
          // Each content block must be { type: "text", text: "..." } for text content
          // IMPORTANT: Ensure strict typing - text must be a string, not optional
          const conversationHistory: AgentInputItem[] = conversation.map((msg, index) => {
            let contentArray: Array<{ type: "text"; text: string }>;
            
            if (Array.isArray(msg.content)) {
              // Already an array - ensure each item has the EXACT right format
              contentArray = msg.content.map((item) => {
                if (typeof item === "string") {
                  return { type: "text" as const, text: item };
                } else if (typeof item === "object" && item !== null) {
                  // If it's an object, extract text and ensure proper format
                  const textValue = (item as any).text || String(item);
                  if (typeof textValue === "string") {
                    return { type: "text" as const, text: textValue };
                  }
                  return { type: "text" as const, text: String(textValue) };
                }
                return { type: "text" as const, text: String(item) };
              });
            } else if (typeof msg.content === "string") {
              // String content - MUST wrap in array with proper format
              contentArray = [{ type: "text" as const, text: msg.content }];
            } else {
              // Fallback for other types
              contentArray = [{ type: "text" as const, text: String(msg.content) }];
            }
            
            // Ensure the array is not empty
            if (contentArray.length === 0) {
              contentArray = [{ type: "text" as const, text: "" }];
            }
            
            // Log the format for debugging
            if (index === 0 || index === conversation.length - 1) {
              console.log(`Message ${index} (${msg.role}): content format:`, JSON.stringify(contentArray).slice(0, 200));
            }
            
            return {
              role: msg.role as "user" | "assistant",
              content: contentArray,
            };
          });

          const lastUserMessage = conversation.length
            ? conversation[conversation.length - 1]?.content ?? ""
            : "";

          // Reset state for this request - important for handling multiple sequential requests
          const contentParts: string[] = [];
          const seenContent = new Set<string>(); // Track seen content to prevent duplicates
          finalOutput = ""; // Reset finalOutput for this request
          errorOccurred = false; // Reset error flag
          errorMessage = ""; // Reset error message
          
          console.log("=== Starting Agents SDK Runner ===");
          console.log("Message:", lastUserMessage.slice(0, 100));
          console.log("Conversation history length:", conversationHistory.length);
          console.log("OPENAI_API_KEY exists:", !!apiKey);
          console.log("MCP_GATEWAY_URL:", MCP_GATEWAY_URL);
          
          try {
            // Try with conversation history first, fallback to just last message if that fails
            let events: AsyncIterable<{ type: string; [key: string]: unknown }>;
            
            try {
              // The Runner.run() signature accepts conversation history as AgentInputItem[]
              // For version 0.0.9, try passing content as string for simple text messages
              const inputToPass = conversationHistory.map((item) => {
                // If content is an array with a single text block, simplify to just the text string
                if (Array.isArray(item.content) && item.content.length === 1 && item.content[0]?.type === "text") {
                  return {
                    role: item.role,
                    content: item.content[0].text,
                  };
                }
                // Otherwise keep the original format
                return item;
              });
              
              events = await runner.run(
                currentOrchestratorAgent,
                inputToPass.length > 0 ? inputToPass : [{ role: "user", content: lastUserMessage }],
                {
                  // Don't pass tools here - they're already on the agents
                  // Passing tools here AND on agents causes SDK to have undefined tools array during handoffs
                  maxTurns: 20, // Increased to allow for retry workflows (initial attempt + browser search + retry)
                  stream: true,
                },
              );
            } catch (runError) {
              console.log("Failed with conversation history, trying with last message only:", runError);
              // Fallback: try with just the last message as a simple string
              try {
                events = await runner.run(
                  currentOrchestratorAgent,
                  [{ role: "user", content: lastUserMessage }],
                  {
                    // Don't pass tools here - they're already on the agents
                    // Passing tools here AND on agents causes SDK to have undefined tools array during handoffs
                    maxTurns: 20, // Increased to allow for retry workflows (initial attempt + browser search + retry)
                    stream: true,
                  },
                );
              } catch (fallbackError) {
                // Both attempts failed - throw to outer catch
                throw fallbackError;
              }
            }
            
            // Send initial event to confirm connection
            eventStream.sendEvent({
              type: "system",
              timestamp: Date.now(),
              metadata: { message: "Agents SDK Runner started" },
            });
            
            // Collect all content from the streaming events.
            let eventCount = 0;
            for await (const event of events as AsyncIterable<{ 
              type: string; 
              output?: unknown; 
              error?: unknown;
              content?: string | unknown;
              text?: string;
              delta?: unknown;
              textDelta?: unknown;
              message?: unknown;
              agentMessage?: unknown;
              agent?: unknown;
              tool?: unknown;
              toolCall?: unknown;
              toolResult?: unknown;
            }>) {
              eventCount++;
              const eventStr = JSON.stringify(event).slice(0, 300);
              console.log(`Event #${eventCount} - Type: ${event.type}`, eventStr);
              
              // Send MCP event to frontend for logging
              const timestamp = Date.now();
              const eventData: {
                type: string;
                timestamp: number;
                agent?: string;
                tool?: string;
                command?: string;
                result?: unknown;
                error?: string;
                metadata?: Record<string, unknown>;
              } = {
                type: event.type,
                timestamp,
              };

              // Extract agent information
              if ((event as any).agent) {
                eventData.agent = String((event as any).agent);
              } else if ((event as any).agentMessage?.agent) {
                eventData.agent = String((event as any).agentMessage.agent);
              }

              // Extract tool call information
              if ((event as any).toolCall) {
                const toolCall = (event as any).toolCall;
                eventData.tool = toolCall.name || toolCall.tool;
                eventData.command = toolCall.input?.command || toolCall.arguments?.command || JSON.stringify(toolCall.input || toolCall.arguments);
                eventData.metadata = { toolCall };
              } else if ((event as any).tool) {
                eventData.tool = String((event as any).tool);
              }

              // Extract tool result
              if ((event as any).toolResult) {
                const toolResult = (event as any).toolResult;
                eventData.result = toolResult.result || toolResult.output || toolResult;
                if (toolResult.error) {
                  eventData.error = String(toolResult.error);
                }
              }

              // Extract MCP command from tool calls
              if (eventData.tool === "mcp_proxy" && eventData.command) {
                eventData.metadata = { ...eventData.metadata, mcpCommand: eventData.command };
              }

              if (event.type === "error") {
                errorOccurred = true;
                errorMessage = event.error instanceof Error ? event.error.message : String(event.error);
                eventData.error = errorMessage;
                eventStream.sendEvent(eventData);
                console.error("Agent runner error:", event.error);
                break;
              } else if (event.type === "finalOutput") {
                // finalOutput events contain the complete response - use this as the primary source
                // IMPORTANT: Don't stream here if we've already streamed the content from other events
                // The finalOutput is just for setting the final value, not for streaming
                if (event.output !== undefined) {
                  if (typeof event.output === "string") {
                    const outputStr = event.output.trim();
                    // Use Set to track exact content strings
                    if (!seenContent.has(outputStr)) {
                      seenContent.add(outputStr);
                      finalOutput = outputStr;
                      // Only stream if we haven't already streamed this content
                      // Check if any of the content parts match this output
                      const alreadyStreamed = contentParts.some(part => {
                        const partTrimmed = part.trim();
                        return partTrimmed === outputStr || 
                               (partTrimmed.length > 0 && outputStr.includes(partTrimmed)) ||
                               (outputStr.length > 0 && partTrimmed.includes(outputStr));
                      });
                      if (!alreadyStreamed && outputStr.length > 0) {
                        eventStream.sendContent(outputStr);
                        contentParts.push(outputStr);
                      }
                    }
                  } else {
                    try {
                      const outputStr = JSON.stringify(event.output);
                      const outputHash = outputStr.trim();
                      if (!seenContent.has(outputHash)) {
                        seenContent.add(outputHash);
                        finalOutput = outputStr;
                        eventStream.sendContent(outputStr);
                        contentParts.push(outputStr);
                      }
                    } catch {
                      const outputStr = String(event.output);
                      const outputHash = outputStr.trim();
                      if (!seenContent.has(outputHash)) {
                        seenContent.add(outputHash);
                        finalOutput = outputStr;
                        eventStream.sendContent(outputStr);
                        contentParts.push(outputStr);
                      }
                    }
                  }
                }
                eventData.result = event.output;
                eventStream.sendEvent(eventData);
              } else if (event.type === "content" || event.type === "text" || event.type === "textDelta" || event.type === "delta") {
                // Collect streaming content from various event types
                const content = (event as any).content || (event as any).text || (event as any).textDelta || (event as any).delta;
                if (content) {
                  const contentStr = typeof content === "string" ? content : String(content);
                  if (contentStr.trim()) {
                    // Use Set to track exact content strings (more reliable than string includes)
                    const contentHash = contentStr.trim();
                    if (!seenContent.has(contentHash)) {
                      seenContent.add(contentHash);
                      contentParts.push(contentStr);
                      finalOutput = (finalOutput || "") + contentStr;
                      console.log("Collected content chunk:", contentStr.slice(0, 50));
                      // Stream content immediately
                      eventStream.sendContent(contentStr);
                    } else {
                      console.log("Skipping duplicate content chunk:", contentStr.slice(0, 50));
                    }
                  }
                }
                eventData.result = content;
                eventStream.sendEvent(eventData);
              } else if (event.type === "newMessage" || event.type === "message" || event.type === "agentMessage") {
                // Some SDK versions use newMessage/message/agentMessage events
                const message = event as any;
                const messageContent = message.content || message.text || message.message || (message.agentMessage?.content);
                if (messageContent && typeof messageContent === "string") {
                  const contentStr = messageContent.trim();
                  if (contentStr) {
                    // Use Set to track exact content strings
                    const contentHash = contentStr.trim();
                    if (!seenContent.has(contentHash)) {
                      seenContent.add(contentHash);
                      contentParts.push(contentStr);
                      finalOutput = (finalOutput || "") + contentStr;
                      console.log("Collected message content:", contentStr.slice(0, 50));
                      // Stream content immediately
                      eventStream.sendContent(contentStr);
                    } else {
                      console.log("Skipping duplicate message content:", contentStr.slice(0, 50));
                    }
                  }
                }
                eventData.result = messageContent;
                eventStream.sendEvent(eventData);
              } else if (event.type === "toolCall" || event.type === "toolResult") {
                // Explicitly handle tool call events
                eventStream.sendEvent(eventData);
              } else if (event.type === "raw_model_stream_event") {
                // Handle raw model stream events - these contain the actual response text
                const rawEvent = event as any;
                console.log(`Raw model stream event:`, JSON.stringify(rawEvent).slice(0, 200));
                
                // Extract content from various nested structures
                let extractedText = null;
                
                // Check data.event structure
                if (rawEvent.data?.event) {
                  const modelEvent = rawEvent.data.event;
                  // Look for text in various fields
                  if (modelEvent.text) {
                    extractedText = modelEvent.text;
                  } else if (modelEvent.content) {
                    extractedText = modelEvent.content;
                  } else if (modelEvent.delta?.text) {
                    extractedText = modelEvent.delta.text;
                  } else if (modelEvent.delta?.content) {
                    extractedText = modelEvent.delta.content;
                  }
                }
                
                // Check data.response structure
                if (!extractedText && rawEvent.data?.response) {
                  const response = rawEvent.data.response;
                  if (response.output) {
                    // Output might be an array of items
                    if (Array.isArray(response.output)) {
                      const textItems = response.output
                        .map((item: any) => item.text || item.content || item.message?.text || item.message?.content)
                        .filter((text: any) => text && typeof text === "string")
                        .join("");
                      if (textItems) extractedText = textItems;
                    } else if (typeof response.output === "string") {
                      extractedText = response.output;
                    }
                  }
                  if (!extractedText && response.text) {
                    extractedText = response.text;
                  }
                  if (!extractedText && response.content) {
                    extractedText = response.content;
                  }
                }
                
                // Check for text in the event itself
                if (!extractedText) {
                  if (rawEvent.text) extractedText = rawEvent.text;
                  else if (rawEvent.content) extractedText = rawEvent.content;
                  else if (rawEvent.data?.text) extractedText = rawEvent.data.text;
                  else if (rawEvent.data?.content) extractedText = rawEvent.data.content;
                }
                
                if (extractedText && typeof extractedText === "string" && extractedText.trim()) {
                  const textStr = extractedText.trim();
                  // Use Set to track exact content strings
                  const contentHash = textStr;
                  if (!seenContent.has(contentHash)) {
                    seenContent.add(contentHash);
                    console.log(`Extracted text from raw_model_stream_event:`, textStr.slice(0, 100));
                    contentParts.push(textStr);
                    finalOutput = (finalOutput || "") + textStr;
                    eventStream.sendContent(textStr);
                  } else {
                    console.log(`Skipping duplicate text from raw_model_stream_event:`, textStr.slice(0, 100));
                  }
                }
                
                eventData.result = extractedText || rawEvent.data;
                eventStream.sendEvent(eventData);
              } else if (event.type === "run_item_stream_event") {
                // Handle run item stream events
                const runItemEvent = event as any;
                console.log(`Run item stream event:`, JSON.stringify(runItemEvent).slice(0, 200));
                
                // Extract text from run item events
                let extractedText = null;
                if (runItemEvent.item?.text) {
                  extractedText = runItemEvent.item.text;
                } else if (runItemEvent.item?.content) {
                  extractedText = runItemEvent.item.content;
                } else if (runItemEvent.text) {
                  extractedText = runItemEvent.text;
                } else if (runItemEvent.content) {
                  extractedText = runItemEvent.content;
                }
                
                if (extractedText && typeof extractedText === "string" && extractedText.trim()) {
                  const textStr = extractedText.trim();
                  // Use Set to track exact content strings
                  const contentHash = textStr;
                  if (!seenContent.has(contentHash)) {
                    seenContent.add(contentHash);
                    console.log(`Extracted text from run_item_stream_event:`, textStr.slice(0, 100));
                    contentParts.push(textStr);
                    finalOutput = (finalOutput || "") + textStr;
                    eventStream.sendContent(textStr);
                  } else {
                    console.log(`Skipping duplicate text from run_item_stream_event:`, textStr.slice(0, 100));
                  }
                }
                
                eventData.result = extractedText || runItemEvent.item || runItemEvent;
                eventStream.sendEvent(eventData);
              } else if (event.type === "run" || event.type === "runStart" || event.type === "runEnd") {
                // Handle run lifecycle events
                console.log(`Run event: ${event.type}`, eventStr);
                eventStream.sendEvent(eventData);
              } else if ((event as any).output !== undefined) {
                // Some events might have output directly
                const output = (event as any).output;
                const outputStr = typeof output === "string" ? output : JSON.stringify(output);
                if (outputStr && outputStr.trim()) {
                  // Use Set to track exact content strings
                  const contentHash = outputStr.trim();
                  if (!seenContent.has(contentHash)) {
                    seenContent.add(contentHash);
                    console.log(`Found output in event type ${event.type}:`, outputStr.slice(0, 100));
                    contentParts.push(outputStr);
                    finalOutput = (finalOutput || "") + outputStr;
                    eventStream.sendContent(outputStr);
                  } else {
                    console.log(`Skipping duplicate output from ${event.type}:`, outputStr.slice(0, 100));
                  }
                }
                eventData.result = output;
                eventStream.sendEvent(eventData);
              } else {
                // Log all other event types for debugging and send to frontend
                console.log(`Unhandled event type: ${event.type}`, eventStr);
                // Try to extract any text content from the event
                const eventAny = event as any;
                if (eventAny.text || eventAny.message || eventAny.response) {
                  const extractedText = eventAny.text || eventAny.message || eventAny.response;
                  const textStr = typeof extractedText === "string" ? extractedText : String(extractedText);
                  if (textStr && textStr.trim()) {
                    // Use Set to track exact content strings
                    const contentHash = textStr.trim();
                    if (!seenContent.has(contentHash)) {
                      seenContent.add(contentHash);
                      console.log(`Extracted text from ${event.type}:`, textStr.slice(0, 100));
                      contentParts.push(textStr);
                      finalOutput = (finalOutput || "") + textStr;
                      eventStream.sendContent(textStr);
                    } else {
                      console.log(`Skipping duplicate text from ${event.type}:`, textStr.slice(0, 100));
                    }
                  }
                }
                eventStream.sendEvent(eventData);
              }
            }
            
            console.log(`Processed ${eventCount} events, collected ${contentParts.length} content parts`);
            
            // If we collected content parts but no finalOutput, combine them (deduplicating)
            if (!finalOutput && contentParts.length > 0) {
              // Use Set to deduplicate - more reliable than string includes
              const uniqueParts: string[] = [];
              const seenParts = new Set<string>();
              for (const part of contentParts) {
                const partTrimmed = part.trim();
                if (partTrimmed && !seenParts.has(partTrimmed)) {
                  seenParts.add(partTrimmed);
                  uniqueParts.push(part);
                }
              }
              finalOutput = uniqueParts.join("");
              console.log(`Combined ${contentParts.length} content parts into ${uniqueParts.length} unique parts, finalOutput length: ${finalOutput.length}`);
            }
            
            // IMPORTANT: Don't stream finalOutput again if we've already streamed content incrementally
            // Content was streamed during the event loop, so we just need to close the stream
            if (finalOutput && finalOutput.trim().length > 0) {
              console.log("Content was streamed incrementally, closing stream");
              
              // Summarize long conversations if user is authenticated (async, don't block response)
              if (memoryService && conversation.length > 20) {
                memoryService.summarizeConversation(conversation).catch((summaryError) => {
                  console.error("Error summarizing conversation:", summaryError);
                });
              }
              
              eventStream.close();
              return new Response(eventStream.stream, {
                headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
              });
            } else if (contentParts.length > 0) {
              // If we have content parts but no finalOutput, send them (deduplicated)
              const uniqueParts: string[] = [];
              const seenParts = new Set<string>();
              for (const part of contentParts) {
                const partTrimmed = part.trim();
                if (partTrimmed && !seenParts.has(partTrimmed)) {
                  seenParts.add(partTrimmed);
                  uniqueParts.push(part);
                }
              }
              const combinedContent = uniqueParts.join("").trim();
              if (combinedContent) {
                console.log("Streaming combined content parts to client");
                eventStream.sendContent(combinedContent);
                
                // Summarize long conversations if user is authenticated (async, don't block response)
                if (memoryService && conversation.length > 20) {
                  memoryService.summarizeConversation(conversation).catch((summaryError) => {
                    console.error("Error summarizing conversation:", summaryError);
                  });
                }
                
                eventStream.close();
                return new Response(eventStream.stream, {
                  headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
                });
              }
            }
            
            // No content at all - fall back to direct API
            console.warn("No content generated from Agents SDK, will fall back to direct API");
            // Don't close the stream here - let it fall through to the direct API fallback
            // The direct API will use the same event stream
            useAgentsSdk = false;
            // Don't reset errorOccurred here - keep it as is
          } catch (runnerError) {
            errorOccurred = true;
            errorMessage = runnerError instanceof Error ? runnerError.message : String(runnerError);
            console.error("=== Runner Error ===");
            console.error("Error message:", errorMessage);
            console.error("Error stack:", runnerError instanceof Error ? runnerError.stack : 'No stack trace');
            
            // Send error to stream and fall through to direct API
            eventStream.sendEvent({
              type: "error",
              timestamp: Date.now(),
              error: errorMessage,
            });
            eventStream.sendContent(`I encountered an error: ${errorMessage}. Falling back to direct API...`);
          }

          // If Runner succeeded but produced no output, fall back to direct API
          if (!errorOccurred && (!finalOutput || finalOutput.trim().length === 0)) {
            console.warn("No output from Runner, falling back to direct OpenAI API");
            useAgentsSdk = false;
          }
        } catch (sdkError) {
          console.error("Failed to initialize Runner, falling back to direct API:", sdkError);
          useAgentsSdk = false;
          errorOccurred = true;
          errorMessage = sdkError instanceof Error ? sdkError.message : String(sdkError);
          eventStream.sendEvent({
            type: "error",
            timestamp: Date.now(),
            error: errorMessage,
          });
        }
      }

      // Fallback to direct OpenAI API if Agents SDK didn't work
      if (!useAgentsSdk || errorOccurred) {
        console.log("=== Using Direct OpenAI API (Fallback Mode) ===");
        console.log("Reason:", errorOccurred ? "error" : "no_output");
        if (errorOccurred) {
          console.log("Error message:", errorMessage);
        }
        eventStream.sendEvent({
          type: "fallback",
          timestamp: Date.now(),
          metadata: { reason: errorOccurred ? "error" : "no_output" },
        });
        
        // Send a content event to indicate we're using direct API
        eventStream.sendEvent({
          type: "system",
          timestamp: Date.now(),
          metadata: { message: "Using direct OpenAI API (Agents SDK unavailable)" },
        });
        
        const response = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
            body: JSON.stringify({
            model: "gpt-4o-mini",
            messages: [
              { role: "system", content: systemPrompt },
              ...conversation,
            ],
            stream: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error("OpenAI API error:", response.status, errorText);
          const errorMsg = `OpenAI API request failed: ${errorText}`;
          eventStream.sendEvent({
            type: "error",
            timestamp: Date.now(),
            error: errorMsg,
          });
          eventStream.sendContent(`I apologize, but I encountered an error: ${errorMsg}. Please try again.`);
          eventStream.close();
          
          return new Response(eventStream.stream, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }

        if (!response.body) {
          eventStream.sendEvent({
            type: "error",
            timestamp: Date.now(),
            error: "No response body from OpenAI API",
          });
          eventStream.sendContent("I apologize, but I couldn't connect to the AI service. Please try again.");
          eventStream.close();
          
          return new Response(eventStream.stream, {
            headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
          });
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let hasContent = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          textBuffer += decoder.decode(value, { stream: true });
          
          const lines = textBuffer.split("\n");
          textBuffer = lines.pop() || "";
          
          for (const line of lines) {
            if (line.startsWith("data: ") && line !== "data: [DONE]") {
              try {
                const data = JSON.parse(line.slice(6));
                const content = data.choices?.[0]?.delta?.content;
                if (content) {
                  finalOutput += content;
                  eventStream.sendContent(content);
                }
              } catch {
                // Ignore parse errors
              }
            }
          }
        }

        if (!finalOutput || finalOutput.trim().length === 0) {
          finalOutput = "I was not able to generate a response. Please try rephrasing your question or asking again in a moment.";
          eventStream.sendContent(finalOutput);
        }
        
        // Summarize long conversations if user is authenticated (async, don't block response)
        if (memoryService && conversation.length > 20) {
          memoryService.summarizeConversation(conversation).catch((summaryError) => {
            console.error("Error summarizing conversation:", summaryError);
          });
        }
        
        eventStream.close();
        return new Response(eventStream.stream, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }

      // This should not be reached, but ensure we always return a stream
      // If we somehow get here without closing the stream, close it and return
      if (eventStream) {
        if (finalOutput) {
          eventStream.sendContent(finalOutput);
        } else {
          eventStream.sendContent("I apologize, but I was unable to generate a response. Please try again.");
        }
        eventStream.close();
        return new Response(eventStream.stream, {
          headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
        });
      }
      
      // Last resort fallback
      return respondWithStreamedText(finalOutput || "I apologize, but I was unable to generate a response. Please try again.", corsHeaders);
    }

    if (selectedProvider === "anthropic") {
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) {
        throw new Error("ANTHROPIC_API_KEY is not configured");
      }

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-3-haiku-20240307",
          system: systemPrompt,
          max_tokens: 1024,
          messages: mapMessagesForAnthropic(conversation),
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Anthropic error:", response.status, errorText);
        return new Response(JSON.stringify({ error: "Anthropic request failed" }), {
          status: response.status,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const data = await response.json();
      const text = Array.isArray(data?.content)
        ? data.content
            .map((part: { text?: string }) => part?.text ?? "")
            .join("\n")
            .trim()
        : "";

      // Summarize long conversations if user is authenticated (async, don't block response)
      if (memoryService && conversation.length > 20) {
        memoryService.summarizeConversation(conversation).catch((summaryError) => {
          console.error("Error summarizing conversation:", summaryError);
        });
      }

      return respondWithStreamedText(text, corsHeaders);
    }

    const apiKey = Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY is not configured");
    }

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          system_instruction: {
            parts: [{ text: systemPrompt }],
          },
          contents: mapMessagesForGemini(conversation),
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Gemini error:", response.status, errorText);
      return new Response(JSON.stringify({ error: "Gemini request failed" }), {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((part: { text?: string }) => part?.text ?? "")
      .join("\n")
      .trim() ?? "";

    // Summarize long conversations if user is authenticated
    if (memoryService && conversation.length > 20) {
      try {
        await memoryService.summarizeConversation(conversation);
      } catch (summaryError) {
        console.error("Error summarizing conversation:", summaryError);
        // Don't fail the request if summarization fails
      }
    }

    return respondWithStreamedText(text, corsHeaders);
  } catch (error) {
    console.error("chat error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    
    // Always return a stream, even for errors
    const errorStream = createEventStream(corsHeaders);
    errorStream.sendEvent({
      type: "error",
      timestamp: Date.now(),
      error: errorMessage,
    });
    errorStream.sendContent(`I apologize, but I encountered an error: ${errorMessage}. Please try again.`);
    errorStream.close();
    
    return new Response(errorStream.stream, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  }
});
