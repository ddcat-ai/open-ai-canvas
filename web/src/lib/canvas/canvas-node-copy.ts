import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import type { CanvasNodeData, CanvasNodeMetadata, StoryboardRow } from "@/types/canvas";

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

// 副本只能继承内容和用户引用，运行中任务、批次及指向源生成结果的关系必须隔离。
export function isolateCopiedNodeMetadata(node: CanvasNodeData, idMap: ReadonlyMap<string, string>): CanvasNodeMetadata {
    const metadata = resetGenerationTaskMetadata(node.metadata, node.metadata?.content ? "success" : "idle");
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
    metadata.frame = node.metadata?.frame ? { ...node.metadata.frame } : undefined;
    metadata.referenceSetId = remapOwnedNodeId(node.metadata?.referenceSetId, idMap);
    metadata.referenceAssetNodeIds = node.metadata?.referenceAssetNodeIds
        ?.map((nodeId) => remapOwnedNodeId(nodeId, idMap))
        .filter((nodeId): nodeId is string => Boolean(nodeId));
    metadata.videoStartFrameNodeId = remapReferenceId(node.metadata?.videoStartFrameNodeId, idMap);
    metadata.videoEndFrameNodeId = remapReferenceId(node.metadata?.videoEndFrameNodeId, idMap);
    metadata.directorPreviewNodeId = remapOwnedNodeId(node.metadata?.directorPreviewNodeId, idMap);
    metadata.directorDepthNodeId = remapOwnedNodeId(node.metadata?.directorDepthNodeId, idMap);
    metadata.directorNormalNodeId = remapOwnedNodeId(node.metadata?.directorNormalNodeId, idMap);

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
