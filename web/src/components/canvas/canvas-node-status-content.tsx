// 画布节点的运行状态内容：生成中（含已耗时）、失败（重试/重新加载资源）与未知节点兜底。

import { type GenerationTask } from "@/services/api/task-center";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel, isGenerationTaskSubmissionUncertain } from "@/lib/generation-task-display";
import { AlertCircle, Clock3, Download, FileText, RefreshCw } from "lucide-react";
import { useSyncExternalStore } from "react";
import { idleTaskTickerSubscribe, subscribeTaskTicker, taskTickerSnapshot } from "@/lib/canvas/task-ticker";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import type { CanvasNodeContentProps } from "./canvas-node-content";

export function LoadingContent({ node, theme, onOpenTaskDetails }: Pick<CanvasNodeContentProps, "node" | "theme" | "onOpenTaskDetails">) {
    const taskId = node.metadata?.taskId;
    const displayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "running") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        mediaStage: node.metadata?.taskMediaStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode,
    };
    const submissionUncertain = Boolean(taskId) && isGenerationTaskSubmissionUncertain(displayTask);
    const showsProgress = Boolean(taskId) && generationTaskShowsProgress(displayTask);
    const progress = showsProgress && typeof node.metadata?.taskProgress === "number" ? Math.max(0, Math.min(100, Math.round(node.metadata.taskProgress))) : null;
    const statusLabel = taskId ? generationTaskStatusLabel(displayTask) : "等待任务状态";
    const stageLabel = taskId ? generationTaskStageLabel(displayTask) : "正在创建任务";
    const elapsed = useTaskElapsed(node.metadata?.taskCreatedAt);
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2.5 px-5 text-center" style={{ color: theme.node.activeStroke }}>
            {submissionUncertain ? <AlertCircle className="size-10" /> : <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />}
            <span className="text-[var(--fs-tiny)] font-semibold">{stageLabel}</span>
            {taskId ? (
                <div className="flex w-full max-w-[210px] flex-col items-center gap-1.5">
                    <div className="max-w-full truncate text-[var(--fs-label)] font-medium" style={{ color: theme.node.text }}>
                        {statusLabel}
                        {progress !== null ? ` · ${progress}%` : ""}
                    </div>
                    {progress !== null ? (
                        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: theme.node.stroke }}>
                            <div className="h-full rounded-full transition-[width]" style={{ width: `${progress}%`, background: theme.node.activeStroke }} />
                        </div>
                    ) : null}
                    <div className="max-w-full truncate text-[var(--fs-tiny)] tabular-nums" style={{ color: theme.node.muted }}>
                        <Clock3 className="mr-1 inline size-3" />
                        {elapsed} · {shortTaskId(taskId)}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1.5">
                        <button
                            type="button"
                            className="inline-flex h-7 items-center gap-1 rounded-[var(--r-sm)] px-2 text-[var(--fs-tiny)] font-medium transition-colors"
                            style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                onOpenTaskDetails?.(node);
                            }}
                        >
                            <FileText className="size-3" />
                            详情
                        </button>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

export function useTaskElapsed(createdAt?: string) {
    const now = useSyncExternalStore(createdAt ? subscribeTaskTicker : idleTaskTickerSubscribe, taskTickerSnapshot, taskTickerSnapshot);
    if (!createdAt) return "刚刚";
    const started = new Date(createdAt).getTime();
    if (!Number.isFinite(started)) return "刚刚";
    const seconds = Math.max(0, Math.floor((now - started) / 1000));
    if (seconds < 60) return `${seconds}秒`;
    const minutes = Math.floor(seconds / 60);
    return minutes < 60 ? `${minutes}分${seconds % 60}秒` : `${Math.floor(minutes / 60)}时${minutes % 60}分`;
}

export function shortTaskId(id: string) {
    if (id.length <= 20) return id;
    return `${id.slice(0, 14)}...${id.slice(-4)}`;
}

export function ErrorContent({ node, theme, onRetry, onReloadResource }: Pick<CanvasNodeContentProps, "node" | "theme" | "onRetry" | "onReloadResource">) {
    const moderationFailure = node.metadata?.generationErrorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(node.metadata?.errorDetails);
    const errorDisplayTask = {
        provider: node.metadata?.taskProvider,
        status: (node.metadata?.taskStatus || "failed") as GenerationTask["status"],
        stage: node.metadata?.taskStage,
        mediaStage: node.metadata?.taskMediaStage,
        officialStatus: node.metadata?.taskOfficialStatus,
        errorCode: node.metadata?.taskErrorCode,
    };
    const submissionUncertain = isGenerationTaskSubmissionUncertain(errorDisplayTask);
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5" style={{ color: submissionUncertain ? theme.node.text : theme.accent.danger }}>
                {submissionUncertain ? generationTaskStatusLabel(errorDisplayTask) : generationErrorMessage(node.metadata?.errorDetails)}
            </div>
            {submissionUncertain ? (
                <div className="rounded-[var(--r-sm)] px-3 py-2 text-[var(--fs-label)] leading-4" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    {generationTaskStageLabel(errorDisplayTask)}
                </div>
            ) : moderationFailure ? (
                <div className="rounded-[var(--r-sm)] px-3 py-2 text-[var(--fs-label)] leading-4" style={{ background: theme.toolbar.itemHover, color: theme.node.muted }}>
                    修改节点提示词后，可重新点击生成。
                </div>
            ) : node.metadata?.resourceReloadAvailable ? (
                <div className="flex flex-wrap justify-center gap-2">
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                        style={{ background: theme.accent.primary, color: theme.accent.onPrimary }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onReloadResource?.(node);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <Download className="size-3.5" />
                        重新加载资源
                    </button>
                    <button
                        type="button"
                        className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                        style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                        onClick={(event) => {
                            event.stopPropagation();
                            onRetry?.(node);
                        }}
                        onMouseDown={(event) => event.stopPropagation()}
                    >
                        <RefreshCw className="size-3.5" />
                        重新生成
                    </button>
                </div>
            ) : (
                <button
                    type="button"
                    className="inline-flex h-8 items-center gap-1.5 rounded-[var(--r-md)] px-3 text-xs font-medium transition-colors"
                    style={{ background: theme.toolbar.itemHover, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRetry?.(node);
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                >
                    <RefreshCw className="size-3.5" />
                    {node.metadata?.taskCanRecoverMedia ? "重试保存（不重新生成）" : node.metadata?.isBatchRoot ? "重新生成失败项" : "重新生成"}
                </button>
            )}
        </div>
    );
}

export function UnknownNodeContent({ theme }: Pick<CanvasNodeContentProps, "theme">) {
    return (
        <div className="flex h-full w-full items-center justify-center text-sm" style={{ color: theme.node.placeholder }}>
            未知节点
        </div>
    );
}
