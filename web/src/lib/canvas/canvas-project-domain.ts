import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { PromptTemplateOperation } from "@/lib/prompts";
import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import { normalizeStoryboardAssetBindings } from "@/lib/canvas/canvas-storyboard-assets";
import { bindingForConnectedNode, storyboardComposerContent, storyboardRowReferenceNodeIds } from "@/lib/canvas/canvas-storyboard-materializer";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { canvasNodeMentionToken, canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { batchReferenceHandleY } from "@/lib/canvas/canvas-batch-table";
import { reconcileImageBatchRoot } from "@/lib/canvas/canvas-image-batch-retry";
import { scopedLocalStorage } from "@/lib/user-scope";
import type { GenerationTask } from "@/services/api/task-center";
import { synchronizeGenerationSpec } from "@/lib/canvas/generation-contract";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type ConnectionHandle, type Position, type StoryboardColumn, type StoryboardRow } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const builtinSpec = type in NODE_DEFAULT_SIZE ? getNodeSpec(type as CanvasNodeType) : undefined;
    const pluginDefinition = getNodeDefinition(type);
    const spec = builtinSpec || (pluginDefinition ? { width: pluginDefinition.defaultSize.width, height: pluginDefinition.defaultSize.height, title: pluginDefinition.defaultTitle, metadata: pluginDefinition.defaultMetadata } : undefined);
    if (!spec) throw new Error(`未注册的画布节点类型：${type}`);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();

    return {
        id,
        type,
        title: spec.title,
        createdAt: now,
        updatedAt: now,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: type === CanvasNodeType.Script
            ? { ...spec.metadata, ...metadata, storyboard: metadata?.storyboard || { rows: [1, 2, 3].map((shotNumber) => createStoryboardRow(shotNumber)), visibleColumns: ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"], referenceNodeIds: [] } }
            : { ...spec.metadata, ...metadata, ...(type === CanvasNodeType.Drawing ? { drawingId: metadata?.drawingId || `${id}-document` } : {}) },
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
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [],
        status: "idle",
        ...patch,
    };
}

// 有结构化变量时由服务端按最新平台模板和用户偏好编译；变量被清除表示用户已做镜头级手动覆盖。
export function storyboardPromptTemplateMetadata(row: StoryboardRow, kind: "image" | "video"): Pick<CanvasNodeMetadata, "promptTemplateOperation" | "promptTemplateVariables"> {
    const variables = kind === "image" ? row.imagePromptTemplateVariables : row.videoPromptTemplateVariables;
    return variables
        ? { promptTemplateOperation: kind === "image" ? PromptTemplateOperation.StoryboardFirstFrame : PromptTemplateOperation.StoryboardVideo, promptTemplateVariables: variables }
        : { promptTemplateOperation: undefined, promptTemplateVariables: undefined };
}

export function cinematicStoryboardColumns(columns?: StoryboardColumn[]): StoryboardColumn[] {
    return Array.from(new Set([
        "shotNumber",
        "durationSeconds",
        "videoMotionPrompt",
        "dialogue",
        "assets",
        ...(columns || []),
        "shotSize",
        "narrativeIntent",
        "viewerPOV",
        "performanceBlocking",
        "camera",
        "motion",
        "timeBeats",
        "lightingAndAtmosphere",
        "continuityOut",
        "negativePrompt",
    ])) as StoryboardColumn[];
}

// 分镜文本任务的模型侧输出契约，字段与 storyboardRowsFromTask 的解析结构一一对应。
// 后端只有带 metadata.promptTemplateOperation 的任务才会编译服务端分镜模板（含 JSON 契约），
// 章节分镜走的是自定义 prompt，缺这段约束时模型会按自然语言习惯返回 Markdown 表格，解析阶段拿不到 rows。
export function storyboardRowsOutputContract(requirement: string) {
    return [
        "【受保护输出契约】",
        "- 只返回一个 JSON 对象，不要 Markdown、表格、代码块、注释或任何解释文字。",
        `- 顶层固定为 {"title": string, "rows": object[]}，rows 至少 1 项。${requirement}`,
        "- rows 每项对应一个镜头，按剧情顺序排列；字段缺失时填空字符串或空数组，不要省略字段：",
        "  shotNumber（整数，从 1 递增）、durationSeconds（整数，1-60）、plotDescription（本镜可见的剧情与关键动作）、",
        "  dialogue（本镜实际念出的台词或简短旁白，超长必须拆镜）、characters（本镜出现的角色名数组）、",
        "  narrativeIntent、viewerPOV、performanceBlocking、shotSize（景别）、emotion、lightingAndAtmosphere、",
        "  audioEffects、camera、motion、timeBeats、imageGenerationPrompt（首帧画面提示词）、",
        "  videoMotionPrompt（运镜与结尾状态）、continuityOut、negativePrompt、",
        "  mustHave（数组，最多 3 项）、optionalDetails（数组）。",
        "- 镜头数量以完整覆盖剧情因果、人物关系和关键台词为准，不要为压缩数量删减关键情节。",
    ].join("\n");
}

// 文本任务的 result_json 外层是 {mode, reasoning, text} 包装，分镜表在 text 字段的内层 JSON 字符串里；
// 历史模板路径可能直接落 {title, rows}。两种结构都要能解析，内层再做代码块剥离与首尾大括号截取兜底，
// 模型偶发违反契约（包 ```json 或混入解释文字）时仍能取出分镜表。
function parseStoryboardRowsPayload(raw: string): { title?: string; rows?: Array<Partial<StoryboardRow>> } {
    const parsed = JSON.parse(raw) as { title?: string; rows?: Array<Partial<StoryboardRow>>; text?: unknown };
    if (Array.isArray(parsed.rows)) return parsed;
    if (typeof parsed.text === "string" && parsed.text.trim()) {
        const inner = parsed.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
        const start = inner.indexOf("{");
        const end = inner.lastIndexOf("}");
        if (start >= 0 && end > start) {
            try {
                const innerParsed = JSON.parse(inner.slice(start, end + 1)) as { title?: string; rows?: Array<Partial<StoryboardRow>> };
                if (Array.isArray(innerParsed.rows)) return innerParsed;
            } catch {
                // 内层不是合法 JSON 时落到外层结构，由调用方的缺行校验统一报错。
            }
        }
    }
    if (parsed.text && typeof parsed.text === "object") {
        try {
            const nested = parseStoryboardRowsPayload(JSON.stringify(parsed.text));
            if (Array.isArray(nested.rows)) return nested;
        } catch {
            // 对象形式的 text 不是分镜载荷时，交由统一缺行校验报错。
        }
    }
    return parsed;
}

function normalizeStoryboardText(value: unknown): string {
    if (typeof value === "string") return value;
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) return value.map(normalizeStoryboardText).filter(Boolean).join("、");
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    for (const key of ["text", "content", "value", "description", "name"]) {
        if (!(key in record)) continue;
        const nested = normalizeStoryboardText(record[key]);
        if (nested) return nested;
    }
    return "";
}

