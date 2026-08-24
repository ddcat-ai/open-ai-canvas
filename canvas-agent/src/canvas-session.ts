import crypto from "node:crypto";
import type { ServerResponse } from "node:http";

import { CANVAS_GENERATION_CONTINUATION_TIMEOUT_MS } from "./canvas-tool-timeouts.js";
import { buildCanvasContext, findCanvasNodes, getCanvasConnection, getCanvasGenerationTasks, getCanvasNode, getCanvasResources, hashState, validateCanvasOps } from "./canvas-context.js";
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
        const candidate = { ...((body && typeof body === "object" && !Array.isArray(body) ? body : {}) as Record<string, unknown>), clientId } as CanvasSnapshot;
        const incomingRevision = typeof candidate.revision === "number" && Number.isInteger(candidate.revision) && candidate.revision >= 0 ? candidate.revision : undefined;
        const actualHash = hashState(candidate);
        const suppliedHash = typeof (body as Record<string, unknown> | null)?.stateHash === "string" ? String((body as Record<string, unknown>).stateHash) : undefined;
        if (suppliedHash && suppliedHash !== actualHash) return { accepted: false, revision: this.canvasState?.revision ?? 0, stateHash: this.canvasState ? hashState(this.canvasState) : actualHash, reason: "state_hash_mismatch" as const };
        const previousState = this.canvasState;
        const currentRevision = previousState?.revision ?? 0;
        if (previousState) {
            if (incomingRevision !== undefined && incomingRevision < currentRevision) return { accepted: false, revision: currentRevision, stateHash: hashState(previousState), reason: "stale_revision" as const };
            if (incomingRevision === currentRevision && actualHash !== hashState(previousState)) return { accepted: false, revision: currentRevision, stateHash: hashState(previousState), reason: "revision_conflict" as const };
        }
        const revision = incomingRevision ?? (this.canvasState ? currentRevision + 1 : 0);
        this.canvasState = { ...candidate, revision };
        return { accepted: true, idempotent: Boolean(previousState && incomingRevision === currentRevision && actualHash === hashState(previousState)), revision, stateHash: actualHash };
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
        const readTool = ["canvas_get_state", "canvas_get_context", "canvas_find_nodes", "canvas_get_node", "canvas_get_connection", "canvas_get_generation_tasks", "canvas_get_resources", "canvas_validate_ops", "canvas_get_selection", "canvas_export_snapshot"].includes(tool);
        if (readTool && (!this.clients.size || !this.canvasState)) throw new Error("当前没有已连接画布");
        if (tool === "canvas_get_state" || tool === "canvas_export_snapshot") return compactCanvasState(this.canvasState);
        if (tool === "canvas_get_context") return buildCanvasContext(this.canvasState);
        if (tool === "canvas_find_nodes") return findCanvasNodes(this.canvasState, input as Parameters<typeof findCanvasNodes>[1]);
        if (tool === "canvas_get_node") return getCanvasNode(this.canvasState, input as Parameters<typeof getCanvasNode>[1]);
        if (tool === "canvas_get_connection") return getCanvasConnection(this.canvasState, input as Parameters<typeof getCanvasConnection>[1]);
        if (tool === "canvas_get_generation_tasks") return getCanvasGenerationTasks(this.canvasState, input as Parameters<typeof getCanvasGenerationTasks>[1]);
        if (tool === "canvas_get_resources") return getCanvasResources(this.canvasState, input as Parameters<typeof getCanvasResources>[1]);
        if (tool === "canvas_validate_ops") return validateCanvasOps(this.canvasState, (input as { ops: unknown[] }).ops);
        if (tool === "canvas_get_selection") {
            const ids = new Set(this.canvasState?.selectedNodeIds || []);
            return { nodes: (this.canvasState?.nodes || []).filter((node) => ids.has(node.id)).map(compactNode) };
        }
        if (tool === "canvas_create_workflow") {
            input = { ops: workflowOps(input as Record<string, unknown>, this.canvasState) };
            tool = "canvas_apply_ops";
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
            const batchText = data.items.map((item) => `${item.title || ""} ${item.text || ""}`).join(" ");
            if (/流水线|工作流|工作流图|管线|节点图|连线|pipeline|workflow/i.test(batchText)) throw new Error("检测到工作流意图，请使用 canvas_create_workflow 创建真实类型节点和连线");
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
        const currentContext = buildCanvasContext(this.canvasState);
        const expectedRevision = typeof input.expectedRevision === "number" ? input.expectedRevision : undefined;
        const expectedStateHash = typeof input.expectedStateHash === "string" ? input.expectedStateHash : "";
        if (expectedRevision !== undefined && expectedRevision !== currentContext.revision) {
            throw new Error(`画布 revision 已从 ${expectedRevision} 变为 ${currentContext.revision}，请重新读取 canvas_get_context 后再执行写操作`);
        }
        if (expectedStateHash && expectedStateHash !== currentContext.stateHash) {
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

function workflowOps(input: Record<string, unknown>, state: CanvasSnapshot | null) {
    const nodes = Array.isArray(input.nodes) ? input.nodes as Array<Record<string, unknown>> : [];
    if (!nodes.length) throw new Error("工作流至少需要一个节点");
    const refs = new Set<string>();
    for (const node of nodes) {
        const ref = String(node.ref || "").trim();
        const title = String(node.title || "").trim();
        const kind = String(node.kind || "text");
        const prompt = String(node.prompt || node.content || workflowPrompt(kind, title, input)).trim();
        if (!ref || !title) throw new Error("工作流节点必须包含 ref 和 title");
        if (refs.has(ref)) throw new Error(`工作流节点 ref「${ref}」重复`);
        if (!["text", "script"].includes(workflowNodeType(kind)) && !prompt) throw new Error(`媒体工作流节点「${title}」缺少 prompt/content，不能创建空资源节点`);
        refs.add(ref);
        for (const nodeId of Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds : []) {
            if (!existingNodeId(state, String(nodeId))) throw new Error(`节点「${title}」引用的现有节点「${String(nodeId)}」不存在`);
        }
    }
    const direction = input.direction === "vertical" ? "vertical" : "horizontal";
    const gap = Math.max(48, Number(input.gap || 120));
    const existing = state?.nodes || [];
    const maxX = existing.reduce((max, node) => Math.max(max, node.position.x + node.width), 0);
    const maxY = existing.reduce((max, node) => Math.max(max, node.position.y + node.height), 0);
    const start = input.start && typeof input.start === "object" ? input.start as { x: number; y: number } : { x: existing.length ? maxX + 160 : 80, y: existing.length ? Math.max(80, maxY - 520) : 80 };
    const ids = new Map(nodes.map((node) => [String(node.ref), `agent-workflow-${slug(String(node.ref))}-${crypto.randomUUID().slice(0, 8)}`]));
    const ops: Array<Record<string, unknown>> = [];
    let cursor = { x: Number(start.x), y: Number(start.y) };
    for (const node of nodes) {
        const kind = String(node.kind || "text");
        const type = workflowNodeType(kind);
        const size = workflowNodeSize(type, kind, node.width, node.height);
        const prompt = String(node.prompt || node.content || workflowPrompt(kind, String(node.title), input));
        const position = { ...cursor };
        const internalReferenceIds = Array.isArray(node.referenceRefs) ? node.referenceRefs.map((ref) => ids.get(String(ref))).filter(Boolean) : [];
        const externalReferenceIds = Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds.map(String) : [];
        ops.push({ type: "add_node", id: ids.get(String(node.ref)), nodeType: type, title: String(node.title), position, width: size.width, height: size.height, metadata: { content: type === "text" ? String(node.content || prompt) : "", composerContent: prompt || undefined, prompt: prompt || undefined, workflowKind: workflowKind(kind), workflowTitle: input.title, workflowDescription: node.description || input.description, generationMode: type === "image" ? "image" : type === "video" ? "video" : type === "audio" ? "audio" : undefined, status: type === "text" || type === "script" ? "success" : "idle", referenceNodeIds: [...internalReferenceIds, ...externalReferenceIds].length ? [...internalReferenceIds, ...externalReferenceIds] : undefined } });
        cursor = direction === "vertical" ? { x: Number(start.x), y: cursor.y + size.height + gap } : { x: cursor.x + size.width + gap, y: Number(start.y) };
    }
    const edges = Array.isArray(input.edges) && input.edges.length ? input.edges as Array<Record<string, unknown>> : nodes.slice(0, -1).map((node, index) => ({ from: node.ref, to: nodes[index + 1].ref }));
    const keys = new Set<string>();
    for (const edge of edges) {
        const from = String(edge.from || "");
        const to = String(edge.to || "");
        if (!ids.has(from) || !ids.has(to)) throw new Error(`工作流连线引用不存在的节点：${from} → ${to}`);
        const key = `${from}\0${to}`;
        if (keys.has(key)) continue;
        keys.add(key);
        ops.push({ type: "connect_nodes", fromNodeId: ids.get(from), toNodeId: ids.get(to) });
    }
    for (const node of nodes) for (const ref of Array.isArray(node.referenceRefs) ? node.referenceRefs : []) {
        const from = String(ref);
        const to = String(node.ref);
        if (!ids.has(from)) throw new Error(`节点「${to}」引用了不存在的节点「${from}」`);
        const key = `${from}\0${to}`;
        if (keys.has(key)) continue;
        keys.add(key);
        ops.push({ type: "connect_nodes", fromNodeId: ids.get(from), toNodeId: ids.get(to) });
    }
    for (const node of nodes) for (const ref of Array.isArray(node.referenceNodeIds) ? node.referenceNodeIds : []) {
        const from = String(ref);
        const to = String(node.ref);
        const key = `${from}\0${to}`;
        if (keys.has(key)) continue;
        keys.add(key);
        ops.push({ type: "connect_nodes", fromNodeId: from, toNodeId: ids.get(to) });
    }
    ops.push({ type: "select_nodes", ids: nodes.map((node) => ids.get(String(node.ref))) });
    if (input.autoRun === true || nodes.some((node) => node.runGeneration === true)) for (const node of nodes) {
        const type = workflowNodeType(String(node.kind || "text"));
        if (!["image", "video", "audio"].includes(type) || (input.autoRun !== true && node.runGeneration !== true)) continue;
        ops.push({ type: "run_generation", nodeId: ids.get(String(node.ref)), mode: type, prompt: node.prompt || node.content || workflowPrompt(String(node.kind || "text"), String(node.title), input) });
    }
    return ops;
}

function existingNodeId(state: CanvasSnapshot | null, id: string) {
    return Boolean(state?.nodes?.some((node) => node.id === id));
}

function workflowNodeType(kind: string) {
    if (kind === "script") return "script";
    if (["image", "character_cards", "character_three_view"].includes(kind)) return "image";
    if (["video", "storyboard_video"].includes(kind)) return "video";
    if (kind === "audio") return "audio";
    return "text";
}

function workflowNodeSize(type: string, kind: string, width: unknown, height: unknown) {
    const defaults = type === "image" ? { width: 560, height: 380 } : type === "video" ? { width: 640, height: 360 } : type === "script" ? { width: 920, height: 360 } : type === "audio" ? { width: 340, height: 160 } : { width: 420, height: 240 };
    return { width: typeof width === "number" && width > 0 ? width : defaults.width, height: typeof height === "number" && height > 0 ? height : defaults.height };
}

function workflowPrompt(kind: string, title: string, input: Record<string, unknown>) {
    const workflowTitle = String(input.title || input.description || "当前创作项目").trim();
    if (kind === "character_cards") return `请基于「${workflowTitle}」拆分主要角色，并为每个角色生成可用于后续创作的角色图片卡片：外观、服饰、身份、性格和视觉辨识点。`;
    if (kind === "character_three_view") return `请基于上游角色卡片生成「${title}」：同一角色的正面、侧面、背面三视图，保持服饰、发型、道具和比例一致。`;
    if (kind === "storyboard_video") return `请基于上游角色三视图，为「${workflowTitle}」制作分镜剧情视频方案：包含镜头顺序、景别、动作、节奏和画面连续性。`;
    return "";
}

function workflowKind(kind: string) {
    if (["character_cards", "character_three_view"].includes(kind)) return "character";
    if (kind === "storyboard_video") return "storyboard";
    if (kind === "script") return "script";
    return "free";
}

function slug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "node";
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
