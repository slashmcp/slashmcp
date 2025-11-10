# MCP Server Registry Feature Design for slashmcp

> **Implementation status (November 2025):** The shipped chat commands use the `/slashmcp` prefix (e.g. `/slashmcp add`, provider shortcuts like `/gemini`). Legacy references to `/add-mcp` and similar variants in the design below capture the original proposal; keep both in mind when evolving the feature.

## 1. System Architecture Overview

The goal is to introduce a dynamic **MCP Server Registry** feature to `slashmcp`, allowing users to register custom MCP gateways directly from the chat interface. This requires a three-part solution: a client-side UI/UX flow, a persistent backend service for registration and storage, and a runtime mechanism to integrate the new servers.

The proposed architecture leverages **Supabase** for persistent storage and serverless function execution, and the existing `slashmcp` client for the user interface and runtime routing.

### High-Level Component Diagram

The system will consist of the following primary components:

| Component | Technology | Role |
| :--- | :--- | :--- |
| **Client (Chat Bar)** | Frontend (e.g., React/Next.js) | Handles user input (`/add-mcp`), displays the UI flow for data collection, and triggers the backend registration. Fetches the active server list on boot. |
| **Supabase Edge Function (`mcp/register`)** | Supabase Functions (Deno/TypeScript) | **Backend Registration**: Validates input, performs health checks (`listTools`), stores metadata in the Supabase database, and handles secret management. |
| **Supabase Database** | PostgreSQL | **Persistent Storage**: Stores the `mcp_servers` registry table, including server metadata, gateway URLs, and user-specific authentication details. |
| **Supabase Edge Function (`mcp/proxy`)** | Supabase Functions (Deno/TypeScript) | **Runtime Proxy**: Acts as a secure intermediary, routing client requests to the registered MCP gateways using stored credentials. |
| **Client Runtime** | Frontend/Edge Logic | **Runtime Integration**: Merges the fetched `mcp_servers` list into the `MCP_SERVER_REGISTRY` and updates the chat parser's routing logic. |

### Security and Validation Strategy

Security is paramount, especially when dealing with external gateways. The following strategies will be employed:

1.  **Input Sanitization**: All user inputs (`name`, `gatewayUrl`, `credentials`) will be sanitized on the client and rigorously validated within the `mcp/register` Supabase function to prevent injection attacks.
2.  **URL Validation**: The `gatewayUrl` must be a valid, secure HTTPS endpoint. The `mcp/register` function will enforce this.
3.  **Health Check as Authorization**: The mandatory call to the MCP `listTools` endpoint serves as a basic authorization check, ensuring the provided URL is a functional MCP gateway before it is registered.
4.  **Secret Management**: API keys and OAuth tokens will be stored securely.
    *   **User-Specific Secrets**: Stored in the Supabase database, encrypted at rest, and only accessible by the user who registered the server.
    *   **Supabase Function Secrets**: Any necessary global secrets for the Supabase functions (e.g., a master key for internal communication) will be managed via `supabase secrets set`.
5.  **Proxying**: All runtime requests to custom servers will be routed through a dedicated Supabase function (`mcp/proxy`). This prevents the client from directly exposing user-specific API keys to the public internet and allows for centralized rate limiting and logging.

## 2. Detailed UI/UX and Chat Command Specification

The user experience should be simple and guided.

### Chat Commands

| Command | Syntax | Description |
| :--- | :--- | :--- |
| **`/add-mcp`** | `/add-mcp <name> <gatewayUrl>` | Initiates the guided flow for adding a new server. The `<name>` is the user-friendly identifier, and `<gatewayUrl>` is the base URL of the MCP gateway. |
| **`/add-mcp-json`** | `/add-mcp-json <json_payload>` | Allows power users to paste a complete JSON configuration object, bypassing the guided flow. |
| **`/remove-mcp`** | `/remove-mcp <name>` | Removes a custom server from the user's registry. |
| **`/list-mcp`** | `/list-mcp` | Displays a list of all custom registered servers and their status (Active/Inactive). |

