# Product Requirements Document: Workflow Execution Engine

## 1. Overview

### 1.1 Purpose
The Workflow Execution Engine is a backend service that interprets visual workflow definitions (nodes and edges) and orchestrates the execution of multi-agent MCP workflows. It handles sequential and parallel execution, data flow between nodes, error handling, and execution tracking.

### 1.2 Goals
- Execute visual workflows created in the Workflow Builder
- Support sequential, parallel, and conditional execution patterns
- Handle data flow between workflow nodes
- Provide real-time execution status and logging
- Ensure reliability with error handling and retries
- Track execution history for debugging and analytics

### 1.3 Success Metrics
- Workflows execute successfully end-to-end
- Execution time is reasonable (< 30s for simple workflows)
- Error rate < 5% for valid workflows
- Real-time status updates visible to users
- Execution history is complete and queryable

---

## 2. User Stories

### 2.1 Basic Execution
**As a user**, I want to run a workflow I created, so that I can automate multi-step tasks.

**Acceptance Criteria:**
- User can click "Run" button on a workflow
- Workflow executes all nodes in correct order
- Results are displayed when complete
- Errors are clearly communicated

### 2.2 Real-Time Status
**As a user**, I want to see the progress of my workflow execution, so that I know what's happening.

**Acceptance Criteria:**
- Execution status updates in real-time
- Each node shows its execution status (pending, running, completed, failed)
- Progress percentage or step indicator is visible
- User can cancel a running workflow

### 2.3 Error Handling
**As a user**, I want to know when and why a workflow fails, so that I can fix issues.

**Acceptance Criteria:**
- Failed nodes are clearly identified
- Error messages are descriptive
- Execution stops at failure point (or continues based on configuration)
- Error details are logged for debugging

### 2.4 Execution History
**As a user**, I want to see past workflow executions, so that I can review results and debug issues.

**Acceptance Criteria:**
- List of all workflow executions
- Filter by status, date, workflow
- View detailed execution logs
- Re-run previous executions

---

## 3. Technical Architecture

### 3.1 System Components

```
┌─────────────────┐
│  Frontend       │
│  (React)        │
└────────┬────────┘
         │ HTTP/SSE
         ▼
┌─────────────────┐
│  Supabase Edge  │
│  Function:      │
│  workflow-execute│
└────────┬────────┘
         │
         ├──► Workflow Orchestrator
         │    - Parse workflow graph
         │    - Build execution plan
         │    - Manage execution state
         │
         ├──► Node Executor
         │    - Execute individual nodes
         │    - Handle MCP calls
         │    - Process data transformations
         │
         ├──► Execution Tracker
         │    - Update execution status
         │    - Log node executions
         │    - Stream updates to frontend
         │
         └──► MCP Proxy
              - Route to MCP servers
              - Handle authentication
              - Process responses
```

### 3.2 Execution Flow

1. **Parse Workflow**
   - Load workflow, nodes, and edges from database
   - Build directed graph representation
   - Validate workflow structure (no cycles, valid connections)

2. **Build Execution Plan**
   - Topological sort to determine execution order
   - Identify parallel execution opportunities
   - Create execution queue

3. **Execute Nodes**
   - Process nodes in order (respecting dependencies)
   - Execute parallel nodes simultaneously
   - Pass data between nodes via edges
   - Track execution status

4. **Handle Results**
   - Collect outputs from all nodes
   - Merge final results
   - Store execution history
   - Stream updates to frontend

### 3.3 Data Flow

```
Node Output → Edge Data Mapping → Next Node Input
```

- Each node produces output data
- Edges define how to map source output to target input
- Data transformations happen at edge level
- Final workflow output is aggregation of end nodes

---

## 4. Detailed Requirements

### 4.1 Workflow Execution API

#### 4.1.1 Execute Workflow Endpoint
**Endpoint:** `POST /functions/v1/workflow-execute`

**Request:**
```typescript
{
  workflow_id: string;
  input_data?: Record<string, unknown>;
  parameters?: Record<string, string | number | boolean>;
}
```

