import { findServerDefinition } from "./registry";
import type { McpInvocation, McpServerId } from "./types";

export interface ParseMcpCommandResult {
  invocation: McpInvocation;
  isMcpCommand: boolean;
  validationMessage?: string;
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  let escapeNext = false;

  for (const char of input) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === "\\" && inQuotes) {
      escapeNext = true;
      continue;
    }

    if (char === "'" || char === "\"") {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
        continue;
      }
      if (quoteChar === char) {
        inQuotes = false;
        continue;
      }
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
}

function stripWrappingQuotes(value: string): string {
  if (value.length < 2) return value;
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}

function normalizeServerId(raw: string): McpServerId | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  // Dynamic, user-registered servers are stored with ids like srv_...
  if (lower.startsWith("srv_")) {
    return lower;
  }

  const candidate = lower as McpServerId;
  return findServerDefinition(candidate) ? candidate : null;
}

export function parseMcpCommand(rawInput: string): ParseMcpCommandResult | null {
  const trimmed = rawInput.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const tokens = tokenize(trimmed.slice(1));
  if (tokens.length === 0) {
    return null;
  }

  const serverId = normalizeServerId(tokens[0]);
  if (!serverId) {
    return null;
  }

  const invocation: McpInvocation = {
    serverId,
    command: tokens[1],
    args: {},
    positionalArgs: [],
    rawInput,
  };

  const argTokens = tokens.slice(2);
  for (const token of argTokens) {
    const equalIndex = token.indexOf("=");
    if (equalIndex === -1) {
      invocation.positionalArgs.push(stripWrappingQuotes(token));
      continue;
    }

    const key = token.slice(0, equalIndex);
    const value = token.slice(equalIndex + 1);
    if (!key) {
      invocation.positionalArgs.push(stripWrappingQuotes(value));
      continue;
    }
    invocation.args[key] = stripWrappingQuotes(value);
  }

  if (!invocation.command) {
    const server = findServerDefinition(serverId);
    return {
      invocation,
      isMcpCommand: true,
      validationMessage: server
        ? `Available commands: ${server.commands.map(cmd => cmd.name).join(", ")}`
        : "No commands registered for this server.",
    };
  }

  return { invocation, isMcpCommand: true };
}

