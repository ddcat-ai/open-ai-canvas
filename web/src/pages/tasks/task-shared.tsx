import { Coins } from "lucide-react";

import { formatCredits } from "@/constant/credits";
import { t } from "@/i18n";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import type { GenerationTask, TaskStatus } from "@/services/api/task-center";
import { modelDisplayName, type AiConfig } from "@/stores/use-config-store";
import { formatLocale } from "@/lib/format-locale";
import { useTranslation } from "react-i18next";

export function getTaskCanvasContext(task: GenerationTask, canvasById: Map<string, { title: string; projectId?: string }>, projectNameById: Map<string, string>) {
    if (!task.projectId) return { canvasName: t("tasks:no-linked-canvas"), projectName: "" };
    const canvas = canvasById.get(task.projectId);
    if (canvas) return { canvasName: canvas.title || t("tasks:untitled-canvas"), projectName: canvas.projectId ? projectNameById.get(canvas.projectId) || "" : "" };
    const projectName = projectNameById.get(task.projectId);
    return projectName ? { canvasName: t("tasks:project-level-task"), projectName } : { canvasName: t("tasks:canvas-removed"), projectName: "" };
}

export function isTaskFailed(task: GenerationTask) {
    return task.status === "failed" || task.status === "cancelled";
}

export function taskAttentionReason(task: GenerationTask) {
    if (task.status === "cancelled") return providerCancelStatusLabel(task);
    if (task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)) return t("tasks:content-moderation-failed-revise-the-input-and-submit-a-new-task");
    if (task.error) return generationErrorMessage(task.error);
    return task.stage || t("tasks:generation-failed-open-details-for-the-reason");
}

export function providerCancelStatusLabel(task: GenerationTask) {
    if (task.providerCancelStatus === "requested") return t("tasks:upstream-cancellation-requested-awaiting-confirmation");
    if (task.providerCancelStatus === "confirmed") return t("tasks:upstream-confirmed-cancellation-credits-refunded");
    if (task.providerCancelStatus === "uncertain") {
        if (task.billing?.status === "settled") return t("tasks:upstream-could-not-cancel-cost-already-settled");
        if (task.billing?.status === "refunded") return t("tasks:upstream-cancellation-unconfirmed-credits-refunded");
        return task.providerCancelError || t("tasks:upstream-cancellation-could-not-be-confirmed-billing-under-review");
    }
    return task.billing?.status === "refunded" ? t("tasks:cancelled-before-calling-upstream-credits-refunded") : t("tasks:task-cancelled-you-can-resubmit-with-the-original-input");
}

export function statusDotClassName(status: TaskStatus) {
    if (status === "succeeded") return "task-record-dot is-success";
    if (status === "running") return "task-record-dot is-active is-pulsing";
    if (status === "queued") return "task-record-dot is-queued";
    if (status === "failed") return "task-record-dot is-failed";
    return "task-record-dot is-idle";
}

export function taskMediaKind(task: GenerationTask): "text" | "image" | "video" {
    const value = `${task.type} ${task.operation || ""}`.toLowerCase();
    if (value.includes("video") || value.includes(t("tasks:video"))) return "video";
    if (value.includes("image") || value.includes(t("tasks:image")) || value.includes(t("tasks:visuals"))) return "image";
    return "text";
}

export function TaskDate({ value }: { value?: string }) {
    if (!value) return <span className="text-xs text-foreground/38">-</span>;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return <span className="text-xs text-foreground/38">-</span>;
    const compact = `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${date.toLocaleTimeString(formatLocale(), { hourCycle: "h23", hour: "2-digit", minute: "2-digit" })}`;
    return (
        <time className="task-record-date-value" dateTime={date.toISOString()} title={date.toLocaleString()}>
            {compact}
        </time>
    );
}

export function TaskBilling({ billing }: { billing?: GenerationTask["billing"] }) {
    const { t } = useTranslation("canvas");
    if (!billing) return <span className="task-record-billing-empty text-xs text-foreground/30">-</span>;
    const amount = formatCredits(billing.amountMicrocredits);
    const note = billing.status === "settled" ? t("tasks:settled") : billing.status === "refunded" ? t("tasks:refunded") : billing.status === "uncertain" ? t("tasks:to-verify") : t("tasks:est");
    return (
        <div className={`task-record-billing ${billing.status === "uncertain" ? "is-uncertain" : ""}`} title={t("tasks:credits-param", { note: note })}>
            <Coins className="size-4" />
            <span>
                <strong>{amount}</strong>
                <small>{note}</small>
            </span>
        </div>
    );
}

export function formatModelName(config: AiConfig, task: GenerationTask) {
    const raw = (task.model || task.provider || "").trim();
    const model = raw.includes("::") ? raw.split("::").pop()?.trim() || raw : raw;

    if (!model) return t("tasks:workflows");
    if (model === "version-router") return t("tasks:version-comparison-workflow");
    if (model === "workflow-router") return t("tasks:workflow-routing");
    if (model === "internal-agent") return t("tasks:built-in-workflow");
    if (model === "openai-compatible") return t("tasks:openai-compatible-api");
    return modelDisplayName(config, raw);
}