function normalizeStoryboardRow(row: Partial<StoryboardRow>): Partial<StoryboardRow> {
    return {
        ...row,
        plotDescription: normalizeStoryboardText(row.plotDescription),
        dialogue: normalizeStoryboardText(row.dialogue),
        narrativeIntent: normalizeStoryboardText(row.narrativeIntent),
        viewerPOV: normalizeStoryboardText(row.viewerPOV),
        performanceBlocking: normalizeStoryboardText(row.performanceBlocking),
        shotSize: normalizeStoryboardText(row.shotSize),
        emotion: normalizeStoryboardText(row.emotion),
        lightingAndAtmosphere: normalizeStoryboardText(row.lightingAndAtmosphere),
        audioEffects: normalizeStoryboardText(row.audioEffects),
        camera: normalizeStoryboardText(row.camera),
        motion: normalizeStoryboardText(row.motion),
        timeBeats: normalizeStoryboardText(row.timeBeats),
        imageGenerationPrompt: normalizeStoryboardText(row.imageGenerationPrompt),
        videoMotionPrompt: normalizeStoryboardText(row.videoMotionPrompt),
        continuityOut: normalizeStoryboardText(row.continuityOut),
        negativePrompt: normalizeStoryboardText(row.negativePrompt),
    };
}

export function storyboardRowsFromTask(task: GenerationTask) {
    const result = parseStoryboardRowsPayload(task.resultJson || "{}");
    if (!Array.isArray(result.rows) || !result.rows.length) throw new Error("分镜任务没有返回镜头行");
    return {
        // 旧任务和部分模型会把 title 返回成对象/数组；恢复路径必须只接受字符串，
        // 否则可选链只能防 undefined，仍会在对象上调用 trim 使整页恢复失败。
        title: typeof result.title === "string" ? result.title.trim() : undefined,
        rows: result.rows.map((row, index) => {
            const source = row && typeof row === "object" ? row : {};
            const next = createStoryboardRow(index + 1, {
                ...normalizeStoryboardRow(source),
                id: `shot-${Date.now()}-${index + 1}-${Math.random().toString(36).slice(2, 6)}`,
                shotNumber: index + 1,
                status: "idle",
                assetBindings: normalizeStoryboardAssetBindings(Array.isArray(source.assetBindings) ? source.assetBindings : undefined),
            });
            next.characters = Array.isArray(source.characters) ? source.characters : [];
            next.mustHave = Array.isArray(source.mustHave) ? source.mustHave : [];
            next.optionalDetails = Array.isArray(source.optionalDetails) ? source.optionalDetails : [];
            return next;
        }),
    };
}


