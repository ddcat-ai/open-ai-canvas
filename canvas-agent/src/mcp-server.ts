import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildCanvasContext, findCanvasNodes, getCanvasConnection, getCanvasGenerationTasks, getCanvasNode, getCanvasResources } from "./canvas-context.js";
import { createRemoteClient, RemoteMcpClient } from "./remote-client.js";
import { planTool } from "./tool-planner.js";
import { toolDescriptions, toolInputSchemas, toolNames, type ToolName } from "./schemas.js";
import { compactCanvasState, compactNode } from "./tools.js";
import type { CanvasSnapshot } from "./types.js";

export const REMOTE_AGENT_PROMPT = "你是影策在线画布 Agent。所有画布读取和写入都通过远程 HTTPS MCP 接口完成。写入前先读取上下文并携带 expectedRevision 与 expectedStateHash；409/428/422 必须如实报告并重新读取，不得猜测节点 id。删除、覆盖、移动、改边和生成由 MCP 宿主审批。";

export async function startMcpServer(options: { client?: RemoteMcpClient } = {}) {
    const server = new McpServer({ name: "kraftreel-cli", version: "0.1.0" }, { instructions: REMOTE_AGENT_PROMPT });
    registerMcpTools(server, options.client ?? createRemoteClient());
    await server.connect(new StdioServerTransport());
}

export function registerMcpTools(server: McpServer, client: RemoteMcpClient) {
    for (const name of toolNames) registerRemoteTool(server, client, name);
}

function registerRemoteTool(server: McpServer, client: RemoteMcpClient, name: ToolName) {
    const schema = toolInputSchemas[name];
    server.registerTool(name, { description: toolDescriptions[name], inputSchema: schema.shape }, async (raw: unknown) => {
        const input = schema.parse(raw) as Record<string, unknown>;
        const selection = client.requireSelection();
        const project = await client.getProject(selection.projectId);
        const snapshot = normalizeProject(project);
        const planned = planTool(name, input, snapshot);
        let result: unknown;
        if (planned.tool === "read") result = readProjection(name, input, snapshot, project);
        else if (planned.tool === "validate") result = await client.validate(selection.projectId, { ops: planned.input.ops, expectedRevision: requiredRevision(input, project), expectedStateHash: requiredHash(input, project) });
        else if (planned.tool === "generate") result = await client.generate(selection.projectId, { ...planned.input, expectedRevision: requiredRevision(input, project), expectedStateHash: requiredHash(input, project) });
        else result = await client.apply(selection.projectId, { ...planned.input, expectedRevision: requiredRevision(input, project), expectedStateHash: requiredHash(input, project) });
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    });
}

function normalizeProject(value: Record<string, unknown>): CanvasSnapshot {
    const raw = (value.project && typeof value.project === "object" ? value.project : value) as Record<string, unknown>;
    return { ...(raw as CanvasSnapshot), revision: typeof value.revision === "number" ? value.revision : Number(raw.revision || 0) } as CanvasSnapshot;
}

function readProjection(name: ToolName, input: Record<string, unknown>, snapshot: CanvasSnapshot, project: Record<string, unknown>) {
    const revision = project.revision ?? snapshot.revision ?? 0;
    const stateHash = project.stateHash ?? "";
    let data: unknown;
    if (name === "canvas_get_state" || name === "canvas_export_snapshot") data = compactCanvasState(snapshot);
    else if (name === "canvas_get_context") data = { ...buildCanvasContext(snapshot), revision, stateHash };
    else if (name === "canvas_find_nodes") data = findCanvasNodes(snapshot, input as Parameters<typeof findCanvasNodes>[1]);
    else if (name === "canvas_get_node") data = getCanvasNode(snapshot, input as { id: string });
    else if (name === "canvas_get_connection") data = getCanvasConnection(snapshot, input as { id: string });
    else if (name === "canvas_get_generation_tasks") data = getCanvasGenerationTasks(snapshot, input as Parameters<typeof getCanvasGenerationTasks>[1]);
    else if (name === "canvas_get_resources") data = getCanvasResources(snapshot, input as Parameters<typeof getCanvasResources>[1]);
    else if (name === "canvas_get_selection") { const ids = new Set(snapshot.selectedNodeIds || []); data = { nodes: (snapshot.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) }; }
    else throw new Error(`未知读工具：${name}`);
    return { data, revision, stateHash, hashSource: "server" };
}

function requiredRevision(input: Record<string, unknown>, project: Record<string, unknown>) { const value = typeof input.expectedRevision === "number" ? input.expectedRevision : project.revision; if (typeof value !== "number") throw new Error("写操作必须提供 expectedRevision"); return value; }
function requiredHash(input: Record<string, unknown>, project: Record<string, unknown>) { const value = typeof input.expectedStateHash === "string" && input.expectedStateHash ? input.expectedStateHash : project.stateHash; if (typeof value !== "string" || !value) throw new Error("写操作必须提供 expectedStateHash"); return value; }

export { RemoteMcpClient };
