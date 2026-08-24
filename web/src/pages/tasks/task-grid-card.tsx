import { Button, Tooltip } from "antd";
import { Eye, FileText, Image as ImageIcon, RotateCcw, Video } from "lucide-react";

import { MediaPreview } from "@/components/media-preview";
import { CONTENT_MODERATION_ERROR_CODE, isContentModerationError } from "@/lib/generation-error";
import { statusLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import { isTaskFailed, statusDotClassName, TaskDate } from "./task-shared";
import { useTranslation } from "react-i18next";

export function TaskGridCard({ task, actingId, onOpen, onRetry }: { task: GenerationTask; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const { t } = useTranslation("canvas");
    const isActive = task.status === "queued" || task.status === "running";
    const isFailed = isTaskFailed(task);
    const isVideo = task.previewKind === "video";
    const fallbackVideo = task.type.includes("video");
    const Icon = fallbackVideo ? Video : task.type.includes("image") ? ImageIcon : FileText;
    return (
        <article className={`task-grid-card${isFailed ? " is-attention" : ""}`}>
            <div className="task-grid-thumb">
                {task.previewUrl ? <MediaPreview src={task.previewUrl} kind={isVideo ? "video" : "image"} loading="lazy" className="h-full w-full object-cover" /> : <Icon />}
                <div className="task-grid-overlay">
                    <Tooltip title={t("tasks:view-details")}>
                        <Button type="text" size="small" icon={<Eye className="size-3.5" />} aria-label={t("tasks:view-details")} onClick={onOpen} />
                    </Tooltip>
                    {isFailed ? (
                        <Tooltip title={t("tasks:retry-task")}>
                            <Button
                                type="text"
                                size="small"
                                icon={<RotateCcw className="size-3.5" />}
                                aria-label={t("tasks:retry-task")}
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
                    {task.prompt || t("tasks:untitled-task")}
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
