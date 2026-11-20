import { Coins, FileText, Image as ImageIcon, Video, type LucideIcon } from "lucide-react";

import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { taskBillingDisplay, taskBillingLabel } from "@/lib/generation-task-billing";
import { generationTaskStatusLabel, mediaDeliverySummary } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { translate } from "@/i18n";

export function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>) {
    if (!task.projectId) return { canvasName: translate("library.tasks.shared.unboundCanvas"), projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || translate("library.tasks.shared.untitledCanvas"), projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: translate("library.tasks.shared.projectTask"), projectName } : { canvasName: translate("library.tasks.shared.canvasRemoved"), projectName: "" };
}

export function isTaskFailed(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

export function taskAttentionReason(task: GenerationTask) {
    if (task.status === "cancelled") return providerCancelStatusLabel(task);
    if (task.mediaStage) return mediaDeliverySummary(task.status, task.mediaStage);
    if (task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)) return translate("library.tasks.shared.moderationFailed");
    if (task.error) return generationErrorMessage(task.error);
    return task.stage || translate("library.tasks.shared.failedOpenDetail");
}

export function providerCancelStatusLabel(task: GenerationTask) {
    if (task.providerCancelStatus === "requested") return translate("library.tasks.cancel.requested");
    if (task.providerCancelStatus === "confirmed") return translate("library.tasks.cancel.confirmed");
    if (task.providerCancelStatus === "uncertain") {
        if (task.billing?.status === "settled") return translate("library.tasks.cancel.uncertainSettled");
        if (task.billing?.status === "refunded") return translate("library.tasks.cancel.uncertainRefunded");
        return task.providerCancelError || translate("library.tasks.cancel.uncertainPending");
    }
    return task.billing?.status === "refunded" ? translate("library.tasks.cancel.beforeUpstream") : translate("library.tasks.cancel.cancelled");
}

export function isTaskActive(task: GenerationTask) {
    return task.status === "queued" || task.status === "running";
}

/** 内容审核失败的任务按原输入重试仍会失败，界面上不提供自动重试。 */
export function isTaskRetryBlocked(task: GenerationTask) {
    return task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error);
}

export type TaskTone = "running" | "queued" | "success" | "failed" | "cancelled";

export function taskTone(task: GenerationTask): TaskTone {
    if (task.status === "running") return "running";
    if (task.status === "queued") return "queued";
    if (task.status === "succeeded") return "success";
    if (task.status === "cancelled") return "cancelled";
    return "failed";
}

/** 状态胶囊：圆点 + 文案，颜色由 data-tone 决定，运行中圆点会呼吸。 */
export function TaskStatusPill({ task, className = "" }: { task: GenerationTask; className?: string }) {
    return (
        <span className={`task-center-status ${className}`} data-tone={taskTone(task)}>
            <i aria-hidden="true" />
            {generationTaskStatusLabel(task)}
        </span>
    );
}

export function taskMediaKind(task: GenerationTask): "text" | "image" | "video" {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes("视频")) return "video";
    if (value.includes("image") || value.includes("图片") || value.includes("画面")) return "image";
    return "text";
}

export function taskKindIcon(task: GenerationTask): LucideIcon {
    const kind = taskMediaKind(task);
    return kind === "video" ? Video : kind === "image" ? ImageIcon : FileText;
}

export function TaskDate({ value }: { value?: string }) {
    if (!value || !Number.isFinite(Date.parse(value))) return <span className="task-center-muted">-</span>;
    return <RelativeTime value={value} />;
}

export function TaskBilling({ billing }: { billing?: GenerationTask["billing"] }) {
    if (!billing) return <span className="task-center-muted">-</span>;
    const display = taskBillingDisplay(billing);
    return (
        <span className="task-center-billing" data-tone={display.tone} title={taskBillingLabel(billing)}>
            <Coins aria-hidden="true" />
            <span>
                <strong>{display.amount}</strong>
                <small>{display.refundNote ? `${display.note} · ${display.refundNote}` : display.note}</small>
            </span>
        </span>
    );
}

export function formatModelName(config: AiConfig, task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    // 工作流名称是任务快照，不属于模型渠道，不能交给模型展示名解析器再次映射成“系统模型”。
    if (task.provider === "runninghub") return raw || translate("library.tasks.model.workflow");
    if (!model) return translate("library.tasks.model.workflow");
    if (model === "version-router") return translate("library.tasks.model.versionRouter");
    if (model === "workflow-router") return translate("library.tasks.model.workflowRouter");
    if (model === "internal-agent") return translate("library.tasks.model.internalAgent");
    if (model === "openai-compatible") return translate("library.tasks.model.openaiCompatible");
    return modelDisplayName(config, raw);
}
