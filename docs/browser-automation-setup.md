# Browser Automation Setup for Research Assistant

This guide explains how to set up full browser automation for recursive testing and web scraping in SlashMCP.

## Architecture

```
User → SlashMCP Chat → playwright-wrapper (Supabase) → browser-service (Node.js/Puppeteer)
```

The `playwright-wrapper` Supabase function acts as a proxy that:
- Uses real browser automation when `browser-service` is deployed
- Falls back to HTTP fetch for basic testing

## Step 1: Deploy Browser Service

### Option A: Render (Recommended - Free tier available)

1. **Create Account**: Go to https://render.com
2. **New Web Service**: Click "New +" → "Web Service"
3. **Connect GitHub**: Select your `SlashMCP` repository
4. **Configure**:
   - **Name**: `browser-service`
   - **Root Directory**: `browser-service`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Plan**: Free (or paid for better performance)
5. **Environment Variables**:
   - `PORT=3000`
   - `NODE_ENV=production`
6. **Deploy**: Click "Create Web Service"

After deployment, copy the service URL (e.g., `https://browser-service.onrender.com`)

### Option B: Railway

1. **Create Account**: Go to https://railway.app
2. **New Project**: Click "New Project" → "Deploy from GitHub repo"
3. **Select Repo**: Choose `SlashMCP`
4. **Configure**:
   - Set root directory to `browser-service`
   - Railway auto-detects Node.js
5. **Deploy**: Railway will auto-deploy

### Option C: Fly.io

```bash
cd browser-service
flyctl launch
# Follow prompts
flyctl deploy
```

## Step 2: Configure Supabase

1. **Get Browser Service URL**: Copy the deployed URL (e.g., `https://browser-service.onrender.com`)
2. **Add Supabase Secret**:
   ```bash
   npx supabase secrets set BROWSER_SERVICE_URL=https://your-service-url.com --project-ref akxdroedpsvmckvqvggr
   ```
3. **Redeploy playwright-wrapper**:
   ```bash
   npx supabase functions deploy playwright-wrapper --project-ref akxdroedpsvmckvggr
   ```

## Step 3: Test Browser Automation

In your SlashMCP chat:

```bash
# Navigate to your app (will execute JavaScript!)
/srv_ba559a954e05 browser_navigate url=https://slashmcp.vercel.app

# Get snapshot (will see React-rendered content!)
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app

# Take screenshot
/srv_ba559a954e05 browser_take_screenshot url=https://slashmcp.vercel.app
```

## Step 4: Enable Research Assistant Mode

The browser automation is now integrated into the research assistant flow. When you ask questions like:

- "Research this website: https://example.com"
- "What's on the homepage of slashmcp.vercel.app?"
- "Test our app and find all the buttons"

The assistant will automatically use browser automation to:
1. Navigate to the URL
2. Wait for JavaScript to load
3. Extract content, links, buttons
4. Take screenshots if needed
5. Provide comprehensive analysis

## Recursive Testing

To test your own app recursively:

```bash
# 1. Navigate to your app
/srv_ba559a954e05 browser_navigate url=https://slashmcp.vercel.app

# 2. Get snapshot of all elements
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app

# 3. Click elements (e.g., sign in button)
/srv_ba559a954e05 browser_click ref=button#sign-in url=https://slashmcp.vercel.app

# 4. Take screenshots at each step
/srv_ba559a954e05 browser_take_screenshot url=https://slashmcp.vercel.app
```

## Troubleshooting

### Browser service not responding
- Check service logs on Render/Railway/Fly.io
- Verify service URL is correct in Supabase secrets
- Test service directly: `curl https://your-service.com/health`

### Timeout errors
- Increase timeout in `browser-service/index.js` (currently 30s)
- Check if target website is slow to load

### Memory issues
- Upgrade to paid tier on Render/Railway
- Reduce concurrent requests
- Browser instance is reused, but pages are closed after each request

## Cost Considerations

- **Render Free**: 750 hours/month, spins down after 15min inactivity
- **Railway**: $5/month minimum, always-on
- **Fly.io**: Pay-as-you-go, good for low traffic

For production use, consider paid tiers for better performance.