### Guided UI Flow (`/add-mcp`)

1.  **User Input**: User types `/add-mcp MyServer https://api.myserver.com/mcp`.
2.  **Client Action**: The client parses the command and displays a temporary confirmation/credential form in the chat window.
3.  **Credential Prompt**: If the client detects the server requires credentials (e.g., based on a pre-defined list or a prompt from the gateway), it asks the user:
    *   "Does **MyServer** require an API Key or OAuth token?" (Yes/No)
    *   If Yes: "Please enter the API Key/Token:" (Input field with masking).
4.  **Submission**: The user submits the form. The client sends a request to the `mcp/register` Supabase function with the server name, URL, and credentials.
5.  **Backend Processing**: The Supabase function validates, health-checks, and stores the server.
6.  **Confirmation Message**: The client displays a final, rich confirmation message:
    > **✅ MCP Server Registered: MyServer**
    > **ID:** `server-1a2b3c`
    > **Gateway:** `https://api.myserver.com/mcp`
    > **Status:** **Active** (Health check passed)
    > **Action:** You can now use tools from this server with the prefix `/server-1a2b3c:toolname`.
    > [**Connect Now** Button] (Triggers a client-side reload/re-fetch of the registry).

## 3. Supabase Backend Schema and Function Logic

### Database Schema: `mcp_servers`

A single table will manage the registry. Row-Level Security (RLS) will be crucial to ensure users can only access their own registered servers.

| Column Name | Data Type | Constraint | Description |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | Primary Key, Auto-generated | Unique identifier for the server (used as the command prefix). |
| `user_id` | `uuid` | Foreign Key (auth.users) | The ID of the user who registered the server. **Crucial for RLS.** |
| `name` | `text` | NOT NULL, UNIQUE (per user) | User-friendly name (e.g., "MyServer"). |
| `gateway_url` | `text` | NOT NULL | The base URL of the MCP gateway. |
| `auth_type` | `text` | NOT NULL | Type of authentication: `none`, `api_key`, `oauth`. |
| `auth_secret` | `text` | NULLABLE | The API key or OAuth token. **Must be encrypted at rest.** |
| `is_active` | `boolean` | NOT NULL, Default: `TRUE` | User can disable the server without removing it. |
| `last_health_check` | `timestamp with time zone` | NULLABLE | Timestamp of the last successful health check. |
| `metadata` | `jsonb` | NULLABLE | Stores server-specific data (e.g., required headers, OAuth flow details). |

### Supabase Function: `mcp/register`

This function is the core of the registration process.

| Step | Action | Details |
| :--- | :--- | :--- |
| **1. Input Validation** | Check `name`, `gatewayUrl`, and `auth_secret`. | Ensure `gatewayUrl` is HTTPS and well-formed. Reject if `name` is already in use by the user. |
| **2. Health Check** | `fetch(gatewayUrl + '/listTools')` | Call the MCP endpoint. If it fails (4xx/5xx or timeout), return an error to the client. |
| **3. Secret Handling** | Encrypt `auth_secret`. | Use Supabase's built-in encryption features or a secure vault mechanism to encrypt the secret before storage. |
| **4. Database Insertion** | `INSERT INTO mcp_servers` | Insert the validated data, including the new `id` and the current `user_id`. |
| **5. Response** | Return the new server's `id` and a success status. | The client uses the `id` to form the command prefix. |

## 4. Runtime Integration and Security

### Client Boot Process

The client's initialization logic must be updated to dynamically load the server registry.

