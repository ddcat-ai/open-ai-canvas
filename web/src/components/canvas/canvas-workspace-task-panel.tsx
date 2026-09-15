import { memo, useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Clock3, Coins, ListChecks, LoaderCircle, MoreHorizontal, RefreshCw, XCircle } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { formatCredits } from "@/constant/credits";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { useUserStore } from "@/stores/use-user-store";

export function CanvasWorkspaceTaskPanel({ tasks, refreshing, onRefresh, onCancelTask }: {
    tasks: GenerationTask[];
    refreshing?: boolean;
    onRefresh?: () => void;
    onCancelTask?: (task: GenerationTask) => void;
}) {
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <ListChecks className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">任务</span>
                <span className="tabular-nums text-foreground/32">{tasks.length.toLocaleString("zh-CN")}</span>
                <span className="ml-auto">
                    <button type="button" className="icon-btn tip-down" data-tip="刷新" aria-label="刷新" onClick={onRefresh}>
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
                    <WorkspaceState icon="canvas" compact title="暂无任务" description="点击画布上的生成按钮开始创作。" />
                )}
            </div>
        </>
    );
}

const TaskListItem = memo(function TaskListItem({ task, onCancelTask }: { task: GenerationTask; onCancelTask?: (task: GenerationTask) => void }) {
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const [expanded, setExpanded] = useState(false);
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        if (task.status !== "queued" && task.status !== "running") return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [task.status]);

    const showsProgress = generationTaskShowsProgress(task);
    const progress = showsProgress && typeof task.progress === "number" ? Math.max(0, Math.min(100, Math.round(task.progress))) : undefined;
    const startedAt = task.startedAt || task.createdAt;
    const elapsedMs = Math.max(0, now - parseTime(startedAt));
    const durationLabel = `${task.status === "queued" ? "已等待" : "已运行"} ${formatDuration(elapsedMs)}`;
    const billingLabel = task.billing ? `冻结 ${formatCredits(task.billing.amountMicrocredits)} 积分` : "";
    const isActive = task.status === "queued" || task.status === "running";
    const statusColor = task.status === "running" ? "var(--primary)" : task.status === "succeeded" ? "var(--success, #16a34a)" : task.status === "failed" ? "var(--danger, #dc2626)" : "var(--foreground/40)";

    const menuItems: MenuProps["items"] = [
        ...(isActive && onCancelTask ? [{ key: "cancel", danger: true, icon: <XCircle className="size-3.5" />, label: "取消任务", onClick: () => onCancelTask(task) }] : []),
    ];

    return (
        <div
            className="group relative rounded-[var(--r-md)] px-2 py-1.5 text-left transition-[background-color] hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-primary/35"
            style={{ contentVisibility: "auto", containIntrinsicSize: "48px" }}
        >
            <button
                type="button"
                className="flex w-full min-w-0 items-start gap-2 text-left"
                onClick={() => setExpanded((value) => !value)}
                aria-expanded={expanded}
            >
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: `color-mix(in srgb, ${statusColor} 12%, transparent)`, color: statusColor }}>
                    {isActive ? <LoaderCircle className="size-3.5 animate-spin motion-reduce:animate-none" /> : task.status === "succeeded" ? <CheckCircle2 className="size-3.5" /> : task.status === "failed" ? <XCircle className="size-3.5" /> : <Clock3 className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium leading-4 text-foreground" title={formatTaskKind(task)}>{formatTaskKind(task)}</span>
                        <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-medium leading-none" style={{ borderColor: `color-mix(in srgb, ${statusColor} 30%, transparent)`, color: statusColor }}>
                            {generationTaskStatusLabel(task)}
                        </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] leading-3 text-foreground/45" title={generationTaskStageLabel(task)}>
                        {generationTaskStageLabel(task)}
                    </span>
                    {showsProgress && progress !== undefined && isActive ? (
                        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-foreground/10">
                            <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${progress}%`, background: statusColor }} />
                        </div>
                    ) : null}
                    <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-foreground/40">
                        <Clock3 className="size-2.5 shrink-0" />
                        <span className="truncate">{durationLabel}</span>
                        {creditsEnabled && billingLabel ? <span className="truncate">· {billingLabel}</span> : null}
                    </span>
                </span>
                {expanded ? <ChevronUp className="mt-0.5 size-3.5 shrink-0 text-foreground/40" /> : <ChevronDown className="mt-0.5 size-3.5 shrink-0 text-foreground/40" />}
            </button>

            {expanded ? (
                <div className="mt-1.5 border-t border-border/50 px-1 pt-1.5 text-[10px] leading-3 text-foreground/50">
                    <div className="flex items-center justify-between gap-2">
                        <span>当前阶段</span>
                        <span className="max-w-[200px] truncate text-right text-foreground/70">{generationTaskStageLabel(task)}</span>
                    </div>
                    {task.model ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                            <span>模型</span>
                            <span className="max-w-[200px] truncate text-right text-foreground/70">{task.model}</span>
                        </div>
                    ) : null}
                    {task.prompt ? (
                        <div className="mt-1">
                            <span className="block">提示词</span>
                            <span className="mt-0.5 block line-clamp-2 text-foreground/60">{task.prompt}</span>
                        </div>
                    ) : null}
                    {creditsEnabled && task.billing ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                            <span className="inline-flex items-center gap-1"><Coins className="size-2.5" />计费</span>
                            <span className="text-foreground/70">{billingLabel}</span>
                        </div>
                    ) : null}
                </div>
            ) : null}

            {menuItems.length > 0 ? (
                <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                    <button
                        type="button"
                        className="asset-more absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                        aria-label="更多操作"
                        title="更多"
                    >
                        <MoreHorizontal className="size-3.5" />
                    </button>
                </Dropdown>
            ) : null}
        </div>
    );
});

function parseTime(value?: string) {
    if (!value) return Date.now();
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : Date.now();
}

function formatDuration(value: number) {
    const totalSeconds = Math.floor(value / 1_000);
    const hours = Math.floor(totalSeconds / 3_600);
    const minutes = Math.floor((totalSeconds % 3_600) / 60);
    const seconds = totalSeconds % 60;
    return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
