import { t } from "@/i18n";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";

export const statusLabel: Record<TaskStatus, string> = {
    queued: t("lib:queued"),
    running: t("lib:generating"),
    succeeded: t("lib:done"),
    failed: t("lib:failed"),
    cancelled: t("lib:cancelled"),
};

type GenerationTaskDisplayTarget = Pick<GenerationTask, "provider" | "status" | "stage" | "officialStatus"> & Partial<Pick<GenerationTask, "errorCode">>;

export function isGenerationTaskSubmissionUncertain(task: GenerationTaskDisplayTarget) {
    return task.provider === "dreamina-cli" && (task.stage === "submission_unknown" || task.errorCode === "dreamina_submission_unknown");
}

export function generationTaskStatusLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return t("lib:submission-result-pending-confirmation");
    if (task.provider === "dreamina-cli" && task.stage === "submitting") return t("lib:submitting");
    if (task.provider === "dreamina-cli" && task.officialStatus === "pending") return t("lib:queued-upstream");
    if (task.provider === "dreamina-cli" && task.officialStatus === "processing") return t("lib:generating");
    if (task.provider === "dreamina-cli" && task.officialStatus === "completed") return t("lib:finished-upstream");
    if (task.provider === "dreamina-cli" && task.status === "running" && task.stage === "submitted") return t("lib:status-pending-update");
    return statusLabel[task.status];
}

export function generationTaskStageLabel(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return t("lib:not-auto-retried-to-avoid-double-billing");
    if (task.provider === "dreamina-cli" && task.stage === "submitting") return t("lib:submitting-awaiting-provider-confirmation");
    if (task.provider === "dreamina-cli" && task.officialStatus) return t("lib:provider-status-param", { officialStatus: task.officialStatus });
    if (task.provider === "dreamina-cli" && task.status === "running" && task.stage === "submitted") return t("lib:submitted-waiting-for-status-update");
    if (task.stage === "generating") return t("lib:generating");
    if (task.stage === "queued") return t("lib:queued");
    return task.stage || generationTaskStatusLabel(task);
}

export function generationTaskShowsProgress(task: GenerationTaskDisplayTarget) {
    if (isGenerationTaskSubmissionUncertain(task)) return false;
    return !(task.provider === "dreamina-cli" && task.status === "running" && (task.stage === "submitting" || task.stage === "submitted"));
}

export const operationOptions = [
    { label: t("lib:agent-session-film-workflow-breakdown"), value: "agent_session" },
    { label: t("lib:text-to-video"), value: "text_to_video" },
    { label: t("lib:image-to-video"), value: "image_to_video" },
    { label: t("lib:video-extend"), value: "extend" },
    { label: t("lib:video-inpaint-edit"), value: "inpaint" },
    { label: t("lib:element-replace"), value: "replace_element" },
    { label: t("lib:shot-camera-adjust"), value: "camera_motion" },
    { label: t("lib:style-transfer"), value: "style_transfer" },
    { label: t("lib:audio-referenced-video-generation"), value: "audio_to_video" },
    { label: t("lib:result-version-compare"), value: "compare_versions" },
];

export const operationLabelByValue = new Map(operationOptions.map((item) => [item.value, item.label]));

export const taskTypeLabel: Record<string, string> = {
    agent_session: t("lib:agent-session"),
    agent_storyboard: t("lib:agent-storyboard"),
    agent_storyboard_rows: t("lib:storyboard"),
    canvas_image: t("lib:canvas-image-generation"),
    canvas_video: t("lib:canvas-videos"),
    canvas_audio: t("lib:canvas-audio"),
    canvas_text: t("lib:canvas-text"),
};

export function formatTaskKind(task: GenerationTask) {
    if (task.type === "agent_session" || task.operation === "agent_session") return t("lib:agent-session");

    const typeLabel = taskTypeLabel[task.type];
    const operationLabel = task.operation ? operationLabelByValue.get(task.operation) : "";

    if (task.type === "canvas_video" && operationLabel) return `${typeLabel || t("lib:canvas-videos")} · ${operationLabel}`;
    if (typeLabel) return typeLabel;
    if (operationLabel) return operationLabel;
    if (task.type.startsWith("video_")) return t("lib:video-task");
    return t("lib:generation-tasks");
}
