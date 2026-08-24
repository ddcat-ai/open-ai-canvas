import { FolderKanban, RotateCcw } from "lucide-react";

import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed } from "./task-shared";
import { useTranslation } from "react-i18next";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const { t } = useTranslation("canvas");
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
                    <span className="task-group-count">
                        {t("tasks:total")} {group.tasks.length} {t("tasks:items-done")} {succeeded}
                    </span>
                </div>
                <span className="task-group-sub">
                    {active ? (
                        <span>
                            {active} {t("tasks:running-2")}
                        </span>
                    ) : null}
                    {active && failed ? <span aria-hidden="true"> · </span> : null}
                    {failed ? (
                        <b className="is-bad">
                            {failed} {t("tasks:failed")}
                        </b>
                    ) : null}
                    {(active || failed) && succeeded ? <span aria-hidden="true"> · </span> : null}
                    {succeeded ? (
                        <span>
                            {succeeded} {t("tasks:done-2")}
                        </span>
                    ) : null}
                    {!active && !failed && !succeeded ? t("tasks:no-running-tasks-2") : null}
                </span>
            </div>
            {failed ? (
                <button type="button" className="task-group-reset" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} />
                    {retrying ? t("tasks:retrying") : t("tasks:retry-failed-tasks")}
                </button>
            ) : null}
        </div>
    );
}
