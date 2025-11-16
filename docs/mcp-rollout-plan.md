# MCP Server Rollout Plan

This document tracks follow-on work for wiring additional Model Context Protocol (MCP) servers into SlashMCP. Each section captures the prerequisites, engineering tasks, and validation steps required for a production-ready integration.

## 1. Core Gateway Hardening

- [ ] Stand up the MCP gateway process (e.g. Manus MCP CLI or custom proxy) and expose it at `VITE_MCP_GATEWAY_URL`.
- [ ] Add structured logging and request telemetry (status, latency, command, server id).
- [ ] Implement auth between frontend and gateway (Supabase JWT or shared secret).
- [ ] Add retry / exponential backoff policy for transient MCP failures.
- [ ] Document local development workflow (how to run gateway + sample env files).

## 2. Polymarket (`polymarket-mcp`)

- [x] Confirm API access requirements (public vs API key). If API key required, store as Supabase secret `POLYMARKET_API_KEY`.
- [x] Extend Supabase Edge Function `mcp` to proxy `polymarket-mcp` commands.
- [ ] Add rich rendering component (price chart, probability cards) for `get_market_price`.
- [x] Update registry entry with supported subcommands and argument validation rules.
- [ ] Write integration test invoking `/polymarket-mcp get_market_price market_id=...` and snapshot response.

## 3. Knowledge Retrieval (`grokipedia-mcp`)

- [ ] Decide on deployment model (self-host vs managed). Capture infra steps.
- [ ] Extend `mcp` function with search proxy and response summarization.
- [ ] Build UI template for multi-hit knowledge cards (title, abstract, citations).
- [ ] Add caching layer for frequent queries (KV store or Supabase table).
- [ ] Add regression tests for search edge cases (no hits, truncation, pagination).

## 4. Canva Design (`canva-mcp`)

- [ ] Complete OAuth client registration; store secrets in Supabase (`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`).
- [ ] Implement OAuth callback flow (Supabase function or separate server).
- [ ] Extend `mcp` handler to initiate design creation and return shareable links / thumbnails.
- [ ] Add UI to preview designs and surface download links.
- [ ] Document manual review process for Canva scopes/permissions.

## 5. Playwright Automation (`playwright-mcp`)

- [ ] Provision headless browser environment for the MCP server (e.g. Fly.io, Railway, Lambda with Chromium).
- [ ] Extend `mcp` handler with `navigate_and_scrape` and `screenshot` commands, including binary payload support.
- [ ] Add frontend rendering for scrape text and screenshot thumbnails (support for base64 images).
- [ ] Add job tracking to monitor long-running browser tasks.
- [ ] Create security review checklist (allowed domains, rate limits, credential handling).

## 6. Monitoring & Alerting

- [ ] Instrument Supabase `mcp` function with error metrics (Logflare, Sentry).
- [ ] Configure alerting for repeated command failures or latency spikes.
- [ ] Add health-check endpoint for MCP gateway probes.
- [ ] Create dashboard summarizing usage by server/command.

## 7. Documentation

- [x] Update `README.md` with gateway setup instructions, Google OAuth prerequisites, and slash command examples.
- [x] Generate quick reference cheat-sheet sourced from `src/lib/mcp/registry.ts` (`docs/mcp-command-cheatsheet.md`).
- [ ] Record Loom walkthrough showing MCP commands end-to-end.
  - Loom recording script prepped in `docs/mcp-loom-walkthrough-script.md`; ready for capture.
- [x] Capture manual end-to-end test notes for `/slashmcp` login, list, add/remove, and natural-language triggers (see `docs/mcp-registry-e2e.md`).

## 8. Gemini Nano Banana (`gemini-mcp`)

- [x] Configure Supabase secret `GEMINI_API_KEY` and gateway environment.
- [x] Extend `mcp` function with Gemini `generate_text` proxy (model, system, temperature support).
- [x] Add registry entry plus cheat-sheet docs for command parameters.
- [ ] Add frontend rich rendering (token usage, finish reason, retry controls).
- [ ] Create regression test covering `/gemini-mcp generate_text prompt="..."`.

