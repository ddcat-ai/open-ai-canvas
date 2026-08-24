import type { GenerationTask, TaskStatus } from "@/services/api/task-center";

export const statusLabel: Record<TaskStatus, string> = {
    queued: "排队中",
    running: "生成中",
    succeeded: "已完成",
    failed: "失败",
    cancelled: "已取消",
};

type GenerationTaskDisplayTarget = Pick<GenerationTask, "provider" | "status" | "stage" | "officialStatus"> & Partial<Pick<GenerationTask, "errorCode">>;

export function isGenerationTaskSubmissionUncertain(task: GenerationTaskDisplayTarget) {
    return task.provider === "dreamina-cli" && (task.stage === "submission_unknown" || task.errorCode === "dreamina_submission_unknown");
}

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return "提交结果待确认";
    if (task.provider === "dreamina-cli" && task.stage === "submitting") return "正在提交";
    if (task.provider === "dreamina-cli" && task.officialStatus === "pending") return "官方排队中";
    if (task.provider === "dreamina-cli" && task.officialStatus === "processing") return "生成中";
    if (task.provider === "dreamina-cli" && task.officialStatus === "completed") return "官方已完成";
    if (task.provider === "dreamina-cli" && task.status === "running" && task.stage === "submitted") return "状态待更新";
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return "为避免重复扣费，未自动重试";
    if (task.provider === "dreamina-cli" && task.stage === "submitting") return "正在提交，等待官方确认";
    if (task.provider === "dreamina-cli" && task.officialStatus) return `官方返回状态：${task.officialStatus}`;
    if (task.provider === "dreamina-cli" && task.status === "running" && task.stage === "submitted") return "已提交，等待状态更新";
    if (task.stage === "generating") return "生成中";
    if (task.stage === "queued") return "排队中";
    return task.stage || generationTaskStatusLabel(task);
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return false;
    return !(task.provider === "dreamina-cli" && task.status === "running" && (task.stage === "submitting" || task.stage === "submitted"));
}

export const operationOptions = [
    { label: "Agent 会话：拆解影视工作流", value: "agent_session" },
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
    agent_session: "Agent 会话",
    agent_storyboard: "Agent 分镜",
    agent_storyboard_rows: "分镜脚本",
    canvas_image: "画布生图",
    canvas_video: "画布视频",
    canvas_audio: "画布音频",
    canvas_text: "画布文本",
};

export function formatTaskKind(task: GenerationTask) {
    if (task.type === "agent_session" || task.operation === "agent_session") return "Agent 会话";

    const typeLabel = taskTypeLabel[task.type];
    const operationLabel = task.operation ? operationLabelByValue.get(task.operation) : "";

    if (task.type === "canvas_video" && operationLabel) return `${typeLabel || "画布视频"} · ${operationLabel}`;
    if (typeLabel) return typeLabel;
    if (operationLabel) return operationLabel;
    if (task.type.startsWith("video_")) return "视频任务";
    return "生成任务";
}