1.  **Existing Logic**: Client boots and loads the hardcoded `MCP_SERVER_REGISTRY`.
2.  **New Step**: Client makes an authenticated request to a new Supabase function, `mcp/get-registry`.
3.  **Supabase Function (`mcp/get-registry`)**: This function queries the `mcp_servers` table, filtered by the current `user_id` (enforced by RLS), and returns a list of active servers and their metadata (excluding the `auth_secret`).
4.  **Client Merge**: The client merges the returned list into the local `MCP_SERVER_REGISTRY`. The custom servers are now available for command parsing.

### Command Routing and Proxying

The key to secure runtime integration is the dedicated proxy function.

1.  **Chat Parser Update**: The chat parser is updated to recognize the new dynamic server IDs (e.g., `/server-1a2b3c:toolname`).
2.  **Request Rerouting**: When a command targets a custom server ID, the client does **not** call the `gatewayUrl` directly. Instead, it calls the **Supabase Proxy Function**: `mcp/proxy`.
3.  **Supabase Function (`mcp/proxy`)**:
    *   Receives the custom server `id` and the full MCP request payload.
    *   Authenticates the user and verifies they own the server `id`.
    *   Fetches the server's full record from the database, including the decrypted `auth_secret`.
    *   Constructs the final request to the actual `gatewayUrl`, injecting the `auth_secret` (e.g., as an `Authorization` header).
    *   Proxies the response back to the client.

This proxy architecture ensures that the user's API key/secret never leaves the secure Supabase environment, fulfilling the security consideration.

## 5. Development Instructions (Summary)

The implementation should follow these steps:

1.  **Database Setup**: Create the `mcp_servers` table with RLS enabled for `user_id`.
2.  **Backend Functions**: Implement the `mcp/register`, `mcp/get-registry`, and `mcp/proxy` Supabase Edge Functions.
3.  **Client UI**: Implement the chat command parsing for `/add-mcp`, `/remove-mcp`, and the guided UI flow.
4.  **Client Runtime**: Update the client boot sequence to call `mcp/get-registry` and merge the results into the `MCP_SERVER_REGISTRY`.
5.  **Client Routing**: Update the chat parser and request logic to route custom server commands through the `mcp/proxy` function.

---
*This document serves as the design specification for the MCP Server Registry feature.*

## 2. Detailed UI/UX and Chat Command Specification

This section provides the precise specifications for the user-facing components, ensuring a smooth and secure experience for adding and managing custom MCP servers.

### 2.1. Chat Command Syntax and Parsing

The primary command is `/add-mcp`, which supports two modes: guided and quick-add.

| Command | Syntax | Description | Client Action |
| :--- | :--- | :--- | :--- |
| **Guided Add** | `/add-mcp <name> <gatewayUrl>` | Initiates the interactive flow. The client validates the basic format and then prompts for credentials if necessary. | Client displays an inline form/prompt. |
| **JSON Quick-Add** | `/add-mcp-json <json_payload>` | For advanced users, accepts a complete JSON object containing all required fields, including credentials. | Client sends the JSON directly to `mcp/register` for validation and storage. |
| **Removal** | `/remove-mcp <name>` | Removes a custom server by its user-defined name. | Client sends request to `mcp/remove` Supabase function. |
| **Listing** | `/list-mcp` | Displays a summary of all custom servers registered by the user. | Client calls `mcp/get-registry` and formats the output. |

**Example JSON Payload for Quick-Add:**

```json
{
  "name": "MyPrivateGPT",
  "gatewayUrl": "https://api.mycompany.com/mcp/v1",
  "authType": "api_key",
  "authSecret": "sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
}
```

### 2.2. Guided UI Flow (`/add-mcp`)

The guided flow is designed to be resilient and informative, using the chat interface's ability to render interactive components (e.g., buttons, input fields).

**Step 1: Initial Command and Validation**

*   **User:** `/add-mcp MyServer https://api.myserver.com/mcp`
*   **Client Response (Inline):**
    > **Confirm Server Details:**
    > **Name:** `MyServer`
    > **URL:** `https://api.myserver.com/mcp`
    > **Security Check:** Does this server require an API Key or OAuth Token?
    > [**No Credentials** Button] [**API Key** Button] [**OAuth** Button]

