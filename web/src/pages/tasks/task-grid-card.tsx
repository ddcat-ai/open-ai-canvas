import { Button } from "antd";
import { IconButton } from "@/components/ui/base/buttons";
import { Tooltip } from "@/components/ui/base/tooltip";
import { Eye, FileText, Image as ImageIcon, RotateCcw, Video } from "lucide-react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { statusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed, statusDotClassName, TaskDate } from "./task-shared";

export function TaskGridCard({ task, actingId, onOpen, onRetry }: { task: GenerationTask; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const isVideo = task.previewKind === "video";
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const fallbackVideo = task.type.includes("video");
    const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
    return (
        <article className={`task-grid-card${isFailed ? " is-attention" : ""}`}>
            <div className="task-grid-thumb">
                {thumbnailUrl ? (
                    <MediaPreview src={thumbnailUrl} kind="image" loading="lazy" className="h-full w-full object-cover" />
                ) : isVideo && task.previewUrl ? (
                    <span className="task-video-poster-placeholder"><Video /><small>视频预览</small></span>
                ) : (
                    <Icon />
                )}
                <div className="task-grid-overlay">
                    <Tooltip title="查看详情">
                        <IconButton size="sm" variant="ghost" icon={Eye} aria-label="查看详情" onClick={onOpen} />
                    </Tooltip>
                    {isFailed ? (
                        <Tooltip title="重试任务">
                            <Button
                                type="text"
                                size="small"
                                icon={<RotateCcw className="size-3.5" />}
                                aria-label="重试任务"
                                loading={actingId === task.id}
                                disabled={task.errorCode === CONTENT_MODERATION_ERROR_CODE || isContentModerationError(task.error)}
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
                        {statusLabel[task.status]}
                    </span>
                    <span className="task-grid-date">
                        <TaskDate value={task.createdAt} />
                    </span>
                </div>
            </div>
        </article>
    );
}
