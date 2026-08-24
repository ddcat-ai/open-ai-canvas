import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { AiConfig } from "@/stores/use-config-store";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "./canvas-agent-ops";

export type CanvasWorkflowNodeKind =
    | "text"
    | "script"
    | "image"
    | "video"
    | "audio"
    | "character_cards"
    | "character_three_view"
    | "storyboard_video";

export type CanvasWorkflowNodeInput = {
    ref: string;
    kind: CanvasWorkflowNodeKind;
    title: string;
    content?: string;
    prompt?: string;
    description?: string;
    referenceRefs?: string[];
    /** Existing canvas node ids returned by canvas_find_nodes/canvas_get_context. */
    referenceNodeIds?: string[];
    runGeneration?: boolean;
    width?: number;
    height?: number;
};

export type CanvasWorkflowInput = {
    title?: string;
    description?: string;
    nodes: CanvasWorkflowNodeInput[];
    edges?: Array<{ from: string; to: string }>;
    direction?: "horizontal" | "vertical";
    start?: { x: number; y: number };
    gap?: number;
    autoRun?: boolean;
};

const WORKFLOW_KINDS = new Set<CanvasWorkflowNodeKind>([
    "character_cards",
    "character_three_view",
    "storyboard_video",
]);

const DEFAULT_GAP = 120;
const WORKFLOW_PREFIX = "agent-workflow";

