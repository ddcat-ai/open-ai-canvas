import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ChevronDown, ChevronUp, Clock3, Coins, ListTodo, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { formatCredits } from "@/constant/credits";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { formatTaskKind, statusLabel } from "@/lib/generation-task-display";
import { canvasThemes } from "@/lib/canvas-theme";
import type { GenerationTask } from "@/services/api/task-center";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export function CanvasActiveTaskPanel({ tasks, align = "right" }: { tasks: GenerationTask[]; align?: "left" | "right" }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const reducedMotion = useReducedMotion();
    const [now, setNow] = useState(() => Date.now());
    const [open, setOpen] = useState(false);
    const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);

    useEffect(() => {
        if (!tasks.length) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1_000);
        return () => window.clearInterval(timer);
    }, [tasks.length]);

    useEffect(() => {
        if (expandedTaskId && !tasks.some((task) => task.id === expandedTaskId)) setExpandedTaskId(null);
    }, [expandedTaskId, tasks]);

    if (!tasks.length) return null;

    const motionTransition = reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel;

    return (
        <AnimatePresence initial={false}>
            <motion.div
                key="canvas-active-task-panel"
                data-canvas-no-zoom
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={motionTransition}
                className={`pointer-events-none absolute top-3 z-[var(--z-panel-floating)] w-[var(--canvas-panel-width)] ${align === "left" ? "left-3" : "right-3"}`}
            >
                <LayoutGroup id="canvas-active-tasks">
                    <motion.section
                        layout
                        className="pointer-events-auto overflow-hidden rounded-[var(--panel-radius)] border backdrop-blur-2xl"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 24px 72px ${theme.spatial.shadow}` }}
                        aria-label="当前画布生成任务"
                    >
                        <motion.button
                            type="button"
                            layout
                            className="flex min-h-12 w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]"
                            onClick={() => setOpen((value) => !value)}
                            aria-expanded={open}
                            aria-controls="canvas-active-task-list"
                        >
                            <span className="flex min-w-0 items-center gap-2">
                                <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)]" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                    <ListTodo className="size-4" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-semibold leading-5">生成任务</span>
                                    <span className="block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }} aria-live="polite">当前画布 · {tasks.length} 个进行中</span>
                                </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2" style={{ color: theme.accent.primary }}>
                                <LoaderCircle className="size-4 animate-spin opacity-70 motion-reduce:animate-none" />
                                {open ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                            </span>
                        </motion.button>

                        <AnimatePresence initial={false}>
                            {open ? (
                                <motion.div
                                    id="canvas-active-task-list"
                                    layout
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={motionTransition}
                                    className="thin-scrollbar max-h-[min(70vh,520px)] space-y-2 overflow-y-auto px-2.5 pb-2.5"
                                >
                                    {tasks.map((task) => (
                                        <ActiveTaskCard
                                            key={task.id}
                                            task={task}
                                            now={now}
                                            theme={theme}
                                            expanded={expandedTaskId === task.id}
                                            onToggle={() => setExpandedTaskId((current) => current === task.id ? null : task.id)}
                                            reducedMotion={Boolean(reducedMotion)}
                                            creditsEnabled={creditsEnabled}
                                        />
                                    ))}
                                </motion.div>
                            ) : null}
                        </AnimatePresence>
                    </motion.section>
                </LayoutGroup>
            </motion.div>
        </AnimatePresence>
    );
}

function ActiveTaskCard({ task, now, theme, expanded, onToggle, reducedMotion, creditsEnabled }: { task: GenerationTask; now: number; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; expanded: boolean; onToggle: () => void; reducedMotion: boolean; creditsEnabled: boolean }) {
    const progress = typeof task.progress === "number" ? Math.max(0, Math.min(100, Math.round(task.progress))) : task.status === "queued" ? 0 : undefined;
    const startedAt = task.startedAt || task.createdAt;
    const elapsedMs = Math.max(0, now - parseTime(startedAt));
    const durationLabel = `${task.status === "queued" ? "已等待" : "已运行"} ${formatDuration(elapsedMs)}`;
    const billingLabel = task.billing ? `冻结 ${formatCredits(task.billing.amountMicrocredits)} 积分` : "未计费";
    const statusTone = task.status === "running" ? theme.accent.primary : theme.node.muted;
    const transition = reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel;

    return (
        <motion.article
            layout
            layoutId={`canvas-active-task-${task.id}`}
            className="overflow-hidden rounded-xl border"
            style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}
        >
            <button type="button" className="block w-full p-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px]" onClick={onToggle} aria-expanded={expanded}>
                <div className="flex min-w-0 items-start gap-2">
                    <motion.span layout="position" className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-md" style={{ background: `${statusTone}18`, color: statusTone }}>
                        <ListTodo className="size-3.5" />
                    </motion.span>
                    <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold" title={formatTaskKind(task)}>{formatTaskKind(task)}</span>
                            <span className="shrink-0 rounded-full border px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium" style={{ borderColor: `${statusTone}44`, color: statusTone }}>{statusLabel[task.status]}</span>
                        </span>
                        <span className="mt-1 block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }} title={task.stage || statusLabel[task.status]}>{task.stage || statusLabel[task.status]}</span>
                    </span>
                    {expanded ? <ChevronUp className="mt-0.5 size-3.5 shrink-0" style={{ color: theme.node.muted }} /> : <ChevronDown className="mt-0.5 size-3.5 shrink-0" style={{ color: theme.node.muted }} />}
                </div>

                <div className="mt-3 h-1.5 overflow-hidden rounded-full" style={{ background: theme.toolbar.itemHover }}>
                    {progress !== undefined ? (
                        <motion.div
                            className="relative h-full rounded-full overflow-hidden"
                            animate={{ width: `${progress}%` }}
                            transition={reducedMotion ? { duration: 0 } : { duration: 0.3, ease: "easeOut" }}
                            style={{ background: statusTone }}
                        >
                            {/* 进度条 shimmer 扫描动画（对应 #98 决策3）*/}
                            {task.status === "running" && !reducedMotion ? (
                                <span
                                    className="absolute inset-0 canvas-task-progress-shimmer"
                                    style={{ background: "linear-gradient(90deg, transparent, rgba(255,255,255,.3), transparent)" }}
                                    aria-hidden
                                />
                            ) : null}
                        </motion.div>
                    ) : (
                        // indeterminate 模式（无具体百分比，从左到右循环扫描）
                        <motion.div
                            className="h-full rounded-full"
                            initial={{ width: "20%", x: "-100%" }}
                            animate={{ width: "20%", x: "400%" }}
                            transition={reducedMotion ? { duration: 0 } : { duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                            style={{ background: statusTone }}
                        />
                    )}
                </div>

                {/* 进度百分比显示（对应 #98 决策3：列表视图）*/}
                {progress !== undefined && task.status === "running" ? (
                    <div className="mt-1 flex items-center justify-between text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                        <span>{durationLabel}</span>
                        <span className="font-medium tabular-nums" style={{ color: statusTone }}>{progress}%</span>
                    </div>
                ) : (
                    <div className={`mt-3 grid gap-2 text-[var(--fs-tiny)] ${creditsEnabled ? "grid-cols-2" : "grid-cols-1"}`} style={{ color: theme.node.muted }}>
                        <span className="inline-flex min-w-0 items-center gap-1 truncate" title={durationLabel}><Clock3 className="size-3 shrink-0" />{durationLabel}</span>
                        {creditsEnabled ? <span className="inline-flex min-w-0 items-center justify-end gap-1 truncate" title={billingLabel}><Coins className="size-3 shrink-0" />{billingLabel}</span> : null}
                    </div>
                )}
            </button>

            <AnimatePresence initial={false}>
                {expanded ? (
                    <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={transition}
                        className="border-t px-3 pb-3 pt-2 text-[var(--fs-label)]"
                        style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}
                    >
                        <div className="flex items-center justify-between gap-2">
                            <span>当前阶段</span>
                            <span className="max-w-[200px] truncate text-right" style={{ color: theme.node.text }}>{task.stage || statusLabel[task.status]}</span>
                        </div>
                    </motion.div>
                ) : null}
            </AnimatePresence>
        </motion.article>
    );
}

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
