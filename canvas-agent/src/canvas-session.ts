import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import { CANVAS_GENERATION_CONTINUATION_TIMEOUT_MS } from "./canvas-tool-timeouts.js";
import { buildCanvasContext, findCanvasNodes, getCanvasResources, validateCanvasOps } from "./canvas-context.js";
import { type ToolName } from "./schemas.js";
import { compactCanvasState, compactNode, isToolName, nextCanvasX, parseToolInput } from "./tools.js";
import type { CanvasNode, CanvasNodeType, CanvasSnapshot } from "./types.js";

type PendingRequest = { clientId: string; recoverable: boolean; resolve: (value: unknown) => void; reject: (error: Error) => void };
type CanvasClient = { response: ServerResponse; timer: NodeJS.Timeout; runtimeSessionId?: string };

export class CanvasSession {
    private clients = new Map<string, CanvasClient>();
    private pending = new Map<string, PendingRequest>();
    private canvasState: CanvasSnapshot | null = null;

    health() {
        return { ok: true, hasCanvas: Boolean(this.canvasState), clients: this.clients.size };
    }

    openEvents(url: URL, res: ServerResponse, runtimeSessionId?: string) {
        const clientId = url.searchParams.get("clientId") || crypto.randomUUID();
        res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
        const previous = this.clients.get(clientId);
        sendEvent(res, "hello", { ok: true, clientId });
        const timer = setInterval(() => sendEvent(res, "ping", { time: Date.now() }), 15000);
        this.clients.set(clientId, { response: res, timer, runtimeSessionId });
        if (previous) {
            clearInterval(previous.timer);
            previous.response.end();
        }
        res.on("close", () => {
            clearInterval(timer);
            if (this.clients.get(clientId)?.response !== res) return;
            this.clients.delete(clientId);
            if (this.canvasState?.clientId === clientId) this.canvasState = null;
            this.rejectPendingClient(clientId, new Error("画布连接已断开"), true);
        });
    }

    closeRuntimeSession(runtimeSessionId: string) {
        const error = new Error("本机会话已撤销");
        for (const [clientId, client] of [...this.clients]) {
            if (client.runtimeSessionId !== runtimeSessionId) continue;
            this.clients.delete(clientId);
            clearInterval(client.timer);
            if (this.canvasState?.clientId === clientId) this.canvasState = null;
            this.rejectPendingClient(clientId, error);
            client.response.end();
        }
    }

