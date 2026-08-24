import { t } from "@/i18n";
import { parseBackendGenerationResult } from "@/services/api/generation-task";
import type { GenerationTask } from "@/services/api/task-center";

export type RecoverableCreationTextMessage = {
    mode?: string;
    status?: string;
    content: string;
    error?: string;
    taskIds?: string[];
};

export type CreationTextTaskRecovery = {
    status: "done" | "error" | "cancelled";
    content: string;
    error?: string;
    taskIds: string[];
};

// 页面重载后只依赖后端任务终态恢复消息，不复用已经中断的浏览器请求。
export function recoverCreationTextTask(message: RecoverableCreationTextMessage, tasks: GenerationTask[]): CreationTextTaskRecovery | null {
    if (message.mode !== "text" || (message.status !== "streaming" && message.status !== "pending")) return null;

    const taskIds = new Set(message.taskIds || []);
    const matches = tasks.filter((task) => taskIds.has(task.id));
    if (!matches.length || matches.some((task) => task.status === "queued" || task.status === "running")) return null;

    const nextTaskIds = Array.from(new Set([...(message.taskIds || []), ...matches.map((task) => task.id)]));
    const succeeded = matches.find((task) => task.status === "succeeded");
    if (succeeded) {
        try {
            const text = parseBackendGenerationResult(succeeded).text;
            if (!text?.trim()) throw new Error(t("domain:backend-task-returned-no-text"));
            return { status: "done", content: text, error: undefined, taskIds: nextTaskIds };
        } catch (error) {
            return { status: "error", content: t("domain:generation-failed"), error: error instanceof Error ? error.message : t("domain:invalid-text-task-result-format"), taskIds: nextTaskIds };
        }
    }
    if (matches.every((task) => task.status === "cancelled")) {
        return { status: "cancelled", content: t("domain:stopped"), error: undefined, taskIds: nextTaskIds };
    }
    const failed = matches.find((task) => task.status === "failed");
    return { status: "error", content: t("domain:generation-failed"), error: failed?.error || t("domain:text-task-failed"), taskIds: nextTaskIds };
}
