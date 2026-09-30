// 分镜脚本节点的流水线状态条、生成批次详情与编辑器小控件。

import { type CanvasStoryboardPipelineProgress, pipelineStatusLabel, type StoryboardPipelineStage } from "@/lib/canvas/canvas-storyboard-progress";
import { canvasThemes } from "@/lib/canvas-theme";
import { type CanvasGenerationBatch, type CanvasGenerationBatchItem, type CanvasGenerationBatchItemStatus, type CanvasNodeStatus, type StoryboardRow } from "@/types/canvas";
import { Fragment } from "react";
import { generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { Tooltip } from "@/components/ui/base/tooltip";
import { RefreshCw } from "lucide-react";

export function storyboardStepState(stage: StoryboardPipelineStage): "done" | "current" | "error" | "idle" {
    if (stage.failed > 0 && stage.success === 0) return "error";
    if (stage.success > 0) return "done";
    if (stage.loading > 0 || stage.incomplete > 0) return "current";
    return "idle";
}

export function StoryboardMiniPipeline({ pipeline, theme, rows }: { pipeline: CanvasStoryboardPipelineProgress; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; rows: StoryboardRow[] }) {
    const steps: Array<{ key: string; label: string; state: "done" | "current" | "error" | "idle"; hint: string }> = [
        { key: "script", label: "分镜", state: rows.length > 0 ? "done" : "idle", hint: rows.length > 0 ? `${rows.length} 个镜头` : "待添加镜头" },
        { key: "images", label: "分镜图（可选）", state: storyboardStepState(pipeline.images), hint: pipelineStatusLabel(pipeline.images) },
        { key: "videos", label: "视频", state: storyboardStepState(pipeline.videos), hint: pipelineStatusLabel(pipeline.videos) },
        {
            key: "final",
            label: "合并成片",
            state: pipeline.final.success > 0 ? "done" : pipeline.final.failed > 0 ? "error" : pipeline.final.loading > 0 || pipeline.successfulVideoNodeIds.length >= 2 ? "current" : "idle",
            hint: pipelineStatusLabel(pipeline.final),
        },
    ];
    return (
        <div
            className="flex h-9 shrink-0 items-center justify-center overflow-hidden border-b px-4"
            style={{ borderColor: theme.node.stroke, background: theme.node.fill }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {steps.map((step, index) => (
                <Fragment key={step.key}>
                    {index > 0 ? <span className="mx-2.5 h-px min-w-3.5 flex-1 max-w-20" style={{ background: theme.node.stroke }} /> : null}
                    <span
                        className="flex items-center gap-1.5 whitespace-nowrap text-[var(--fs-tiny)]"
                        title={step.hint}
                        style={{
                            color: step.state === "done" ? theme.node.muted : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.faint,
                            fontWeight: step.state === "current" || step.state === "error" ? 700 : 500,
                        }}
                    >
                        <span
                            className="size-2 shrink-0 rounded-full"
                            style={{
                                background: step.state === "done" ? theme.node.activeStroke : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.stroke,
                                boxShadow: step.state === "current" ? `0 0 0 3px ${theme.accent.primarySoft}` : undefined,
                            }}
                        />
                        {step.label}
                    </span>
                </Fragment>
            ))}
        </div>
    );
}

export function GenerationBatchDetails({ batch, rows, onRetryItem }: { batch: CanvasGenerationBatch; rows: StoryboardRow[]; onRetryItem: (itemId: string) => void }) {
    const shotByRowId = new Map(rows.map((row) => [row.id, row.shotNumber]));
    return (
        <div className="w-80" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{generationBatchModeLabel(batch)}详情</span>
                <span className="text-xs text-foreground/50">{batch.items.length} 项</span>
            </div>
            <div className="thin-scrollbar max-h-72 overflow-y-auto">
                {batch.items.map((item) => {
                    const requiresPromptChange = isContentModerationError(item.errorDetails);
                    return (
                        <div key={item.id} className="flex min-h-9 items-center gap-2 border-t border-foreground/10 py-1.5 first:border-t-0">
                            <span className="w-14 shrink-0 text-xs font-medium">镜头 {shotByRowId.get(item.rowId) || "--"}</span>
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground/60" title={item.errorDetails ? generationErrorMessage(item.errorDetails) : undefined}>
                                {generationBatchItemLabel(item)}
                                {item.retryCount ? ` · 重试 ${item.retryCount}` : ""}
                            </span>
                            {item.status === "failed" ? (
                                <Tooltip title={requiresPromptChange ? "请先修改提示词，再重试这个镜头" : "只重试这个镜头"}>
                                    <button
                                        type="button"
                                        className="grid size-7 shrink-0 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                                        onClick={() => onRetryItem(item.id)}
                                        aria-label={`重试镜头 ${shotByRowId.get(item.rowId) || ""}`}
                                    >
                                        <RefreshCw className="size-3.5" />
                                    </button>
                                </Tooltip>
                            ) : null}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function generationBatchModeLabel(batch: CanvasGenerationBatch) {
    return batch.mode === "storyboard_video" ? "视频生成" : batch.mode === "storyboard_image" ? "分镜图生成" : "动作板生成";
}

export function generationBatchSummary(batch: CanvasGenerationBatch) {
    const count = (status: CanvasGenerationBatchItemStatus) => batch.items.filter((item) => item.status === status).length;
    const generating = count("submitting") + count("queued") + count("running");
    const stopped = count("cancelled");
    return `${generationBatchModeLabel(batch)}${batch.status === "completed" ? "完成" : batch.status === "cancelled" ? "已停止" : "中"} · 完成 ${count("succeeded")}/${batch.items.length} / 失败 ${count("failed")} / 生成中 ${generating} / 等待 ${count("waiting")}${stopped ? ` / 已停止 ${stopped}` : ""}`;
}

export function generationBatchItemLabel(item: CanvasGenerationBatchItem) {
    if (item.costUncertain) return "费用待确认";
    if (isContentModerationError(item.errorDetails)) return "审核未通过，需修改提示词";
    const labels: Record<CanvasGenerationBatchItemStatus, string> = { waiting: "等待", submitting: "提交中", queued: "排队", running: "生成中", succeeded: "成功", failed: "失败", cancelled: "已停止" };
    return labels[item.status];
}

export function batchItemTone(item?: CanvasGenerationBatchItem): CanvasNodeStatus | undefined {
    if (!item) return undefined;
    if (item.status === "succeeded") return "success";
    if (item.status === "failed" || item.status === "cancelled") return "error";
    if (item.status === "waiting") return "idle";
    return "loading";
}
