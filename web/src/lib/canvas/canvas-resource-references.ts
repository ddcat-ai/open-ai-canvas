import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { Skill } from "@/services/api/skills";
import type { Asset, AssetCategory } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text" | "skill" | "character";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    storageKey?: string;
    text?: string;
    active: boolean;
    sourceType?: CanvasNodeType;
    skill?: Skill;
    assetId?: string;
    category?: AssetCategory;
};

export function canvasResourceMentionToken(reference: CanvasResourceReference) {
    if (reference.kind === "skill" && reference.skill?.skill_id) return `@[skill:${reference.skill.skill_id}]`;
    if (reference.assetId) return `@[asset:${reference.assetId}]`;
    return `@[node:${reference.nodeId}]`;
}

export function removeCanvasResourceMention(prompt: string, reference: CanvasResourceReference) {
    const token = canvasResourceMentionToken(reference);
    if (!token || !prompt.includes(token)) return prompt;
    return prompt
        .split(token)
        .join("")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

export function buildAssetMentionReferences(assets: Asset[]): CanvasResourceReference[] {
    return assets.flatMap((asset): CanvasResourceReference[] => {
        if (asset.kind === "model") return [];
        const kind: CanvasResourceKind = asset.kind === "entity" ? "character" : asset.kind;
        const previewUrl = asset.kind === "image" ? asset.data.dataUrl : asset.kind === "video" ? asset.data.url : asset.coverUrl;
        const text = asset.kind === "text" ? asset.data.content : undefined;
        return [{
            id: `asset:${asset.id}`,
            nodeId: "",
            assetId: asset.id,
            kind,
            label: asset.title,
            title: asset.title,
            previewUrl,
            storageKey: "storageKey" in asset.data ? asset.data.storageKey : undefined,
            text,
            active: false,
            category: asset.category || "other",
        }];
    });
}

export function buildCanvasResourceReferences(nodes: CanvasNodeData[], connections: CanvasConnection[], contextNodeId?: string | null) {
    const contextNodes = contextNodeId ? getMentionResourceNodes(contextNodeId, nodes, connections) : [];
    const globalReferences = labelResourceNodes(nodes.filter(isResourceNode), false);
    const activeByNodeId = new Map(labelResourceNodes(contextNodes, true).map((reference) => [reference.nodeId, reference]));
    return globalReferences.map((reference) => activeByNodeId.get(reference.nodeId) || reference);
}

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections), true);
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isResourceNode(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configInputs = getConnectedConfigResourceNodes(nodeId, nodes, connections);
    if (configInputs.length) return configInputs;
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    return [];
}

/** 收集节点自身及其上游链路中的视频节点，用于时间线片段导入定位真正的视频源。 */
export function collectUpstreamVideoNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData[] {
    const queue = [nodeId];
    const visited = new Set<string>();
    const result: CanvasNodeData[] = [];
    while (queue.length) {
        const currentId = queue.shift()!;
        if (visited.has(currentId)) continue;
        visited.add(currentId);
        const node = nodes.find((item) => item.id === currentId);
        if (node?.type === CanvasNodeType.Video && Boolean(node.metadata?.content || node.metadata?.storageKey)) result.push(node);
        connections.filter((connection) => connection.toNodeId === currentId).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return result;
}

/**
 * 该节点的直接上游素材节点（按连线取 fromNodeId，只保留构成素材的）。
 * 扩展节点经 CanvasNodeGraphContext 复用它，不要另写一份取上游的逻辑。
 */
export function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return connections
        .filter((connection) => connection.toNodeId === nodeId)
        .map((connection) => nodes.find((node) => node.id === connection.fromNodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isResourceNode(node)));
}

function getConnectedConfigResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const configConnection = connections.find((connection) => connection.fromNodeId === nodeId && nodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config);
    if (!configConnection) return [];
    return getContextResourceNodes(configConnection.toNodeId, nodes, connections).filter((node) => node.id !== nodeId);
}

function labelResourceNodes(nodes: CanvasNodeData[], active: boolean) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0, skill: 0, character: 0 };
    let drawingCount = 0;
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = resourceKind(node);
        if (!kind) return [];
        const index = node.type === CanvasNodeType.Drawing ? drawingCount++ : counts[kind]++;
        const label = node.type === CanvasNodeType.Drawing ? `绘图${index + 1}` : labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: node.title || label,
                previewUrl: node.metadata?.workflowKind === "character" ? node.metadata.characterCoverUrl : node.type === CanvasNodeType.Drawing ? node.metadata?.drawingPreviewUrl : node.metadata?.content,
                storageKey: node.metadata?.storageKey,
                text: node.metadata?.workflowKind === "character" ? node.metadata.characterPrompt : node.type === CanvasNodeType.Text ? node.metadata?.content || node.metadata?.prompt : node.type === CanvasNodeType.Skill ? skillResourceText(node) : undefined,
                active,
                sourceType: node.type,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "character") return `角色${index + 1}`;
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    if (kind === "skill") return `技能${index + 1}`;
    return `文本${index + 1}`;
}

function isResourceNode(node: CanvasNodeData) {
    return Boolean(resourceKind(node));
}

function resourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    // 角色卡是跨类型覆盖：任何节点带上角色元数据都按角色处理，故先于按类型判定。
    if (node.metadata?.workflowKind === "character" && node.metadata.characterAssetId) return "character";
    return getNodeResourceKind(node);
}

function skillResourceText(node: CanvasNodeData) {
    const skill = node.metadata?.skillSnapshot;
    if (!skill) return node.metadata?.content || "";
    return [skill.name, skill.description, skill.template, skill.outputContract].filter(Boolean).join("\n\n");
}
