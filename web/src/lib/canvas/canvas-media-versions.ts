import { nanoid } from "nanoid";

import { nextCanvasVersionLabel } from "@/lib/canvas/canvas-layout";
import type { CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

function snapshotMetadata(metadata: CanvasNodeMetadata | undefined, rootId: string, label: string): CanvasNodeMetadata {
    const snapshot = { ...metadata, versionOfNodeId: rootId, versionLabel: label, versionPrimary: false };
    delete snapshot.taskId;
    delete snapshot.taskStatus;
    delete snapshot.taskProgress;
    delete snapshot.taskStage;
    delete snapshot.taskCreatedAt;
    delete snapshot.taskUpdatedAt;
    delete snapshot.errorDetails;
    delete snapshot.generationErrorCode;
    delete snapshot.failedPromptFingerprint;
    delete snapshot.isBatchRoot;
    delete snapshot.batchRootId;
    delete snapshot.batchChildIds;
    delete snapshot.primaryImageId;
    delete snapshot.imageBatchExpanded;
    snapshot.status = snapshot.content ? "success" : "idle";
    return snapshot;
}

// 原位生成保留稳定节点 ID，同时把生成前媒体快照放入同一版本族。
export function prepareInPlaceMediaVersion(nodes: CanvasNodeData[], nodeId: string): CanvasNodeData[] {
    const source = nodes.find((node) => node.id === nodeId);
    if (!source?.metadata?.content) return nodes;
    const rootId = source.metadata.versionOfNodeId || source.id;
    const snapshotLabel = source.metadata.versionLabel || "A";
    const nextLabel = nextCanvasVersionLabel(rootId, source.metadata.versionLabel ? nodes : [{ ...source, metadata: { ...source.metadata, versionOfNodeId: rootId, versionLabel: "A" } }, ...nodes.filter((node) => node.id !== source.id)]);
    const snapshot: CanvasNodeData = {
        ...source,
        id: nanoid(),
        title: `${source.title.replace(/ · [A-Z]$/, "")} · ${snapshotLabel}`,
        position: { x: source.position.x + 36, y: source.position.y + 36 },
        parentId: undefined,
        metadata: snapshotMetadata(source.metadata, rootId, snapshotLabel),
    };
    return [
        ...nodes.map((node) => {
            if ((node.metadata?.versionOfNodeId || node.id) !== rootId) return node;
            if (node.id !== source.id) return { ...node, metadata: { ...node.metadata, versionPrimary: false } };
            return { ...node, metadata: { ...node.metadata, versionOfNodeId: rootId, versionLabel: nextLabel, versionPrimary: true } };
        }),
        snapshot,
    ];
}
