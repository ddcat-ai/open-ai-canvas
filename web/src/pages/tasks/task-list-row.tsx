import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { ChevronRight, Eye, FolderKanban, Play, RotateCcw } from "lucide-react";
import { useState, type MouseEvent } from "react";

import { MediaPreview } from "@/components/media-preview";
import { generationErrorMessage } from "@/lib/generation-error";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { formatModelName, getTaskCanvasContext, isTaskActive, isTaskFailed, isTaskRetryBlocked, taskAttentionReason, TaskBilling, TaskDate, taskKindIcon, TaskStatusPill, taskTone } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";
import { progressFillStyle } from "@/lib/progress-fill";

/** 列表行：缩略图 / 标题与状态 / 时间 / 积分 / 操作。点行内空白处也能打开详情，键盘走标题按钮。 */
export function TaskListRow({
    task,
    canvasById,
    projectNameById,
    effectiveConfig,
    creditsEnabled,
    actingId,
    onOpen,
    onRetry,
    onPreview,
}: {
    task: GenerationTask;
    canvasById: Map<string, { title: string; projectId?: string }>;
    projectNameById: Map<string, string>;
    effectiveConfig: AiConfig;
    creditsEnabled: boolean;
    actingId: string;
    onOpen: () => void;
    onRetry: () => void;
    onPreview: () => void;
}) {
    const { t } = useTranslation();
    const context = getTaskCanvasContext(task, canvasById, projectNameById);
    const canvasLabel = context.projectName ? `${context.canvasName} · ${context.projectName}` : context.canvasName;
    const active = isTaskActive(task);
    const failed = isTaskFailed(task);
    const retryBlocked = isTaskRetryBlocked(task);
    const stageLabel = generationTaskStageLabel(task);
    const showsProgress = generationTaskShowsProgress(task);
    const openFromRow = (event: MouseEvent<HTMLElement>) => {
        if (event.target instanceof Element && event.target.closest("button, a, input")) return;
        onOpen();
    };
    return (
        <article className="task-center-row" data-tone={taskTone(task)} onClick={openFromRow}>
            <TaskPreviewThumbnail task={task} onOpen={onPreview} />
            <div className="task-center-row-main">
                <button type="button" className="task-center-row-title" title={task.prompt} onClick={onOpen}>
                    {task.prompt || t("library.tasks.row.untitled")}
                </button>
                <div className="task-center-row-meta">
                    <TaskStatusPill task={task} />
                    <span>{formatTaskKind(task)}</span>
                    <span>{formatModelName(effectiveConfig, task)}</span>
                    <span className="task-center-row-canvas" title={canvasLabel}>
                        <FolderKanban aria-hidden="true" />
                        <span>{canvasLabel}</span>
                    </span>
                </div>
                {active && showsProgress ? (
                    <div className="task-center-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>{stageLabel}</span>
                        <strong>{task.progress || 0}%</strong>
                        <i>
                            <b style={progressFillStyle(task.progress || 0)} />
                        </i>
                    </div>
                ) : active ? (
                    <p className="task-center-row-note">{stageLabel}</p>
                ) : null}
                {failed ? (
                    <p className="task-center-row-error" title={task.error ? generationErrorMessage(task.error) : undefined}>
                        {taskAttentionReason(task)}
                    </p>
                ) : null}
            </div>
            <div className="task-center-row-time">
                <TaskDate value={task.createdAt} />
            </div>
            {creditsEnabled ? (
                <div className="task-center-row-billing">
                    <TaskBilling billing={task.billing} />
                </div>
            ) : null}
            <div className="task-center-row-actions">
                {failed ? (
                    <Tooltip title={retryBlocked ? t("library.tasks.row.retryBlocked") : task.canRecoverMedia ? t("library.tasks.row.retrySaveHint") : t("library.tasks.row.retryTask")}>
                        <Button
                            type="text"
                            size="small"
                            icon={<RotateCcw className="size-3.5" />}
                            aria-label={task.canRecoverMedia ? t("library.tasks.row.retrySave") : t("library.tasks.row.retryTask")}
                            loading={actingId === task.id}
                            disabled={retryBlocked}
                            onClick={onRetry}
                        />
                    </Tooltip>
                ) : null}
                <Tooltip title={t("library.tasks.row.viewDetail")}>
                    <IconButton size="sm" variant="ghost" icon={ChevronRight} aria-label={t("library.tasks.row.viewDetail")} onClick={onOpen} />
                </Tooltip>
            </div>
        </article>
    );
}

function TaskPreviewThumbnail({ task, onOpen }: { task: GenerationTask; onOpen: () => void }) {
    const { t } = useTranslation();
    const isVideo = task.previewKind === "video";
    const [unavailableUrl, setUnavailableUrl] = useState("");
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const previewUnavailable = Boolean(thumbnailUrl && unavailableUrl === thumbnailUrl);
    if (!task.previewUrl) {
        const Icon = taskKindIcon(task);
        return (
            <span className="task-center-thumb" aria-hidden="true">
                <Icon />
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={previewUnavailable}
            className="task-center-thumb is-interactive"
            aria-label={previewUnavailable ? t("library.tasks.row.previewMissing") : isVideo ? t("library.tasks.row.previewVideo") : t("library.tasks.row.previewImage")}
            title={previewUnavailable ? t("library.tasks.row.previewMissing") : undefined}
        >
            {thumbnailUrl ? (
                <MediaPreview src={thumbnailUrl} kind="image" width={64} height={48} loading="lazy" fallbackLabel={t("library.tasks.row.previewUnavailable")} onUnavailable={() => setUnavailableUrl(thumbnailUrl)} />
            ) : (
                <TaskVideoThumbnail src={task.previewUrl} />
            )}
            {!previewUnavailable ? <span className="task-center-thumb-hover">{isVideo ? <Play aria-hidden="true" /> : <Eye aria-hidden="true" />}</span> : null}
        </button>
    );
}