**Step 2: Credential Input (If Required)**

*   **User Action:** Clicks **API Key** Button.
*   **Client Response (Inline):**
    > **Enter API Key for MyServer:**
    > [Input Field: `********************` (Masked)]
    > [**Submit** Button] [**Cancel** Button]

**Step 3: Submission and Backend Processing**

*   **User Action:** Enters key and clicks **Submit**.
*   **Client Action:** Sends a request to the `mcp/register` Supabase function.
*   **Client Response (Inline - Temporary):**
    > ⏳ **Registering MyServer...** Performing health check and securing credentials.

**Step 4: Confirmation or Error**

#### Success Message

If the `mcp/register` function returns success:

> **✅ MCP Server Registered: MyServer**
> **Server ID:** `srv_a1b2c3d4` (Used for command routing)
> **Gateway:** `https://api.myserver.com/mcp`
> **Status:** **Active** (Health check passed: `listTools` returned 5 tools)
> **Usage:** You can now use tools from this server with the prefix `/srv_a1b2c3d4:toolname`.
> [**Connect Now** Button] (Triggers a client-side registry refresh/reload)

#### Error Message

If the `mcp/register` function returns an error (e.g., health check failed, invalid URL):

> ❌ **Registration Failed for MyServer**
> **Reason:** Health check failed. The server at `https://api.myserver.com/mcp` did not respond to the `/listTools` endpoint.
> **Suggestion:** Please verify the URL and ensure the server is running and accessible.
> [**Try Again** Button] [**Cancel** Button]

### 2.3. Server Management UI (`/list-mcp`)

The `/list-mcp` command provides a clear overview of the user's custom servers.

*   **User:** `/list-mcp`
*   **Client Response (Inline):**

| Name | Server ID | Status | Auth Type | Last Check | Actions |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **MyServer** | `srv_a1b2c3d4` | **Active** | API Key | 2025-11-09 10:30 AM | [Disable] [Remove] |
| **LocalDev** | `srv_e5f6g7h8` | **Inactive** | None | 2025-11-08 09:00 AM | [Enable] [Remove] |
| **PublicTool** | `srv_i9j0k1l2` | **Active** | OAuth | 2025-11-09 10:35 AM | [Disable] [Remove] |

The **[Disable]** and **[Enable]** buttons trigger a call to a `mcp/toggle-active` Supabase function, which updates the `is_active` column in the database, allowing users to temporarily stop using a server without deleting its configuration.

## 3. Design Supabase Backend Schema and Function Logic

The backend is built entirely on **Supabase**, utilizing its PostgreSQL database for persistent storage and its Edge Functions for serverless logic and secure proxying.

### 3.1. Database Schema: `mcp_servers`

The table design prioritizes security, performance, and clear data separation.

| Column Name | Data Type | Constraint | Description | RLS Policy Note |
| :--- | :--- | :--- | :--- | :--- |
| `id` | `text` | Primary Key, Generated (`srv_` prefix) | Unique ID used as the command prefix (e.g., `srv_a1b2c3d4`). | |
| `user_id` | `uuid` | Foreign Key (`auth.users.id`) | The ID of the user who owns this server registration. | **Crucial for all RLS policies.** |
| `name` | `text` | NOT NULL, UNIQUE (`user_id`, `name`) | User-friendly name (e.g., "MyServer"). | |
| `gateway_url` | `text` | NOT NULL | The base URL of the MCP gateway (must be HTTPS). | |
| `auth_type` | `text` | NOT NULL, CHECK (`'none'`, `'api_key'`, `'oauth'`) | Specifies the type of authentication required. | |
| `auth_secret` | `text` | NULLABLE | The encrypted API key or OAuth token. | **Only accessible by the `mcp/proxy` function.** |
| `is_active` | `boolean` | NOT NULL, Default: `TRUE` | Toggle to enable/disable the server without deletion. | |
| `last_health_check` | `timestamp with time zone` | NULLABLE | Timestamp of the last successful health check. | |
| `metadata` | `jsonb` | NULLABLE | Stores additional server details (e.g., required headers, OAuth flow details). | |
| `created_at` | `timestamp with time zone` | Default: `now()` | Record creation timestamp. | |