// 模型切换时必须清理的节点级生成参数：这些参数属于旧模型的能力档位（分辨率/宽高比/质量等），
// 新模型不支持时若残留，会在 buildNodeConfig 的「节点优先、全局兜底」合并中反复叠加（issue #254）。
const NODE_MODEL_GENERATION_PARAMS: ReadonlyArray<keyof CanvasNodeMetadata> = [
    "size",
    "quality",
    "transparentBackground",
    "count",
    "seconds",
    "vquality",
    "generateAudio",
    "watermark",
    "audioVoice",
    "audioFormat",
    "audioSpeed",
    "audioInstructions",
];

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata>) {
    const safePatch = patch || {};
    const nextPatch = resetGenerationParamsOnModelSwitch(node, safePatch);
    const next = synchronizeGenerationSpec(node, nextPatch);
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}

// 切换模型（不同模型标识）时，节点级生成参数必须随旧模型一起失效，回落全局配置；
// 显式传入的同批 patch（如用户同时调整了参数）仍然优先。
function resetGenerationParamsOnModelSwitch(node: CanvasNodeData, patch: Partial<CanvasNodeMetadata>): Partial<CanvasNodeMetadata> {
    if (typeof patch.model !== "string" || patch.model === node.metadata?.model) {
        return patch;
    }
    const reset: Partial<CanvasNodeMetadata> = {};
    for (const key of NODE_MODEL_GENERATION_PARAMS) {
        reset[key] = undefined;
    }
    return { ...reset, ...patch };
}

/**
 * 连线落到目标节点上的吸附点。单端口一侧取边的正中——与 connectionHandleY 保持同一个
 * 口径，否则吸附点和实际画出来的线会对不上（这两处是同一规则的两份实现，改一处必错）。
 */
