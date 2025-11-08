import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import type { Database } from "../_shared/database.types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type VisionProvider = "gpt4o" | "gemini";

interface VisionPayload {
  jobId?: string;
  provider?: VisionProvider;
}

const SUPABASE_URL = Deno.env.get("PROJECT_URL") ?? Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY =
  Deno.env.get("SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const AWS_REGION = Deno.env.get("AWS_REGION") ?? Deno.env.get("AWS_DEFAULT_REGION");
const AWS_ACCESS_KEY_ID = Deno.env.get("AWS_ACCESS_KEY_ID");
const AWS_SECRET_ACCESS_KEY = Deno.env.get("AWS_SECRET_ACCESS_KEY");
const AWS_SESSION_TOKEN = Deno.env.get("AWS_SESSION_TOKEN");
const AWS_S3_BUCKET = Deno.env.get("AWS_S3_BUCKET");

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const OPENAI_MODEL = Deno.env.get("OPENAI_VISION_MODEL") ?? "gpt-4o-mini";
const OPENAI_API_BASE = Deno.env.get("OPENAI_API_BASE") ?? "https://api.openai.com/v1";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const GEMINI_MODEL = Deno.env.get("GEMINI_VISION_MODEL") ?? "gemini-1.5-pro-latest";
const GEMINI_API_BASE = Deno.env.get("GEMINI_API_BASE") ?? "https://generativelanguage.googleapis.com/v1";

const supabase = SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
  ? createClient<Database>(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

const encoder = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function hmacSha256(key: string | ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const keyData = typeof key === "string" ? encoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(data));
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

async function createPresignedGetUrl(options: {
  bucket: string;
  key: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string | null;
  expiresIn?: number;
}): Promise<string> {
  const { bucket, key, region, accessKeyId, secretAccessKey, sessionToken, expiresIn = 300 } = options;

  const host = region === "us-east-1"
    ? `${bucket}.s3.amazonaws.com`
    : `${bucket}.s3.${region}.amazonaws.com`;

  const encodedKey = key.split("/").map((segment) => encodeRfc3986(segment)).join("/");
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

  const signedHeaders = "host";
  const queryEntries: [string, string][] = [
    ["X-Amz-Algorithm", "AWS4-HMAC-SHA256"],
    ["X-Amz-Credential", `${accessKeyId}/${credentialScope}`],
    ["X-Amz-Date", amzDate],
    ["X-Amz-Expires", String(expiresIn)],
    ["X-Amz-SignedHeaders", signedHeaders],
  ];

  if (sessionToken) {
    queryEntries.push(["X-Amz-Security-Token", sessionToken]);
  }

  const canonicalQuery = queryEntries
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .sort()
    .join("&");

  const canonicalHeaders = `host:${host}\n`;

  const canonicalRequest = [
    "GET",
    `/${encodedKey}`,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    toHex(await crypto.subtle.digest("SHA-256", encoder.encode(canonicalRequest))),
  ].join("\n");

  const kDate = await hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, "s3");
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  const finalQuery = `${canonicalQuery}&X-Amz-Signature=${signature}`;
  return `https://${host}/${encodedKey}?${finalQuery}`;
}

type VisionResult = {
  summary: string;
  bullet_points?: string[];
  chart_analysis?: string;
  ui_layout?: string;
  detected_text?: string[];
  tags?: Array<{ label: string; confidence?: number; category?: string }>;
  risk_notes?: string;
  suggested_questions?: string[];
};

function buildVisionPrompt(fileName: string, analysisTarget: string | null, ocrText?: string | null): string {
  const basePrompt = `You are an expert visual analyst. Review the provided image and deliver a thorough yet concise analysis.`;
  const targetContext = analysisTarget
    ? `This upload was tagged as "${analysisTarget}". Tailor your summary accordingly.`
    : "";
  const ocrContext = ocrText
    ? `Extracted OCR text (may include noise): """${ocrText.slice(0, 4000)}""". Use this only if it clearly belongs to the image.`
    : "No OCR text available.";

  return `${basePrompt}

${targetContext}

File name: ${fileName}
${ocrContext}

Return JSON adhering to the provided schema with:
- summary: 3-5 sentences describing key visuals, context, tone.
- bullet_points: important details or insights (max 6).
- chart_analysis: describe axes, trends, anomalies if chart-like content exists; otherwise empty string.
- ui_layout: call out UI elements (navigation, cards, CTAs) if it’s an interface screenshot.
- detected_text: key textual snippets visible in the image (not all OCR noise).
- tags: notable objects, themes, or categories with optional confidence 0-1.
- risk_notes: mention potential sensitive content if any, otherwise empty string.
- suggested_questions: follow-up prompts a user might ask.

Respond with JSON only. Do not include code fences or any additional commentary.
`;
}

async function summarizeWithOpenAI(imageUrl: string, prompt: string): Promise<{ result: VisionResult; cost?: Record<string, unknown> }> {
  if (!OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured");
  }

  const response = await fetch(`${OPENAI_API_BASE}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: imageUrl },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`OpenAI vision request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const result = data?.output?.[0]?.content?.[0]?.text ?? data?.output_text ?? "";
  let parsed: VisionResult;
  try {
    parsed = typeof result === "string" ? JSON.parse(result) : result;
  } catch (error) {
    console.error("OpenAI vision raw response:", result);
    parsed = {
      summary: typeof result === "string" ? result : JSON.stringify(result),
    };
  }

  const cost = data?.usage ?? null;

  return { result: parsed, cost: cost ?? undefined };
}

async function fetchImageBytes(url: string): Promise<{ mimeType: string; base64: string }> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch image for Gemini: ${response.status} ${await response.text()}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  const mimeType = response.headers.get("Content-Type") ?? "image/png";
  const bytes = new Uint8Array(arrayBuffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  const base64 = btoa(binary);
  return { mimeType, base64 };
}

async function summarizeWithGemini(imageUrl: string, prompt: string): Promise<{ result: VisionResult; cost?: Record<string, unknown> }> {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const { mimeType, base64 } = await fetchImageBytes(imageUrl);

  const response = await fetch(
    `${GEMINI_API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        generationConfig: {
          temperature: 0.2,
        },
        contents: [
          {
            parts: [
              { text: prompt },
              {
                inline_data: {
                  mime_type: mimeType,
                  data: base64,
                },
              },
            ],
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gemini vision request failed: ${response.status} ${text}`);
  }

  const data = await response.json();
  const resultTextRaw =
    data?.candidates?.[0]?.content?.parts?.find((part: { text?: string }) => part.text)?.text ??
    data?.output_text ??
    "";

  const cleaned =
    typeof resultTextRaw === "string"
      ? resultTextRaw.trim().replace(/^```json\s*/, "").replace(/```$/, "")
      : resultTextRaw;
  let parsed: VisionResult;
  try {
    parsed = typeof cleaned === "string" ? JSON.parse(cleaned) : cleaned;
  } catch (error) {
    console.error("Gemini vision raw response:", cleaned);
    parsed = {
      summary: typeof cleaned === "string" ? cleaned : JSON.stringify(cleaned),
    };
  }

  const cost = data?.usageMetadata ?? null;

  return { result: parsed, cost: cost ?? undefined };
}

async function runVisionAnalysis({
  provider,
  imageUrl,
  fileName,
  analysisTarget,
  ocrText,
}: {
  provider: VisionProvider;
  imageUrl: string;
  fileName: string;
  analysisTarget: string | null;
  ocrText?: string | null;
}): Promise<{ provider: VisionProvider; result: VisionResult; cost?: Record<string, unknown> }> {
  const prompt = buildVisionPrompt(fileName, analysisTarget, ocrText);

  if (provider === "gpt4o") {
    const { result, cost } = await summarizeWithOpenAI(imageUrl, prompt);
    return { provider, result, cost };
  }

  const { result, cost } = await summarizeWithGemini(imageUrl, prompt);
  return { provider, result, cost };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!supabase || !AWS_REGION || !AWS_S3_BUCKET || !AWS_ACCESS_KEY_ID || !AWS_SECRET_ACCESS_KEY) {
    return new Response(JSON.stringify({ error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let currentJobId: string | undefined;

  try {
    const payload: VisionPayload = await req.json();
    if (!payload.jobId) {
      return new Response(JSON.stringify({ error: "jobId is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    currentJobId = payload.jobId;
    const provider: VisionProvider = payload.provider ?? "gpt4o";

    const { data: job, error: jobError } = await supabase
      .from("processing_jobs")
      .select("*")
      .eq("id", currentJobId)
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: "Job not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!job.storage_path) {
      return new Response(JSON.stringify({ error: "Job missing storage path" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: resultRow } = await supabase
      .from("analysis_results")
      .select("*")
      .eq("job_id", currentJobId)
      .maybeSingle();

    const ocrText = resultRow?.ocr_text ?? null;

    const imageUrl = await createPresignedGetUrl({
      bucket: AWS_S3_BUCKET,
      key: job.storage_path,
      region: AWS_REGION,
      accessKeyId: AWS_ACCESS_KEY_ID,
      secretAccessKey: AWS_SECRET_ACCESS_KEY,
      sessionToken: AWS_SESSION_TOKEN ?? undefined,
      expiresIn: 60 * 10,
    });

    const { provider: resolvedProvider, result, cost } = await runVisionAnalysis({
      provider,
      imageUrl,
      fileName: job.file_name,
      analysisTarget: job.analysis_target,
      ocrText,
    });

    const { error: upsertError } = await supabase
      .from("analysis_results")
      .upsert(
        {
          job_id: job.id,
          vision_summary: result.summary,
          vision_metadata: {
            bullet_points: result.bullet_points ?? [],
            chart_analysis: result.chart_analysis ?? "",
            ui_layout: result.ui_layout ?? "",
            detected_text: result.detected_text ?? [],
            tags: result.tags ?? [],
            risk_notes: result.risk_notes ?? "",
            suggested_questions: result.suggested_questions ?? [],
          },
          vision_provider: resolvedProvider,
          vision_cost: cost ?? null,
        },
        { onConflict: "job_id" },
      );

    if (upsertError) {
      console.error("Failed to update analysis_results with vision summary", upsertError);
      let detailMessage = "Unknown Supabase upsert error";
      if (typeof upsertError === "string") {
        detailMessage = upsertError;
      } else if (upsertError && typeof upsertError === "object") {
        const possibleMessage =
          // deno-lint-ignore no-explicit-any
          (upsertError as any).message ??
          // deno-lint-ignore no-explicit-any
          (upsertError as any).code ??
          // deno-lint-ignore no-explicit-any
          (upsertError as any).hint ??
          // deno-lint-ignore no-explicit-any
          (upsertError as any).details;
        detailMessage = possibleMessage
          ? String(possibleMessage)
          : JSON.stringify(upsertError);
      }
      return new Response(
        JSON.stringify({
          error: "Failed to persist vision summary",
          details: detailMessage,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    return new Response(
      JSON.stringify({
        jobId: job.id,
        provider: resolvedProvider,
        vision_summary: result.summary,
        vision_metadata: {
          bullet_points: result.bullet_points ?? [],
          chart_analysis: result.chart_analysis ?? "",
          ui_layout: result.ui_layout ?? "",
          detected_text: result.detected_text ?? [],
          tags: result.tags ?? [],
          risk_notes: result.risk_notes ?? "",
          suggested_questions: result.suggested_questions ?? [],
        },
        cost: cost ?? null,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    console.error("vision-worker error", error);
    if (supabase && currentJobId) {
      const errorMessage = error instanceof Error ? error.message : "Unknown vision worker error";
      await supabase
        .from("analysis_results")
        .upsert(
          {
            job_id: currentJobId,
            vision_summary: null,
            vision_metadata: { error: errorMessage },
            vision_provider: null,
          },
          { onConflict: "job_id" },
        );
    }
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Unknown error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

