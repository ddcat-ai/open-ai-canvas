import { Button, Dropdown, Input } from "antd";
import { ArrowUpRight, CircleAlert, Clapperboard, Copy, Download, Ellipsis, ImageOff, ImagePlus, LoaderCircle, Maximize2, Play, RefreshCw, RotateCcw, Search, SquarePen, X } from "lucide-react";
import { memo, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { WorkspaceNoResultsState, WorkspaceState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control/segmented-control";
import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { RelativeTime } from "@/components/ui/product/relative-time";
import { cn } from "@/lib/utils";
import type { GenerationTask } from "@/services/api/task-center";
import type { WorkbenchKind, WorkbenchTool } from "@/services/api/workbench";

import type { WorkbenchOutput } from "./workbench-batches";
import { SceneGlyph } from "./workbench-composer";
import { workbenchToolSubtitle } from "./workbench-presets";

export type GalleryTile =
    | { type: "output"; key: string; output: WorkbenchOutput; task: GenerationTask }
    | { type: "active"; key: string; task: GenerationTask; slot: number }
    | { type: "loading"; key: string; task: GenerationTask }
    | { type: "failed"; key: string; task: GenerationTask }
    | { type: "pending"; key: string; state: "submitting" | "unsubmitted"; error?: string };

export type GalleryBatch = {
    key: string;
    createdAt: string;
    prompt: string;
    toolName?: string;
    modelLabel?: string;
    chips: string[];
    /** 宽高比（宽 / 高），未知时为 undefined，由首张产物的真实尺寸补上。 */
    ratio?: number;
    tiles: GalleryTile[];
    tasks: GenerationTask[];
    outputs: WorkbenchOutput[];
    counts: { done: number; active: number; failed: number; pending: number; total: number };
    resumable: number;
    resumeError?: string;
    submitting: boolean;
    localOnly: boolean;
};

export type GalleryFilter = "all" | "active" | "done" | "failed";

export type GalleryActions = {
    openOutput: (batch: GalleryBatch, output: WorkbenchOutput) => void;
    download: (output: WorkbenchOutput, batch: GalleryBatch) => void;
    useAsReference?: (output: WorkbenchOutput) => void;
    makeVideo?: (output: WorkbenchOutput) => void;
    cancelTask: (task: GenerationTask) => void;
    retryTask: (task: GenerationTask) => void;
    reuse: (batch: GalleryBatch) => void;
    copyPrompt: (batch: GalleryBatch) => void;
    downloadAll: (batch: GalleryBatch) => void;
    cancelBatch: (batch: GalleryBatch) => void;
    retryFailed: (batch: GalleryBatch) => void;
    resume: (batch: GalleryBatch) => void;
    dismiss: (batch: GalleryBatch) => void;
    visible: (batchKey: string) => void;
    measure: (batchKey: string, ratio: number) => void;
};

export function galleryBatchMatches(batch: GalleryBatch, filter: GalleryFilter, query: string) {
    const normalized = query.trim().toLocaleLowerCase();
    if (normalized && !`${batch.prompt} ${batch.toolName || ""}`.toLocaleLowerCase().includes(normalized)) return false;
    if (filter === "active") return batch.counts.active > 0 || batch.submitting;
    if (filter === "done") return batch.counts.done > 0;
    if (filter === "failed") return batch.counts.failed > 0 || batch.resumable > 0;
    return true;
}

function tileMinWidth(ratio?: number) {
    if (!ratio) return 200;
    if (ratio >= 1.3) return 280;
    if (ratio <= 0.8) return 168;
    return 208;
}

function useOnceVisible<T extends Element>(onVisible: () => void) {
    const ref = useRef<T | null>(null);
    const callback = useRef(onVisible);
    callback.current = onVisible;
    useEffect(() => {
        const element = ref.current;
        if (!element) return;
        if (typeof IntersectionObserver === "undefined") {
            callback.current();
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some((entry) => entry.isIntersecting)) return;
                observer.disconnect();
                callback.current();
            },
            { rootMargin: "480px 0px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    return ref;
}

const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function TileAction({ label, icon, onClick, primary }: { label: string; icon: ReactNode; onClick: () => void; primary?: boolean }) {
    return (
        <Tooltip title={label}>
            <button
                type="button"
                className={cn("wb-tile-action", primary && "is-primary")}
                data-icon-only
                aria-label={label}
                onClick={(event) => {
                    event.stopPropagation();
                    onClick();
                }}
            >
                {icon}
            </button>
        </Tooltip>
    );
}

function OutputTile({ batch, tile, kind, actions }: { batch: GalleryBatch; tile: Extract<GalleryTile, { type: "output" }>; kind: WorkbenchKind; actions: GalleryActions }) {
    const { output } = tile;
    const [failed, setFailed] = useState(false);
    const [playing, setPlaying] = useState(false);
    const videoRef = useRef<HTMLVideoElement | null>(null);
    const reportSize = (width: number, height: number) => {
        if (width > 0 && height > 0 && !batch.ratio) actions.measure(batch.key, width / height);
    };
    const preview =
        output.kind === "video" ? (
            output.thumbUrl ? (
                <>
                    <img src={output.thumbUrl} alt="" loading="lazy" onLoad={(event) => reportSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => setFailed(true)} />
                    <video ref={videoRef} className={cn("wb-tile-hover-video", playing && "is-playing")} src={output.url} muted loop playsInline preload="none" onPlaying={() => setPlaying(true)} onPause={() => setPlaying(false)} />
                </>
            ) : (
                <video ref={videoRef} src={output.url} muted loop playsInline preload="metadata" onLoadedMetadata={(event) => reportSize(event.currentTarget.videoWidth, event.currentTarget.videoHeight)} onError={() => setFailed(true)} />
            )
        ) : (
            <img src={output.thumbUrl || output.url} alt={batch.prompt.slice(0, 40) || "生成结果"} loading="lazy" onLoad={(event) => reportSize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => setFailed(true)} />
        );
    return (
        <div
            className={cn("wb-tile is-output", output.kind === "video" && "is-video")}
            role="button"
            tabIndex={0}
            aria-label={output.kind === "video" ? "预览视频" : "预览图片"}
            onClick={() => actions.openOutput(batch, output)}
            onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    actions.openOutput(batch, output);
                }
            }}
            onMouseEnter={() => {
                const video = videoRef.current;
                if (!video || prefersReducedMotion()) return;
                video.preload = "auto";
                void video.play().catch(() => undefined);
            }}
            onMouseLeave={() => {
                const video = videoRef.current;
                if (!video) return;
                video.pause();
            }}
        >
            {failed ? (
                <span className="wb-tile-state">
                    <ImageOff />
                    <small>预览不可用</small>
                </span>
            ) : (
                preview
            )}
            {output.kind === "video" ? (
                <span className="wb-tile-play" aria-hidden>
                    <Play />
                </span>
            ) : null}
            <span className="wb-tile-scrim" aria-hidden />
            <span className="wb-tile-actions">
                <TileAction label="下载" icon={<Download />} onClick={() => actions.download(output, batch)} />
                {kind === "image" && actions.useAsReference && output.resourceId ? <TileAction label="用作参考图" icon={<ImagePlus />} onClick={() => actions.useAsReference?.(output)} /> : null}
                {kind === "image" && actions.makeVideo && output.resourceId ? <TileAction label="做成视频" icon={<Clapperboard />} onClick={() => actions.makeVideo?.(output)} /> : null}
                <TileAction label="查看大图" icon={<Maximize2 />} onClick={() => actions.openOutput(batch, output)} primary />
            </span>
        </div>
    );
}

function ProgressTile({ tile, actions, busy }: { tile: Extract<GalleryTile, { type: "active" }>; actions: GalleryActions; busy: boolean }) {
    const { task } = tile;
    const progress = Math.max(4, Math.min(99, Math.round(task.progress || 0)));
    return (
        <div className="wb-tile is-active" aria-busy="true">
            <span className="wb-tile-shimmer" aria-hidden />
            <span className="wb-tile-state">
                <LoaderCircle className="wb-spin" />
                <strong>{task.status === "queued" ? "排队中" : task.stage || "生成中"}</strong>
                <small>{progress}%</small>
            </span>
            <span className="wb-tile-progress" aria-hidden>
                <span style={{ transform: `translateX(${progress - 100}%)` }} />
            </span>
            {tile.slot === 0 ? (
                <Tooltip title="取消这个任务">
                    <button type="button" className="wb-tile-cancel" data-icon-only aria-label="取消任务" disabled={busy} onClick={() => actions.cancelTask(task)}>
                        {busy ? <LoaderCircle className="wb-spin" /> : <X />}
                    </button>
                </Tooltip>
            ) : null}
        </div>
    );
}

function FailedTile({ task, actions, busy }: { task: GenerationTask; actions: GalleryActions; busy: boolean }) {
    const cancelled = task.status === "cancelled";
    return (
        <div className={cn("wb-tile is-failed", cancelled && "is-cancelled")}>
            <span className="wb-tile-state">
                <CircleAlert />
                <strong>{cancelled ? "已取消" : "生成失败"}</strong>
                {!cancelled && task.error ? (
                    <small className="wb-tile-error" title={task.error}>
                        {task.error}
                    </small>
                ) : null}
                <Button size="small" icon={busy ? <LoaderCircle className="wb-spin" /> : <RotateCcw />} disabled={busy} onClick={() => actions.retryTask(task)}>
                    重新生成
                </Button>
            </span>
        </div>
    );
}

const BatchCard = memo(function BatchCard({ batch, kind, actions, busyTaskIds }: { batch: GalleryBatch; kind: WorkbenchKind; actions: GalleryActions; busyTaskIds: ReadonlySet<string> }) {
    const ref = useOnceVisible<HTMLElement>(() => actions.visible(batch.key));
    const { counts } = batch;
    const style = { "--wb-tile-ratio": batch.ratio ? String(batch.ratio) : "1", "--wb-tile-min": `${tileMinWidth(batch.ratio)}px` } as CSSProperties;
    const unit = kind === "image" ? "张" : "条";
    const status =
        batch.submitting && counts.done + counts.failed === 0 && !batch.tasks.length
            ? "正在提交"
            : counts.active
              ? `${counts.done} / ${counts.total} 已完成 · ${counts.active} ${unit}生成中`
              : counts.failed || batch.resumable
                ? `${counts.done} / ${counts.total} 已完成`
                : `${counts.total} ${unit}`;
    const menuItems = [
        ...(counts.active ? [{ key: "cancel", label: "取消未完成的任务" }] : []),
        ...(counts.failed ? [{ key: "retry", label: "重新生成失败项" }] : []),
        ...(batch.resumable ? [{ key: "resume", label: `继续提交剩余 ${batch.resumable} 个` }] : []),
        ...(batch.localOnly && !batch.submitting ? [{ key: "dismiss", label: "移除这组记录" }] : []),
    ];
    return (
        <article ref={ref} className="wb-batch" aria-label={batch.prompt.slice(0, 60) || "生成批次"}>
            <header className="wb-batch-head">
                <div className="wb-batch-meta">
                    <RelativeTime value={batch.createdAt} />
                    {batch.toolName ? <span>{batch.toolName}</span> : null}
                    {batch.modelLabel ? <span>{batch.modelLabel}</span> : null}
                </div>
                <div className="wb-batch-actions">
                    {batch.tasks.length ? (
                        <Tooltip title="复用这组的场景、素材和参数">
                            <button type="button" className="wb-icon-button" data-icon-only aria-label="复用参数" onClick={() => actions.reuse(batch)}>
                                <SquarePen />
                            </button>
                        </Tooltip>
                    ) : null}
                    <Tooltip title="复制提示词">
                        <button type="button" className="wb-icon-button" data-icon-only aria-label="复制提示词" disabled={!batch.prompt} onClick={() => actions.copyPrompt(batch)}>
                            <Copy />
                        </button>
                    </Tooltip>
                    {batch.outputs.length ? (
                        <Tooltip title={batch.outputs.length > 1 ? `下载全部 ${batch.outputs.length} 个` : "下载"}>
                            <button type="button" className="wb-icon-button" data-icon-only aria-label="下载全部" onClick={() => actions.downloadAll(batch)}>
                                <Download />
                            </button>
                        </Tooltip>
                    ) : null}
                    {menuItems.length ? (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{
                                items: menuItems,
                                onClick: ({ key }) => {
                                    if (key === "cancel") actions.cancelBatch(batch);
                                    if (key === "retry") actions.retryFailed(batch);
                                    if (key === "resume") actions.resume(batch);
                                    if (key === "dismiss") actions.dismiss(batch);
                                },
                            }}
                        >
                            <button type="button" className="wb-icon-button" data-icon-only aria-label="更多操作">
                                <Ellipsis />
                            </button>
                        </Dropdown>
                    ) : null}
                </div>
            </header>
            <p className="wb-batch-prompt" title={batch.prompt}>
                {batch.prompt || "（无提示词）"}
            </p>
            <div className="wb-batch-tags">
                {batch.chips.map((chip) => (
                    <span key={chip} className="wb-tag">
                        {chip}
                    </span>
                ))}
                <span className={cn("wb-batch-status", counts.active && "is-active", (counts.failed || batch.resumable) && !counts.active && "is-warning")}>{status}</span>
            </div>
            {batch.resumable ? (
                <div className="wb-batch-notice" role="status">
                    <CircleAlert />
                    <span>
                        还有 {batch.resumable} 个任务没有提交{batch.resumeError ? `：${batch.resumeError}` : ""}
                    </span>
                    <Button size="small" onClick={() => actions.resume(batch)}>
                        继续提交
                    </Button>
                </div>
            ) : null}
            <div className="wb-tiles" style={style}>
                {batch.tiles.map((tile) =>
                    tile.type === "output" ? (
                        <OutputTile key={tile.key} batch={batch} tile={tile} kind={kind} actions={actions} />
                    ) : tile.type === "active" ? (
                        <ProgressTile key={tile.key} tile={tile} actions={actions} busy={busyTaskIds.has(tile.task.id)} />
                    ) : tile.type === "failed" ? (
                        <FailedTile key={tile.key} task={tile.task} actions={actions} busy={busyTaskIds.has(tile.task.id)} />
                    ) : tile.type === "loading" ? (
                        <div key={tile.key} className="wb-tile is-active" aria-busy="true">
                            <span className="wb-tile-shimmer" aria-hidden />
                        </div>
                    ) : (
                        <div key={tile.key} className={cn("wb-tile", tile.state === "submitting" ? "is-active" : "is-pending")} aria-busy={tile.state === "submitting"}>
                            {tile.state === "submitting" ? <span className="wb-tile-shimmer" aria-hidden /> : null}
                            <span className="wb-tile-state">
                                {tile.state === "submitting" ? <LoaderCircle className="wb-spin" /> : <CircleAlert />}
                                <strong>{tile.state === "submitting" ? "提交中" : "未提交"}</strong>
                            </span>
                        </div>
                    ),
                )}
            </div>
        </article>
    );
});

