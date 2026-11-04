import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Eye, FileText, Image as ImageIcon, RotateCcw, Video } from "lucide-react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel, generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed, statusDotClassName, taskAttentionReason, TaskDate } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";
import { progressFillStyle } from "@/lib/progress-fill";

export function TaskGridCard({ task, actingId, onOpen, onRetry }: { task: GenerationTask; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const { t } = useTranslation();
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const retryDisabled = task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error);
    const isVideo = task.previewKind === "video";
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const fallbackVideo = task.type.includes("video");
    const stageLabel = generationTaskStageLabel(task);
    const showsProgress = generationTaskShowsProgress(task);
    const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
    return (
        <article className={`product-collection-card task-grid-card${isFailed ? " is-attention" : ""}`}>
            <div className="task-grid-thumb">
                {thumbnailUrl ? (
                    <MediaPreview src={thumbnailUrl} kind="image" loading="lazy" className="h-full w-full object-cover" />
                ) : isVideo && task.previewUrl ? (
                    <TaskVideoThumbnail src={task.previewUrl} />
                ) : (
                    <Icon />
                )}
                <div className="task-grid-overlay">
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
            </div>
            <div className="task-grid-body">
                <button type="button" className="task-grid-title" title={task.prompt} onClick={onOpen}>
                    {task.prompt || t("library.tasks.row.untitled")}
                </button>
                <div className="task-grid-meta">
                    <span className={`task-grid-status ${isFailed ? "is-failed" : isActive ? "is-active" : task.status === "succeeded" ? "is-success" : ""}`}>
                        <i className={statusDotClassName(task.status)} />
                        {generationTaskStatusLabel(task)}
                    </span>
                    <span className="task-grid-date">
                        <TaskDate value={task.createdAt} />
                    </span>
                </div>
                {isActive && !showsProgress ? <p>{stageLabel}</p> : isActive ? (
                    <div className="task-grid-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>{stageLabel}</span>
                        <strong>{task.progress || 0}%</strong>
                        <i><b style={progressFillStyle(task.progress || 0)} /></i>
                    </div>
                ) : null}
                {isFailed ? <p className="task-grid-error" title={task.error || undefined}>{taskAttentionReason(task)}</p> : null}
            </div>
        </article>
    );
}
