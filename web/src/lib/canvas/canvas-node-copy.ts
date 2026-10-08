import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeMetadata, type StoryboardRow } from "@/types/canvas";

const COPY_TITLE_SUFFIX = /^(.*)_copy(\d+)$/i;

export function nextCopiedNodeTitle(sourceTitle: string, existingTitles: Iterable<string>) {
    const sourceMatch = sourceTitle.match(COPY_TITLE_SUFFIX);
    const baseTitle = (sourceMatch?.[1] || sourceTitle.replace(/ Copy$/i, "")).trim() || sourceTitle.trim() || "未命名节点";
    let maxCopyIndex = 0;
    for (const title of existingTitles) {
        const match = title.match(COPY_TITLE_SUFFIX);
        if (!match || match[1] !== baseTitle) continue;
        const copyIndex = Number(match[2]);
        if (Number.isSafeInteger(copyIndex)) maxCopyIndex = Math.max(maxCopyIndex, copyIndex);
    }
    return `${baseTitle}_copy${maxCopyIndex + 1}`;
}

function remapReferenceId(nodeId: string | undefined, idMap: ReadonlyMap<string, string>) {
    return nodeId ? idMap.get(nodeId) || nodeId : undefined;
}

function remapOwnedNodeId(nodeId: string | undefined, idMap: ReadonlyMap<string, string>) {
    return nodeId ? idMap.get(nodeId) : undefined;
}

function remapReferenceIds(nodeIds: string[] | undefined, idMap: ReadonlyMap<string, string>) {
    return nodeIds ? Array.from(new Set(nodeIds.map((nodeId) => idMap.get(nodeId) || nodeId))) : undefined;
}

function copyStoryboardRow(row: StoryboardRow, idMap: ReadonlyMap<string, string>): StoryboardRow {
    const imageNodeId = remapOwnedNodeId(row.imageNodeId, idMap);
    const videoNodeId = remapOwnedNodeId(row.videoNodeId, idMap);
    const hasCopiedOutput = Boolean(imageNodeId || videoNodeId);
    return {
        ...row,
        characters: (row.characters || []).map((character) => ({
            ...character,
            characterImageNodeId: remapReferenceId(character.characterImageNodeId, idMap),
        })),
        assetBindings: (row.assetBindings || []).map((binding) => ({ ...binding, nodeId: remapReferenceId(binding.nodeId, idMap)! })),
        imageNodeId,
        videoNodeId,
        status: hasCopiedOutput ? row.status : "idle",
        errorDetails: undefined,
    };
}

/**
 * 副本继承内容和用户引用，但不能继承原节点的任务、批次与结果持久化身份。
 * @param node 原节点，复制过程不会修改它的元数据。
 * @param idMap 本次复制的节点 ID 映射，用于更新副本内部引用。
 * @returns 可独立生成与保存的副本元数据。
 */
export function isolateCopiedNodeMetadata(node: CanvasNodeData, idMap: ReadonlyMap<string, string>): CanvasNodeMetadata {
    const metadata = resetGenerationTaskMetadata(node.metadata, node.metadata?.content ? "success" : "idle");
    // 原节点的提交标记不能证明副本已保存；继承后，普通保存会把新副本误判为未确认结果并排除。
    delete metadata.generationEffectKeys;
    delete metadata.generationBatches;
    delete metadata.batchRootId;
    delete metadata.batchChildIds;
    delete metadata.batchFailedCount;
    delete metadata.isBatchRoot;
    delete metadata.primaryImageId;
    delete metadata.imageBatchExpanded;
    delete metadata.batchUsesReferenceImages;
    delete metadata.versionOfNodeId;
    delete metadata.versionLabel;
    delete metadata.versionPrimary;

    metadata.copiedFromNodeId = node.id;
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) {
        metadata.generationResultPlacement = "replace-node";
    }
    metadata.frame = node.metadata?.frame ? { ...node.metadata.frame } : undefined;
    metadata.referenceSetId = remapOwnedNodeId(node.metadata?.referenceSetId, idMap);
    metadata.referenceAssetNodeIds = node.metadata?.referenceAssetNodeIds
        ?.map((nodeId) => remapOwnedNodeId(nodeId, idMap))
        .filter((nodeId): nodeId is string => Boolean(nodeId));
    metadata.videoStartFrameNodeId = remapReferenceId(node.metadata?.videoStartFrameNodeId, idMap);
    metadata.videoEndFrameNodeId = remapReferenceId(node.metadata?.videoEndFrameNodeId, idMap);
    metadata.previsPreviewNodeId = remapOwnedNodeId(node.metadata?.previsPreviewNodeId, idMap);
    metadata.previsDepthNodeId = remapOwnedNodeId(node.metadata?.previsDepthNodeId, idMap);
    metadata.previsNormalNodeId = remapOwnedNodeId(node.metadata?.previsNormalNodeId, idMap);

    const characterViewNodeIds = node.metadata?.characterViewNodeIds;
    const copiedCharacterViewNodeIds = characterViewNodeIds ? {
        front: remapOwnedNodeId(characterViewNodeIds.front, idMap),
        side: remapOwnedNodeId(characterViewNodeIds.side, idMap),
        back: remapOwnedNodeId(characterViewNodeIds.back, idMap),
    } : undefined;
    metadata.characterViewNodeIds = copiedCharacterViewNodeIds && Object.values(copiedCharacterViewNodeIds).some(Boolean)
        ? copiedCharacterViewNodeIds
        : undefined;
    metadata.emotionEdit = node.metadata?.emotionEdit ? {
        ...node.metadata.emotionEdit,
        sourceNodeId: remapReferenceId(node.metadata.emotionEdit.sourceNodeId, idMap)!,
        faceBox: { ...node.metadata.emotionEdit.faceBox },
        editRegion: node.metadata.emotionEdit.editRegion ? { ...node.metadata.emotionEdit.editRegion } : undefined,
    } : undefined;
    metadata.storyboard = node.metadata?.storyboard ? {
        rows: node.metadata.storyboard.rows.map((row) => copyStoryboardRow(row, idMap)),
        visibleColumns: [...node.metadata.storyboard.visibleColumns],
        referenceNodeIds: remapReferenceIds(node.metadata.storyboard.referenceNodeIds, idMap) || [],
    } : undefined;
    return metadata;
}
