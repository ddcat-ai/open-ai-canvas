import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/components/canvas/canvas-script-node";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { scopedLocalStorage } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasWorkspaceMode, type ConnectionHandle, type Position, type StoryboardColumn, type StoryboardRow } from "@/types/canvas";

const CANVAS_WORKSPACE_MODE_STORAGE_KEY = "canvas-workspace-mode-v1";

export function readCanvasWorkspaceMode(): CanvasWorkspaceMode {
    if (typeof window === "undefined") return "professional";
    try {
        return scopedLocalStorage.getItem(CANVAS_WORKSPACE_MODE_STORAGE_KEY) === "simple" ? "simple" : "professional";
    } catch (error) {
        console.warn("读取画布工作模式失败，已使用专业模式", error);
        return "professional";
    }
}

export function persistCanvasWorkspaceMode(mode: CanvasWorkspaceMode) {
    try {
        scopedLocalStorage.setItem(CANVAS_WORKSPACE_MODE_STORAGE_KEY, mode);
    } catch (error) {
        console.warn("保存画布工作模式失败", error);
    }
}


export function createCanvasNode(type: CanvasNodeType, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: type === CanvasNodeType.Script ? { ...spec.metadata, ...metadata, storyboard: metadata?.storyboard || { rows: [1, 2, 3].map((shotNumber) => createStoryboardRow(shotNumber)), visibleColumns: ["shotNumber", "durationSeconds", "plotDescription", "dialogue"], referenceNodeIds: [] } } : { ...spec.metadata, ...metadata },
    };
}

export function createStoryboardRow(shotNumber: number, patch: Partial<StoryboardRow> = {}): StoryboardRow {
    return {
        id: `shot-${Date.now()}-${shotNumber}-${Math.random().toString(36).slice(2, 6)}`,
        shotNumber,
        durationSeconds: 6,
        plotDescription: "",
        dialogue: "",
        characters: [],
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        negativePrompt: "",
        referenceNodeIds: [],
        status: "idle",
        ...patch,
    };
}

export function cinematicStoryboardColumns(columns?: StoryboardColumn[]): StoryboardColumn[] {
    return Array.from(new Set([
        ...(columns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"]),
        "shotSize",
        "camera",
        "motion",
        "timeBeats",
        "lightingAndAtmosphere",
        "negativePrompt",
    ])) as StoryboardColumn[];
}

export function storyboardRowsFromTask(task: GenerationTask) {
    const result = JSON.parse(task.resultJson || "{}") as { title?: string; rows?: Array<Partial<StoryboardRow>> };
    if (!Array.isArray(result.rows) || !result.rows.length) throw new Error("分镜任务没有返回镜头行");
    return {
        title: result.title?.trim(),
        rows: result.rows.map((row, index) => createStoryboardRow(index + 1, { ...row, id: `shot-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`, shotNumber: index + 1, status: "idle", referenceNodeIds: Array.isArray(row.referenceNodeIds) ? row.referenceNodeIds : [] })),
    };
}


export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle, handleId?: string, scrollTop = 0) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: storyboardHandleY(node, handleId, scrollTop) ?? node.position.y + node.height / 2,
    };
}

export function storyboardHandleAtY(node: CanvasNodeData, worldY: number, scrollTop = 0) {
    const rows = node.metadata?.storyboard?.rows || [];
    const localY = worldY - node.position.y - STORYBOARD_HEADER_HEIGHT;
    const tableHeight = storyboardTableHeight(node.height, node.metadata?.storyboardComposerHeight);
    if (rows.length && localY >= 0 && localY <= tableHeight) {
        const index = Math.max(0, Math.min(rows.length - 1, Math.floor((localY + scrollTop) / STORYBOARD_ROW_HEIGHT)));
        return `row:${rows[index].id}`;
    }
    const composerTop = node.height - (node.metadata?.storyboardComposerHeight || 104);
    if (worldY >= node.position.y + composerTop && worldY <= node.position.y + node.height) return "storyboard:context";
    return undefined;
}

