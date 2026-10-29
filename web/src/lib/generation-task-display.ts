import type { GenerationTask, TaskStatus } from "@/services/api/task-center";

export const statusLabel: Record<TaskStatus, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

type GenerationTaskDisplayTarget = Pick<GenerationTask, "status" | "stage" | "mediaStage" | "progress" | "providerRequestId" | "providerCancelStatus">;

const cancellablePreSubmissionStages = new Set(["queued", "等待队列调度", "后端接管任务", "正在准备创作"]);

/**
 * 只有在第三方请求尚未提交时允许取消。
 *
 * 一旦拿到 providerRequestId、进入取消协调状态，或提交结果不确定，
 * 任务可能已经产生上游费用；所有画布入口必须共用这条规则，避免
 * 活动面板、详情弹窗和任务列表出现不一致。
 */
export function canCancelGenerationTask(task: GenerationTaskDisplayTarget) {
    if (task.status !== "queued" && task.status !== "running") return false;
    if (task.providerRequestId || task.providerCancelStatus || task.mediaStage) return false;
    const stage = (task.stage || "").trim().toLowerCase();
    // Unknown running stages are treated as already submitted. A provider may
    // return a custom stage name, and showing a cancel button in that state is
    // more dangerous than conservatively hiding it after billing may begin.
    if (!stage) return task.status === "queued";
    return cancellablePreSubmissionStages.has(stage);
}

export function mediaDeliverySummary(status: TaskStatus | undefined, stage: GenerationTask["mediaStage"]) {
    if (!stage) return "";
    if (stage === "completed") return "生成成功 · 文件保存成功 · 素材登记成功";
    const prefix = stage === "download" || stage === "checkpoint" ? "生成成功" : stage === "register" ? "生成成功 · 文件保存成功" : "生成成功 · 下载成功";
    const action = { download: "下载", upload: "上传 OSS", local_save: "保存文件", register: "登记素材", checkpoint: "记录恢复信息" }[stage];
    return `${prefix} · ${action}${status === "failed" ? "失败" : status === "cancelled" ? "已停止" : "待完成"}`;
}

export function isGenerationTaskSubmissionUncertain(task: GenerationTaskDisplayTarget) {
    return task.stage === "submission_unknown";
}

function generationTaskSaving(task: GenerationTaskDisplayTarget) {
    return Boolean(task.mediaStage && task.mediaStage !== "completed");
}

export type GenerationSavingState = "saving" | "retrying" | "waiting";

/**
 * 保存阶段的细分，取自后端写入的 stage：正常保存、失败后自动重试（作品已生成，保存遇到问题，正在自动恢复）、
 * 等待保存并发（作品已生成，等待保存）。重试必须让用户看得见，不能一律显示成“正在保存”。
 */
export function generationTaskSavingState(stage?: string): GenerationSavingState {
    if (stage?.includes("保存遇到问题")) return "retrying";
    if (stage?.includes("等待保存")) return "waiting";
    return "saving";
}

const savingStageLabels: Record<GenerationSavingState, string> = {
    saving: "已生成，正在存入素材库",
    retrying: "保存遇到问题，正在自动重试",
    waiting: "作品已生成，等待保存",
};

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    if (generationTaskSaving(task) && task.status === "failed") return "保存未完成";
    if (generationTaskSaving(task) && (task.status === "queued" || task.status === "running")) return "保存中";
    if (isGenerationTaskSubmissionUncertain(task)) return "提交结果待确认";
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return "为避免重复扣费，未自动重试";
    // 状态标签已表达“保存中”，这里补充保存的真实进展（正常保存 / 失败后自动重试 / 等待保存）。
    if (generationTaskSaving(task) && (task.status === "queued" || task.status === "running")) return savingStageLabels[generationTaskSavingState(task.stage)];
    switch (task.stage) {
        case "queued":
        case "等待队列调度":
        case "后端接管任务":
            return "正在准备创作";
        case "generating":
        case "submitted":
        case "调用生成模型":
        case "正在准备参考素材":
        case "正在连接上游":
        case "作品创作中":
        case "上游生成中":
        case "后台仍在生成":
        case "后台仍在生成图片":
            return "作品创作中";
        case "submitting":
            return "正在提交创作";
        case "等待上游任务同步":
            return "正在同步创作进度";
        case "作品已生成，正在保存":
            return task.status === "failed" ? "作品已生成，保存未完成" : "已生成，正在存入素材库";
        default:
            // 供应商自定义的英文阶段（如 provider_processing）对用户没有意义，按任务状态兜底。
            if (task.stage && /^[a-z0-9_.:-]+$/i.test(task.stage)) return task.status === "running" ? "作品创作中" : generationTaskStatusLabel(task);
            return task.stage || generationTaskStatusLabel(task);
    }
}

