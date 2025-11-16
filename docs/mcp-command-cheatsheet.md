# MCP Command Quick Reference

This cheat sheet mirrors the entries in `src/lib/mcp/registry.ts`. It provides operators with command syntax, key parameters, and configuration requirements for each registered MCP server.

## How to Read This Guide

- **Install**: CLI command to install the MCP server through `manus-mcp-cli`.
- **Auth / Env**: Environment variables or secrets required before invoking commands.
- **Example**: Copy-pastable `/slashmcp` invocation that exercises the command with realistic arguments.

## Registered Servers

### Alpha Vantage (`alphavantage-mcp`)

- **Install**: `manus-mcp-cli install alphavantage-mcp`
- **Auth / Env**: `ALPHAVANTAGE_API_KEY`
- **Commands**:
  - `get_stock_chart`
    - Purpose: Historical price series for a ticker.
    - Parameters: `symbol` (required), `interval`, `range`
    - Example: `/alphavantage-mcp get_stock_chart symbol=TSLA interval=1wk`
  - `get_quote`
    - Purpose: Latest quote plus key stats.
    - Parameters: `symbol` (required)
    - Example: `/alphavantage-mcp get_quote symbol=NVDA`

### Polymarket (`polymarket-mcp`)

- **Install**: `manus-mcp-cli install polymarket-mcp`
- **Commands**:
  - `get_market_price`
    - Purpose: Retrieve pricing info for a prediction market.
    - Parameters: `market_id` (required)
    - Example: `/polymarket-mcp get_market_price market_id=us_election_2024`

### Grokipedia (`grokipedia-mcp`)

- **Install**: `manus-mcp-cli install grokipedia-mcp`
- **Commands**:
  - `search`
    - Purpose: Query structured knowledge base articles.
    - Parameters: `query` (required), `limit`
    - Example: `/grokipedia-mcp search query="Model Context Protocol history" limit=3`

### Canva Designs (`canva-mcp`)

- **Install**: `manus-mcp-cli install canva-mcp`
- **Auth / Env**: `CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`
- **Commands**:
  - `create_design`
    - Purpose: Generate a design from a Canva template.
    - Parameters: `template` (required), `text` (required)
    - Example: `/canva-mcp create_design template=social_post text="New Research Findings"`

### Gemini Nano Banana (`gemini-mcp`)

- **Install**: `manus-mcp-cli install gemini-mcp`
- **Auth / Env**: `GEMINI_API_KEY`
- **Commands**:
  - `generate_text`
    - Purpose: Lightweight Gemini generation for copy, summaries, or playful nano banana riffs.
    - Parameters: `prompt` (required), `model`, `system`, `temperature`, `max_output_tokens`
    - Example: `/gemini-mcp generate_text prompt="Pitch a nano banana smoothie" model=gemini-1.5-flash temperature=0.6`

### Playwright Automation (`playwright-mcp`)

- **Install**: `manus-mcp-cli install playwright-mcp`
- **Commands**:
  - `navigate_and_scrape`
    - Purpose: Visit a URL and scrape content using a CSS selector.
    - Parameters: `url` (required), `selector` (required)
    - Example: `/playwright-mcp navigate_and_scrape url=https://example.com selector=article`
  - `screenshot`
    - Purpose: Capture a screenshot of a page or selector.
    - Parameters: `url` (required), `selector`
    - Example: `/playwright-mcp screenshot url=https://example.com selector=header`