function storyboardHandleY(node: CanvasNodeData, handleId?: string, scrollTop = 0) {
    if (node.type !== CanvasNodeType.Script) return undefined;
    if (handleId === "storyboard:context") return node.position.y + node.height - (node.metadata?.storyboardComposerHeight || 104) / 2;
    if (!handleId?.startsWith("row:")) return undefined;
    const rowId = handleId.slice(4);
    const index = (node.metadata?.storyboard?.rows || []).findIndex((row) => row.id === rowId);
    if (index < 0) return undefined;
    const tableHeight = storyboardTableHeight(node.height, node.metadata?.storyboardComposerHeight);
    return node.position.y + STORYBOARD_HEADER_HEIGHT + clamp(index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop, 4, tableHeight - 4);
}

export function normalizeConnection(firstNodeId: string, secondNodeId: string, nodes: CanvasNodeData[], firstHandleType: "source" | "target") {
    const first = nodes.find((node) => node.id === firstNodeId);
    const second = nodes.find((node) => node.id === secondNodeId);
    if (!first || !second || first.id === second.id) return null;
    if (isFrameNode(first) || isFrameNode(second)) return null;
    if (first.type === CanvasNodeType.Config && second.type === CanvasNodeType.Config) return null;
    if (second.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (first.type === CanvasNodeType.Config && firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    if (first.type === CanvasNodeType.Config) return { fromNodeId: first.id, toNodeId: second.id };
    if (firstHandleType === "target") return { fromNodeId: second.id, toNodeId: first.id };
    return { fromNodeId: first.id, toNodeId: second.id };
}

export function attachNodeToStoryboardRow(nodes: CanvasNodeData[], connection: Pick<CanvasConnection, "fromNodeId" | "toNodeId" | "fromHandleId" | "toHandleId">) {
    const fromStoryboardHandle = connection.fromHandleId?.startsWith("row:") || connection.fromHandleId === "storyboard:context";
    const toStoryboardHandle = connection.toHandleId?.startsWith("row:") || connection.toHandleId === "storyboard:context";
    const scriptNodeId = fromStoryboardHandle ? connection.fromNodeId : toStoryboardHandle ? connection.toNodeId : null;
    const handleId = connection.fromHandleId || connection.toHandleId;
    const rowId = handleId?.startsWith("row:") ? handleId.slice(4) : null;
    const linkedNodeId = scriptNodeId === connection.fromNodeId ? connection.toNodeId : connection.fromNodeId;
    const linkedNode = nodes.find((node) => node.id === linkedNodeId);
    const scriptNode = nodes.find((node) => node.id === scriptNodeId && node.type === CanvasNodeType.Script);
    if (!scriptNodeId || !linkedNode || !scriptNode) return nodes;
    const row = rowId ? scriptNode.metadata?.storyboard?.rows.find((item) => item.id === rowId) : undefined;
    const videoPrompt = row ? (row.videoMotionPrompt || row.plotDescription).trim() : "";

    return nodes.map((node) => {
        if (row && node.id === linkedNode.id && scriptNodeId === connection.fromNodeId && node.type === CanvasNodeType.Video) {
            return { ...node, title: `镜头 ${row.shotNumber} · 视频`, metadata: { ...node.metadata, prompt: videoPrompt, composerContent: videoPrompt, workflowKind: "shot" as const, workflowTitle: `镜头 ${row.shotNumber} 视频`, shotIndex: row.shotNumber, generationMode: "video" as const, videoEditOperation: node.metadata?.videoEditOperation || "text_to_video", seconds: String(row.durationSeconds) } };
        }
        if (node.id !== scriptNodeId || node.type !== CanvasNodeType.Script) return node;
        const storyboard = node.metadata?.storyboard;
        return {
            ...node,
            metadata: {
                ...node.metadata,
                storyboard: {
                    rows: (storyboard?.rows || []).map((item) => item.id !== rowId ? item : scriptNodeId === connection.fromNodeId
                        ? { ...item, imageNodeId: linkedNode.type === CanvasNodeType.Image ? linkedNode.id : item.imageNodeId, videoNodeId: linkedNode.type === CanvasNodeType.Video ? linkedNode.id : item.videoNodeId }
                        : { ...item, referenceNodeIds: Array.from(new Set([...(item.referenceNodeIds || []), linkedNode.id])) }),
                    visibleColumns: storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
                    referenceNodeIds: handleId === "storyboard:context" ? Array.from(new Set([...(storyboard?.referenceNodeIds || []), linkedNode.id])) : storyboard?.referenceNodeIds || [],
                },
            },
        };
    });
}

export function storyboardRowFromHandle(nodes: CanvasNodeData[], nodeId: string, handleId?: string) {
    if (!handleId?.startsWith("row:")) return undefined;
    return nodes.find((node) => node.id === nodeId && node.type === CanvasNodeType.Script)?.metadata?.storyboard?.rows.find((row) => `row:${row.id}` === handleId);
}

export function expandStoryboardTextMentions(prompt: string, references: CanvasResourceReference[]) {
    let expanded = prompt;
    references.filter((reference) => reference.active && reference.kind === "text" && reference.text?.trim()).forEach((reference) => {
        const token = `@${reference.label}`;
        if (!expanded.includes(token)) return;
        expanded = expanded.split(token).join(`【项目设定：${reference.title}】\n${reference.text!.trim()}`);
    });
    return expanded;
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

export type NodeAlignmentContext = {
    movingBounds: { left: number; top: number; right: number; bottom: number };
    targets: Array<{ x: number[]; y: number[] }>;
};

export function createNodeAlignmentContext(nodes: CanvasNodeData[], initialPositions: Array<{ id: string; x: number; y: number }>): NodeAlignmentContext | null {
    const movingIds = new Set(initialPositions.map((item) => item.id));
    const initialById = new Map(initialPositions.map((item) => [item.id, item]));
    const movingNodes = nodes.filter((node) => movingIds.has(node.id));
    if (!movingNodes.length) return null;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const left = Math.min(...movingNodes.map((node) => initialById.get(node.id)?.x ?? node.position.x));
    const top = Math.min(...movingNodes.map((node) => initialById.get(node.id)?.y ?? node.position.y));
    const right = Math.max(...movingNodes.map((node) => (initialById.get(node.id)?.x ?? node.position.x) + node.width));
    const bottom = Math.max(...movingNodes.map((node) => (initialById.get(node.id)?.y ?? node.position.y) + node.height));
    const targets = nodes.flatMap((node) => {
        if (movingIds.has(node.id)) return [];
        const batchRoot = node.metadata?.batchRootId ? nodeById.get(node.metadata.batchRootId) : null;
        if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) return [];
        const parent = node.parentId ? nodeById.get(node.parentId) : null;
        if (parent && isFrameNode(parent) && parent.metadata?.frame?.collapsed) return [];
        return [{
            x: [node.position.x, node.position.x + node.width / 2, node.position.x + node.width],
            y: [node.position.y, node.position.y + node.height / 2, node.position.y + node.height],
        }];
    });
    return { movingBounds: { left, top, right, bottom }, targets };
}

export function calculateNodeAlignment(context: NodeAlignmentContext | null, rawOffset: Position, threshold: number) {
    if (!context) return { offset: rawOffset, guides: {} as { vertical?: number; horizontal?: number } };
    const { left, top, right, bottom } = context.movingBounds;
    const movingX = [left + rawOffset.x, (left + right) / 2 + rawOffset.x, right + rawOffset.x];
    const movingY = [top + rawOffset.y, (top + bottom) / 2 + rawOffset.y, bottom + rawOffset.y];
    let bestXDelta: number | undefined;
    let bestXGuide: number | undefined;
    let bestYDelta: number | undefined;
    let bestYGuide: number | undefined;
    context.targets.forEach(({ x: targetsX, y: targetsY }) => {
        movingX.forEach((value, anchorIndex) => {
            const target = targetsX[anchorIndex];
            const delta = target - value;
            if (Math.abs(delta) <= threshold && (bestXDelta === undefined || Math.abs(delta) < Math.abs(bestXDelta))) {
                bestXDelta = delta;
                bestXGuide = target;
            }
        });
        movingY.forEach((value, anchorIndex) => {
            const target = targetsY[anchorIndex];
            const delta = target - value;
            if (Math.abs(delta) <= threshold && (bestYDelta === undefined || Math.abs(delta) < Math.abs(bestYDelta))) {
                bestYDelta = delta;
                bestYGuide = target;
            }
        });
    });
    return {
        offset: { x: rawOffset.x + (bestXDelta || 0), y: rawOffset.y + (bestYDelta || 0) },
        guides: { vertical: bestXGuide, horizontal: bestYGuide },
    };
}


export function isHiddenBatchChild(node: CanvasNodeData, nodes: CanvasNodeData[], collapsingBatchIds?: Set<string>) {
    const rootId = node.metadata?.batchRootId;
    if (!rootId) return false;
    const root = nodes.find((item) => item.id === rootId);
    if (root && collapsingBatchIds?.has(rootId)) return false;
    return Boolean(root && !root.metadata?.imageBatchExpanded);
}

export function sameStringSet(left: Set<string>, right: Set<string>) {
    if (left.size !== right.size) return false;
    for (const value of left) if (!right.has(value)) return false;
    return true;
}

export function sameNodeSemanticData(left: CanvasNodeData, right: CanvasNodeData) {
    return left.id === right.id && left.type === right.type && left.title === right.title && left.parentId === right.parentId && left.width === right.width && left.height === right.height && left.metadata === right.metadata;
}

export function removeCanvasNodes(nodes: CanvasNodeData[], requestedIds: Set<string>) {
    const removedIds = new Set(requestedIds);
    nodes.forEach((node) => {
        if (requestedIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => removedIds.add(childId));
    });
    const remainingNodes = nodes.filter((node) => !removedIds.has(node.id));
    const nextNodes = remainingNodes.map((node) => {
        const detached = node.parentId && removedIds.has(node.parentId) ? { ...node, parentId: undefined } : node;
        const storyboard = detached.metadata?.storyboard;
        const cleaned = storyboard
            ? {
                  ...detached,
                  metadata: {
                      ...detached.metadata,
                      storyboard: {
                          ...storyboard,
                          referenceNodeIds: storyboard.referenceNodeIds.filter((id) => !removedIds.has(id)),
                          rows: storyboard.rows.map((row) => ({
                              ...row,
                              referenceNodeIds: (row.referenceNodeIds || []).filter((id) => !removedIds.has(id)),
                              imageNodeId: row.imageNodeId && !removedIds.has(row.imageNodeId) ? row.imageNodeId : undefined,
                              videoNodeId: row.videoNodeId && !removedIds.has(row.videoNodeId) ? row.videoNodeId : undefined,
                          })),
                      },
                  },
              }
            : detached;
        const childIds = cleaned.metadata?.batchChildIds?.filter((childId) => !removedIds.has(childId));
        if (!cleaned.metadata?.isBatchRoot || childIds?.length === cleaned.metadata.batchChildIds?.length) return cleaned;
        const primaryImageId = childIds?.includes(cleaned.metadata.primaryImageId || "") ? cleaned.metadata.primaryImageId : childIds?.[0];
        const primaryNode = remainingNodes.find((item) => item.id === primaryImageId);
        return {
            ...cleaned,
            metadata: {
                ...cleaned.metadata,
                batchChildIds: childIds,
                primaryImageId,
                content: primaryNode?.metadata?.content || cleaned.metadata?.content,
                naturalWidth: primaryNode?.metadata?.naturalWidth || cleaned.metadata?.naturalWidth,
                naturalHeight: primaryNode?.metadata?.naturalHeight || cleaned.metadata?.naturalHeight,
            },
        };
    });
    return { removedIds, nodes: nextNodes };
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
