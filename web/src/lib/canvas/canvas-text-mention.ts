import { applyCanvasConnectionPromptSync, buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences } from "./canvas-resource-references";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export function connectCanvasTextMention(nodes: CanvasNodeData[], connections: CanvasConnection[], targetId: string, sourceId: string, connectionId: string) {
    const target = nodes.find((node) => node.id === targetId);
    const source = buildCanvasResourceReferences(nodes, connections).find((reference) => reference.nodeId === sourceId && reference.kind === "text");
    if (!target || !source || sourceId === targetId || target.metadata?.locked) throw new Error("无法引用该文本节点");
    const configId = connections.find((edge) => edge.fromNodeId === targetId && nodes.find((node) => node.id === edge.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId;
    const configReferences = configId ? buildCanvasNodeMentionReferenceMap(nodes, connections).get(configId) : [];
    const receiverId = configReferences?.some((reference) => reference.nodeId !== targetId) ? configId! : targetId;
    if (nodes.find((node) => node.id === receiverId)?.metadata?.locked) throw new Error("无法修改锁定节点的引用");
    const pending = [receiverId];
    const visited = new Set<string>();
    while (pending.length) {
        const id = pending.pop()!;
        if (id === sourceId) throw new Error("该引用会形成循环连线");
        if (visited.has(id)) continue;
        visited.add(id);
        pending.push(...connections.filter((edge) => edge.fromNodeId === id).map((edge) => edge.toNodeId));
    }
    const nextConnections = connections.some((edge) => edge.fromNodeId === sourceId && edge.toNodeId === receiverId) ? connections : [...connections, { id: connectionId, fromNodeId: sourceId, toNodeId: receiverId }];
    const nextNodes = applyCanvasConnectionPromptSync(nodes, connections, nodes, nextConnections);
    const reference = buildCanvasNodeMentionReferenceMap(nextNodes, nextConnections).get(targetId)?.find((item) => item.nodeId === sourceId);
    if (!reference) throw new Error("文本引用未建立");
    return { nodes: nextNodes, connections: nextConnections, reference };
}
