import type { MCPConnection, MCPConnectionInput, MCPManagementScope, MCPParameter, MCPServerTemplate } from "@/services/api/agent-mcp";

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
        allowedUserIds: [...(connection?.allowedUserIds ?? [])],
        toolPolicies: structuredClone(connection?.toolPolicies ?? {}),
    };
}

export function mcpConnectionChanged(input: MCPConnectionInput, connection?: MCPConnection) {
    if (!connection) return false;
    if (input.serverUrl.trim() !== connection.serverUrl || input.transport !== connection.transport || input.templateId !== connection.templateId) return true;
    const secrets = new Set(connection.configuredSecrets);
    return Object.entries(input.parameters).some(([name, value]) => (secrets.has(name) ? value !== "" : value !== (connection.parameters[name] ?? "")));
}

export function validateMCPConnection(input: MCPConnectionInput, parameters: MCPParameter[], connection?: MCPConnection, scope: MCPManagementScope = connection?.scope ?? "user") {
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
    if (scope === "user" && (input.allowedUserIds.length || Object.keys(input.toolPolicies).length)) return "个人连接不能配置平台用户或参数授权策略";
    if (scope === "platform") {
        if (input.allowedUserIds.length > 100) return "每个平台连接最多授权 100 个用户";
        if (input.allowedUserIds.some((id) => !id.trim() || new TextEncoder().encode(id.trim()).length > 36)) return "用户 ID 不能为空，且最多 36 字节";
    }
    if (input.enabled) {
        if (!connection?.lastTestAt || mcpConnectionChanged(input, connection)) return "请先保存参数并检测连接，再启用工具";
        if (!input.allowedTools.length) return "请选择至少一个允许使用的工具";
        if (input.allowedTools.some((name) => !connection.tools.some((tool) => tool.name === name))) return "工具列表已变化，请重新检测连接";
        if (scope === "platform") {
            if (!input.allowedUserIds.length) return "请指定至少一个允许使用此平台连接的用户 ID";
            const policyError = validateMCPToolPolicies(input.toolPolicies, input.allowedTools);
            if (policyError) return policyError;
        }
    }
    return "";
}

export function mcpConnectionWrite(input: MCPConnectionInput): MCPConnectionInput {
    const allowedTools = [...new Set(input.allowedTools)];
    return {
        ...input,
        name: input.name.trim(),
        serverUrl: input.serverUrl.trim(),
        parameters: { ...input.parameters },
        allowedTools,
        allowedUserIds: [...new Set(input.allowedUserIds.map((id) => id.trim()).filter(Boolean))],
        toolPolicies: Object.fromEntries(allowedTools.filter((name) => Object.hasOwn(input.toolPolicies, name)).map((name) => [name, structuredClone(input.toolPolicies[name])])),
    };
}

function validateMCPToolPolicies(policies: MCPConnectionInput["toolPolicies"], allowedTools: string[]) {
    for (const name of allowedTools) {
        const policy = policies[name];
        if (!policy || typeof policy !== "object" || Array.isArray(policy) || policy.type !== "object") return `请为 ${name} 明确填写 type 为 object 的参数限制`;
        if (new TextEncoder().encode(JSON.stringify(policy)).length > 8 * 1024) return `${name} 的参数限制不能超过 8 KiB`;
        const pending: unknown[] = [policy];
        while (pending.length) {
            const value = pending.pop();
            if (!value || typeof value !== "object") continue;
            for (const [key, child] of Object.entries(value)) {
                if ((key === "$ref" || key === "$dynamicRef") && typeof child === "string" && !child.startsWith("#")) return `${name} 的参数限制不能引用外部 Schema`;
                if (child && typeof child === "object") pending.push(child);
            }
        }
    }
    if (new TextEncoder().encode(JSON.stringify(policies)).length > 64 * 1024) return "工具参数限制合计不能超过 64 KiB";
    return "";
}

export function parseMCPToolPolicies(textByTool: Record<string, string>, allowedTools: string[], requireAll = true): MCPConnectionInput["toolPolicies"] {
    const policies: MCPConnectionInput["toolPolicies"] = {};
    for (const name of new Set(allowedTools)) {
        const text = Object.hasOwn(textByTool, name) ? textByTool[name].trim() : "";
        if (!text) {
            if (requireAll) throw new Error(`请为 ${name} 明确填写参数限制`);
            continue;
        }
        try {
            Object.defineProperty(policies, name, { value: JSON.parse(text), enumerable: true });
        } catch {
            throw new Error(`${name} 的参数限制必须是有效 JSON`);
        }
    }
    const error = validateMCPToolPolicies(policies, Object.keys(policies));
    if (error) throw new Error(error);
    return policies;
}

export function safeMCPHomepage(value: string) {
    try {
        const url = new URL(value);
        return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : undefined;
    } catch {
        return undefined;
    }
}
