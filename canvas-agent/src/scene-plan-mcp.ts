import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { assertCanvasVersion, executeCanvasOpsPlan, plannedScenesSchema, prepareSceneCanvasPlan, validatePreparedPlan, type CanvasPlanClient, type PreparedCanvasPlan } from "./orchestration.js";

type PlanClient = CanvasPlanClient & { requireSelection(): { projectId: string }; readonly serverUrl: string };
type Entry = { prepared: PreparedCanvasPlan; serverUrl: string; expiresAt: number; status: "waiting_approval" | "running" | "applied" | "unknown"; result?: unknown };
const planIdentity = { planId: z.string().uuid() };

/** A store belongs to one authenticated MCP process, never shared across hosts/users. */
export function registerScenePlanTools(server: McpServer, client: PlanClient) {
    const entries = new Map<string, Entry>();
    const getEntry = (planId: string) => {
        const entry = entries.get(planId);
        if (!entry || entry.expiresAt <= Date.now()) throw new Error("计划不存在或已过期，请重新读取画布并生成计划；先确认旧操作是否已应用");
        if (entry.serverUrl !== client.serverUrl || entry.prepared.projectId !== client.requireSelection().projectId) throw new Error("计划不属于当前服务或当前选中画布");
        return entry;
    };
    const respond = async (run: () => Promise<unknown>) => {
        try { return { content: [{ type: "text" as const, text: JSON.stringify(await run()) }] }; }
        catch (error) { return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "场景计划操作失败" }] }; }
    };

    server.registerTool("canvas_prepare_scene_plan", {
        description: "将宿主分析出的场景列表保存为执行计划，仅校验和预览，不写画布。先读取真实剧本正文；必须携带分析所依据的 revision/stateHash。预览包含完整操作，申请宿主批准后使用 canvas_apply_scene_plan；不重新分析已批准内容。",
        inputSchema: {
            scriptNodeId: z.string().trim().min(1), scenes: plannedScenesSchema,
            expectedRevision: z.number().int().nonnegative(), expectedStateHash: z.string().trim().min(1),
        },
        annotations: { readOnlyHint: true, openWorldHint: false },
    }, async (input) => respond(async () => {
        for (const [id, entry] of entries) if (entry.expiresAt <= Date.now() && entry.status !== "running") entries.delete(id);
        if (entries.size >= 20) throw new Error("当前 MCP 会话最多保存 20 个计划，请先处理已有计划或等待过期");
        const projectId = client.requireSelection().projectId;
        const project = await client.getProject(projectId);
        assertCanvasVersion(project, input);
        const prepared = prepareSceneCanvasPlan({ ...input, project, projectId, planId: randomUUID() });
        await validatePreparedPlan(client, prepared);
        // Recheck after async validation so simultaneous preparations cannot exceed the bound.
        if (entries.size >= 20) throw new Error("当前 MCP 会话计划容量已满");
        const expiresAt = Date.now() + 30 * 60 * 1000;
        entries.set(prepared.plan.id, { prepared, serverUrl: client.serverUrl, expiresAt, status: "waiting_approval" });
        return { planId: prepared.plan.id, status: "waiting_approval", expiresAt, ...prepared };
    }));

    server.registerTool("canvas_get_scene_plan", {
        description: "查询当前 MCP 会话内的场景计划、执行状态和操作预览。进程重启不恢复计划；unknown 表示上次结果未知，必须读取画布核对，禁止重放。",
        inputSchema: planIdentity, annotations: { readOnlyHint: true, openWorldHint: false },
    }, async ({ planId }) => respond(async () => {
        const entry = getEntry(planId);
        return { planId, status: entry.status, expiresAt: entry.expiresAt, ...entry.prepared, result: entry.result };
    }));

    server.registerTool("canvas_apply_scene_plan", {
        description: "应用宿主已批准的场景计划，需传预览返回的 planId 和 approvalDigest。摘要只绑定内容，不替代宿主授权。固定原 revision/stateHash；冲突必须重新规划。超时或异常后本会话禁止重放，先查询计划及画布。",
        inputSchema: { ...planIdentity, approvalDigest: z.string().regex(/^[a-f0-9]{64}$/) },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    }, async ({ planId, approvalDigest }) => respond(async () => {
        const entry = getEntry(planId);
        if (approvalDigest !== entry.prepared.approvalDigest) throw new Error("批准摘要与计划不匹配");
        if (entry.status === "applied") return entry.result;
        if (entry.status !== "waiting_approval") throw new Error("计划正在执行或上次结果未知，拒绝重放；请读取画布核对");
        entry.status = "running";
        try {
            const execution = await executeCanvasOpsPlan({ client, prepared: entry.prepared, mode: "ask", approvedDigest: approvalDigest });
            entry.status = "applied";
            entry.result = { planId, status: execution.status, plan: execution.plan, result: execution.result };
            return entry.result;
        } catch (error) {
            // Conservative even for validation failures: no error path may replay a dispatched write.
            entry.status = "unknown";
            throw error;
        }
    }));
}
