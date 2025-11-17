# Playwright Wrapper MCP

A Supabase Edge Function that wraps Playwright browser automation in the SlashMCP JSON gateway format.

## Current Status

✅ **Structure**: Function accepts JSON gateway format (`{ command, args }`)  
✅ **HTTP-based Testing**: Implements lightweight browser testing via HTTP fetch  
⏳ **Full Browser Automation**: For screenshots/JS execution, use a headless browser service API

## Supported Commands

- `browser_navigate` - Navigate to a URL
- `browser_snapshot` - Get accessibility snapshot of current page
- `browser_click` - Click an element
- `browser_take_screenshot` - Capture screenshot

## Implementation Details

This function uses **HTTP-based testing** for lightweight page analysis:
- Fetches page HTML via HTTP
- Extracts titles, headings, links, and buttons via regex
- Simulates navigation by following links
- Works for static content and basic page structure analysis

**Limitations:**
- Cannot execute JavaScript (React apps need SSR or pre-rendering)
- Cannot take actual screenshots (returns page structure instead)
- Cannot interact with dynamic elements that require JS

**For Full Browser Automation:**
- Use a headless browser service API (e.g., Browserless.io, ScrapingBee)
- Or deploy a separate Node.js service with Puppeteer/Playwright

## Deployment

```bash
npx supabase functions deploy playwright-wrapper --project-ref akxdroedpsvmckvqvggr
```

## Registration in SlashMCP

Once deployed, register it:

```text
/slashmcp add playwright-wrapper https://YOUR_PROJECT.functions.supabase.co/playwright-wrapper
```

