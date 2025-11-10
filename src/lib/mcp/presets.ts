import type { McpProviderPreset } from "./types";

export const MCP_PROVIDER_PRESETS: Record<string, McpProviderPreset> = {
  gemini: {
    id: "gemini",
    label: "Gemini MCP",
    description: "Google Gemini tools via MCP gateway",
    gatewayUrl: "https://gateway.gemini.google.com/mcp",
    authType: "api_key",
    requiresSecret: true,
    notes: "Create a Gemini API key and supply it with key=YOUR_KEY",
  },
  playwright: {
    id: "playwright",
    label: "Playwright MCP",
    description: "Browser automation via Playwright MCP",
    gatewayUrl: "https://playwright.yourdomain.com/mcp",
    authType: "none",
    requiresSecret: false,
  },
  polygon: {
    id: "polygon",
    label: "Polygon.io",
    description: "Financial data from Polygon.io",
    gatewayUrl: "https://mcp.polygon.io",
    authType: "api_key",
    requiresSecret: true,
    notes: "Use your Polygon API key with key=YOUR_KEY",
  },
  alphavantage: {
    id: "alphavantage",
    label: "Alpha Vantage",
    description: "Alpha Vantage MCP adapter",
    gatewayUrl: "https://alphavantage.yourdomain.com/mcp",
    authType: "api_key",
    requiresSecret: true,
  },
  polymarket: {
    id: "polymarket",
    label: "Polymarket MCP",
    description: "Prediction market MCP gateway",
    gatewayUrl: "https://polymarket.yourdomain.com/mcp",
    authType: "none",
  },
};

export const MCP_PROVIDER_COMMANDS = Object.keys(MCP_PROVIDER_PRESETS).map(alias => `/${alias}`);

export function findProviderPreset(alias: string): McpProviderPreset | undefined {
  const normalized = alias.replace(/^\//, "").toLowerCase();
  return MCP_PROVIDER_PRESETS[normalized];
}
