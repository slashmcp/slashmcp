# Browser Automation Testing Checklist

## Pre-Deployment Checklist

✅ **Service Deployed**: `https://slashmcp.onrender.com`
✅ **Supabase Secret Set**: `BROWSER_SERVICE_URL`
✅ **playwright-wrapper Updated**: Proxies to browser service
✅ **Chat Agent Updated**: Knows about browser automation

## Step 1: Verify Service Health

Once Render build completes, test the health endpoint:

```bash
curl https://slashmcp.onrender.com/health
```

Expected response:
```json
{
  "status": "ok",
  "service": "browser-automation",
  "browserReady": true
}
```

## Step 2: Test Basic Browser Commands

In your SlashMCP chat at https://slashmcp.vercel.app:

### 2.1 Navigate to a Simple Site
```
/srv_ba559a954e05 browser_navigate url=https://example.com
```
**Expected**: Should return page title and status 200

### 2.2 Navigate to Your App
```
/srv_ba559a954e05 browser_navigate url=https://slashmcp.vercel.app
```
**Expected**: Should return your app's title

### 2.3 Get Snapshot (THE BIG TEST!)
```
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app
```
**Expected**: Should see:
- ✅ Buttons (Sign in, etc.)
- ✅ Links
- ✅ Headings
- ✅ All React-rendered content (not empty!)

This is the key test - if you see buttons/links, JavaScript execution is working!

## Step 3: Test Research Assistant Mode

Try natural language queries:

### 3.1 Research a Website
```
"Research https://example.com and tell me what's on the page"
```

### 3.2 Test Your Own App
```
"Test our app at slashmcp.vercel.app and find all the buttons"
```

### 3.3 Extract Content
```
"What text is visible on https://slashmcp.vercel.app?"
```

## Step 4: Recursive Testing Workflow

Test your app recursively:

### 4.1 Initial Navigation
```
/srv_ba559a954e05 browser_navigate url=https://slashmcp.vercel.app
```

### 4.2 Get Full Snapshot
```
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app
```

### 4.3 Find a Button to Click
Look for a button ref in the snapshot, then:
```
/srv_ba559a954e05 browser_click ref=button#sign-in url=https://slashmcp.vercel.app
```

### 4.4 Take Screenshot
```
/srv_ba559a954e05 browser_take_screenshot url=https://slashmcp.vercel.app
```

### 4.5 Extract Text
```
/srv_ba559a954e05 browser_extract_text url=https://slashmcp.vercel.app
```

## Step 5: Test Different Websites

### 5.1 Static HTML Site
```
/srv_ba559a954e05 browser_snapshot url=https://example.com
```

### 5.2 React App (Your App)
```
/srv_ba559a954e05 browser_snapshot url=https://slashmcp.vercel.app
```

### 5.3 Complex Site
```
/srv_ba559a954e05 browser_navigate url=https://github.com
/srv_ba559a954e05 browser_snapshot url=https://github.com
```

## Troubleshooting

### If browser_snapshot returns empty arrays:
- ❌ JavaScript not executing
- Check Render logs for errors
- Verify Chromium is installed

### If commands timeout:
- Service might be spinning down (free tier)
- Wake it up: `curl https://slashmcp.onrender.com/health`
- Wait 30-60 seconds, then retry

### If you get 401 errors:
- Check Supabase secret is set correctly
- Redeploy playwright-wrapper

### If browser won't launch:
- Check Render logs
- Verify Puppeteer installed correctly
- May need to use Docker instead

## Success Criteria

✅ **Basic Navigation**: Can navigate to any URL
✅ **JavaScript Execution**: Snapshot shows React-rendered content
✅ **Element Detection**: Can find buttons, links, headings
✅ **Screenshots**: Can capture page images
✅ **Research Mode**: Natural language queries work
✅ **Recursive Testing**: Can test your own app

## Next Steps After Testing

Once everything works:
1. Set up a cron job to keep service awake (optional)
2. Test with more complex workflows
3. Integrate into automated testing pipeline
4. Use for production research tasks

