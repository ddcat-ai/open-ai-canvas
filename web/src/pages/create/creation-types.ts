import type { GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import type { CreationAttachment, CreationMode } from "./creation-assets";
import type { CreationReference } from "./creation-references";

export type { CreationMode };

export type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
export type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string };
export type CreationRetryContext = GenerationRetryContext & { retryContextsByBatchIndex?: GenerationRetryContext[] };

export type CreationMessage = {
    id: string;
    role: "user" | "assistant";
    mode?: CreationMode;
    content: string;
    reasoning?: string;
    createdAt: string;
    status?: CreationStatus;
    model?: string;
    resultUrls?: string[];
    error?: string;
    generationErrorCode?: string;
    generationOperation?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
    clientOperationId?: string;
    retryOf?: string;
    attemptGroupId?: string;
    generationStage?: string;
    generationEffectKeys?: string[];
};
export type CreationConversation = { id: string; title: string; updatedAt: string; canvasId?: string; messages: CreationMessage[] };

export const modeLabels: Record<CreationMode, string> = { text: "文本", image: "图片", video: "视频" };
export const defaultCreationMode: CreationMode = "image";
export const shotScriptLabels: Record<CreationMode, string> = { text: "创作思路", image: "画面指令", video: "镜头脚本" };
export const ratioOptions = [
    { value: "1:1", label: "方形" },
    { value: "16:9", label: "横屏" },
    { value: "9:16", label: "竖屏" },
    { value: "4:3", label: "标准横屏" },
    { value: "3:4", label: "标准竖屏" },
    { value: "21:9", label: "宽银幕" },
];
export const qualityOptions = [
    { value: "auto", label: "自动", description: "由模型决定" },
    { value: "low", label: "低", description: "更快生成" },
    { value: "medium", label: "中", description: "均衡模式" },
    { value: "high", label: "高", description: "优先细节" },
    // grok2api / xAI Imagine：quality 映射 resolution
    { value: "1k", label: "1K", description: "标准清晰度" },
    { value: "2k", label: "2K", description: "更高清晰度" },
];
export const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
export const countOptions = ["1", "2", "3", "4"];
export const conversationTimeFormatter = new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const messageTimeFormatter = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });

export const historyDayFormatter = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" });

export type CreationShotRailEntry = { key: string; ordinal: number; user: CreationMessage; result?: CreationMessage };