export function getConnectionTargetAnchor(node: CanvasNodeData, current: ConnectionHandle, handleId?: string, scrollTop = 0) {
    return {
        x: current.handleType === "source" ? node.position.x : node.position.x + node.width,
        y: batchReferenceHandleY(node, handleId) ?? storyboardHandleY(node, handleId, scrollTop) ?? node.position.y + node.height / 2,
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
    const videoComposerContent = row ? storyboardComposerContent(videoPrompt, storyboardRowReferenceNodeIds(scriptNode, row, nodes, [], false), nodes) : "";

    return nodes.map((node) => {
        if (row && node.id === linkedNode.id && scriptNodeId === connection.fromNodeId && node.type === CanvasNodeType.Video) {
            return { ...node, title: `镜头 ${row.shotNumber} · 视频`, metadata: { ...node.metadata, prompt: videoPrompt, composerContent: videoComposerContent, ...storyboardPromptTemplateMetadata(row, "video"), workflowKind: "shot" as const, workflowTitle: `镜头 ${row.shotNumber} 视频`, shotIndex: row.shotNumber, generationMode: "video" as const, videoEditOperation: node.metadata?.videoEditOperation || "text_to_video", seconds: String(row.durationSeconds) } };
        }
        if (node.id !== scriptNodeId || node.type !== CanvasNodeType.Script) return node;
        const storyboard = node.metadata?.storyboard;
        const binding = bindingForConnectedNode(linkedNode);
        return {
            ...node,
            metadata: {
                ...node.metadata,
                storyboard: {
                    rows: (storyboard?.rows || []).map((item) => item.id !== rowId ? item : scriptNodeId === connection.fromNodeId
                        ? { ...item, imageNodeId: linkedNode.type === CanvasNodeType.Image ? linkedNode.id : item.imageNodeId, videoNodeId: linkedNode.type === CanvasNodeType.Video ? linkedNode.id : item.videoNodeId }
                        : binding && !(item.assetBindings || []).some((candidate) => candidate.nodeId === linkedNode.id)
                          ? { ...item, assetBindings: [...(item.assetBindings || []), binding] }
                          : item),
                    visibleColumns: storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
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
        const replacement = `【项目设定：${reference.title}】\n${reference.text!.trim()}`;
        for (const token of [canvasResourceMentionToken(reference), `@${reference.label}`, reference.nodeId ? canvasNodeMentionToken(reference.nodeId) : ""]) {
            if (!token) continue;
            if (expanded.includes(token)) expanded = expanded.split(token).join(replacement);
        }
    });
    return expanded;
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
        characterCount: inputs.filter((input) => input.type === "character").length,
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

export function applyBatchPrimaryImage(root: CanvasNodeData, primary: CanvasNodeData): CanvasNodeData {
    // 主图是根节点对媒体的完整代理；可选字段也必须显式覆盖，避免残留上一张图的存储身份。
    return {
        ...root,
        width: primary.width,
        height: primary.height,
        metadata: {
            ...root.metadata,
            primaryImageId: primary.id,
            content: primary.metadata?.content,
            storageKey: primary.metadata?.storageKey,
            status: primary.metadata?.status,
            naturalWidth: primary.metadata?.naturalWidth,
            naturalHeight: primary.metadata?.naturalHeight,
            bytes: primary.metadata?.bytes,
            mimeType: primary.metadata?.mimeType,
            errorDetails: primary.metadata?.errorDetails,
            generationErrorCode: primary.metadata?.generationErrorCode,
            failedPromptFingerprint: primary.metadata?.failedPromptFingerprint,
            freeResize: primary.metadata?.freeResize,
        },
    };
}

export function removeCanvasNodes(nodes: CanvasNodeData[], requestedIds: Set<string>) {
    const removedIds = new Set(requestedIds);
    nodes.forEach((node) => {
        if (requestedIds.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => removedIds.add(childId));
    });
    const remainingNodes = nodes.filter((node) => !removedIds.has(node.id));
    const cleanedNodes = remainingNodes.map((node) => {
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
                              assetBindings: (row.assetBindings || []).filter((binding) => !removedIds.has(binding.nodeId)),
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
        const batchRoot = { ...cleaned, metadata: { ...cleaned.metadata, batchChildIds: childIds, primaryImageId } };
        return primaryNode ? applyBatchPrimaryImage(batchRoot, primaryNode) : batchRoot;
    });
    const nextNodes = cleanedNodes.map((node) => reconcileImageBatchRoot(node, cleanedNodes));
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
