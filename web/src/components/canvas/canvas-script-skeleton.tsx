import { ChevronRight, Clapperboard, Expand, Image as ImageIcon, Video } from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { CanvasStoryboardPipelineProgress } from "@/lib/canvas/canvas-storyboard-progress";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationBatch, CanvasNodeData, CanvasWorkspaceMode } from "@/types/canvas";

function generationBatchSummary(batch: CanvasGenerationBatch): string | null {
    const total = batch.items.length;
    const completed = batch.items.filter((item) => item.status === "succeeded").length;
    const failed = batch.items.filter((item) => item.status === "failed").length;
    if (failed > 0) return `${completed}/${total} · ${failed} 失败`;
    if (completed === total) return `${total}/${total} 完成`;
    return `${completed}/${total}`;
}

export function CanvasScriptSkeleton({ node, pipeline, batch, onExpand, onGenerateImages, onGenerateVideos, workspaceMode = "professional" }: {
    node: CanvasNodeData;
    pipeline: CanvasStoryboardPipelineProgress;
    batch?: CanvasGenerationBatch;
    onExpand: () => void;
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    workspaceMode?: CanvasWorkspaceMode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const rows = node.metadata?.storyboard?.rows || [];
    const totalDuration = rows.reduce((sum, row) => sum + (Number(row.durationSeconds) || 0), 0);
    const hasActiveBatch = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running"));
    const taskFeedback = node.metadata?.status === "loading"
        ? `${node.metadata.taskStage || "正在创建任务"}${typeof node.metadata.taskProgress === "number" ? ` · ${node.metadata.taskProgress}%` : ""}`
        : node.metadata?.status === "error" ? node.metadata.errorDetails : "";
    const batchSummary = batch ? generationBatchSummary(batch) : null;

    return (
        <div
            className="relative flex h-full w-full flex-col overflow-hidden rounded-3xl border transition-[height] duration-200 ease-out"
            style={{ color: theme.node.text, background: theme.node.fill, borderColor: theme.node.stroke }}
            onDoubleClick={(event) => { event.stopPropagation(); onExpand(); }}
        >
            {/* 标题栏：图标 + 标题 + 摘要 + 状态 */}
            <div className="flex h-11 shrink-0 items-center gap-2.5 border-b px-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <div className="grid size-7 shrink-0 place-items-center rounded-lg" style={{ background: "color-mix(in srgb, currentColor 8%, transparent)" }}>
                    <Clapperboard className="size-3.5" strokeWidth={1.8} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="min-w-0 truncate text-sm font-semibold">{node.title || "分镜脚本"}</div>
                    <div className="min-w-0 truncate text-canvas-caption" style={{ color: theme.node.muted }}>
                        {rows.length ? `${rows.length} 镜 · ${totalDuration}s` : "尚未创建镜头"}
                        {pipeline.images.created > 0 ? ` · ${pipeline.images.created}/${pipeline.images.total} 图` : ""}
                        {pipeline.videos.created > 0 ? ` · ${pipeline.videos.created}/${pipeline.videos.total} 视频` : ""}
                    </div>
                </div>
                {taskFeedback ? (
                    <span className="min-w-0 max-w-[40%] shrink-0 truncate text-canvas-caption font-medium" title={taskFeedback} style={{ color: node.metadata?.status === "error" ? theme.accent.danger : theme.node.muted }}>{taskFeedback}</span>
                ) : batchSummary ? (
                    <span className="min-w-0 max-w-[40%] shrink-0 truncate text-canvas-caption font-medium" title={batchSummary} style={{ color: batch?.status === "partial_failed" ? theme.accent.danger : theme.node.muted }}>{batchSummary}</span>
                ) : null}
                {hasActiveBatch ? <div className="size-2 shrink-0 animate-pulse rounded-full" style={{ background: theme.accent.primary }} /> : null}
            </div>

            {/* 操作栏：展开编辑 + 快捷生成 */}
            <div
                className="flex min-h-0 flex-1 items-center gap-1.5 px-3 py-2"
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            >
                <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-canvas-caption font-medium outline-none transition hover:bg-black/5 active:scale-95 dark:hover:bg-white/10"
                    style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text }}
                    onClick={(event) => { event.stopPropagation(); onExpand(); }}
                    aria-label="展开分镜脚本编辑面板"
                >
                    <Expand className="size-3" strokeWidth={1.8} />
                    <span>展开编辑</span>
                    <ChevronRight className="size-3 opacity-50" strokeWidth={1.8} />
                </button>
                {rows.length > 0 ? (
                    <>
                        <button
                            type="button"
                            disabled={pipeline.images.incomplete === 0 || node.metadata?.status === "loading" || hasActiveBatch}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-canvas-caption font-medium outline-none transition hover:bg-black/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
                            style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text }}
                            onClick={(event) => { event.stopPropagation(); onGenerateImages(); }}
                            aria-label={pipeline.images.incomplete ? `生成剩余 ${pipeline.images.incomplete} 张分镜图` : "分镜图已全部完成"}
                        >
                            <ImageIcon className="size-3" strokeWidth={1.8} />
                            <span>{pipeline.images.incomplete ? `${pipeline.images.incomplete} 图` : "图完成"}</span>
                        </button>
                        <button
                            type="button"
                            disabled={pipeline.videos.incomplete === 0 || node.metadata?.status === "loading" || hasActiveBatch}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border px-2 text-canvas-caption font-medium outline-none transition hover:bg-black/5 active:scale-95 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10"
                            style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.text }}
                            onClick={(event) => { event.stopPropagation(); onGenerateVideos(); }}
                            aria-label={pipeline.videos.incomplete ? `生成剩余 ${pipeline.videos.incomplete} 个视频` : "视频已全部完成"}
                        >
                            <Video className="size-3" strokeWidth={1.8} />
                            <span>{pipeline.videos.incomplete ? `${pipeline.videos.incomplete} 视频` : "视频完成"}</span>
                        </button>
                    </>
                ) : null}
            </div>
        </div>
    );
}
