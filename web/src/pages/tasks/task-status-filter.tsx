import { Segmented } from "antd";
import { useTranslation } from "react-i18next";

export type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";

export type TaskStats = { total: number; today: number; active: number; succeeded: number; failed: number };

export function TaskStatusFilterBar({ stats, value, onChange }: { stats: TaskStats; value: TaskStatusFilter; onChange: (value: TaskStatusFilter) => void }) {
    const { t } = useTranslation("canvas");
    const options = [
        { value: "all", label: t("tasks:all"), count: stats.total },
        { value: "active", label: t("tasks:running-2"), count: stats.active },
        { value: "succeeded", label: t("tasks:done-2"), count: stats.succeeded },
        { value: "failed", label: t("tasks:failed-cancelled"), count: stats.failed },
    ] satisfies Array<{ value: TaskStatusFilter; label: string; count: number }>;

    return (
        <div className="task-status-filter">
            <span className="task-status-today">
                {t("tasks:generated-today")} <strong>{stats.today}</strong>
            </span>
            <Segmented<TaskStatusFilter>
                size="small"
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
