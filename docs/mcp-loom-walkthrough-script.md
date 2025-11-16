# Loom Walkthrough Script: SlashMCP MCP Commands

Use this script to record a Loom video that demonstrates the end-to-end experience of SlashMCP, from login through executing a few MCP commands.

## Prep Checklist

- Ensure Supabase credentials and MCP gateway environment variables are configured locally.
- Start the MCP gateway and Supabase Edge Functions (`npm run dev` plus gateway process).
- Confirm the MCP registry includes at least `polymarket-mcp` and `alphavantage-mcp`.
- Open the SlashMCP web app in a clean browser profile with the devtools console hidden.

## Recording Outline

1. **Intro (0:00 – 0:30)**
   - Introduce yourself and state the goal: “Today I’ll show how SlashMCP wires Model Context Protocol servers into our slash command UX.”
   - Mention prerequisites (Supabase login, MCP gateway URL, installed servers).

2. **Login & Session Check (0:30 – 1:15)**
   - Navigate to the SlashMCP login page.
   - Sign in with Supabase email magic link or OAuth and narrate the flow.
   - After login, open the `/slashmcp` command palette to show available servers.

3. **Listing Registered Servers (1:15 – 1:45)**
   - Run `/slashmcp list` to display installed MCP servers.
   - Call out metadata shown (labels, categories) and note how it maps to the registry.

4. **Polymarket Demo (1:45 – 2:45)**
   - Execute `/polymarket-mcp get_market_price market_id=us_election_2024`.
   - Highlight structured response rendering (probabilities, last updated timestamp).
   - Briefly mention upcoming UI enhancements (rich price chart).

5. **Alpha Vantage Demo (2:45 – 3:45)**
   - Trigger `/alphavantage-mcp get_quote symbol=NVDA`.
   - Point out key stats returned and how authentication relies on `ALPHAVANTAGE_API_KEY`.

6. **Help & Cheat Sheet Callout (3:45 – 4:15)**
   - Show where the new quick reference cheat sheet lives (`docs/mcp-command-cheatsheet.md`).
   - Mention that operators can use the sheet for parameters and sample commands.

7. **Outro (4:15 – 4:45)**
   - Summarize benefits (single command surface, standardized telemetry).
   - Ask viewers to report issues in the `#slashmcp` Slack channel.

## Post-Recording Notes

- Trim dead air, and set the Loom thumbnail to the command palette view.
- Add chapters in Loom matching the outline headings for easy navigation.
- Share the Loom link in `docs/mcp-rollout-plan.md` once uploaded.


