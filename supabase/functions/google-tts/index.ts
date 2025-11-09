import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const allowedOrigins = Deno.env.get("ALLOWED_ORIGINS")?.split(",").map(origin => origin.trim()) ?? ["*"];

type GoogleServiceAccount = {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string;
  client_email: string;
  client_id: string;
};

const GOOGLE_TOKEN_AUDIENCE = "https://oauth2.googleapis.com/token";
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/cloud-platform";

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

type VoiceRequest = {
  text?: string;
  voice?: string;
  languageCode?: string;
  speakingRate?: number;
  pitch?: number;
};

const textEncoder = new TextEncoder();

function base64UrlEncode(input: string | Uint8Array): string {
  let raw: string;
  if (typeof input === "string") {
    raw = base64UrlEncode(textEncoder.encode(input));
    return raw;
  }

  let binary = "";
  for (let i = 0; i < input.length; i++) {
    binary += String.fromCharCode(input[i]);
  }
  raw = btoa(binary);
  return raw.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const pemContents = pem.replace(/-----BEGIN [^-]+-----/, "").replace(/-----END [^-]+-----/, "").replace(/\s+/g, "");
  const binary = atob(pemContents);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

async function getAccessTokenFromServiceAccount(credentials: GoogleServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const payload = {
    iss: credentials.client_email,
    scope: GOOGLE_SCOPE,
    aud: GOOGLE_TOKEN_AUDIENCE,
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;

  const keyData = pemToArrayBuffer(credentials.private_key);
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    textEncoder.encode(unsigned),
  );

  const jwt = `${unsigned}.${base64UrlEncode(new Uint8Array(signature))}`;

  const tokenResponse = await fetch(GOOGLE_TOKEN_AUDIENCE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    throw new Error(`Failed to obtain Google access token: ${errorText}`);
  }

  const tokenJson = await tokenResponse.json();
  const accessToken = tokenJson?.access_token as string | undefined;
  if (!accessToken) {
    throw new Error("Google access token response missing access_token field.");
  }
  return accessToken;
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

  if (req.method !== "POST") {
    return new Response("Method not allowed", {
      status: 405,
      headers: corsHeaders,
    });
  }

  try {
    const apiKey = Deno.env.get("GOOGLE_TTS_API_KEY");
    const serviceAccountJson = Deno.env.get("GOOGLE_TTS_CREDENTIALS");
    if (!apiKey) {
      if (!serviceAccountJson) {
        throw new Error("GOOGLE_TTS_API_KEY or GOOGLE_TTS_CREDENTIALS must be configured");
      }
    }

    const body = (await req.json()) as VoiceRequest;
    const text = body.text?.trim();

    if (!text) {
      return new Response(JSON.stringify({ error: "Missing text payload." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const voiceName = body.voice ?? "en-US-Studio-Q";
    const languageCode =
      body.languageCode ??
      (voiceName.includes("-") ? voiceName.split("-").slice(0, 2).join("-") : "en-US");

    const speakingRate = typeof body.speakingRate === "number" ? body.speakingRate : 1.05;
    const pitch = typeof body.pitch === "number" ? body.pitch : -1.0;

    const requestBody = JSON.stringify({
      input: { text },
      voice: {
        languageCode,
        name: voiceName,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate,
        pitch,
      },
    });

    let requestUrl = "https://texttospeech.googleapis.com/v1/text:synthesize";
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (serviceAccountJson) {
      const credentials = JSON.parse(serviceAccountJson) as GoogleServiceAccount;
      const accessToken = await getAccessTokenFromServiceAccount(credentials);
      headers.Authorization = `Bearer ${accessToken}`;
    } else {
      requestUrl += `?key=${apiKey}`;
    }

    const response = await fetch(requestUrl, {
      method: "POST",
      headers,
      body: requestBody,
    });

    const payloadText = await response.text();

    if (!response.ok) {
      console.error("Google TTS error:", response.status, payloadText);
      return new Response(payloadText || "Google TTS request failed", {
        status: response.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(payloadText);
    } catch (error) {
      console.error("Failed to parse TTS response", error);
      parsed = {};
    }

    const audioContent = typeof parsed.audioContent === "string" ? parsed.audioContent : "";
    if (!audioContent) {
      return new Response(JSON.stringify({ error: "No audio content returned from Google TTS." }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const payload = {
      audioContent,
      audioEncoding: "MP3",
      voice: voiceName,
    };

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("google-tts edge function error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Unknown error during speech synthesis.",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});

