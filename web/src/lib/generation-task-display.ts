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

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    if (task.mediaStage && task.status === "failed") return "作品保存未完成";
    if (task.mediaStage && (task.status === "queued" || task.status === "running")) return "作品已生成，正在保存";
    if (isGenerationTaskSubmissionUncertain(task)) return "提交结果待确认";
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return "为避免重复扣费，未自动重试";
    switch (task.stage) {
        case "queued":
        case "等待队列调度":
        case "后端接管任务":
            return "正在准备创作";
        case "generating":
        case "调用生成模型":
        case "正在准备参考素材":
        case "正在连接上游":
        case "作品创作中":
        case "上游生成中":
        case "后台仍在生成":
            return "作品创作中";
        case "等待上游任务同步":
            return "正在同步创作进度";
        default:
            return task.stage || generationTaskStatusLabel(task);
    }
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    if (task.mediaStage && task.mediaStage !== "completed") return false;
    if (isGenerationTaskSubmissionUncertain(task)) return false;
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
