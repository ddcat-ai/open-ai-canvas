import { ListChecks, RefreshCw } from "lucide-react";

import { useTranslation } from "react-i18next";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { currentLocale } from "@/i18n";
import type { GenerationTask } from "@/services/api/task-center";
import { TaskListItem } from "./canvas-workspace-task-list-item";

// 任务面板：展示用户直接发起的生成任务；云端 Agent 内部任务由历史面板承载。
export function CanvasWorkspaceTaskPanel({ tasks, refreshing, onRefresh, onCancelTask }: { tasks: GenerationTask[]; refreshing?: boolean; onRefresh?: () => void; onCancelTask?: (task: GenerationTask) => void }) {
    const { t } = useTranslation();
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2">
                <ListChecks className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">{t("canvasC.workspaceTasks.title")}</span>
                <span className="tabular-nums text-foreground/32">{tasks.length.toLocaleString(currentLocale())}</span>
                <span className="ml-auto">
                    <button type="button" className="icon-btn tip-down" data-tip={t("common.refresh")} aria-label={t("common.refresh")} onClick={onRefresh}>
                        <RefreshCw className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} />
                    </button>
                </span>
            </header>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {tasks.length ? (
                    <div className="space-y-0.5">
                        {tasks.map((task) => (
                            <TaskListItem key={task.id} task={task} onCancelTask={onCancelTask} />
                        ))}
                    </div>
                ) : (
                    <WorkspaceState icon="canvas" compact title={t("canvasC.workspaceTasks.emptyTitle")} description={t("canvasC.workspaceTasks.emptyDescription")} />
                )}
            </div>
        </>
    );
}