**Response:**
```typescript
{
  execution_id: string;
  status: "pending" | "running" | "completed" | "failed";
  workflow_id: string;
}
```

**Behavior:**
- Creates execution record in database
- Starts async execution
- Returns immediately with execution ID
- Frontend polls or uses SSE for updates

#### 4.1.2 Execution Status Endpoint
**Endpoint:** `GET /functions/v1/workflow-execution/:id`

**Response:**
```typescript
{
  execution: WorkflowExecution;
  node_executions: NodeExecution[];
  current_step: number;
  total_steps: number;
  progress: number; // 0-100
}
```

#### 4.1.3 Cancel Execution Endpoint
**Endpoint:** `POST /functions/v1/workflow-execution/:id/cancel`

**Behavior:**
- Sets execution status to "cancelled"
- Stops running nodes (best effort)
- Cleans up resources

### 4.2 Node Execution

#### 4.2.1 Node Types and Execution

**Start Node:**
- No execution needed
- Provides initial input data
- Always succeeds

**End Node:**
- Collects final outputs
- No execution needed
- Marks workflow as complete

**Tool Node:**
- Executes MCP command via proxy
- Parameters come from:
  - Node configuration (static)
  - Previous node outputs (dynamic)
  - Workflow input parameters
- Returns MCP command result

**Agent Node:**
- Similar to tool node
- May include LLM processing
- Can make multiple MCP calls

**Data Node:**
- Performs data transformation
- Operations: transform, filter, merge, split
- Uses JavaScript expressions or templates

**Condition Node:**
- Evaluates condition expression
- Routes to true/false branch
- Condition can reference previous outputs

**Merge Node:**
- Combines outputs from multiple parallel branches
- Strategies: concat, merge (deep), zip
- Produces single output for next nodes

#### 4.2.2 Node Execution States
- `pending`: Not yet started
- `running`: Currently executing
- `completed`: Successfully finished
- `failed`: Execution failed
- `skipped`: Skipped due to condition or error

### 4.3 Error Handling

#### 4.3.1 Error Types
1. **Node Execution Error**: MCP call fails, timeout, invalid response
2. **Data Transformation Error**: Invalid expression, type mismatch
3. **Workflow Structure Error**: Missing node, invalid connection
4. **Authentication Error**: MCP server auth failure

#### 4.3.2 Error Handling Strategies
- **Fail Fast**: Stop workflow on first error (default)
- **Continue on Error**: Skip failed nodes, continue execution
- **Retry**: Retry failed nodes (configurable, max 3 attempts)
- **Fallback**: Use alternative node if primary fails

#### 4.3.3 Error Reporting
- Error message in execution record
- Failed node clearly identified
- Stack trace for debugging
- Suggestions for fixing common errors

### 4.4 Data Flow and Mapping

#### 4.4.1 Edge Data Mapping
Edges can define how to map source output to target input:

```typescript
{
  source_node_id: string;
  target_node_id: string;
  data_mapping: {
    // Map source output fields to target input parameters
    "target_param": "source_field",
    "target_param2": "$.source.nested.field", // JSONPath
    "target_param3": "{{source_field}}", // Template
  }
}
```

#### 4.4.2 Data Transformation
- JSONPath for extracting nested values
- Template strings for formatting
- Type conversion (string to number, etc.)
- Array operations (map, filter, reduce)

### 4.5 Parallel Execution

#### 4.5.1 Parallel Node Detection
- Nodes with no dependencies on each other can run in parallel
- Identified during topological sort
- Executed concurrently using Promise.all()

#### 4.5.2 Merge Strategy
When multiple parallel branches converge:
- **Concat**: Combine arrays
- **Merge**: Deep merge objects
- **Zip**: Pair corresponding elements

### 4.6 Real-Time Updates

#### 4.6.1 Server-Sent Events (SSE)
Stream execution updates to frontend:

```
event: node_start
data: { node_id: "...", execution_id: "..." }

event: node_complete
data: { node_id: "...", output: {...} }

event: node_error
data: { node_id: "...", error: "..." }

event: workflow_complete
data: { execution_id: "...", output: {...} }
```

