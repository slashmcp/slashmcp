# Example Workflows for Multi-Agent Orchestration

This document provides concrete examples of workflows that users can build with the Visual Agent Workflow Builder.

## Example 1: Research & Summarize Workflow

**Goal:** Research a topic, gather information from multiple sources, and create a comprehensive summary.

### Workflow Structure:

```
[Start] 
  ↓
[Web Search Agent] → Search for "Model Context Protocol"
  ↓
[Grokipedia Agent] → Search knowledge base for related articles
  ↓
[Playwright Agent] → Scrape additional content from official docs
  ↓
[Gemini Agent] → Summarize all collected information
  ↓
[Canva Agent] → Create visual summary design
  ↓
[End] → Output: Summary document + visual design
```

### Node Configuration:

1. **Web Search Node**
   - Tool: `search-mcp/web_search`
   - Parameters: `query="Model Context Protocol"`, `max_results=5`
   - Output: Array of search results

2. **Grokipedia Node**
   - Tool: `grokipedia-mcp/search`
   - Parameters: `query="Model Context Protocol history"`, `limit=3`
   - Output: Knowledge base articles

3. **Playwright Node**
   - Tool: `playwright-mcp/browser_extract_text`
   - Parameters: `url="https://modelcontextprotocol.io"`
   - Output: Extracted text content

4. **Gemini Summarizer Node**
   - Tool: `gemini-mcp/generate_text`
   - Parameters: 
     - `prompt="Summarize the following information about MCP: {web_results} {grokipedia_results} {scraped_content}"`
     - `model="gemini-1.5-pro"`
   - Output: Comprehensive summary text

5. **Canva Design Node**
   - Tool: `canva-mcp/create_design`
   - Parameters:
     - `template="social_post"`
     - `text="{summary_text}"`
   - Output: Design URL

### Data Flow:
- Each node passes its output to the next node
- Gemini node receives concatenated inputs from all previous nodes
- Canva node receives the summary text from Gemini

---

## Example 2: Stock Analysis & Report Workflow

**Goal:** Analyze multiple stocks, compare performance, and generate a formatted report.

### Workflow Structure:

```
[Start]
  ↓
[Parallel Branch 1] → [Alpha Vantage] Get TSLA quote
[Parallel Branch 2] → [Alpha Vantage] Get AAPL quote
[Parallel Branch 3] → [Alpha Vantage] Get NVDA quote
  ↓
[Wait for All] → Merge all stock data
  ↓
[Gemini Agent] → Analyze and compare stocks
  ↓
[Canva Agent] → Create comparison chart design
  ↓
[End] → Output: Analysis report + visual chart
```

### Node Configuration:

1. **Stock Quote Nodes (3 parallel)**
   - Tool: `alphavantage-mcp/get_quote`
   - Parameters: `symbol="TSLA"` (or AAPL, NVDA)
   - Output: Stock quote data

2. **Merge Node** (automatic)
   - Combines all three stock quotes into a single array
   - Output: `[{TSLA: {...}}, {AAPL: {...}}, {NVDA: {...}}]`

3. **Analysis Node**
   - Tool: `gemini-mcp/generate_text`
   - Parameters:
     - `prompt="Compare these stocks: {merged_data}. Analyze trends, risks, and opportunities."`
     - `model="gemini-1.5-pro"`
   - Output: Analysis text

4. **Visualization Node**
   - Tool: `canva-mcp/create_design`
   - Parameters:
     - `template="chart"`
     - `text="{analysis_text}"`
   - Output: Chart design

---

## Example 3: Market Research & Prediction Workflow

**Goal:** Research a market topic, check prediction markets, and generate insights.

### Workflow Structure:

```
[Start]
  ↓
[Web Search] → Search for market topic
  ↓
[Polymarket] → Get prediction market data
  ↓
[Alpha Vantage] → Get related stock data
  ↓
[Gemini] → Synthesize insights
  ↓
[End] → Output: Market insights report
```

### Node Configuration:

1. **Web Search Node**
   - Tool: `search-mcp/web_search`
   - Parameters: `query="US election 2024 market impact"`

2. **Polymarket Node**
   - Tool: `polymarket-mcp/get_market_price`
   - Parameters: `market_id="us_election_2024"`

