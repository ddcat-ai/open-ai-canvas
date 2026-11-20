import { describe, expect, test } from "bun:test";
import { createMCPConnectionDraft, mcpConnectionChanged, mcpConnectionWrite, mcpParameters, parseMCPToolPolicies, safeMCPHomepage, validateMCPConnection } from "../src/components/mcp/mcp-form";
import type { MCPConnection, MCPServerTemplate } from "../src/services/api/agent-mcp";

const template: MCPServerTemplate = {
    id: "template-1",
    name: "Example",
    description: "",
    homepage: "https://example.com",
    transport: "streamable_http",
    serverUrl: "https://example.com/mcp",
    headers: { Authorization: "Bearer {{token}}" },
    parameters: [
        { name: "token", label: "访问令牌", description: "", type: "secret", required: true },
        { name: "workspace", label: "工作区", description: "", type: "string", required: false, defaultValue: "main" },
    ],
    published: true,
    createdAt: "",
    updatedAt: "",
};
const connection: MCPConnection = {
    id: "connection-1",
    revision: 1,
    scope: "user",
    templateId: template.id,
    name: template.name,
    transport: template.transport,
    serverUrl: template.serverUrl,
    parameters: { workspace: "private" },
    configuredSecrets: ["token"],
    enabled: true,
    tools: [{ name: "list_issues", description: "", inputSchema: {}, readOnly: true }],
    allowedTools: ["list_issues"],
    lastTestAt: "2026-11-11T01:00:00Z",
    createdAt: "",
    updatedAt: "",
};