#### 4.6.2 Update Frequency
- Node state changes: Immediate
- Progress updates: Every 100ms
- Final result: On completion

---

## 5. Database Schema (Already Implemented)

### 5.1 Execution Tables
- `workflow_executions`: Main execution records
- `node_executions`: Individual node execution history

### 5.2 Required Fields
- Execution status tracking
- Input/output data storage
- Error messages
- Timestamps for performance analysis

---

## 6. Implementation Plan

### 6.1 Phase 1: Core Execution (Week 1)
- [ ] Create `workflow-execute` Supabase Edge Function
- [ ] Implement workflow graph parser
- [ ] Build execution orchestrator
- [ ] Execute nodes sequentially
- [ ] Basic error handling

### 6.2 Phase 2: Data Flow (Week 2)
- [ ] Implement edge data mapping
- [ ] Data transformation logic
- [ ] Parameter injection from previous nodes
- [ ] Output collection and merging

### 6.3 Phase 3: Advanced Features (Week 3)
- [ ] Parallel execution
- [ ] Conditional branching
- [ ] Merge node logic
- [ ] Retry mechanism

### 6.4 Phase 4: Real-Time Updates (Week 4)
- [ ] SSE streaming
- [ ] Frontend execution viewer
- [ ] Progress indicators
- [ ] Cancel functionality

### 6.5 Phase 5: Polish (Week 5)
- [ ] Execution history UI
- [ ] Error recovery suggestions
- [ ] Performance optimization
- [ ] Comprehensive testing

---

## 7. Edge Cases and Considerations

### 7.1 Workflow Validation
- Detect cycles in workflow graph
- Validate all nodes have required configuration
- Check MCP server availability
- Verify authentication credentials

### 7.2 Timeout Handling
- Node execution timeout (30s default)
- Workflow execution timeout (5min default)
- Graceful timeout handling

### 7.3 Resource Management
- Limit concurrent executions per user
- Rate limiting for MCP calls
- Memory management for large data flows

### 7.4 Security
- User can only execute their own workflows
- MCP credentials never exposed
- Input data sanitization
- SQL injection prevention

---

## 8. Testing Strategy

### 8.1 Unit Tests
- Workflow graph parsing
- Node execution logic
- Data transformation functions
- Error handling

### 8.2 Integration Tests
- End-to-end workflow execution
- MCP proxy integration
- Database operations
- SSE streaming

### 8.3 Test Workflows
- Simple sequential workflow
- Parallel execution workflow
- Conditional branching workflow
- Error handling workflow
- Large data workflow

---

## 9. Future Enhancements

### 9.1 Advanced Features
- Workflow scheduling (cron-like)
- Workflow versioning
- A/B testing workflows
- Workflow analytics dashboard

### 9.2 Performance
- Workflow caching
- Incremental execution (resume from failure)
- Distributed execution
- Workflow optimization suggestions

### 9.3 User Experience
- Visual execution viewer
- Step-by-step debugging
- Workflow performance metrics
- Cost tracking per execution

---

## 10. Success Criteria

The execution engine is successful when:
1. ✅ Users can execute workflows end-to-end
2. ✅ Execution completes in reasonable time
3. ✅ Errors are handled gracefully
4. ✅ Real-time updates work reliably
5. ✅ Execution history is complete
6. ✅ System handles edge cases
7. ✅ Performance is acceptable (< 30s for simple workflows)

---

## Appendix: Example Execution

### Simple Workflow
```
Start → Web Search → Gemini Summarize → End
```

**Execution:**
1. Start node: Provides input `{ query: "MCP" }`
2. Web Search node: Executes `search-mcp/web_search` with query
3. Gemini node: Receives search results, executes `gemini-mcp/generate_text`
4. End node: Collects summary, workflow complete

**Data Flow:**
- Start → Web Search: `{ query: "MCP" }`
- Web Search → Gemini: `{ results: [...], prompt: "Summarize: {{results}}" }`
- Gemini → End: `{ summary: "..." }`

---

**Document Version:** 1.0  
**Last Updated:** 2025-01-18  
**Status:** Ready for Implementation

