import { nanoid } from "nanoid";

import { normalizeStoryboardAssetBindings, storyboardAssetRoleForNode } from "@/lib/canvas/canvas-storyboard-assets";
import { applyCanvasConnectionPromptSync, buildOrderedCanvasResourceReferences, canvasNodeMentionToken } from "@/lib/canvas/canvas-resource-references";
import { nodeGenerationPrompt } from "@/lib/canvas/generation-contract";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type StoryboardAssetBinding, type StoryboardRow } from "@/types/canvas";

export function storyboardRowReferenceNodeIds(scriptNode: CanvasNodeData, row: StoryboardRow, nodes: CanvasNodeData[], connections: CanvasConnection[], includeFirstFrame: boolean, targetNodeId?: string) {
    const characterAssetIds = new Set((row.characters || []).map((character) => character.characterAssetId).filter((assetId): assetId is string => Boolean(assetId)));
    const boundNodeIds = new Set((row.assetBindings || []).map((binding) => binding.nodeId));
    const explicitlyBoundCharacters = new Set(
        nodes
            .filter((node) => boundNodeIds.has(node.id))
            .map((node) => node.metadata?.characterAssetId)
            .filter(Boolean),
    );
    const characterNodeIds = nodes
        .filter((node) => node.metadata?.workflowKind === "character" && Boolean(node.metadata.characterAssetId) && characterAssetIds.has(node.metadata.characterAssetId!) && !explicitlyBoundCharacters.has(node.metadata.characterAssetId))
        .map((node) => node.id);
    const referenceIds = new Set([
        ...(scriptNode.metadata?.storyboard?.referenceNodeIds || []),
        ...(row.assetBindings || []).map((binding) => binding.nodeId),
        ...characterNodeIds,
        ...connections.filter((connection) => connection.toNodeId === scriptNode.id && connection.toHandleId === `row:${row.id}`).map((connection) => connection.fromNodeId),
        ...(targetNodeId ? connections.filter((connection) => !connection.relation && connection.toNodeId === targetNodeId).map((connection) => connection.fromNodeId) : []),
        ...(includeFirstFrame && row.imageNodeId ? [row.imageNodeId] : []),
    ]);
    if (!includeFirstFrame && row.imageNodeId) referenceIds.delete(row.imageNodeId);
    referenceIds.delete(scriptNode.id);
    return Array.from(referenceIds).filter((nodeId) => nodes.some((node) => node.id === nodeId));
}

export function storyboardComposerContent(prompt: string, referenceNodeIds: string[], nodes: CanvasNodeData[]) {
    const referenceIds = Array.from(new Set(referenceNodeIds));
    const referenceNodes = referenceIds.flatMap((nodeId) => {
        const node = nodes.find((candidate) => candidate.id === nodeId);
        return node ? [node] : [];
    });
    // 既有手工入边可能与资产清单顺序不同；保存节点身份，到真实生成入口再按媒体槽位编译。
    const mentions = buildOrderedCanvasResourceReferences(referenceNodes).map((reference) => canvasNodeMentionToken(reference.nodeId));
    return mentions.length ? [`参考资产：${mentions.join(" ")}`, prompt.trim()].filter(Boolean).join("\n") : prompt.trim();
}

export function reconcileStoryboardTargetConnections(connections: CanvasConnection[], scriptNode: CanvasNodeData, row: StoryboardRow, targetNodeId: string, referenceNodeIds: string[]) {
    const desired = new Set(referenceNodeIds.filter((nodeId) => nodeId !== targetNodeId && nodeId !== scriptNode.id));
    const next = connections.filter((connection) => {
        if (connection.storyboardRowId !== row.id || connection.toNodeId !== targetNodeId) return true;
        if (connection.relation === "storyboard-output") return connection.fromNodeId === scriptNode.id;
        if (connection.relation === "storyboard-asset-reference") return desired.has(connection.fromNodeId);
        return true;
    });
    if (!next.some((connection) => connection.fromNodeId === scriptNode.id && connection.toNodeId === targetNodeId && connection.fromHandleId === `row:${row.id}`)) {
        next.push({ id: nanoid(), fromNodeId: scriptNode.id, toNodeId: targetNodeId, fromHandleId: `row:${row.id}`, relation: "storyboard-output", storyboardRowId: row.id });
    }
    desired.forEach((fromNodeId) => {
        if (!next.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === targetNodeId)) {
            next.push({ id: nanoid(), fromNodeId, toNodeId: targetNodeId, relation: "storyboard-asset-reference", storyboardRowId: row.id });
        }
    });
    return next;
}