#### Row-Level Security (RLS) Policies

RLS must be enabled on the `mcp_servers` table. The policies ensure that users can only interact with their own registered servers.

| Policy Name | Command | Target Roles | Policy Logic (`USING` clause) |
| :--- | :--- | :--- | :--- |
| `enable_select_own_servers` | `SELECT` | `authenticated` | `auth.uid() = user_id` |
| `enable_insert_own_servers` | `INSERT` | `authenticated` | `auth.uid() = user_id` |
| `enable_update_own_servers` | `UPDATE` | `authenticated` | `auth.uid() = user_id` |
| `enable_delete_own_servers` | `DELETE` | `authenticated` | `auth.uid() = user_id` |

### 3.2. Supabase Edge Function: `mcp/register`

This function is responsible for the secure and validated creation of a new server entry.

**Input:** `name`, `gatewayUrl`, `authType`, `authSecret` (optional)
**Output:** `id` of the new server or an error message.

| Step | Logic and Implementation Details |
| :--- | :--- |
| **1. Authentication & Authorization** | Retrieve `user_id` from the request context (JWT). If not authenticated, reject the request. |
| **2. Input Validation** | Validate that `name` is unique for the `user_id`. Validate `gatewayUrl` is a valid HTTPS URL. Validate `authType` is one of the allowed values. |
| **3. MCP Health Check** | **Crucial Step**: Use a secure `fetch` call to `gatewayUrl + '/listTools'`. If the response status is not 200 or the payload is invalid, fail the registration and return a helpful error message. |
| **4. Secret Encryption** | If `authSecret` is provided, use a PostgreSQL function (e.g., `pgsodium.crypto_aead_det_encrypt`) or a secure vault service to encrypt the secret before it is passed to the database insert. This ensures the secret is never stored in plaintext. |
| **5. Database Insertion** | Insert the new record into `mcp_servers`. The `id` should be generated with a clear prefix (e.g., `srv_` + a short unique string) for easy client-side parsing. |
| **6. Response** | Return a success object containing the new server's generated `id` and `name`. |

### 3.3. Supabase Edge Function: `mcp/get-registry`

This function is called by the client on boot to populate the `MCP_SERVER_REGISTRY`.

**Input:** None (user context is derived from JWT)
**Output:** Array of active server objects.

| Step | Logic and Implementation Details |
| :--- | :--- |
| **1. Authentication & Authorization** | Retrieve `user_id` from the request context. |
| **2. Database Query** | Query the `mcp_servers` table for all records where `user_id = auth.uid()` and `is_active = TRUE`. |
| **3. Data Projection** | **Security Note**: Explicitly select only non-sensitive columns: `id`, `name`, `gateway_url`, `auth_type`, `metadata`. **DO NOT** include `auth_secret`. |
| **4. Response** | Return the array of server objects. The client will merge this list with its default registry. |

### 3.4. Supabase Edge Function: `mcp/proxy`

This function is the secure runtime gateway for all custom server requests.

**Input:** `serverId`, `toolName`, `requestPayload` (the full MCP request body)
**Output:** The response from the target MCP gateway.