3. **Stock Data Node**
   - Tool: `alphavantage-mcp/get_stock_chart`
   - Parameters: `symbol="SPY"`, `range="1Y"`

4. **Synthesis Node**
   - Tool: `gemini-mcp/generate_text`
   - Parameters: `prompt="Analyze: {search_results} + {prediction_data} + {stock_data}"`

---

## Example 4: Content Creation Pipeline

**Goal:** Research topic → Generate content → Create visual → Publish

### Workflow Structure:

```
[Start]
  ↓
[Grokipedia] → Research topic
  ↓
[Gemini] → Generate article content
  ↓
[Gemini] → Create social media posts (3 variations)
  ↓
[Canva] → Create designs for each post
  ↓
[End] → Output: Article + 3 social media designs
```

### Node Configuration:

1. **Research Node**
   - Tool: `grokipedia-mcp/search`
   - Parameters: `query="AI agent frameworks"`

2. **Content Generation Node**
   - Tool: `gemini-mcp/generate_text`
   - Parameters: `prompt="Write a 1000-word article about: {research_results}"`

3. **Social Media Generator Node** (runs 3 times with different prompts)
   - Tool: `gemini-mcp/generate_text`
   - Parameters: 
     - `prompt="Create a Twitter post about: {article_content}"`
     - `prompt="Create a LinkedIn post about: {article_content}"`
     - `prompt="Create an Instagram caption about: {article_content}"`

4. **Design Nodes** (3 parallel)
   - Tool: `canva-mcp/create_design`
   - Parameters: `template="social_post"`, `text="{social_post_text}"`

---

## Example 5: Automated Testing & Documentation

**Goal:** Test a web application and generate documentation.

### Workflow Structure:

```
[Start]
  ↓
[Playwright] → Navigate to app
  ↓
[Playwright] → Take screenshot
  ↓
[Playwright] → Extract page content
  ↓
[Gemini] → Generate test documentation
  ↓
[End] → Output: Screenshot + documentation
```

### Node Configuration:

1. **Navigation Node**
   - Tool: `playwright-wrapper/browser_navigate`
   - Parameters: `url="http://localhost:5173"`

2. **Screenshot Node**
   - Tool: `playwright-wrapper/browser_take_screenshot`
   - Parameters: `filename="homepage.png"`, `fullPage=true`

3. **Content Extraction Node**
   - Tool: `playwright-wrapper/browser_extract_text`
   - Parameters: `url="http://localhost:5173"`

4. **Documentation Node**
   - Tool: `gemini-mcp/generate_text`
   - Parameters: `prompt="Create test documentation for: {screenshot} + {extracted_content}"`

---

## Workflow Patterns

### Pattern 1: Sequential Pipeline
```
A → B → C → D
```
Each node depends on the previous node's output.

### Pattern 2: Parallel Processing
```
    → B
A → → C
    → D
```
Multiple nodes run simultaneously, then merge.

### Pattern 3: Conditional Branching
```
A → [Condition] → B (if true)
              → C (if false)
```
Different paths based on data or conditions.

### Pattern 4: Loop/Iteration
```
A → B → [Loop: Process each item] → C
```
Process multiple items in a collection.

---

## Visual Representation

In the workflow builder, these would appear as:

- **Agent Nodes**: Rounded rectangles with agent icons
- **Tool Nodes**: Square nodes with tool icons
- **Data Nodes**: Diamond shapes for data transformations
- **Connections**: Arrows showing data flow
- **Parallel Branches**: Multiple arrows from one node
- **Conditional Branches**: Diamond decision nodes

Each node would have:
- **Input Ports**: Where data enters
- **Output Ports**: Where data exits
- **Configuration Panel**: Settings for the tool/agent
- **Status Indicator**: Running, success, error

---

## Benefits of Visual Workflows

1. **Reusability**: Save workflows as templates
2. **Complexity Management**: Visual representation makes complex flows understandable
3. **Debugging**: See exactly where failures occur
4. **Collaboration**: Share workflows with team members
5. **Iteration**: Easily modify and test different approaches
6. **Documentation**: The workflow itself documents the process

