import { FolderKanban, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { GenerationTask } from "@/services/api/task-center";
import { isTaskActive, isTaskFailed, isTaskRetryBlocked } from "./task-shared";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const { t } = useTranslation();
    const succeeded = group.tasks.filter((task) => task.status === "succeeded").length;
    const active = group.tasks.filter(isTaskActive).length;
    const failed = group.tasks.filter((task) => isTaskFailed(task) && !isTaskRetryBlocked(task)).length;
    const parts = [
        active ? { key: "active", text: t("library.tasks.group.active", { count: active }) } : null,
        failed ? { key: "failed", text: t("library.tasks.group.failed", { count: failed }), bad: true } : null,
        succeeded ? { key: "succeeded", text: t("library.tasks.group.succeeded", { count: succeeded }) } : null,
    ].filter((part): part is { key: string; text: string; bad?: boolean } => Boolean(part));
    return (
        <div className="task-center-group-head">
            <span className="task-center-group-icon" aria-hidden="true">
                <FolderKanban />
            </span>
            <div className="task-center-group-copy">
                <strong>{group.projectName ? `${group.title} · ${group.projectName}` : group.title}</strong>
                <span>{t("library.tasks.group.summary", { total: group.tasks.length, succeeded })}</span>
            </div>
            <span className="task-center-group-summary">
                {parts.length
                    ? parts.map((part) => (
                          <span key={part.key} data-bad={part.bad || undefined}>
                              {part.text}
                          </span>
                      ))
                    : t("library.tasks.group.empty")}
            </span>
            {failed ? (
                <button type="button" className="task-center-group-retry" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} aria-hidden="true" />
                    {retrying ? t("library.tasks.group.retrying") : t("library.tasks.group.retryFailed")}
                </button>
            ) : null}
        </div>
    );
}