/**
 * 用户可见的生成阶段。画布节点和首页创作卡片共用同一套阶段与文案，
 * 不在各页面重复翻译后端 stage 字符串。只用于未结束的任务；失败和取消由各自的失败态展示。
 */
export type GenerationPhase = "submitting" | "queued" | "preparing" | "generating" | "saving" | "finalizing" | "uncertain";
export type GenerationMediaKind = "image" | "video" | "audio" | "text";

type GenerationPhaseTarget = { status?: string; stage?: string; mediaStage?: GenerationTask["mediaStage"] };

/** 三段进度依次对应：提交与排队、模型生成、保存到素材库。 */
export const GENERATION_PHASE_STEPS = ["排队", "生成", "保存"] as const;

const queuedPhaseStages = new Set(["queued", "等待队列调度"]);

/** 平台自己写入的阶段；除此之外的中文 stage 来自上游（例如拼车渠道的“候车 · 前面 3 条”）。 */
const platformStages = new Set([
    "queued",
    "等待队列调度",
    "后端接管任务",
    "正在准备创作",
    "正在准备参考素材",
    "正在准备生成任务",
    "正在创建任务",
    "正在连接上游",
    "submitting",
    "submitted",
    "generating",
    "调用生成模型",
    "作品创作中",
    "上游生成中",
    "后台仍在生成",
    "后台仍在生成图片",
    "等待上游任务同步",
    "作品已生成，正在保存",
    "submission_unknown",
]);

/** 按班次出片的渠道在发车前的排队阶段：这时上游给的百分比不是生成进度。 */
const upstreamQueuePattern = /候车|排队|等待发车|前面\s*\d+\s*条/;

/** 上游给出的可读阶段文案；平台内部阶段、英文代号返回空串。 */
export function upstreamGenerationStage(stage?: string) {
    const value = (stage || "").trim();
    if (!value || platformStages.has(value) || /^[a-z0-9_.:-]+$/i.test(value)) return "";
    return value;
}

function upstreamQueueStage(stage?: string) {
    const value = upstreamGenerationStage(stage);
    return Boolean(value) && upstreamQueuePattern.test(value);
}
const preparingPhaseStages = new Set(["后端接管任务", "正在准备创作", "正在准备参考素材", "正在连接上游", "submitting"]);
const generationKindNoun: Record<GenerationMediaKind, string> = { image: "图片", video: "视频", audio: "音频", text: "文本" };

export function generationTaskPhase(task: GenerationPhaseTarget | null | undefined): GenerationPhase {
    if (!task?.status) return "submitting";
    if (task.stage === "submission_unknown") return "uncertain";
    if (task.status === "succeeded") return "finalizing";
    if (task.mediaStage && task.mediaStage !== "completed") return "saving";
    const stage = task.stage || "";
    if (task.status === "queued" || queuedPhaseStages.has(stage) || upstreamQueueStage(stage)) return "queued";
    if (preparingPhaseStages.has(stage)) return "preparing";
    return "generating";
}

/** 当前所在步骤的下标；全部完成（正在载入结果）时等于步骤总数。 */
export function generationPhaseStep(phase: GenerationPhase) {
    switch (phase) {
        case "submitting":
        case "queued":
            return 0;
        case "preparing":
        case "generating":
        case "uncertain":
            return 1;
        case "saving":
            return 2;
        case "finalizing":
            return GENERATION_PHASE_STEPS.length;
    }
}

