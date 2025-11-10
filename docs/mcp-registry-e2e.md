# MCP Registry End-to-End Test Notes

_Updated: 2025-11-10_

This document captures the manual validation run after wiring Google OAuth sign-in and the `/slashmcp` command suite. Follow the same sequence whenever we refresh auth or registry logic.

## 1. Prerequisites

- Supabase project with the latest migrations applied (`mcp_servers` table, RLS policies).
- Supabase secrets configured: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALPHAVANTAGE_API_KEY`, `TWELVEDATA_API_KEY` (optional), `POLYMARKET_CACHE_TTL_MS`.
- Frontend `.env.local` populated with `VITE_SUPABASE_URL`, `VITE_SUPABASE_FUNCTIONS_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_MCP_GATEWAY_URL`, and (optionally) `VITE_SUPABASE_REDIRECT_URL`.
- At least one Google account authorized for the OAuth client.

## 2. Happy Path Flow

1. **Load app** – Navigate to the dev URL. The header now shows a “Sign in with Google” button.
2. **Google sign-in** – Click the button, complete the OAuth prompt, and verify the chat surfaces `✅ Signed in as <email>`.
3. **Baseline command** – Run `/slashmcp list` to confirm the registry call succeeds (expect “No MCP servers registered yet” on a clean account).
4. **Preset add** – Execute `/gemini key=example-secret` to register a preset server. Expected response: `✅ Registered Gemini …` with returned server id.
5. **Custom add** – Run `/slashmcp add demo https://example.com/mcp auth=none` (replace with a reachable test gateway). Check that `list` now displays both entries.
6. **Remove** – `/slashmcp remove demo` should return `🗑️ Removed MCP server "demo"` and the next `/slashmcp list` call should only show the preset server.
7. **Sign out** – Click the header sign-out button (or run `await supabase.auth.signOut()` in the console). The chat should confirm the session was cleared and subsequent `/slashmcp list` commands should prompt for login again.

## 3. Regression Checks

- **Duplicate add** – Attempt to register the same `name` twice; expect a descriptive error that the server already exists.
- **Unauthenticated call** – Open a private window without signing in and run `/slashmcp list`; verify the assistant instructs you to authenticate first.
- **Natural language triggers** – Ask “Show me Tesla’s stock price” and “What are the election odds on Polymarket?” to ensure the NLP handlers route through the MCP gateway (stock card or probability response).
- **Network failure** – Temporarily disable network access to the custom gateway and call `/slashmcp add demo https://unreachable.test`. Ensure the edge function surfaces a clear failure message.

Document pass/fail notes inline as we iterate so Phase 4 audit has a persistent record. 
