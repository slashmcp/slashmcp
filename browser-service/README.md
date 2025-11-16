# Browser Automation Service

A Node.js service using Puppeteer for full browser automation with JavaScript execution. This enables recursive testing and web scraping for the SlashMCP research assistant.

## Features

- ✅ Full JavaScript execution (works with React SPAs)
- ✅ Screenshot capture
- ✅ Element interaction (click, navigate)
- ✅ Accessibility snapshots
- ✅ Text extraction
- ✅ Recursive testing support

## Local Development

```bash
cd browser-service
npm install
npm run dev
```

The service will run on `http://localhost:3000`

## Deployment

### Option 1: Render (Recommended)

1. Create a new **Web Service** on Render
2. Connect your GitHub repo
3. Set:
   - **Build Command**: `cd browser-service && npm install`
   - **Start Command**: `cd browser-service && npm start`
   - **Environment**: `Node`
4. Add environment variable: `PORT=3000`

### Option 2: Railway

1. Create new project on Railway
2. Connect GitHub repo
3. Set root directory to `browser-service`
4. Railway auto-detects Node.js

### Option 3: Fly.io

1. Install Fly CLI: `flyctl install`
2. Run: `flyctl launch` in `browser-service` directory
3. Follow prompts

## Register in SlashMCP

Once deployed, register the service:

```
/slashmcp add browser-service https://YOUR-SERVICE-URL/invoke
```

## Supported Commands

- `browser_navigate` - Navigate to URL (waits for JS to load)
- `browser_snapshot` - Get accessibility snapshot with all interactive elements
- `browser_click` - Click elements by selector
- `browser_take_screenshot` - Capture full page screenshots
- `browser_extract_text` - Extract all text content from page

## Usage Example

```bash
# Navigate to your app
/browser-service browser_navigate url=https://slashmcp.vercel.app

# Get snapshot (will see React-rendered content!)
/browser-service browser_snapshot url=https://slashmcp.vercel.app

# Click a button
/browser-service browser_click ref=button#sign-in url=https://slashmcp.vercel.app

# Take screenshot
/browser-service browser_take_screenshot url=https://slashmcp.vercel.app
```

## Notes

- Browser instance is reused for performance
- Each request gets a new page (isolated)
- Supports full JavaScript execution
- Works with React, Vue, Angular, and any SPA