/** stage 用于细分保存阶段（正常保存 / 自动重试 / 等待保存）；排队与生成中有上游阶段文案时直接展示它。 */
export function generationPhaseLabel(phase: GenerationPhase, kind?: GenerationMediaKind, stage?: string) {
    const noun = kind ? generationKindNoun[kind] : "作品";
    switch (phase) {
        case "submitting":
            return "正在提交";
        case "queued":
            return upstreamGenerationStage(stage) || "排队中";
        case "preparing":
            return "准备生成";
        case "generating":
            return upstreamGenerationStage(stage) || `正在生成${noun}`;
        case "saving": {
            const saving = generationTaskSavingState(stage);
            return saving === "retrying" ? "保存遇到问题，正在重试" : saving === "waiting" ? "等待保存" : `正在保存${noun}`;
        }
        case "finalizing":
            return `正在载入${noun}`;
        case "uncertain":
            return "提交结果待确认";
    }
}

/** 只在能给用户新信息时返回提示，其余阶段返回空串，避免每个状态都堆一行套话。 */
export function generationPhaseHint(phase: GenerationPhase, kind?: GenerationMediaKind, stage?: string) {
    switch (phase) {
        case "queued":
            return "轮到后自动开始";
        case "generating":
            return kind === "video" ? "离开页面也会继续生成" : "";
        case "saving": {
            const saving = generationTaskSavingState(stage);
            return saving === "retrying" ? "作品已生成，正在自动重试保存，不会重新生成" : saving === "waiting" ? "作品已生成，轮到后自动保存" : "作品已生成，正在存入素材库";
        }
        case "uncertain":
            return "为避免重复扣费，未自动重试";
        default:
            return "";
    }
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    if (task.mediaStage && task.mediaStage !== "completed") return false;
    if (isGenerationTaskSubmissionUncertain(task)) return false;
    // 上游还在候车/排队：上游给的百分比不是生成进度，不展示。
    if (upstreamQueueStage(task.stage)) return false;
    // 排队、后端接管和连接供应商都没有真实百分比。只有上游状态响应
    // 已经写回任务后才显示进度，避免所有图片/视频长期停在同一个假数值。
    if (["queued", "等待队列调度", "后端接管任务", "正在准备参考素材", "正在连接上游", "调用生成模型", "作品创作中", "submitting", "submitted"].includes(task.stage || "")) return false;
    return typeof task.progress === "number" && task.progress > 0;
}

export const operationOptions = [
    { label: "文生视频", value: "text_to_video" },
    { label: "图生视频", value: "image_to_video" },
    { label: "全模态参考", value: "reference_to_video" },
    { label: "视频续写", value: "extend" },
    { label: "视频局部修改", value: "inpaint" },
    { label: "元素替换", value: "replace_element" },
    { label: "镜头/运镜调整", value: "camera_motion" },
    { label: "风格迁移", value: "style_transfer" },
    { label: "参考音频生成视频", value: "audio_to_video" },
    { label: "结果版本对比", value: "compare_versions" },
];

export const operationLabelByValue = new Map(operationOptions.map((item) => [item.value, item.label]));

export const taskTypeLabel: Record<string, string> = {
    canvas_image: "画布生图",
    canvas_video: "画布视频",
    canvas_audio: "画布音频",
    canvas_text: "画布文本",
};

export function formatTaskKind(task: GenerationTask) {
    const typeLabel = taskTypeLabel[task.type];
    const operationLabel = task.operation ? operationLabelByValue.get(task.operation) : "";

    if (task.type === "canvas_video" && operationLabel) return `${typeLabel || "画布视频"} · ${operationLabel}`;
    if (typeLabel) return typeLabel;
    if (operationLabel) return operationLabel;
    if (task.type.startsWith("video_")) return "视频任务";
    return "生成任务";
}
