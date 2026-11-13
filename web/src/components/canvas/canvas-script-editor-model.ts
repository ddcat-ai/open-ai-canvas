import { storyboardRowVideoPrompt } from "@/lib/canvas/canvas-project-domain";
import { CanvasNodeType, type CanvasNodeData, type StoryboardColumn, type StoryboardRow } from "@/types/canvas";

export const STORYBOARD_READING_COLUMNS: StoryboardColumn[] = ["shotNumber", "plotDescription", "dialogue", "assets"];
export const STORYBOARD_COLUMN_OPTIONS: Array<{ label: string; value: StoryboardColumn }> = [
    { label: "镜头", value: "shotNumber" },
    { label: "时长", value: "durationSeconds" },
    { label: "画面描述", value: "plotDescription" },
    { label: "台词/旁白", value: "dialogue" },
    { label: "镜头意图", value: "narrativeIntent" },
    { label: "观众视点", value: "viewerPOV" },
    { label: "表演调度", value: "performanceBlocking" },
    { label: "景别", value: "shotSize" },
    { label: "情绪", value: "emotion" },
    { label: "光影氛围", value: "lightingAndAtmosphere" },
    { label: "音效", value: "audioEffects" },
    { label: "镜头设计", value: "camera" },
    { label: "运镜", value: "motion" },
    { label: "时间节拍", value: "timeBeats" },
    { label: "图片提示词", value: "imageGenerationPrompt" },
    { label: "视频提示词", value: "videoMotionPrompt" },
    { label: "关联资产", value: "assets" },
    { label: "连续性出口", value: "continuityOut" },
    { label: "负面要求", value: "negativePrompt" },
];

export function storyboardReadingColumns(columns?: StoryboardColumn[]) {
    const previousDefaults: StoryboardColumn[][] = [
        ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"],
        ["shotNumber", "durationSeconds", "plotDescription", "dialogue"],
        ["shotNumber", "plotDescription", "videoMotionPrompt", "dialogue"],
    ];
    if (!columns?.length || previousDefaults.some((preset) => preset.length === columns.length && preset.every((column) => columns.includes(column)))) return STORYBOARD_READING_COLUMNS;
    return columns;
}

// 只计算本次可提交的缺失产物；任务创建、配额确认与去重仍由现有生成链路执行。
export function storyboardGenerationTargets(script: CanvasNodeData, rows: StoryboardRow[], nodes: CanvasNodeData[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const activeIds = new Set((script.metadata?.generationBatches || []).flatMap((batch) => batch.items.filter((item) => ["waiting", "submitting", "queued", "running"].includes(item.status)).map((item) => item.nodeId)));
    const latestItems = new Map((script.metadata?.generationBatches || []).flatMap((batch) => batch.items.map((item) => [item.nodeId, item] as const)));
    const uncertain = (id?: string) => Boolean(id && latestItems.get(id)?.status === "failed" && latestItems.get(id)?.costUncertain);
    const output = (id: string | undefined, type: CanvasNodeType) => {
        const node = id ? nodeById.get(id) : undefined;
        return node?.type === type ? node : undefined;
    };
    const available = (node?: CanvasNodeData) => !node?.metadata?.content && !node?.metadata?.storageKey && node?.metadata?.status !== "loading" && (!node || !activeIds.has(node.id));
    const keyframe = script.metadata?.storyboardVideoInputMode === "keyframe";
    const pendingImages = rows.filter((row) => (row.imageGenerationPrompt || row.plotDescription).trim() && available(output(row.imageNodeId, CanvasNodeType.Image)));
    const pendingVideos = rows.filter((row) => storyboardRowVideoPrompt(row) && available(output(row.videoNodeId, CanvasNodeType.Video)));
    const missingKeyframeCount = keyframe ? pendingVideos.filter((row) => !output(row.imageNodeId, CanvasNodeType.Image)?.metadata?.content).length : 0;
    const readyVideos = pendingVideos.filter((row) => !keyframe || Boolean(output(row.imageNodeId, CanvasNodeType.Image)?.metadata?.content));
    return {
        imageIds: pendingImages.filter((row) => !uncertain(row.imageNodeId)).map((row) => row.id),
        videoIds: readyVideos.filter((row) => !uncertain(row.videoNodeId)).map((row) => row.id),
        uncertainImageIds: pendingImages.filter((row) => uncertain(row.imageNodeId)).map((row) => row.id),
        uncertainVideoIds: readyVideos.filter((row) => uncertain(row.videoNodeId)).map((row) => row.id),
        missingKeyframeCount,
    };
}
