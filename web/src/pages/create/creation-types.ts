import type { GenerationRetryContext } from "@/lib/canvas/canvas-project-generation";
import { formatVideoResolutionLabel as videoResolutionLabel, VIDEO_RESOLUTION_OPTIONS } from "@/lib/video-generation-options";
import type { CreationAttachment, CreationMode } from "./creation-assets";
import type { CreationReference } from "./creation-references";
import type { SmartCreationAgentPlan } from "@/lib/plugins/plugin-types";
import type { AgentApproval, AgentRun } from "@/services/api/agent";
import type { AgentContextUsage } from "@/lib/canvas/agent-context-usage";

export type { CreationMode };

export type CreationStatus = "streaming" | "pending" | "done" | "error" | "cancelled";
export type CreationSettings = { ratio: string; seconds: string; quality: string; videoQuality: string; count: string };
export type CreationRetryContext = GenerationRetryContext & { retryContextsByBatchIndex?: GenerationRetryContext[] };
export type CreationAgentQuestion = {
    question: string;
    kind: "choice" | "form";
    options: Array<{ label: string; detail?: string }>;
    fields?: Array<{ title: string; required?: boolean; options?: Array<{ label: string; detail?: string }>; placeholder?: string }>;
    allowFreeform?: boolean;
    round?: number;
    maxRounds?: number;
};

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
    /** 与结果对齐的下载文件名（不含扩展名），保留方案序号与场景简称。 */
    resultDownloadNames?: string[];
    error?: string;
    generationErrorCode?: string;
    generationOperation?: string;
    attachments?: CreationAttachment[];
    references?: CreationReference[];
    settings?: CreationSettings;
    taskIds?: string[];
    clientOperationId?: string;
    agentIdempotencyKey?: string;
    retryOf?: string;
    attemptGroupId?: string;
    generationStage?: string;
    generationEffectKeys?: string[];
    agentPlan?: SmartCreationAgentPlan;
    agentRunId?: string;
    commerceItemId?: string;
    agentQuestion?: CreationAgentQuestion;
    commercePlan?: CreationCommercePlan;
    /** A smart or multi-output image batch rendered as one conversation result. */
    batchId?: string;
    batchTotal?: number;
    batchCompletedCount?: number;
    batchFailedCount?: number;
};
export type CreationAgentPlanItem = { id: string; title: string; status: "pending" | "doing" | "done"; type?: string; targetCopy?: string; zhReviewCopy?: string; specs?: Record<string, unknown> };
export type CreationCommercePlan = {
    planVersion: string; planId: string; version: number; planHash?: string; intent: string; platform: string; site: string; language: string;
    productFacts: Array<{ id: string; claim: string; sourceIds: string[]; status?: "supported" | "inferred" | "unknown" }>;
    items: Array<{ id: string; type: string; purpose: string; title: string; prompt: string; targetCopy: string; zhReviewCopy: string; language?: string; factIds?: string[]; attachmentResourceIds: string[]; specs?: Record<string, unknown>; dependencies?: string[]; design?: { role: string; layout: string; focalPoint: string; composition: string; typography: string; palette: string } }>;
    styleBible?: string; assumptions?: string[]; conflicts?: string[]; languageVariants?: string[];
    styleLock?: { fontFamily: string; typography: string; headingColor: string; bodyColor: string; accentColor: string; backgroundColor: string; iconStyle: string };
    references?: Array<{ resourceId: string; name: string; role: string; kind?: string; index?: number; usage?: string; selection?: string }>;
    skills?: Array<{ id: string; name: string }>;
    estimatedCredits?: number; estimateStatus?: "quoted" | "unavailable"; maxCredits?: number;
};
export type CreationConversation = { id: string; title: string; updatedAt: string; canvasId?: string; composerMode?: CreationMode; messages: CreationMessage[]; agentSessionId?: string; agentRunId?: string; agentRuns?: AgentRun[]; agentApproval?: AgentApproval; agentPlanItems?: CreationAgentPlanItem[]; agentCommercePlan?: CreationCommercePlan; agentContextUsage?: AgentContextUsage };

export const modeLabels: Record<CreationMode, string> = { agent: "Agent", text: "文本", image: "图片", video: "视频" };
export const defaultCreationMode: CreationMode = "agent";
export const creationComposerModeOptions = [
    { key: "agent", label: "Agent", description: "对话与规划" },
    { key: "image", label: "图片", description: "生成图片" },
    { key: "video", label: "视频", description: "生成视频" },
] as const;
export function creationModelCapability(mode: CreationMode) { return mode === "agent" ? "text" : mode; }
export const shotScriptLabels: Record<CreationMode, string> = { agent: "创作思路", text: "创作思路", image: "画面指令", video: "镜头脚本" };
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
    { value: "xhigh", label: "超高", description: "更高细节" },
    { value: "max", label: "最高", description: "最高质量" },
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
