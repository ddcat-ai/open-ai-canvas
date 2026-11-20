import { Button } from "antd";
import { useTranslation } from "react-i18next";
import { Tooltip } from "@/components/ui/base/tooltip";
import { AlertCircle, RotateCcw } from "lucide-react";

import { MediaPreview } from "@/components/media-preview";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import type { GenerationTask } from "@/services/api/task-center";
import type { AiConfig } from "@/stores/use-config-store";
import { formatModelName, isTaskActive, isTaskFailed, isTaskRetryBlocked, taskAttentionReason, TaskDate, taskKindIcon, TaskStatusPill, taskTone } from "./task-shared";
import { TaskVideoThumbnail } from "./task-video-thumbnail";
import { progressFillStyle } from "@/lib/progress-fill";

/** 网格卡片：封面上叠状态；运行中在封面底部显示进度，失败在封面上给出原因。整卡点击打开详情。 */
export function TaskGridCard({ task, effectiveConfig, actingId, onOpen, onRetry }: { task: GenerationTask; effectiveConfig: AiConfig; actingId: string; onOpen: () => void; onRetry: () => void }) {
    const { t } = useTranslation();
    const active = isTaskActive(task);
    const failed = isTaskFailed(task);
    const retryBlocked = isTaskRetryBlocked(task);
    const isVideo = task.previewKind === "video";
    const thumbnailUrl = isVideo ? task.previewPosterUrl : task.previewUrl;
    const stageLabel = generationTaskStageLabel(task);
    const showsProgress = generationTaskShowsProgress(task);
    const Icon = taskKindIcon(task);
    return (
        <article className="product-collection-card task-center-card" data-tone={taskTone(task)}>
            <div className="task-center-card-media">
                {thumbnailUrl ? (
                    <MediaPreview src={thumbnailUrl} kind="image" loading="lazy" fallbackLabel={t("library.tasks.row.previewUnavailable")} />
                ) : isVideo && task.previewUrl ? (
                    <TaskVideoThumbnail src={task.previewUrl} />
                ) : (
                    <span className="task-center-card-placeholder" aria-hidden="true">
                        {failed ? <AlertCircle /> : <Icon />}
                    </span>
                )}
                <TaskStatusPill task={task} className="is-overlay" />
                {active && showsProgress ? (
                    <div className="task-center-card-progress" role="progressbar" aria-label={stageLabel} aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress || 0}>
                        <span>
                            <span>{stageLabel}</span>
                            <strong>{task.progress || 0}%</strong>
                        </span>
                        <i>
                            <b style={progressFillStyle(task.progress || 0)} />
                        </i>
                    </div>
                ) : null}
                {/* 审核失败的任务无法自动重试：卡片上不放按钮，原因写在标题下方，详情里也有说明。 */}
                {failed && !retryBlocked ? (
                    <Tooltip title={task.canRecoverMedia ? t("library.tasks.row.retrySaveHint") : t("library.tasks.row.retryTask")}>
                        <Button
                            className="task-center-card-retry"
                            size="small"
                            icon={<RotateCcw className="size-3.5" />}
                            aria-label={task.canRecoverMedia ? t("library.tasks.row.retrySave") : t("library.tasks.row.retryTask")}
                            loading={actingId === task.id}
                            onClick={onRetry}
                        />
                    </Tooltip>
                ) : null}
            </div>
            <div className="task-center-card-body">
                <strong className="task-center-card-title">{task.prompt || t("library.tasks.row.untitled")}</strong>
                {failed ? (
                    <p className="task-center-card-error" title={task.error || undefined}>
                        {taskAttentionReason(task)}
                    </p>
                ) : active && !showsProgress ? (
                    <p className="task-center-card-note">{stageLabel}</p>
                ) : (
                    <p className="task-center-card-meta">
                        <span>{formatModelName(effectiveConfig, task)}</span>
                        <TaskDate value={task.createdAt} />
                    </p>
                )}
            </div>
            {/* 整卡点击区铺在封面和正文之上；重试按钮叠在它上层，两个按钮互不嵌套。 */}
            <button type="button" className="task-center-card-hit" title={task.prompt} aria-label={task.prompt || t("library.tasks.row.untitled")} onClick={onOpen} />
        </article>
    );
}
