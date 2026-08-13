// Streamable-HTTP MCP client + registry of every Scalekit workspace tool.
// The plugin's action capability exposes one kind per tool; each handler
// opens a session against the (hosted by default) Scalekit MCP server with
// the deployment's OAuth access token and proxies a tools/call.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export interface McpToolResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
  [k: string]: unknown;
}

export interface McpToolClient {
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
  close(): Promise<void>;
}

export async function createMcpClient(options: {
  url: string;
  accessToken: string;
}): Promise<McpToolClient> {
  const transport = new StreamableHTTPClientTransport(new URL(options.url), {
    requestInit: {
      headers: { Authorization: `Bearer ${options.accessToken}` },
    },
  });
  const client = new Client({
    name: "openneko-plugin-scalekit",
    version: "0.4.0",
  });
  await client.connect(transport);
  return {
    async callTool(name, args) {
      const res = await client.callTool({ name, arguments: args });
      return res as unknown as McpToolResult;
    },
    async close() {
      try {
        await client.close();
      } catch {
        // best-effort
      }
    },
  };
}

export function joinTextContent(result: McpToolResult): string {
  return result.content
    .filter((c) => c.type === "text" && typeof c.text === "string")
    .map((c) => c.text ?? "")
    .join("\n\n");
}

export interface ToolDefinition {
  kind: string;
  description: string;
  default_mode: "auto" | "ask";
  example: Record<string, unknown>;
}

/**
 * One entry per Scalekit MCP tool. `default_mode` follows the tool's
 * OAuth scope: read-only → auto, write → ask (approval card).
 */
export const SCALEKIT_MCP_TOOLS: ToolDefinition[] = [
  { kind: "list_environments", description: "List all Scalekit environments in the workspace (Dev/Prod, ids + domains).", default_mode: "auto", example: {} },
  { kind: "get_environment_details", description: "Get details of one Scalekit environment by id.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "get_environment_credentials", description: "Return SCALEKIT_ENVIRONMENT_URL + SCALEKIT_CLIENT_ID for an environment (the client secret is dashboard-only).", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "list_environment_roles", description: "List roles defined in a Scalekit environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "create_environment_role", description: "Create a new role in a Scalekit environment.", default_mode: "ask", example: { environmentId: "env_123", roleName: "viewer", roleDisplayName: "Viewer", description: "", isDefault: false } },
  { kind: "list_environment_scopes", description: "List scopes defined in a Scalekit environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "create_environment_scope", description: "Create a new scope in a Scalekit environment.", default_mode: "ask", example: { environmentId: "env_123", scopeName: "billing_read", description: "" } },
  { kind: "list_workspace_members", description: "List members of the Scalekit workspace.", default_mode: "auto", example: {} },
  { kind: "invite_workspace_member", description: "Invite a member to the Scalekit workspace by email.", default_mode: "ask", example: { email: "admin@company.com" } },
  { kind: "list_organizations", description: "List organizations under a Scalekit environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "get_organization_details", description: "Get details of one Scalekit organization.", default_mode: "auto", example: { environmentId: "env_123", organizationId: "org_123" } },
  { kind: "create_organization", description: "Create a new organization under a Scalekit environment.", default_mode: "ask", example: { environmentId: "env_123" } },
  { kind: "generate_admin_portal_link", description: "Generate a single-use admin portal magic link for an organization (guides the operator through IdP setup).", default_mode: "ask", example: { environmentId: "env_123", organizationId: "org_123" } },
  { kind: "list_environment_connections", description: "List SSO/OIDC connections configured in an environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "list_organization_connections", description: "List connections for an organization (status DRAFT/IN_PROGRESS/COMPLETED).", default_mode: "auto", example: { environmentId: "env_123", organizationId: "org_123" } },
  { kind: "enable_environment_connection", description: "Enable an existing connection in an environment.", default_mode: "ask", example: { environmentId: "env_123", connectionId: "conn_123" } },
  { kind: "list_connected_accounts", description: "List connected accounts (connector authorizations) in an environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "create_connected_account_magic_link", description: "Create a magic link to connect an OAuth connector account at the environment level.", default_mode: "ask", example: { environmentId: "env_123", identifier: "notion-main", connector: "notion" } },
  { kind: "create_organization_user", description: "Create a user in a Scalekit organization.", default_mode: "ask", example: { environmentId: "env_123", organizationId: "org_123", email: "user@company.com", role: "admin" } },
  { kind: "list_organization_users", description: "List users of a Scalekit organization.", default_mode: "auto", example: { environmentId: "env_123", organizationId: "org_123" } },
  { kind: "update_organization_settings", description: "Update an organization's settings (e.g. directory sync features).", default_mode: "ask", example: { environmentId: "env_123", organizationId: "org_123", feature: [{ name: "dir_sync", enabled: true }] } },
  { kind: "list_mcp_servers", description: "List MCP servers registered in an environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "register_mcp_server", description: "Register a new MCP server in an environment (Scalekit-auth or custom provider).", default_mode: "ask", example: { environmentId: "env_123", name: "my-mcp", description: "", url: "https://mcp.example.com/", access_token_expiry: 3600, use_scalekit_authentication: true } },
  { kind: "update_mcp_server", description: "Update a registered MCP server in an environment.", default_mode: "ask", example: { environmentId: "env_123", id: "mcp_123" } },
  { kind: "switch_mcp_auth_to_scalekit", description: "Switch an MCP server's authentication to Scalekit.", default_mode: "ask", example: { environmentId: "env_123", id: "mcp_123" } },
  { kind: "search_connectors", description: "Search the Scalekit connector catalog for an environment.", default_mode: "auto", example: { environmentId: "env_123", query: "google" } },
  { kind: "search_tools", description: "Search tools (actions) exposed by connectors in an environment.", default_mode: "auto", example: { environmentId: "env_123", query: "send email" } },
  { kind: "search_docs", description: "Search Scalekit documentation by keyword.", default_mode: "auto", example: { query: "sso connection" } },
  { kind: "list_redirect_uris", description: "List allowed callback URLs (redirect URIs) for an environment.", default_mode: "auto", example: { environmentId: "env_123" } },
  { kind: "add_redirect_uri", description: "Add a callback URL to an environment's allowed redirect URIs.", default_mode: "ask", example: { environmentId: "env_123", uri: "https://app.example.com/api/auth/callback" } },
  { kind: "remove_redirect_uri", description: "Remove a callback URL from an environment's allowed redirect URIs.", default_mode: "ask", example: { environmentId: "env_123", uri: "https://app.example.com/api/auth/callback" } },
  { kind: "set_initiate_login_uri", description: "Set the initiate-login URI for an environment (IdP-initiated SSO).", default_mode: "ask", example: { environmentId: "env_123", uri: "https://app.example.com/signin" } },
  { kind: "remove_initiate_login_uri", description: "Clear the initiate-login URI for an environment.", default_mode: "ask", example: { environmentId: "env_123" } },
  { kind: "add_post_logout_redirect_uri", description: "Add a post-logout redirect URL for an environment.", default_mode: "ask", example: { environmentId: "env_123", uri: "https://app.example.com/" } },
  { kind: "remove_post_logout_redirect_uri", description: "Remove a post-logout redirect URL from an environment.", default_mode: "ask", example: { environmentId: "env_123", uri: "https://app.example.com/" } },
];

export const SCALEKIT_MCP_TOOL_KINDS: ReadonlySet<string> = new Set(
  SCALEKIT_MCP_TOOLS.map((t) => t.kind),
);
