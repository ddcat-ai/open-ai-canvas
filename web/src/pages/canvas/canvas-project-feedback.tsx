import { translate } from "@/i18n";
import { useTranslation } from "react-i18next";
import { motion } from "motion/react";
import { CheckCircle2, CloudUpload, Eye, LoaderCircle, RotateCcw, TriangleAlert, X } from "lucide-react";

import type { GenerationTask } from "@/services/api/task-center";
import type { MergeVideoProgress } from "@/lib/canvas/canvas-video-merge";
import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasOperationChange } from "./use-canvas-operation-history";
import { aceternityMotion } from "@/lib/aceternity-motion";

export type CanvasUploadStatus = {
    id: number;
    title: string;
    detail: string;
    step: number;
    total: number;
    done?: boolean;
    error?: boolean;
};

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export function CanvasUploadStatusToast({ status, theme }: { status: CanvasUploadStatus; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const accent = status.error ? theme.accent.danger : status.done ? "#22c55e" : theme.node.activeStroke;
    return (
        <motion.div
            data-canvas-no-zoom
            aria-live="polite"
            initial={{ opacity: 0, x: 22, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={aceternityMotion.spring.panel}
            className="pointer-events-none absolute right-4 top-20 z-[var(--z-panel-floating)] w-[var(--panel-width-compact)] overflow-hidden rounded-[var(--panel-radius-wide-tight)] border px-4 py-4 backdrop-blur-2xl"
            style={{
                background: theme.spatial.elevated,
                borderColor: status.error ? `${theme.accent.danger}66` : status.done ? "rgba(34,197,94,.4)" : theme.spatial.glowStrong,
                color: theme.node.text,
                boxShadow: `0 24px 72px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.14)`,
            }}
        >
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
            <div className="flex items-start gap-3">
                <motion.span
                    animate={status.done || status.error ? { scale: [0.8, 1.08, 1] } : { y: [0, -2, 0] }}
                    transition={status.done || status.error ? { duration: aceternityMotion.duration.panel } : { duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
                    className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[var(--dock-radius)] border"
                    style={{ background: theme.spatial.surface, borderColor: `${accent}44`, color: accent }}
                >
                    {status.error ? <TriangleAlert className="size-4" /> : status.done ? <CheckCircle2 className="size-4" /> : <CloudUpload className="size-4" />}
                </motion.span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{status.title}</span>
                    <span className="mt-1 block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {status.detail}
                    </span>
                </span>
                <span className="shrink-0 rounded-full border px-2 py-1 text-[var(--fs-tiny)] font-semibold tabular-nums" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                    {status.step}/{status.total}
                </span>
            </div>
            <div className="mt-4 flex items-center gap-2">
                {Array.from({ length: status.total }, (_, index) => (
                    <motion.span
                        key={index}
                        animate={{ opacity: index < status.step ? 1 : 0.24, scaleX: index < status.step ? 1 : 0.88 }}
                        className="h-1.5 min-w-0 flex-1 rounded-full"
                        style={{ background: index < status.step ? accent : theme.toolbar.itemHover, transformOrigin: "left" }}
                    />
                ))}
            </div>
            <span className="sr-only">{t("canvasPage.feedback.processingStep", { step: status.step, total: status.total })}</span>
        </motion.div>
    );
}

export function TaskDetailItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[var(--fs-tiny)] opacity-50">{label}</div>
            <div className="mt-1 truncate text-xs font-medium" title={value}>
                {value}
            </div>
        </div>
    );
}

export function CanvasMergeStatusToast({ progress, theme }: { progress: MergeVideoProgress; theme: CanvasTheme }) {
    const { t } = useTranslation();
    const detail = progress.phase === "loading" ? t("canvasPage.feedback.mergeLoading") : progress.phase === "reading" ? t("canvasPage.feedback.mergeReading") : t("canvasPage.feedback.mergeEncoding");
    const percent = Math.max(0, Math.min(100, Math.round(progress.progress)));
    return (
        <div
            data-canvas-no-zoom
            aria-live="polite"
            className="pointer-events-none absolute right-4 top-[164px] z-[var(--z-panel-floating)] w-[292px] overflow-hidden rounded-2xl border px-3 py-3 shadow-lg backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
        >
            <div className="flex items-start gap-2">
                <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-xl" style={{ background: theme.toolbar.itemHover, color: theme.node.activeStroke }}>
                    <LoaderCircle className="size-4 animate-spin" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">{t("canvasPage.mediaTools.mergeFinalTitle")}</span>
                    <span className="mt-0.5 block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {detail}
                    </span>
                </span>
                <span className="shrink-0 text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.faint }}>
                    {percent}%
                </span>
            </div>
            <div className="mt-2 h-1 overflow-hidden rounded-full" style={{ background: theme.toolbar.itemHover }}>
                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${percent}%`, background: theme.node.activeStroke }} />
            </div>
        </div>
    );
}

export function CanvasOperationChangeToast({ change, theme, onView, onUndo, onClose }: { change: CanvasOperationChange; theme: CanvasTheme; onView: () => void; onUndo: () => void; onClose: () => void }) {
    const { t } = useTranslation();
    return (
        <div
            data-canvas-no-zoom
            aria-live="polite"
            className="absolute bottom-20 right-4 z-[var(--z-panel-floating)] w-[var(--panel-width-compact)] rounded-lg border p-3 shadow-lg backdrop-blur-xl"
            style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
        >
            <div className="flex items-start gap-2">
                <span className="grid size-8 shrink-0 place-items-center rounded-md" style={{ background: theme.toolbar.itemHover, color: theme.node.activeStroke }}>
                    <span className="size-2 rounded-full bg-current" />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold">{t("canvasPage.feedback.agentWroteBack")}</span>
                    <span className="mt-0.5 block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {t("canvasPage.feedback.undoSummary", { summary: change.summary, count: change.undoCount })}
                    </span>
                </span>
                <button type="button" className="grid size-7 place-items-center rounded-md opacity-55 transition hover:opacity-100" onClick={onClose} aria-label={t("common.close")}>
                    <X className="size-3.5" />
                </button>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2">
                {change.nodeIds.length ? (
                    <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onView}>
                        <Eye className="size-3.5" />
                        {t("canvasPage.feedback.viewChanges")}
                    </button>
                ) : null}
                <button type="button" className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onUndo}>
                    <RotateCcw className="size-3.5" />
                    {t("canvasPage.feedback.undoChanges")}
                </button>
            </div>
        </div>
    );
}

export function taskStatusText(status: GenerationTask["status"]) {
    if (status === "queued") return translate("canvasPage.taskStatus.queued");
    if (status === "running") return translate("canvasPage.taskStatus.running");
    if (status === "succeeded") return translate("canvasPage.taskStatus.succeeded");
    if (status === "failed") return translate("canvasPage.taskStatus.failed");
    return translate("canvasPage.taskStatus.canceled");
}