| Step | Logic and Implementation Details |
| :--- | :--- |
| **1. Authentication & Authorization** | Retrieve `user_id` from the request context. |
| **2. Server Lookup and Secret Retrieval** | Query the `mcp_servers` table using `serverId` and `user_id`. This RLS-protected query ensures the user owns the server. |
| **3. Secret Decryption** | Decrypt the stored `auth_secret` using the corresponding PostgreSQL function or vault service. |
| **4. Request Construction** | Construct the final request URL: `gateway_url + '/' + toolName`. |
| **5. Credential Injection** | Inject the decrypted secret into the request headers or body based on the stored `auth_type` (e.g., `Authorization: Bearer <secret>` for API Key). |
| **6. Proxy Request** | Forward the request to the target `gateway_url`. |
| **7. Response Handling** | Return the response (including status code and body) from the target MCP gateway directly back to the client. |
| **8. Error Handling** | If the proxy request fails (e.g., network error, 401 from target), log the error and return a generic, non-disclosing error message to the client. |

## 4. Runtime Integration and Security Strategy

The runtime integration is the final step, ensuring that the newly registered servers are seamlessly available to the user and that all interactions are secure.

### 4.1. Client Runtime Integration

The client application (likely a React/Next.js frontend) must update its initialization sequence to fetch the custom server registry.

#### Client Initialization Flow

1.  **Standard Initialization**: The client loads the hardcoded, default `MCP_SERVER_REGISTRY` (e.g., the official Manus MCP server).
2.  **Fetch Custom Registry**: After user authentication, the client makes an authenticated API call to the Supabase Edge Function:
    ```javascript
    const customServers = await fetch('/api/mcp/get-registry');
    ```
3.  **Registry Merge**: The client merges the returned list of active custom servers into the local `MCP_SERVER_REGISTRY`. The custom server objects must conform to the existing registry structure, but with a key difference in their `endpoint` definition:

| Registry Field | Default Server Value | Custom Server Value |
| :--- | :--- | :--- |
| `id` | `manus` | `srv_a1b2c3d4` |
| `name` | `Manus AI` | `MyServer` |
| `endpoint` | `https://api.manus.im/mcp` | **`https://supabase.project.url/functions/v1/mcp/proxy`** |
| `is_custom` | `false` | `true` |
| `base_url` | N/A | `https://api.myserver.com/mcp` (Stored for reference) |

By setting the `endpoint` of the custom server to the Supabase proxy function, all subsequent tool calls for that server will automatically be routed through the secure backend.

#### Chat Parser Update

The chat command parser must be updated to dynamically recognize the `id` of the custom servers.

*   **Existing Logic**: Recognizes commands like `/manus:toolname` or `/default:toolname`.
*   **New Logic**: The parser iterates through all `id`s in the merged `MCP_SERVER_REGISTRY`. If the user types `/<server_id>:<tool_name>`, the parser identifies the target server object and prepares the request payload.

**Example Command Routing:**

1.  **User types:** `/srv_a1b2c3d4:summarize`
2.  **Parser identifies:** `server_id = srv_a1b2c3d4`, `tool_name = summarize`.
3.  **Request Payload:** The client constructs the request to the custom server's `endpoint` (which is the Supabase proxy URL), including the `server_id` and the original MCP request body.

### 4.2. Comprehensive Security Strategy

The architecture is designed with security as a core principle, primarily through the use of the Supabase proxy function.

| Security Concern | Mitigation Strategy | Implementation Detail |
| :--- | :--- | :--- |
| **Exposure of Secrets** | **Server-Side Proxying** | The client never handles or knows the `auth_secret`. All requests to custom servers are routed through the `mcp/proxy` function, which securely retrieves and injects the secret on the server side. |
| **Unauthorized Access** | **Row-Level Security (RLS)** | The `mcp_servers` table is protected by RLS, ensuring that a user can only read, update, or delete server configurations that belong to their `user_id`. |
| **Malicious Gateway URL** | **Mandatory Health Check** | The `mcp/register` function performs a health check (`listTools`) before registration. This validates that the URL is a functioning MCP gateway, preventing the registration of arbitrary, non-MCP endpoints. |
| **Input Injection** | **Strict Validation and Sanitization** | All user inputs (`name`, `gatewayUrl`) are validated on the client and strictly validated/sanitized within the Supabase functions before database insertion or use in the proxy request. |
| **Secret Storage** | **Encryption at Rest** | The `auth_secret` column in the `mcp_servers` table is encrypted using a secure PostgreSQL extension (e.g., `pgsodium`), ensuring that even database administrators cannot view the secrets in plaintext. |

