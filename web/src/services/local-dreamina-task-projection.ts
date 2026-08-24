import { t } from "@/i18n";
import type { GenerationTask } from "@/services/api/task-center";
import { DREAMINA_SUBMIT_ERROR_MESSAGES } from "@/lib/generation-error";
import {
    LOCAL_DREAMINA_FAILED_OR_CANCELLED_MESSAGE,
    LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_CODE,
    LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_MESSAGE,
    LOCAL_DREAMINA_WAIT_STOPPED_CODE,
    LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE,
    type LocalDreaminaGenerationTask,
} from "@/services/local-dreamina-generation";

export type LocalDreaminaTaskContext = Pick<GenerationTask, "prompt" | "type" | "attempts"> & Partial<Pick<GenerationTask, "projectId" | "startedAt">>;
export type LocalDreaminaActionTarget = Pick<GenerationTask, "id" | "status"> & Partial<Pick<GenerationTask, "provider" | "stage" | "receiptRecorded" | "errorCode" | "error">>;

export const LOCAL_DREAMINA_BACKGROUND_MESSAGE = t("domain:the-task-moved-to-the-background-official-status-will-keep-syncing");

export type LocalDreaminaDiagnosticLog = {
    level: "info" | "warn" | "error";
    stage: string;
    observedAt: string;
    provenance: "task_state" | "provider_observation" | "background_reconcile" | "manual_refresh";
    errorCode?: string;
};

export function projectLocalDreaminaDiagnosticLog(input: Record<string, unknown>): LocalDreaminaDiagnosticLog {
    const level = input.level === "warn" || input.level === "error" ? input.level : "info";
    const stage = typeof input.stage === "string" && /^[a-z][a-z0-9_]{1,80}$/.test(input.stage) ? input.stage : "unknown";
    const provenance = input.provenance === "provider_observation" || input.provenance === "background_reconcile" || input.provenance === "manual_refresh" ? input.provenance : "task_state";
    const observedAt = typeof input.observedAt === "string" && Number.isFinite(Date.parse(input.observedAt)) ? input.observedAt : new Date(0).toISOString();
    return {
        level,
        stage,
        ...(typeof input.errorCode === "string" && /^[a-z][a-z0-9_]{2,80}$/.test(input.errorCode) ? { errorCode: input.errorCode } : {}),
        provenance,
        observedAt,
    };
}

export function projectLocalDreaminaTask(task: LocalDreaminaGenerationTask, context?: LocalDreaminaTaskContext): GenerationTask {
    const status = projectedStatus(task);
    const terminal = task.lifecycle ? task.lifecycle === "TERMINAL" : status === "succeeded" || status === "failed" || status === "cancelled";
    const projectId = projectedProjectId(task, context);
    const localWaitStopped =
        task.errorCode === LOCAL_DREAMINA_WAIT_STOPPED_CODE &&
        !isLocalDreaminaBackgroundTask({
            id: localDreaminaTaskId(task.id),
            provider: "dreamina-cli",
            status,
            stage: task.stage,
            receiptRecorded: task.receiptRecorded,
        });
    const officialIncomplete = task.errorCode === LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_CODE;
    const failedOrCancelled = task.terminalOutcome === "FAILED_OR_CANCELLED";
    const submitFailure = task.errorCode ? DREAMINA_SUBMIT_ERROR_MESSAGES[task.errorCode] : undefined;
    const scopedContext = task.context?.scope === "scoped" ? task.context : undefined;
    const clientContext = scopedContext
        ? {
              ...(scopedContext.nodeId ? { nodeId: scopedContext.nodeId } : {}),
              ...(scopedContext.conversationId ? { conversationId: scopedContext.conversationId } : {}),
              ...(scopedContext.messageId ? { messageId: scopedContext.messageId } : {}),
              ...(scopedContext.batchIndex !== undefined ? { batchIndex: scopedContext.batchIndex } : {}),
              ...(scopedContext.batchCount !== undefined ? { batchCount: scopedContext.batchCount } : {}),
          }
        : undefined;
    return {
        id: localDreaminaTaskId(task.id),
        ...(task.clientOperationId ? { clientOperationId: task.clientOperationId } : {}),
        ...(scopedContext?.retryOf ? { retryOf: scopedContext.retryOf } : {}),
        ...(scopedContext?.attemptGroupId ? { attemptGroupId: scopedContext.attemptGroupId } : {}),
        ...(Object.keys(clientContext ?? {}).length ? { clientContext } : {}),
        ...(projectId ? { projectId } : {}),
        type: context?.type ?? `canvas_${task.mode}`,
        status,
        progress: task.progress,
        stage: task.stage,
        prompt: context?.prompt ?? "",
        operation: task.operation,
        provider: "dreamina-cli",
        model: `local:dreamina-cli:${task.model}`,
        errorCode: task.errorCode,
        officialStatus: task.officialStatus,
        receiptRecorded: task.receiptRecorded,
        ...(localWaitStopped
            ? {
                  error: LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE,
                  providerCancelStatus: "uncertain" as const,
                  providerCancelError: LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE,
              }
            : failedOrCancelled
              ? { error: LOCAL_DREAMINA_FAILED_OR_CANCELLED_MESSAGE }
              : task.officialStatus === "failed"
                ? { error: LOCAL_DREAMINA_FAILED_OR_CANCELLED_MESSAGE }
                : task.officialStatus === "cancelled"
                  ? { error: t("domain:official-status-cancelled") }
                  : officialIncomplete
                    ? { error: LOCAL_DREAMINA_OFFICIAL_INCOMPLETE_MESSAGE }
                    : submitFailure
                      ? { error: submitFailure }
                      : {}),
        ...(task.result ? { resultJson: JSON.stringify(task.result) } : {}),
        ...(task.resultState ? { resultState: task.resultState } : {}),
        ...(task.outputs ? { outputs: task.outputs.map((output) => ({ ...output })) } : {}),
        attempts: context?.attempts ?? 1,
        ...(context?.startedAt ? { startedAt: context.startedAt } : {}),
        ...(terminal ? { completedAt: task.updatedAt } : {}),
        createdAt: task.createdAt,
        updatedAt: task.updatedAt,
    };
}

