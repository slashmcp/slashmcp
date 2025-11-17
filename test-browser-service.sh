#!/bin/bash
# Quick test script for browser automation service

echo "🧪 Testing Browser Automation Service"
echo "======================================"
echo ""

SERVICE_URL="https://slashmcp.onrender.com"

echo "1️⃣ Testing health endpoint..."
curl -s "$SERVICE_URL/health" | jq '.' || echo "❌ Health check failed"
echo ""

echo "2️⃣ Testing browser navigation (example.com)..."
curl -s -X POST "$SERVICE_URL/invoke" \
  -H "Content-Type: application/json" \
  -d '{"command":"browser_navigate","args":{"url":"https://example.com"}}' | jq '.result.summary' || echo "❌ Navigation failed"
echo ""

echo "3️⃣ Testing browser snapshot (example.com)..."
curl -s -X POST "$SERVICE_URL/invoke" \
  -H "Content-Type: application/json" \
  -d '{"command":"browser_snapshot","args":{"url":"https://example.com"}}' | jq '.result.summary' || echo "❌ Snapshot failed"
echo ""

echo "✅ Tests complete!"

