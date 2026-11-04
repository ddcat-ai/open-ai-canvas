import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Eye, FileText, FolderKanban, Image as ImageIcon, Play, RotateCcw, Video } from "lucide-react";
import { useState } from "react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { formatTaskKind, generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { formatModelName, getTaskCanvasContext, isTaskFailed, statusDotClassName, taskAttentionReason, TaskBilling, TaskDate } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";
import { progressFillStyle } from "@/lib/progress-fill";

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
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const retryDisabled = task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error);
    const stageLabel = generationTaskStageLabel(task);
    const showsProgress = generationTaskShowsProgress(task);
    return (
        <article className={`product-collection-card task-record-row group${isFailed ? " is-attention" : ""}`}>
            <TaskPreviewThumbnail task={task} onOpen={onPreview} />
            <div className="task-record-main">
                <div className="task-record-heading">
                    <span className={`task-record-status ${isFailed ? "is-failed" : isActive ? "is-active" : "is-success"}`}>
                        <i className={statusDotClassName(task.status)} />
                        {generationTaskStatusLabel(task)}
                    </span>
                    <button type="button" className="task-record-title" title={task.prompt} onClick={onOpen}>
                        {task.prompt || t("library.tasks.row.untitled")}
                    </button>
                </div>
                <div className="task-record-meta">
                    <span>{formatTaskKind(task)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatModelName(effectiveConfig, task)}</span>
                    <span className="task-record-meta-canvas">
                        <FolderKanban className="size-3" />
                        {context.canvasName}
                        {context.projectName ? ` · ${context.projectName}` : ""}
                    </span>
                </div>
                {isActive && !showsProgress ? <p>{stageLabel}</p> : isActive ? (
                    <div className="task-record-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>{stageLabel}</span>
                        <span>{task.progress || 0}%</span>
                        <i>
                            <b style={progressFillStyle(task.progress || 0)} />
                        </i>
                    </div>
                ) : null}
                {isFailed ? (
                    <p className="task-record-error" title={task.error ? generationErrorMessage(task.error) : undefined}>
                        {taskAttentionReason(task)}
                    </p>
                ) : null}
            </div>
            <div className="task-record-date">
                <TaskDate value={task.createdAt} />
            </div>
            {creditsEnabled ? <TaskBilling billing={task.billing} /> : <span className="task-record-billing-empty" aria-hidden="true" />}
            <div className="task-record-actions">
                <Tooltip title={t("library.tasks.row.viewDetail")}>
                    <IconButton size="sm" variant="ghost" icon={Eye} aria-label={t("library.tasks.row.viewDetail")} onClick={onOpen} />
                </Tooltip>
                {isFailed ? (
                    <Tooltip title={retryDisabled ? t("library.tasks.row.retryBlocked") : task.canRecoverMedia ? t("library.tasks.row.retrySaveHint") : t("library.tasks.row.retryTask")}>
                        <Button
                            type="text"
                            size="small"
                            icon={<RotateCcw className="size-3.5" />}
                            aria-label={task.canRecoverMedia ? t("library.tasks.row.retrySave") : t("library.tasks.row.retryTask")}
                            loading={actingId === task.id}
                            disabled={retryDisabled}
                            onClick={onRetry}
                        />
                    </Tooltip>
                ) : null}
            </div>
        </article>
    );
}

function TaskPreviewThumbnail({ task, onOpen }: { task: GenerationTask; onOpen: () => void }) {
    const { t } = useTranslation();
    const isVideo = task.previewKind === "video";
    const fallbackVideo = task.type.includes("video");
    const [unavailableUrl, setUnavailableUrl] = useState("");
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const previewUnavailable = Boolean(thumbnailUrl && unavailableUrl === thumbnailUrl);
    if (!task.previewUrl) {
        const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
        return (
            <span className="task-record-thumb">
                <Icon className="size-4" />
            </span>
        );
    }
    return (
        <button
            type="button"
            onClick={onOpen}
            disabled={previewUnavailable}
            className="task-record-thumb group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={previewUnavailable ? t("library.tasks.row.previewMissing") : isVideo ? t("library.tasks.row.previewVideo") : t("library.tasks.row.previewImage")}
            title={previewUnavailable ? t("library.tasks.row.previewMissing") : undefined}
        >
            {thumbnailUrl ? <MediaPreview src={thumbnailUrl} kind="image" width={68} height={48} loading="lazy" className="h-full w-full object-cover" fallbackLabel={t("library.tasks.row.previewUnavailable")} onUnavailable={() => setUnavailableUrl(thumbnailUrl)} /> : isVideo ? <TaskVideoThumbnail src={task.previewUrl} /> : <ImageIcon className="size-4" />}
            {!previewUnavailable ? (
                <span className="absolute inset-0 grid place-items-center bg-black/0 text-white opacity-0 transition-[background-color,opacity] duration-150 group-hover:bg-black/30 group-hover:opacity-100 group-focus-visible:bg-black/30 group-focus-visible:opacity-100">
                    {isVideo ? <Play className="size-4 fill-current" /> : <Eye className="size-4" />}
                </span>
            ) : null}
        </button>
    );
}