    updateState(body: unknown, clientId?: string) {
        this.canvasState = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), clientId } as CanvasSnapshot;
    }

    resolveResult(body: { requestId?: string; error?: string; result?: unknown }) {
        const item = body.requestId ? this.pending.get(body.requestId) : null;
        if (!item || !body.requestId) return;
        this.pending.delete(body.requestId);
        body.error ? item.reject(new Error(body.error)) : item.resolve(body.result);
    }

    emitAll(type: string, payload: unknown) {
        this.clients.forEach((client) => sendEvent(client.response, type, payload));
    }

    dispose() {
        this.clients.forEach(({ response, timer }) => {
            clearInterval(timer);
            response.end();
        });
        this.clients.clear();
        this.canvasState = null;
        const error = new Error("Canvas session disposed");
        this.pending.forEach((request) => request.reject(error));
        this.pending.clear();
    }

    async callTool(name: unknown, rawInput: unknown) {
        if (!isToolName(name)) throw new Error(`未知工具：${String(name)}`);
        let tool: ToolName = name;
        let input = parseToolInput(tool, rawInput) as Record<string, unknown>;
        const projectTool = tool.startsWith("project_");
        if (projectTool) {
            if (!this.clients.size || !this.canvasState) throw new Error("当前没有已连接画布");
            if (!input.projectId && this.canvasState.domainProjectId) input.projectId = this.canvasState.domainProjectId;
            if (!input.projectId) throw new Error("当前画布没有关联短剧项目");
            return await this.requestCanvasTool(tool, input);
        }
        const readTool = ["canvas_get_state", "canvas_get_context", "canvas_find_nodes", "canvas_get_resources", "canvas_validate_ops", "canvas_get_selection", "canvas_export_snapshot"].includes(tool);
        if (readTool && (!this.clients.size || !this.canvasState)) throw new Error("当前没有已连接画布");
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(this.canvasState);
        if (tool === "canvas_get_context") return buildCanvasContext(this.canvasState);
        if (tool === "canvas_find_nodes") return findCanvasNodes(this.canvasState, input as Parameters<typeof findCanvasNodes>[1]);
        if (tool === "canvas_get_resources") return getCanvasResources(this.canvasState, input as Parameters<typeof getCanvasResources>[1]);
        if (tool === "canvas_validate_ops") return validateCanvasOps(this.canvasState, (input as { ops: unknown[] }).ops);
        if (tool === "canvas_get_selection") {
            const ids = new Set(this.canvasState?.selectedNodeIds || []);
            return { nodes: (this.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (tool === "canvas_create_node") {
            const data = input as { nodeType: CanvasNodeType; title?: string; x?: number; y?: number; width?: number; height?: number; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "add_node", nodeType: data.nodeType, title: data.title, position: { x: data.x ?? nextCanvasX(this.canvasState), y: data.y ?? 0 }, width: data.width, height: data.height, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_node") {
            const text = input as { text?: string; x?: number; y?: number; title?: string; width?: number; height?: number };
            input = { ops: [textNodeOp(text, text.x ?? nextCanvasX(this.canvasState), text.y ?? 0)] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_text_nodes") {
            const data = input as { items: Array<{ text: string; title?: string; x?: number; y?: number; width?: number; height?: number }>; x?: number; y?: number; gap?: number; direction?: "row" | "column" };
            const x = Number(data.x ?? nextCanvasX(this.canvasState));
            const y = Number(data.y ?? 0);
            const gap = Number(data.gap ?? 40);
            input = {
                ops: data.items.map((item, index) => textNodeOp(item, item.x ?? (data.direction === "row" ? x + index * (340 + gap) : x), item.y ?? (data.direction === "row" ? y : y + index * (240 + gap)))),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_image_prompt_flow") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: "image" }, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_create_generation_flow") {
            input = { ops: generationFlowOps(input as Record<string, unknown>, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_generate_text" || tool === "canvas_generate_image" || tool === "canvas_generate_video" || tool === "canvas_generate_audio") {
            input = { ops: generationFlowOps({ ...(input as Record<string, unknown>), mode: tool.replace("canvas_generate_", ""), autoRun: true }, this.canvasState) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node") {
            const data = input as { id: string; patch?: Record<string, unknown>; metadata?: Record<string, unknown> };
            input = { ops: [{ type: "update_node", id: data.id, patch: data.patch, metadata: data.metadata }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_update_node_text") {
            const data = input as { id: string; text: string; title?: string };
            input = { ops: [{ type: "update_node", id: data.id, patch: { ...(data.title ? { title: data.title } : {}) }, metadata: { content: data.text, status: "success" } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_move_nodes") {
            const data = input as { items: Array<{ id: string; x?: number; y?: number; dx?: number; dy?: number }> };
            input = {
                ops: data.items.map((item) => {
                    const current = findNode(this.canvasState, item.id);
                    return { type: "update_node", id: item.id, patch: { position: { x: item.x ?? ((current?.position.x || 0) + (item.dx || 0)), y: item.y ?? ((current?.position.y || 0) + (item.dy || 0)) } } };
                }),
            };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_resize_node") {
            const data = input as { id: string; width: number; height: number; freeResize?: boolean };
            input = { ops: [{ type: "update_node", id: data.id, patch: { width: data.width, height: data.height }, metadata: data.freeResize === undefined ? undefined : { freeResize: data.freeResize } }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_delete_nodes") {
            input = { ops: [{ type: "delete_node", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_connect_nodes") {
            const data = input as { connections: Array<{ fromNodeId: string; toNodeId: string; fromHandleId?: string; toHandleId?: string }> };
            input = { ops: data.connections.map((connection) => ({ type: "connect_nodes", ...connection })) };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_select_nodes") {
            input = { ops: [{ type: "select_nodes", ids: (input as { ids: string[] }).ids }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_set_viewport") {
            input = { ops: [{ type: "set_viewport", viewport: (input as { viewport: unknown }).viewport }] };
            tool = "canvas_apply_ops";
        }
        if (tool === "canvas_run_generation") {
            const data = input as { nodeId: string; mode?: string; prompt?: string; retry?: boolean };
            input = { ops: [runGenerationOp(data.nodeId, generationMode(data.mode), data.prompt, data.retry)] };
            tool = "canvas_apply_ops";
        }
        if (tool !== "canvas_apply_ops") throw new Error(`未知工具：${tool}`);
        if (!this.clients.size) throw new Error("当前没有已连接画布");
        const expectedStateHash = typeof input.expectedStateHash === "string" ? input.expectedStateHash : "";
        if (expectedStateHash && expectedStateHash !== buildCanvasContext(this.canvasState).stateHash) {
            throw new Error("画布状态已变化，请重新读取 canvas_get_context 后再执行写操作");
        }
        const validation = validateCanvasOps(this.canvasState, (input as { ops: unknown[] }).ops);
        if (!validation.ok) throw new Error(`画布操作校验失败：${validation.issues.filter((item) => item.severity === "error").map((item) => item.message).join("；")}`);
        return await this.requestCanvasTool(tool, input);
    }

    private async requestCanvasTool(name: ToolName, input: Record<string, unknown>) {
        const requestId = crypto.randomUUID();
        const stateClientId = this.canvasState?.clientId || "";
        const selected = this.clients.has(stateClientId)
            ? [stateClientId, this.clients.get(stateClientId)] as const
            : this.clients.entries().next().value;
        const clientId = selected?.[0];
        const client = selected?.[1]?.response;
        if (!clientId || !client) throw new Error("当前没有已连接画布");
        sendEvent(client, "tool_call", { requestId, name, input });
        const recoverable = hasGenerationContinuation(name, input);
        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(requestId);
                reject(new Error("画布操作超时"));
            }, recoverable ? CANVAS_GENERATION_CONTINUATION_TIMEOUT_MS : 30000);
            if (recoverable) timer.unref();
            this.pending.set(requestId, { clientId, recoverable, resolve: (value) => (clearTimeout(timer), resolve(value)), reject: (error) => (clearTimeout(timer), reject(error)) });
        });
    }

    private rejectPendingClient(clientId: string, error: Error, preserveRecoverable = false) {
        for (const [requestId, request] of this.pending) {
            if (request.clientId !== clientId || (preserveRecoverable && request.recoverable)) continue;
            this.pending.delete(requestId);
            request.reject(error);
        }
    }
}

function hasGenerationContinuation(name: ToolName, input: Record<string, unknown>) {
    if (name !== "canvas_apply_ops" || !Array.isArray(input.ops)) return false;
    return input.ops.some((value) => value && typeof value === "object" && !Array.isArray(value)
        && (value as Record<string, unknown>).type === "run_generation");
}

function sendEvent(res: ServerResponse, type: string, payload: unknown) {
    res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function textNodeOp(input: { id?: string; text?: string; title?: string; width?: number; height?: number }, x: number, y: number) {
    return { type: "add_node", id: input.id, nodeType: "text", title: input.title, position: { x, y }, width: input.width, height: input.height, metadata: { content: input.text || "", status: "success", fontSize: 14 } };
}

function generationTargetNodeOp(id: string, input: Record<string, unknown>, x: number, y: number) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const nodeType = generationNodeType(mode);
    return {
        type: "add_node",
        id,
        nodeType,
        title: String(input.title || generationTitle(mode)),
        position: { x, y },
        width: typeof input.width === "number" ? input.width : undefined,
        height: typeof input.height === "number" ? input.height : undefined,
        metadata: cleanRecord({
            content: "",
            fontSize: nodeType === "text" ? 14 : undefined,
            generationMode: mode,
            composerContent: prompt,
            prompt,
            status: "idle",
            model: input.model,
            size: input.size,
            quality: input.quality,
            transparentBackground: input.transparentBackground,
            count: input.count,
            seconds: input.seconds,
            vquality: input.vquality,
            generateAudio: input.generateAudio,
            watermark: input.watermark,
            audioVoice: input.audioVoice,
            audioFormat: input.audioFormat,
            audioSpeed: input.audioSpeed,
            audioInstructions: input.audioInstructions,
        }),
    };
}

function generationFlowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const mode = generationMode(input.mode);
    const prompt = String(input.prompt || "");
    const x = Number(input.x ?? nextCanvasX(state));
    const y = Number(input.y ?? 0);
    const textId = `text-${crypto.randomUUID()}`;
    const targetId = `${mode}-${crypto.randomUUID()}`;
    const referenceNodeIds = Array.isArray(input.referenceNodeIds) ? input.referenceNodeIds.filter((id): id is string => typeof id === "string") : [];
    const tokens = [`@[node:${textId}]`, ...referenceNodeIds.map((id) => `@[node:${id}]`)];
    const targetInput = { ...input, prompt: tokens.join("\n") };
    return [
        textNodeOp({ id: textId, text: prompt, title: String(input.title || "提示词") }, x, y),
        generationTargetNodeOp(targetId, targetInput, x + 420, y),
        { type: "connect_nodes", fromNodeId: textId, toNodeId: targetId },
        ...referenceNodeIds.map((fromNodeId) => ({ type: "connect_nodes", fromNodeId, toNodeId: targetId })),
        { type: "select_nodes", ids: [targetId] },
        ...(input.autoRun ? [runGenerationOp(targetId, mode, tokens.join("\n"))] : []),
    ];
}

function generationNodeType(mode: "text" | "image" | "video" | "audio"): CanvasNodeType {
    if (mode === "text") return "text";
    if (mode === "video") return "video";
    if (mode === "audio") return "audio";
    return "image";
}

function runGenerationOp(nodeId: string, mode: "text" | "image" | "video" | "audio", prompt?: string, retry?: boolean) {
    return { type: "run_generation", nodeId, mode, prompt, ...(retry ? { retry: true } : {}) };
}

function generationMode(value: unknown): "text" | "image" | "video" | "audio" {
    return value === "text" || value === "video" || value === "audio" ? value : "image";
}

function generationTitle(mode: "text" | "image" | "video" | "audio") {
    if (mode === "text") return "文本生成";
    if (mode === "video") return "视频生成";
    if (mode === "audio") return "音频生成";
    return "图片生成";
}

function findNode(state: CanvasSnapshot | null, id: string): CanvasNode | undefined {
    return (state?.nodes || []).find((node) => node.id === id);
}

function cleanRecord(value: Record<string, unknown>) {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== ""));
}
