import { http } from "./request";

export type MCPTransport = "streamable_http" | "sse";
export type MCPManagementScope = "user" | "platform";

export interface MCPParameter {
    name: string;
    label: string;
    description: string;
    type: "string" | "secret";
    required: boolean;
    defaultValue?: string;
}

export interface MCPServerTemplate {
    id: string;
    name: string;
    description: string;
    homepage: string;
    transport: MCPTransport;
    serverUrl: string;
    headers: Record<string, string>;
    parameters: MCPParameter[];
    published: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MCPTool {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    readOnly: boolean;
}

export interface MCPConnection {
    id: string;
    revision: number;
    scope: MCPManagementScope;
    templateId?: string;
    name: string;
    transport: MCPTransport;
    serverUrl: string;
    enabled: boolean;
    parameters: Record<string, string>;
    configuredSecrets: string[];
    tools: MCPTool[];
    allowedTools: string[];
    allowedUserIds?: string[];
    toolPolicies?: Record<string, Record<string, unknown>>;
    lastTestAt?: string;
    createdAt: string;
    updatedAt: string;
}

export interface MCPConnectionInput {
    name: string;
    templateId?: string;
    transport: MCPTransport;
    serverUrl: string;
    parameters: Record<string, string>;
    enabled: boolean;
    allowedTools: string[];
    allowedUserIds: string[];
    toolPolicies: Record<string, Record<string, unknown>>;
}

export type MCPServerTemplateInput = Omit<MCPServerTemplate, "id" | "createdAt" | "updatedAt">;

function mcpBase(scope: MCPManagementScope) {
    return scope === "platform" ? "/admin/mcp" : "/agent/mcp";
}

export function listMCPTemplates(scope: MCPManagementScope, signal?: AbortSignal) {
    return http.get<{ items: MCPServerTemplate[] }>(`${mcpBase(scope)}/catalog`, { signal, timeout: 15_000 });
}

export function listMCPConnections(scope: MCPManagementScope, signal?: AbortSignal) {
    return http.get<{ items: MCPConnection[] }>(`${mcpBase(scope)}/connections`, { signal, timeout: 15_000 });
}

export function saveMCPConnection(scope: MCPManagementScope, id: string | undefined, input: MCPConnectionInput) {
    const path = `${mcpBase(scope)}/connections`;
    return id ? http.put<MCPConnection>(`${path}/${encodeURIComponent(id)}`, input, { timeout: 15_000 }) : http.post<MCPConnection>(path, input, { timeout: 15_000 });
}

export function deleteMCPConnection(scope: MCPManagementScope, id: string) {
    return http.delete<{ deleted: true }>(`${mcpBase(scope)}/connections/${encodeURIComponent(id)}`, { timeout: 15_000 });
}

export function testMCPConnection(scope: MCPManagementScope, id: string) {
    return http.post<MCPConnection>(`${mcpBase(scope)}/connections/${encodeURIComponent(id)}/test`, {}, { timeout: 60_000 });
}

export function saveMCPTemplate(id: string | undefined, input: MCPServerTemplateInput) {
    return id ? http.put<MCPServerTemplate>(`/admin/mcp/catalog/${encodeURIComponent(id)}`, input, { timeout: 15_000 }) : http.post<MCPServerTemplate>("/admin/mcp/catalog", input, { timeout: 15_000 });
}

export function deleteMCPTemplate(id: string) {
    return http.delete<{ deleted: true }>(`/admin/mcp/catalog/${encodeURIComponent(id)}`, { timeout: 15_000 });
}
