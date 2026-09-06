import { SegmentedControl } from "@/components/ui/base/segmented-control";

export type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";

export type TaskStats = { total: number; today: number; active: number; succeeded: number; failed: number };

export function TaskStatusFilterBar({ stats, value, onChange }: { stats: TaskStats; value: TaskStatusFilter; onChange: (value: TaskStatusFilter) => void }) {
    const options = [
        { value: "all", label: "全部", count: stats.total },
        { value: "active", label: "运行中", count: stats.active },
        { value: "succeeded", label: "已完成", count: stats.succeeded },
        { value: "failed", label: "失败/取消", count: stats.failed },
    ] satisfies Array<{ value: TaskStatusFilter; label: string; count: number }>;

    return (
        <div className="task-status-filter">
            <span className="task-status-today">今日生成 <strong>{stats.today}</strong></span>
            <SegmentedControl<TaskStatusFilter>
                size="sm"
                value={value}
                options={options.map((option) => ({
                    value: option.value,
                    label: (
                        <span>
                            {option.label}
                            <b>{option.count}</b>
                        </span>
                    ),
                }))}
                onChange={onChange}
            />
        </div>
    );
}