export function bindingForConnectedNode(node: CanvasNodeData): StoryboardAssetBinding | null {
    const role = storyboardAssetRoleForNode(node);
    return role ? { nodeId: node.id, role, priority: defaultRolePriority(role) } : null;
}

export function replaceStoryboardRowAssets(nodes: CanvasNodeData[], connections: CanvasConnection[], scriptNodeId: string, rowId: string, bindings: StoryboardAssetBinding[]) {
    const script = nodes.find((node) => node.id === scriptNodeId && node.type === CanvasNodeType.Script);
    const row = script?.metadata?.storyboard?.rows.find((item) => item.id === rowId);
    if (!script || !row) throw new Error("分镜或镜头已不存在，请重新选择");
    if (script.metadata?.locked) throw new Error("请先解锁分镜节点");
    const normalized = normalizeStoryboardAssetBindings(bindings, nodes);
    if (normalized.length !== bindings.length || normalized.some((binding) => binding.nodeId === scriptNodeId || !isStoryboardPreviewAsset(nodes.find((node) => node.id === binding.nodeId)!))) {
        throw new Error("所选资产已失效，请重新选择");
    }
    const selectedIds = new Set(normalized.map((binding) => binding.nodeId));
    const selectedCharacterIds = new Set(
        nodes
            .filter((node) => selectedIds.has(node.id))
            .map((node) => node.metadata?.characterAssetId)
            .filter(Boolean),
    );
    // Character identity and row input edges also feed generation; clear those paths on deselection.
    const nextRow = {
        ...row,
        assetBindings: normalized,
        characters: row.characters.map((character) => {
            if (!character.characterAssetId || selectedCharacterIds.has(character.characterAssetId)) return character;
            return { characterName: character.characterName, characterDescription: character.characterDescription };
        }),
    };
    const nextScript = { ...script, metadata: { ...script.metadata, storyboard: { ...script.metadata!.storyboard!, rows: script.metadata!.storyboard!.rows.map((item) => (item.id === rowId ? nextRow : item)) } } };
    const nextNodes = nodes.map((node) => (node.id === scriptNodeId ? nextScript : node));
    let nextConnections = connections.filter(
        (connection) => connection.toNodeId !== scriptNodeId || connection.toHandleId !== `row:${rowId}` || selectedIds.has(connection.fromNodeId) || !isStoryboardPreviewAsset(nodes.find((node) => node.id === connection.fromNodeId)!),
    );
    for (const targetId of [row.imageNodeId, row.videoNodeId]) {
        if (!targetId || !nodes.some((node) => node.id === targetId)) continue;
        nextConnections = reconcileStoryboardTargetConnections(nextConnections, nextScript, nextRow, targetId, storyboardRowReferenceNodeIds(nextScript, nextRow, nextNodes, nextConnections, targetId === row.videoNodeId, targetId));
    }
    const syncedNodes = applyCanvasConnectionPromptSync(nodes, connections, nextNodes, nextConnections, { clearPromptTemplate: false });
    const outputIds = new Set([row.imageNodeId, row.videoNodeId].filter(Boolean));
    const updatedNodes = syncedNodes.map((node) => {
        if (!outputIds.has(node.id)) return node;
        const referenceIds = storyboardRowReferenceNodeIds(nextScript, nextRow, syncedNodes, nextConnections, node.id === row.videoNodeId, node.id);
        // Replace only the generated reference header; keep the user's edited draft body.
        const body = nodeGenerationPrompt(node).replace(/^参考资产：[^\n]*(?:\n|$)/, "");
        return writeCanvasNodePrompt(node, storyboardComposerContent(body, referenceIds, syncedNodes), { clearPromptTemplate: false });
    });
    return { nodes: updatedNodes, connections: nextConnections };
}

export function isStoryboardPreviewAsset(node: CanvasNodeData | undefined) {
    return Boolean(node && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || node.metadata?.workflowKind === "character"));
}

function defaultRolePriority(role: StoryboardAssetBinding["role"]) {
    if (role === "character") return 100;
    if (role === "environment") return 90;
    if (role === "prop" || role === "weapon" || role === "wardrobe") return 80;
    if (role === "motion" || role === "audio") return 70;
    return 60;
}
