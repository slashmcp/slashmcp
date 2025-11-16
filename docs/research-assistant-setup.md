# Research Assistant & Recursive Testing Setup

## What We've Built

✅ **Browser Automation Service** (`browser-service/`)
- Full JavaScript execution with Puppeteer
- Works with React SPAs and dynamic content
- Supports screenshots, element interaction, text extraction

✅ **Enhanced Playwright Wrapper**
- Proxies to browser service when available
- Falls back to HTTP fetch for basic testing
- Seamlessly integrated with existing MCP infrastructure

✅ **Research Assistant Integration**
- Chat agent automatically uses browser automation for research
- Can scrape websites, extract content, analyze pages
- Supports recursive testing of your own app

## Quick Start

### 1. Deploy Browser Service

**Option A: Render (Free tier)**
1. Go to https://render.com
2. New Web Service → Connect GitHub repo
3. Set root directory: `browser-service`
4. Build: `npm install`, Start: `npm start`
5. Copy the service URL

**Option B: Railway**
1. New project → Deploy from GitHub
2. Set root: `browser-service`
3. Auto-deploys

### 2. Configure Supabase

```bash
# Add browser service URL as secret
npx supabase secrets set BROWSER_SERVICE_URL=https://your-service-url.com --project-ref akxdroedpsvmckvqvggr

# Redeploy playwright-wrapper
npx supabase functions deploy playwright-wrapper --project-ref akxdroedpsvmckvqvggr
```

### 3. Test It

In your SlashMCP chat:

```bash
# Research a website
"Research this website: https://example.com"

# Test your own app
/srv_ba559a954e05 browser_navigate url=https://slashmcp.vercel.app
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app

# Extract text for analysis
/srv_ba559a954e05 browser_extract_text url=https://slashmcp.vercel.app
```

## Research Assistant Usage

The assistant now automatically uses browser automation when you ask:

- **"Research [website URL]"** - Navigates, extracts content, analyzes
- **"What's on [website]?"** - Gets page structure and content
- **"Test our app"** - Recursively tests your deployed app
- **"Find all buttons on [URL]"** - Uses browser snapshot to find elements
- **"Take a screenshot of [URL]"** - Captures visual representation

## Recursive Testing Workflow

1. **Navigate**: `browser_navigate url=https://slashmcp.vercel.app`
2. **Snapshot**: `browser_snapshot url=...` (gets all interactive elements)
3. **Interact**: `browser_click ref=button#sign-in url=...`
4. **Verify**: `browser_take_screenshot url=...` (visual confirmation)
5. **Extract**: `browser_extract_text url=...` (content analysis)

## Architecture

```
User Query
    ↓
Chat Agent (OpenAI Agents SDK)
    ↓
MCP Tool Agent
    ↓
playwright-wrapper (Supabase Edge Function)
    ↓
browser-service (Node.js + Puppeteer)
    ↓
Real Browser (Chromium)
    ↓
Website/App
```

## Next Steps

1. **Deploy browser service** to Render/Railway/Fly.io
2. **Configure Supabase secret** with service URL
3. **Test with natural language**: "Research https://example.com"
4. **Test recursively**: "Test our app and find all interactive elements"

## Files Created

- `browser-service/` - Node.js service with Puppeteer
- `docs/browser-automation-setup.md` - Detailed setup guide
- Updated `supabase/functions/playwright-wrapper/index.ts` - Proxy support
- Updated `supabase/functions/chat/index.ts` - Research assistant integration

## Cost

- **Render Free**: 750 hours/month (spins down after 15min)
- **Railway**: $5/month (always-on)
- **Fly.io**: Pay-as-you-go

For production, consider paid tiers for better performance.