function projectedStatus(task: LocalDreaminaGenerationTask): GenerationTask["status"] {
    if (!task.lifecycle) return task.status;
    if (task.lifecycle === "QUEUED_LOCAL") return "queued";
    if (task.lifecycle === "SUBMITTING" || task.lifecycle === "ACCEPTED" || task.lifecycle === "RUNNING") return "running";
    if (task.lifecycle === "SUBMISSION_UNCERTAIN") return "failed";
    if (task.terminalOutcome === "SUCCEEDED") return "succeeded";
    if (task.terminalOutcome === "CANCELLED") return "cancelled";
    return "failed";
}

function projectedProjectId(task: LocalDreaminaGenerationTask, context?: LocalDreaminaTaskContext) {
    if (!task.context) return context?.projectId;
    if (task.context.scope === "legacy_unscoped") return undefined;
    return task.context.projectId;
}

export function isLocalDreaminaWaitStopped(task: Pick<GenerationTask, "errorCode"> & Partial<Pick<GenerationTask, "provider">>) {
    return task.provider === "dreamina-cli" && task.errorCode === LOCAL_DREAMINA_WAIT_STOPPED_CODE;
}

export function isLocalDreaminaSubmissionUncertain(task: LocalDreaminaActionTarget) {
    return isLocalDreaminaTaskId(task.id) && task.receiptRecorded !== true && (task.stage === "submission_unknown" || task.errorCode === "dreamina_submission_unknown");
}

export function isLocalDreaminaBackgroundTask(task: LocalDreaminaActionTarget) {
    return isLocalDreaminaTaskId(task.id) && task.status === "running" && task.receiptRecorded === true;
}

export function localDreaminaCancellationMessage(task: LocalDreaminaActionTarget) {
    if (isLocalDreaminaSubmissionUncertain(task)) return task.error || t("domain:submission-result-pending-confirmation");
    if (isLocalDreaminaBackgroundTask(task)) return LOCAL_DREAMINA_BACKGROUND_MESSAGE;
    return isLocalDreaminaWaitStopped(task) ? LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE : task.error || t("domain:task-cancelled");
}

export function localDreaminaCancellationCopy(task: LocalDreaminaActionTarget) {
    if (!isLocalDreaminaTaskId(task.id) || isLocalDreaminaSubmissionUncertain(task)) return undefined;
    if (isLocalDreaminaBackgroundTask(task)) {
        return {
            kind: "background",
            action: t("domain:moved-to-background"),
            confirmation: t("domain:the-task-was-accepted-by-the-official-service-official-status-will-keep"),
        } as const;
    }
    return {
        kind: "cancel",
        action: t("domain:cancel-task"),
        confirmation: t("domain:the-task-has-not-been-submitted-officially-yet-it-is-safe-to-cancel-loca"),
    } as const;
}

export function localDreaminaDetachOutcome(task: LocalDreaminaActionTarget) {
    if (!isLocalDreaminaTaskId(task.id) || isLocalDreaminaSubmissionUncertain(task)) return undefined;
    if (isLocalDreaminaBackgroundTask(task)) {
        return {
            kind: "background",
            message: LOCAL_DREAMINA_BACKGROUND_MESSAGE,
            taskStatus: "running",
            creationStatus: "pending",
            canvasNodeStatus: "loading",
            batchItemStatus: "running",
        } as const;
    }
    return {
        kind: "cancel",
        message: isLocalDreaminaWaitStopped(task) ? LOCAL_DREAMINA_WAIT_STOPPED_MESSAGE : task.error || t("domain:task-cancelled"),
        taskStatus: task.status,
        creationStatus: "cancelled",
        canvasNodeStatus: "error",
        batchItemStatus: "cancelled",
    } as const;
}

export function localDreaminaTaskId(idempotencyKey: string) {
    return `dreamina:${stripLocalDreaminaTaskPrefix(idempotencyKey)}`;
}

export function stripLocalDreaminaTaskPrefix(taskId: string) {
    return taskId.startsWith("dreamina:") ? taskId.slice("dreamina:".length) : taskId;
}

export function isLocalDreaminaTaskId(taskId: string) {
    return /^dreamina:[A-Za-z0-9._:-]{16,120}$/.test(taskId);
}