export function buildCanvasWorkflowOps(input: CanvasWorkflowInput, snapshot: CanvasAgentSnapshot, config: AiConfig): CanvasAgentOp[] {
    if (!Array.isArray(input.nodes) || input.nodes.length === 0) throw new Error("工作流至少需要一个节点");
    const refs = new Set<string>();
    input.nodes.forEach((node) => {
        if (!node.ref.trim()) throw new Error("工作流节点 ref 不能为空");
        if (refs.has(node.ref)) throw new Error(`工作流节点 ref「${node.ref}」重复`);
        refs.add(node.ref);
        if (!node.title.trim()) throw new Error(`工作流节点「${node.ref}」缺少标题`);
        const type = nodeTypeForWorkflowKind(node.kind);
        if (![CanvasNodeType.Text, CanvasNodeType.Script].includes(type) && !(node.prompt || node.content || workflowPrompt(node.kind, node.title, input)).trim()) {
            throw new Error(`媒体工作流节点「${node.title}」缺少 prompt/content，不能创建空资源节点`);
        }
        for (const referenceRef of node.referenceRefs || []) {
            if (!refs.has(referenceRef) && !input.nodes.some((candidate) => candidate.ref === referenceRef)) {
                throw new Error(`节点「${node.ref}」引用了不存在的节点「${referenceRef}」`);
            }
        }
        for (const referenceNodeId of node.referenceNodeIds || []) {
            if (!snapshot.nodes.some((candidate) => candidate.id === referenceNodeId)) throw new Error(`节点「${node.title}」引用的现有节点「${referenceNodeId}」不存在`);
        }
    });

    const direction = input.direction || "horizontal";
    const gap = Math.max(48, input.gap ?? DEFAULT_GAP);
    const positions = layoutWorkflowNodes(input.nodes, snapshot, direction, gap, input.start);
    const ids = new Map(input.nodes.map((node) => [node.ref, `${WORKFLOW_PREFIX}-${slug(node.ref)}-${nanoid(8)}`]));
    const ops: CanvasAgentOp[] = [];

    input.nodes.forEach((node, index) => {
        const id = ids.get(node.ref)!;
        const type = nodeTypeForWorkflowKind(node.kind);
        const size = nodeSize(type, node.kind, node.width, node.height);
        const position = positions[index];
        const prompt = node.prompt || node.content || workflowPrompt(node.kind, node.title, input);
        const metadata: CanvasNodeMetadata = {
            content: node.content || (node.kind === "text" ? node.prompt || "" : ""),
            composerContent: prompt || undefined,
            prompt: prompt || undefined,
            workflowKind: workflowKindForNode(node.kind),
            workflowTitle: input.title,
            workflowDescription: node.description || input.description,
            status: type === CanvasNodeType.Text || type === CanvasNodeType.Script ? "success" : "idle",
            generationMode: generationModeForNode(type),
            model: generationModelForNode(type, config),
            ...(node.kind === "character_three_view" ? { characterView: "multi" } : {}),
            ...(node.referenceRefs?.length || node.referenceNodeIds?.length ? {
                referenceNodeIds: [
                    ...(node.referenceRefs || []).map((ref) => ids.get(ref)).filter((id): id is string => Boolean(id)),
                    ...(node.referenceNodeIds || []),
                ],
            } : {}),
        };
        ops.push({ type: "add_node", id, nodeType: type, title: node.title, position, width: size.width, height: size.height, metadata });
    });

    const edges = input.edges?.length ? input.edges : input.nodes.slice(0, -1).map((node, index) => ({ from: node.ref, to: input.nodes[index + 1].ref }));
    const edgeKeys = new Set<string>();
    for (const edge of edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error(`工作流连线引用不存在的节点：${edge.from} → ${edge.to}`);
        if (edge.from === edge.to) throw new Error(`工作流不能连接节点自身：${edge.from}`);
        const key = `${edge.from}\0${edge.to}`;
        if (edgeKeys.has(key)) continue;
        edgeKeys.add(key);
        ops.push({ type: "connect_nodes", fromNodeId: ids.get(edge.from)!, toNodeId: ids.get(edge.to)! });
    }
    for (const node of input.nodes) {
        for (const referenceRef of node.referenceRefs || []) {
            const key = `${referenceRef}\0${node.ref}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            ops.push({ type: "connect_nodes", fromNodeId: ids.get(referenceRef)!, toNodeId: ids.get(node.ref)! });
        }
        for (const referenceNodeId of node.referenceNodeIds || []) {
            const key = `${referenceNodeId}\0${node.ref}`;
            if (edgeKeys.has(key)) continue;
            edgeKeys.add(key);
            ops.push({ type: "connect_nodes", fromNodeId: referenceNodeId, toNodeId: ids.get(node.ref)! });
        }
    }
    const targetIds = input.nodes.map((node) => ids.get(node.ref)!);
    ops.push({ type: "select_nodes", ids: targetIds });
    if (input.autoRun || input.nodes.some((node) => node.runGeneration)) {
        input.nodes.forEach((node) => {
            const type = nodeTypeForWorkflowKind(node.kind);
            const shouldRun = input.autoRun === true || node.runGeneration === true;
            if (shouldRun && generationModeForNode(type)) ops.push({ type: "run_generation", nodeId: ids.get(node.ref)!, mode: generationModeForNode(type)!, prompt: node.prompt || node.content || workflowPrompt(node.kind, node.title, input) || undefined });
        });
    }
    return ops;
}

function workflowPrompt(kind: CanvasWorkflowNodeKind, title: string, input: CanvasWorkflowInput) {
    const workflowTitle = (input.title || input.description || "当前创作项目").trim();
    if (kind === "character_cards") return `请基于「${workflowTitle}」拆分主要角色，并为每个角色生成可用于后续创作的角色图片卡片：外观、服饰、身份、性格和视觉辨识点。`;
    if (kind === "character_three_view") return `请基于上游角色卡片生成「${title}」：同一角色的正面、侧面、背面三视图，保持服饰、发型、道具和比例一致。`;
    if (kind === "storyboard_video") return `请基于上游角色三视图，为「${workflowTitle}」制作分镜剧情视频方案：包含镜头顺序、景别、动作、节奏和画面连续性。`;
    return "";
}

export function looksLikeWorkflowRequest(value: string) {
    return /流水线|工作流|工作流图|管线|节点图|连线|pipeline|workflow/i.test(value);
}

export function isWorkflowNodeKind(kind: string): kind is CanvasWorkflowNodeKind {
    return WORKFLOW_KINDS.has(kind as CanvasWorkflowNodeKind);
}

function layoutWorkflowNodes(nodes: CanvasWorkflowNodeInput[], snapshot: CanvasAgentSnapshot, direction: "horizontal" | "vertical", gap: number, start?: { x: number; y: number }) {
    const maxX = snapshot.nodes.reduce((max, node) => Math.max(max, node.position.x + node.width), 0);
    const maxY = snapshot.nodes.reduce((max, node) => Math.max(max, node.position.y + node.height), 0);
    const origin = start || { x: snapshot.nodes.length ? maxX + 160 : 80, y: snapshot.nodes.length ? Math.max(80, maxY - 520) : 80 };
    let cursor = { ...origin };
    return nodes.map((node) => {
        const type = nodeTypeForWorkflowKind(node.kind);
        const size = nodeSize(type, node.kind, node.width, node.height);
        const position = { ...cursor };
        if (direction === "vertical") cursor = { x: origin.x, y: cursor.y + size.height + gap };
        else cursor = { x: cursor.x + size.width + gap, y: origin.y };
        return position;
    });
}

function nodeTypeForWorkflowKind(kind: CanvasWorkflowNodeKind) {
    if (kind === "script") return CanvasNodeType.Script;
    if (kind === "image" || kind === "character_cards" || kind === "character_three_view") return CanvasNodeType.Image;
    if (kind === "video" || kind === "storyboard_video") return CanvasNodeType.Video;
    if (kind === "audio") return CanvasNodeType.Audio;
    return CanvasNodeType.Text;
}

function nodeSize(type: CanvasNodeType, kind: CanvasWorkflowNodeKind, width?: number, height?: number) {
    const defaults = NODE_DEFAULT_SIZE[type];
    const preferred = kind === "character_cards" || kind === "character_three_view"
        ? { width: 560, height: 380 }
        : kind === "storyboard_video"
            ? { width: 640, height: 360 }
            : defaults;
    return { width: width || preferred.width, height: height || preferred.height };
}

function workflowKindForNode(kind: CanvasWorkflowNodeKind): CanvasNodeMetadata["workflowKind"] {
    if (kind === "character_cards") return "character";
    if (kind === "character_three_view") return "character";
    if (kind === "storyboard_video") return "storyboard";
    if (kind === "script") return "script";
    return "free";
}

function generationModeForNode(type: CanvasNodeType) {
    if (type === CanvasNodeType.Image) return "image" as const;
    if (type === CanvasNodeType.Video) return "video" as const;
    if (type === CanvasNodeType.Audio) return "audio" as const;
    return undefined;
}

function generationModelForNode(type: CanvasNodeType, config: AiConfig) {
    const mode = generationModeForNode(type);
    if (!mode) return undefined;
    return mode === "image" ? config.imageModel : mode === "video" ? config.videoModel : config.audioModel;
}

function slug(value: string) {
    return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "node";
}

export function workflowNodeIdsFromOps(ops: CanvasAgentOp[]) {
    return ops.filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node" && Boolean(op.id)).map((op) => op.id!);
}