export function WorkbenchGallery({
    kind,
    batches,
    loading,
    filter,
    query,
    busyTaskIds,
    actions,
    quickTools,
    historyCapped,
    onFilterChange,
    onQueryChange,
    onRefresh,
    onOpenLibrary,
    onChooseTool,
}: {
    kind: WorkbenchKind;
    batches: GalleryBatch[];
    loading: boolean;
    filter: GalleryFilter;
    query: string;
    busyTaskIds: ReadonlySet<string>;
    actions: GalleryActions;
    quickTools: WorkbenchTool[];
    historyCapped: boolean;
    onFilterChange: (filter: GalleryFilter) => void;
    onQueryChange: (query: string) => void;
    onRefresh: () => void;
    onOpenLibrary: () => void;
    onChooseTool: (tool: WorkbenchTool) => void;
}) {
    const visible = batches.filter((batch) => galleryBatchMatches(batch, filter, query));
    // 筛选计数按批次统计，与筛选结果一致；生成中的作品数单独按张 / 条显示。
    const totals = batches.reduce(
        (sum, batch) => ({
            outputs: sum.outputs + batch.outputs.length,
            generating: sum.generating + batch.counts.active,
            activeBatches: sum.activeBatches + (galleryBatchMatches(batch, "active", "") ? 1 : 0),
            failedBatches: sum.failedBatches + (galleryBatchMatches(batch, "failed", "") ? 1 : 0),
        }),
        { outputs: 0, generating: 0, activeBatches: 0, failedBatches: 0 },
    );
    const unit = kind === "image" ? "张" : "条";
    return (
        <section className="wb-gallery" aria-label="作品">
            <header className="wb-gallery-head">
                <div className="wb-gallery-title">
                    <h2>作品</h2>
                    <span>
                        {totals.outputs} {unit}
                        {totals.generating ? ` · ${totals.generating} ${unit}生成中` : ""}
                    </span>
                </div>
                <div className="wb-gallery-tools">
                    <SegmentedControl<GalleryFilter>
                        size="sm"
                        ariaLabel="按状态筛选"
                        value={filter}
                        onChange={onFilterChange}
                        options={[
                            { value: "all", label: "全部" },
                            { value: "active", label: totals.activeBatches ? `进行中 ${totals.activeBatches}` : "进行中" },
                            { value: "done", label: "已完成" },
                            { value: "failed", label: totals.failedBatches ? `失败 ${totals.failedBatches}` : "失败" },
                        ]}
                    />
                    <Input className="wb-gallery-search" size="small" allowClear prefix={<Search className="size-3.5" />} placeholder="搜索提示词或场景" aria-label="搜索作品" value={query} onChange={(event) => onQueryChange(event.target.value)} />
                    <Tooltip title="刷新">
                        <button type="button" className="wb-icon-button" data-icon-only aria-label="刷新作品列表" onClick={onRefresh}>
                            <RefreshCw />
                        </button>
                    </Tooltip>
                </div>
            </header>
            <div className="wb-gallery-scroll">
                {loading && !batches.length ? (
                    <div className="wb-gallery-skeleton" aria-busy="true" aria-label="正在加载作品">
                        {Array.from({ length: 2 }, (_, index) => (
                            <div key={index} className="wb-batch is-skeleton">
                                <span className="wb-skeleton-line is-short" />
                                <span className="wb-skeleton-line" />
                                <div className="wb-tiles" style={{ "--wb-tile-ratio": "1", "--wb-tile-min": "200px" } as CSSProperties}>
                                    {Array.from({ length: 4 }, (_, tile) => (
                                        <div key={tile} className="wb-tile is-active">
                                            <span className="wb-tile-shimmer" aria-hidden />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : !batches.length ? (
                    <div className="wb-empty">
                        <WorkspaceState
                            compact
                            icon="assets"
                            title={kind === "image" ? "上传商品图，一次生成整套商品图" : "用一张商品图，批量生成商品视频"}
                            description={kind === "image" ? "选好出品场景，上传商品原图，设置数量后生成。主图、场景图、模特图按批次保存在这里。" : "选好镜头场景，上传商品首帧，一次可并行生成多条。生成的视频按批次保存在这里。"}
                            action={
                                <Button type="primary" onClick={onOpenLibrary}>
                                    选择出品场景
                                </Button>
                            }
                        />
                        {quickTools.length ? (
                            <div className="wb-empty-scenes" role="group" aria-label="常用场景">
                                {quickTools.slice(0, 3).map((tool) => (
                                    <button key={tool.id} type="button" className="wb-empty-scene" onClick={() => onChooseTool(tool)}>
                                        <SceneGlyph tool={tool} kind={kind} />
                                        <span className="wb-empty-scene-copy">
                                            <strong>{tool.name}</strong>
                                            <small>{workbenchToolSubtitle(tool)}</small>
                                        </span>
                                        <ArrowUpRight />
                                    </button>
                                ))}
                            </div>
                        ) : null}
                    </div>
                ) : !visible.length ? (
                    <WorkspaceNoResultsState
                        compact
                        query={query}
                        title={query.trim() ? undefined : "这个筛选下还没有作品"}
                        description={query.trim() ? undefined : "切换到“全部”查看所有批次。"}
                        onClear={() => {
                            onQueryChange("");
                            onFilterChange("all");
                        }}
                    />
                ) : (
                    <div className="wb-batch-list">
                        {visible.map((batch) => (
                            <BatchCard key={batch.key} batch={batch} kind={kind} actions={actions} busyTaskIds={busyTaskIds} />
                        ))}
                        {historyCapped ? <p className="wb-gallery-end">这里显示最近 100 个任务，更早的记录可在任务中心查看。</p> : null}
                    </div>
                )}
            </div>
        </section>
    );
}
