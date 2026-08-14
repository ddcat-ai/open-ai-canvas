export type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";

export type TaskStats = { today: number; active: number; succeeded: number; failed: number };

export function TaskStatPills({ stats, statusFilter, onFilterChange }: { stats: TaskStats; statusFilter: TaskStatusFilter; onFilterChange: (value: TaskStatusFilter) => void }) {
    return (
        <div className="task-stat-pills">
            <span className="task-stat-pill">
                <span className="task-stat-dot" />
                今日生成<b>{stats.today}</b>
            </span>
            <button type="button" aria-pressed={statusFilter === "active"} className={`task-stat-pill is-clickable${statusFilter === "active" ? " is-active-filter" : ""}`} onClick={() => onFilterChange(statusFilter === "active" ? "all" : "active")}>
                <span className="task-stat-dot is-run" />
                运行中<b>{stats.active}</b>
            </button>
            <button
                type="button"
                aria-pressed={statusFilter === "succeeded"}
                className={`task-stat-pill is-clickable${statusFilter === "succeeded" ? " is-active-filter" : ""}`}
                onClick={() => onFilterChange(statusFilter === "succeeded" ? "all" : "succeeded")}
            >
                <span className="task-stat-dot is-ok" />
                已完成<b>{stats.succeeded}</b>
            </button>
            <button
                type="button"
                aria-pressed={statusFilter === "failed"}
                className={`task-stat-pill is-clickable is-fail${statusFilter === "failed" ? " is-active-filter" : ""}`}
                onClick={() => onFilterChange(statusFilter === "failed" ? "all" : "failed")}
            >
                <span className="task-stat-dot is-bad" />
                失败<b>{stats.failed}</b>
            </button>
        </div>
    );
}
