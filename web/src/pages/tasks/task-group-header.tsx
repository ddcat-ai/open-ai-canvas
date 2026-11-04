import { FolderKanban, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";

import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed } from "./task-shared";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const { t } = useTranslation();
    const succeeded = group.tasks.filter((task) => task.status === "succeeded").length;
    const active = group.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
    const failed = group.tasks.filter((task) => isTaskFailed(task) && task.errorCode !== CONTENT_MODERATION_ERROR_CODE && !isContentModerationError(task.error)).length;
    const title = group.projectName ? `${group.title} · ${group.projectName}` : group.title;
    return (
        <div className="task-group-head">
            <span className="task-group-ic">
                <FolderKanban />
            </span>
            <div className="min-w-0">
                <div className="task-group-name">
                    <span>{title}</span>
                    <span className="task-group-count">{t("library.tasks.group.summary", { total: group.tasks.length, succeeded })}</span>
                </div>
                <span className="task-group-sub">
                    {active ? <span>{t("library.tasks.group.active", { count: active })}</span> : null}
                    {active && failed ? <span aria-hidden="true"> · </span> : null}
                    {failed ? <b className="is-bad">{t("library.tasks.group.failed", { count: failed })}</b> : null}
                    {(active || failed) && succeeded ? <span aria-hidden="true"> · </span> : null}
                    {succeeded ? <span>{t("library.tasks.group.succeeded", { count: succeeded })}</span> : null}
                    {!active && !failed && !succeeded ? t("library.tasks.group.empty") : null}
                </span>
            </div>
            {failed ? (
                <button type="button" className="task-group-reset" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} />
                    {retrying ? t("library.tasks.group.retrying") : t("library.tasks.group.retryFailed")}
                </button>
            ) : null}
        </div>
    );
}
