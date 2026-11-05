import { useTranslation } from "react-i18next";
import { SegmentedControl } from "@/components/ui/base/segmented-control";

export type TaskStatusFilter = "all" | "failed" | "active" | "succeeded";

export type TaskStats = { total: number; today: number; active: number; succeeded: number; failed: number };

export function TaskStatusFilterBar({ stats, value, onChange }: { stats: TaskStats; value: TaskStatusFilter; onChange: (value: TaskStatusFilter) => void }) {
    const { t } = useTranslation();
    const options = [
        { value: "all", label: t("library.tasks.filter.all"), count: stats.total },
        { value: "active", label: t("library.tasks.filter.active"), count: stats.active },
        { value: "succeeded", label: t("library.tasks.filter.succeeded"), count: stats.succeeded },
        { value: "failed", label: t("library.tasks.filter.failed"), count: stats.failed },
    ] satisfies Array<{ value: TaskStatusFilter; label: string; count: number }>;

    return (
        <SegmentedControl<TaskStatusFilter>
            className="task-center-status-filter"
            ariaLabel={t("library.tasks.detail.status")}
            value={value}
            options={options.map((option) => ({
                value: option.value,
                label: (
                    <>
                        <span>{option.label}</span>
                        <span className="app-segmented-count" data-tone={option.value === "failed" && option.count > 0 ? "failed" : option.value === "active" && option.count > 0 ? "active" : undefined}>
                            {option.count}
                        </span>
                    </>
                ),
            }))}
            onChange={onChange}
        />
    );
}
