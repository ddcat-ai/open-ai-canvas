import type { MCPConnection, MCPConnectionInput, MCPParameter, MCPServerTemplate } from "@/services/api/agent-mcp";

const bearerParameter: MCPParameter = { name: "token", label: "访问令牌", description: "可选；用于服务要求的 Bearer 身份验证。", type: "secret", required: false };

export function mcpParameters(template?: MCPServerTemplate, connection?: MCPConnection): MCPParameter[] {
    const declared = template?.parameters ?? (connection?.templateId ? [] : [bearerParameter]);
    const known = new Set(declared.map((parameter) => parameter.name));
    const secrets = new Set(connection?.configuredSecrets ?? []);
    const extra = [...new Set([...Object.keys(connection?.parameters ?? {}), ...secrets])]
        .filter((name) => !known.has(name))
        .map((name): MCPParameter => ({ name, label: name, description: "", type: secrets.has(name) ? "secret" : "string", required: false }));
    return [...declared, ...extra];
}

export function createMCPConnectionDraft(template?: MCPServerTemplate, connection?: MCPConnection): MCPConnectionInput {
    const parameters = Object.fromEntries(mcpParameters(template, connection).map((parameter) => [parameter.name, parameter.type === "secret" ? "" : (connection?.parameters[parameter.name] ?? parameter.defaultValue ?? "")]));
    return {
        name: connection?.name ?? template?.name ?? "",
        templateId: connection?.templateId ?? template?.id,
        transport: connection?.transport ?? template?.transport ?? "streamable_http",
        serverUrl: connection?.serverUrl ?? template?.serverUrl ?? "",
        parameters,
        enabled: connection?.enabled ?? false,
        allowedTools: [...(connection?.allowedTools ?? [])],
    };
}

export function mcpConnectionChanged(input: MCPConnectionInput, connection?: MCPConnection) {
    if (!connection) return false;
    if (input.serverUrl.trim() !== connection.serverUrl || input.transport !== connection.transport || input.templateId !== connection.templateId) return true;
    const secrets = new Set(connection.configuredSecrets);
    return Object.entries(input.parameters).some(([name, value]) => (secrets.has(name) ? value !== "" : value !== (connection.parameters[name] ?? "")));
}

export function validateMCPConnection(input: MCPConnectionInput, parameters: MCPParameter[], connection?: MCPConnection) {
    if (!input.name.trim()) return "请输入连接名称";
    try {
        const url = new URL(input.serverUrl.trim());
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "请输入不含账号密码的 HTTP 或 HTTPS 服务地址";
        if (url.search || url.hash || input.serverUrl.includes("{{")) return "服务地址不能携带查询参数、片段或密钥占位符";
    } catch {
        return "请输入完整的 MCP 服务地址";
    }
    for (const parameter of parameters) {
        const keepsSecret = parameter.type === "secret" && connection?.configuredSecrets.includes(parameter.name) && input.serverUrl.trim() === connection.serverUrl && input.templateId === connection.templateId;
        if (parameter.required && !input.parameters[parameter.name]?.trim() && !keepsSecret) return `请填写${parameter.label || parameter.name}`;
    }
    if (input.enabled) {
        if (!connection?.lastTestAt || mcpConnectionChanged(input, connection)) return "请先保存参数并检测连接，再启用工具";
        if (!input.allowedTools.length) return "请选择至少一个允许使用的工具";
        if (input.allowedTools.some((name) => !connection.tools.some((tool) => tool.name === name))) return "工具列表已变化，请重新检测连接";
    }
    return "";
}

export function mcpConnectionWrite(input: MCPConnectionInput): MCPConnectionInput {
    return { ...input, name: input.name.trim(), serverUrl: input.serverUrl.trim(), parameters: { ...input.parameters }, allowedTools: [...new Set(input.allowedTools)] };
}

export function safeMCPHomepage(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
    } catch {
        return undefined;
    }
}
