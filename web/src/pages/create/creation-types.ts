import type { GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import { imageQualityDescription, imageQualityLabel } from "@/lib/image-quality";
import type { CreationAttachment, CreationMode } from "./creation-assets";
import type { CreationReference } from "./creation-references";
import { currentLocale, translate } from "@/i18n";

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
    /** 当前会话内的临时访问地址；长期身份使用 resultStorageKeys。 */
    resultUrls?: string[];
    /** 生成结果对应的稳定素材定位符，不随 OSS 签名 URL 过期。 */
    resultStorageKeys?: string[];
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
    /** 最近一次观察到的任务状态、保存阶段与真实进度，只驱动生成中卡片的阶段展示，不作为业务结论。 */
    generationStatus?: TaskStatus;
    generationMediaStage?: GenerationTask["mediaStage"];
    generationProgress?: number;
    /** 页面与后端任务的连接暂时中断：任务没有被确认失败，恢复监听会继续跟进原任务。 */
    syncInterrupted?: boolean;
    /** sync：作品可能已生成，只是页面没拿到结果，应重新获取；task：后端确认任务失败。旧记录没有该字段。 */
    errorKind?: "sync" | "task";
    /** 后端确认失败，但作品已生成、可以重新保存（不重新生成、不重复扣费）。 */
    mediaRecoverable?: boolean;
    generationEffectKeys?: string[];
};
export type CreationConversation = { id: string; title: string; updatedAt: string; canvasId?: string; messages: CreationMessage[] };

export const modeLabels: Record<CreationMode, string> = {
    get text() { return translate("create.mode.text"); },
    get image() { return translate("create.mode.image"); },
    get video() { return translate("create.mode.video"); },
};
export const defaultCreationMode: CreationMode = "image";
export const shotScriptLabels: Record<CreationMode, string> = {
    get text() { return translate("create.shotScript.text"); },
    get image() { return translate("create.shotScript.image"); },
    get video() { return translate("create.shotScript.video"); },
};
export const ratioOptions = [
    { value: "1:1", get label() { return translate("create.ratio.square"); } },
    { value: "16:9", get label() { return translate("create.ratio.landscape"); } },
    { value: "9:16", get label() { return translate("create.ratio.portrait"); } },
    { value: "4:3", get label() { return translate("create.ratio.standardLandscape"); } },
    { value: "3:4", get label() { return translate("create.ratio.standardPortrait"); } },
    { value: "21:9", get label() { return translate("create.ratio.widescreen"); } },
];
export const qualityOptions = [
    ...["auto", "low", "medium", "high", "xhigh", "max", "1k", "2k", "4k"].map((value) => ({ value, label: imageQualityLabel(value), description: imageQualityDescription(value) })),
];
export const resolutionOptions = VIDEO_RESOLUTION_OPTIONS.map((value) => ({ value: String(value), label: videoResolutionLabel(value) }));
export const countOptions = ["1", "2", "3", "4"];
export const conversationTimeFormatter = new Intl.DateTimeFormat(currentLocale(), { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
export const messageTimeFormatter = new Intl.DateTimeFormat(currentLocale(), { hour: "2-digit", minute: "2-digit", hour12: false });

export const historyDayFormatter = new Intl.DateTimeFormat(currentLocale(), { month: "numeric", day: "numeric" });

export type CreationShotRailEntry = { key: string; ordinal: number; user: CreationMessage; result?: CreationMessage };