The **`mcp/proxy`** function acts as the **single security gate** for all custom server interactions, ensuring that:
1. The user is authenticated.
2. The user is authorized to use the requested server ID (via RLS).
3. The necessary credentials are securely retrieved and injected.
4. The client's request is safely forwarded to the external gateway.

## 6. Architectural Diagram

The following diagram illustrates the flow of registration and runtime usage for the custom MCP server registry feature.

![MCP Server Registry Architectural Diagram](/home/ubuntu/architecture_diagram.png)

## 7. Development Instructions Checklist

This checklist summarizes the required development tasks across the client and Supabase backend.

### 7.1. Supabase Backend Development

| Task ID | Component | Description | Priority |
| :--- | :--- | :--- | :--- |
| **DB-1** | Database | Create the `mcp_servers` table with the specified schema (Section 3.1). | High |
| **DB-2** | Database | Enable Row-Level Security (RLS) on `mcp_servers` and define the four policies (`SELECT`, `INSERT`, `UPDATE`, `DELETE`) based on `auth.uid() = user_id`. | High |
| **DB-3** | Database | Implement secure secret storage (e.g., using `pgsodium` or a similar extension) for the `auth_secret` column. | High |
| **FN-1** | Edge Function | Implement `mcp/register` (Section 3.2) for input validation, health check (`listTools`), secret encryption, and database insertion. | High |
| **FN-2** | Edge Function | Implement `mcp/get-registry` (Section 3.3) to securely fetch active, non-sensitive server metadata for the authenticated user. | High |
| **FN-3** | Edge Function | Implement `mcp/proxy` (Section 3.4) for secure runtime routing, secret decryption, credential injection, and request forwarding. | High |
| **FN-4** | Edge Function | Implement utility functions `mcp/remove` and `mcp/toggle-active` for server management. | Medium |

### 7.2. Client (slashmcp) Development

| Task ID | Component | Description | Priority |
| :--- | :--- | :--- | :--- |
| **CL-1** | Chat Parser | Update the parser to recognize and handle the new commands: `/add-mcp`, `/add-mcp-json`, `/remove-mcp`, and `/list-mcp`. | High |
| **CL-2** | UI/UX | Implement the interactive, guided UI flow for `/add-mcp` (Section 2.2), including the credential prompt and confirmation messages. | High |
| **CL-3** | Runtime | Modify the client initialization sequence to call `mcp/get-registry` and merge the results into the `MCP_SERVER_REGISTRY` (Section 4.1). | High |
| **CL-4** | Runtime | Update the request routing logic to identify custom server IDs (`srv_` prefix) and route their requests to the `mcp/proxy` function instead of the `gatewayUrl`. | High |
| **CL-5** | UI/UX | Implement the display and interactive buttons for the `/list-mcp` command (Section 2.3). | Medium |

### 7.3. Security and Testing

| Task ID | Component | Description | Priority |
| :--- | :--- | :--- | :--- |
| **SEC-1** | Testing | Verify that RLS prevents User A from accessing User B's server configurations. | Critical |
| **SEC-2** | Testing | Verify that the `mcp/proxy` function successfully decrypts and injects the `auth_secret` without exposing it to the client. | Critical |
| **SEC-3** | Testing | Verify that the health check in `mcp/register` correctly rejects non-MCP or unreachable URLs. | High |
| **SEC-4** | Testing | Conduct end-to-end testing for a full cycle: registration, client boot, and successful tool execution via the proxy. | High |