describe("MCP connection authorization", () => {
    test("market installation starts disabled and never seeds a secret default", () => {
        const draft = createMCPConnectionDraft({ ...template, parameters: [{ ...template.parameters[0], defaultValue: "do-not-use" }, template.parameters[1]] });
        expect(draft.parameters).toEqual({ token: "", workspace: "main" });
        expect(draft.enabled).toBe(false);
        expect(draft.allowedTools).toEqual([]);
        expect(draft.allowedUserIds).toEqual([]);
        expect(draft.toolPolicies).toEqual({});
        expect(validateMCPConnection(draft, template.parameters)).toContain("访问令牌");
        draft.parameters.token = "provided";
        draft.enabled = true;
        draft.allowedTools = ["list_issues"];
        expect(validateMCPConnection(draft, template.parameters)).toContain("检测连接");
    });

    test("editing keeps stored secrets blank and accepts unchanged authorization", () => {
        const draft = createMCPConnectionDraft(template, connection);
        expect(draft.parameters).toEqual({ token: "", workspace: "private" });
        expect(mcpConnectionChanged(draft, connection)).toBe(false);
        expect(validateMCPConnection(draft, template.parameters, connection)).toBe("");
        expect(mcpConnectionWrite(draft).parameters.token).toBe("");
    });

    test("changing an endpoint or credential requires discovery again", () => {
        const draft = createMCPConnectionDraft(template, connection);
        expect(validateMCPConnection({ ...draft, enabled: false, allowedTools: [], serverUrl: "https://other.example/mcp" }, template.parameters, connection)).toContain("访问令牌");
        for (const changed of [
            { ...draft, serverUrl: "https://other.example/mcp", parameters: { ...draft.parameters, token: "rotated" } },
            { ...draft, transport: "sse" as const },
            { ...draft, parameters: { ...draft.parameters, token: "rotated" } },
        ]) {
            expect(mcpConnectionChanged(changed, connection)).toBe(true);
            expect(validateMCPConnection(changed, template.parameters, connection)).toContain("检测连接");
        }
    });

    test("enabled connections cannot allow undiscovered tools or an empty allowlist", () => {
        const draft = createMCPConnectionDraft(template, connection);
        expect(validateMCPConnection({ ...draft, allowedTools: [] }, template.parameters, connection)).toContain("至少一个");
        expect(validateMCPConnection({ ...draft, allowedTools: ["delete_everything"] }, template.parameters, connection)).toContain("重新检测");
    });

    test("unpublished template connections preserve their known parameter kinds", () => {
        expect(mcpParameters(undefined, connection)).toEqual([
            { name: "workspace", label: "workspace", description: "", type: "string", required: false },
            { name: "token", label: "token", description: "", type: "secret", required: false },
        ]);
        expect(createMCPConnectionDraft(undefined, connection).parameters).toEqual({ workspace: "private", token: "" });
    });

    test("saving allows clearing non-secret text and rejects credential-bearing URLs", () => {
        const draft = createMCPConnectionDraft(template, connection);
        expect(mcpConnectionWrite({ ...draft, parameters: { workspace: "", token: "" }, allowedTools: ["list_issues", "list_issues"] })).toMatchObject({ parameters: { workspace: "", token: "" }, allowedTools: ["list_issues"] });
        expect(validateMCPConnection({ ...draft, serverUrl: "https://user:password@example.com/mcp" }, template.parameters, connection)).toContain("不含账号密码");
        expect(safeMCPHomepage("javascript:alert(1)")).toBeUndefined();
        expect(validateMCPConnection({ ...draft, serverUrl: "https://example.com/mcp?access_key=example" }, template.parameters, connection)).toContain("查询参数");
        expect(safeMCPHomepage("https://user:secret@example.com")).toBeUndefined();
        expect(safeMCPHomepage("https://example.com/docs")).toBe("https://example.com/docs");
    });

    test("platform activation requires explicit users and per-tool argument restrictions", () => {
        const platform = { ...connection, scope: "platform" as const };
        const draft = createMCPConnectionDraft(template, platform);
        expect(validateMCPConnection(draft, template.parameters, platform)).toContain("用户 ID");
        draft.allowedUserIds = ["approved-user"];
        expect(validateMCPConnection(draft, template.parameters, platform)).toContain("list_issues");
        draft.toolPolicies = { list_issues: { type: "object", properties: { owner: { const: "approved-org" }, repo: { enum: ["approved-repo"] } }, required: ["owner", "repo"] } };
        expect(validateMCPConnection(draft, template.parameters, platform)).toBe("");
        expect(validateMCPConnection({ ...draft, allowedUserIds: ["x".repeat(37)] }, template.parameters, platform)).toContain("36 字节");
        expect(validateMCPConnection({ ...draft, allowedUserIds: Array.from({ length: 101 }, (_, index) => `user-${index}`) }, template.parameters, platform)).toContain("100 个用户");
        expect(validateMCPConnection(draft, template.parameters, connection)).toContain("个人连接");
    });

    test("policies never default to unrestricted access and reject malformed or external schemas", () => {
        expect(() => parseMCPToolPolicies({}, ["list_issues"])).toThrow("明确填写");
        expect(() => parseMCPToolPolicies({ list_issues: "{" }, ["list_issues"])).toThrow("有效 JSON");
        expect(() => parseMCPToolPolicies({ list_issues: "{}" }, ["list_issues"])).toThrow("type 为 object");
        expect(() => parseMCPToolPolicies({ list_issues: JSON.stringify({ type: "object", properties: { repo: { $ref: "https://schema.example.com/repo" } } }) }, ["list_issues"])).toThrow("外部 Schema");
        const localPolicy = { type: "object", properties: { repo: { $ref: "#/$defs/repo" } }, $defs: { repo: { enum: ["approved-repo"] } } };
        expect(parseMCPToolPolicies({ list_issues: JSON.stringify(localPolicy) }, ["list_issues"])).toEqual({ list_issues: localPolicy });
        expect(parseMCPToolPolicies({ list_issues: '{"type":"object"}' }, ["list_issues"])).toEqual({ list_issues: { type: "object" } });
    });

    test("disabling an older platform connection does not require granting missing argument policies", () => {
        const platform = { ...connection, scope: "platform" as const };
        const draft = { ...createMCPConnectionDraft(template, platform), enabled: false };
        expect(parseMCPToolPolicies({}, draft.allowedTools, false)).toEqual({});
        expect(validateMCPConnection(draft, template.parameters, platform)).toBe("");
        expect(() => parseMCPToolPolicies({ list_issues: "{" }, draft.allowedTools, false)).toThrow("有效 JSON");
    });

    test("policy budgets count UTF-8 bytes and include the combined policy document", () => {
        expect(() => parseMCPToolPolicies({ list_issues: JSON.stringify({ type: "object", description: "界".repeat(2800) }) }, ["list_issues"])).toThrow("8 KiB");
        const names = Array.from({ length: 9 }, (_, index) => `tool_${index}`);
        const policies = Object.fromEntries(names.map((name) => [name, JSON.stringify({ type: "object", description: "x".repeat(7500) })]));
        expect(() => parseMCPToolPolicies(policies, names)).toThrow("64 KiB");
    });

    test("saving removes deselected policies and normalizes explicitly authorized user IDs", () => {
        const draft = createMCPConnectionDraft(template, connection);
        const written = mcpConnectionWrite({ ...draft, allowedUserIds: [" user-a ", "user-a", "user-b"], toolPolicies: { list_issues: { type: "object" }, removed_tool: { type: "object" } } });
        expect(written.allowedUserIds).toEqual(["user-a", "user-b"]);
        expect(written.toolPolicies).toEqual({ list_issues: { type: "object" } });
    });
});
