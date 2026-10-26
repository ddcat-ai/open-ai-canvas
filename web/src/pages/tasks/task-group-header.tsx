import { FolderKanban, RotateCcw } from "lucide-react";

import type { GenerationTask } from "@/services/api/task-center";
import { canRetryTask } from "./task-shared";

export type TaskGroup = { key: string; title: string; projectName: string; tasks: GenerationTask[] };

export function TaskGroupHeader({ group, retrying = false, onRetryFailed }: { group: TaskGroup; retrying?: boolean; onRetryFailed: () => void }) {
    const succeeded = group.tasks.filter((task) => task.status === "succeeded").length;
    const active = group.tasks.filter((task) => task.status === "queued" || task.status === "running").length;
    const failed = group.tasks.filter(canRetryTask).length;
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
                        共 {group.tasks.length} 项 · 完成 {succeeded}
                    </span>
                </div>
                <span className="task-group-sub">
                    {active ? <span>{active} 运行中</span> : null}
                    {active && failed ? <span aria-hidden="true"> · </span> : null}
                    {failed ? <b className="is-bad">{failed} 失败</b> : null}
                    {(active || failed) && succeeded ? <span aria-hidden="true"> · </span> : null}
                    {succeeded ? <span>{succeeded} 已完成</span> : null}
                    {!active && !failed && !succeeded ? "暂无进行中的任务" : null}
                </span>
            </div>
            {failed ? (
                <button type="button" className="task-group-reset" disabled={retrying} onClick={onRetryFailed}>
                    <RotateCcw className={retrying ? "animate-spin" : undefined} />
                    {retrying ? "重试中..." : "重试失败任务"}
                </button>
            ) : null}
        </div>
    );
}
