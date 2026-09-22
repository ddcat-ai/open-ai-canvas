import { Button } from "antd";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Eye, FileText, Image as ImageIcon, RotateCcw, Video } from "lucide-react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { generationTaskStatusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed, statusDotClassName, taskAttentionReason, TaskDate } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";

export function TaskGridCard({ task, actingId, onOpen, onRetry }: { task: GenerationTask; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const retryDisabled = task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error);
    const isVideo = task.previewKind === "video";
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const fallbackVideo = task.type.includes("video");
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
                    <Tooltip title="查看详情">
                        <IconButton size="sm" variant="ghost" icon={Eye} aria-label="查看详情" onClick={onOpen} />
                    </Tooltip>
                    {isFailed ? (
                        <Tooltip title={retryDisabled ? "内容审核失败，无法自动重试" : task.canRecoverMedia ? "重试保存，不重新生成" : "重试任务"}>
                            <Button
                                type="text"
                                size="small"
                                icon={<RotateCcw className="size-3.5" />}
                                aria-label={task.canRecoverMedia ? "重试保存" : "重试任务"}
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
                    {task.prompt || "未命名任务"}
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
                {isActive && task.mediaStage ? <p>{task.stage || "作品已生成，正在保存"}</p> : isActive ? (
                    <div className="task-grid-progress" role="progressbar" aria-label={task.stage || "任务生成进度"} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>{task.stage || "正在生成"}</span>
                        <strong>{task.progress || 0}%</strong>
                        <i><b style={{ width: `${task.progress || 0}%` }} /></i>
                    </div>
                ) : null}
                {isFailed ? <p className="task-grid-error" title={task.error || undefined}>{taskAttentionReason(task)}</p> : null}
            </div>
        </article>
    );
}
