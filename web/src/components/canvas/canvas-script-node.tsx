import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Checkbox, Input, InputNumber, Modal, Popover, Select, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronDown, ChevronUp, Clapperboard, Copy, Expand, Film, Grid3X3, Image as ImageIcon, ListTree, Merge, Minus, Plus, RefreshCw, Send, Square, Trash2, Video, X } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { pipelineStatusLabel, type CanvasStoryboardPipelineProgress, type StoryboardPipelineStage } from "@/lib/canvas/canvas-storyboard-progress";
import { isContentModerationError } from "@/lib/generation-error";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasGenerationBatchItemStatus, CanvasNodeData, CanvasNodeStatus, CanvasWorkspaceMode, StoryboardColumn, StoryboardRow, StoryboardShotCount, StoryboardShotDuration } from "@/types/canvas";

export const STORYBOARD_ROW_HEIGHT = 48;
export const STORYBOARD_HEADER_HEIGHT = 124;
const STORYBOARD_ADD_ROW_HEIGHT = 36;
const STORYBOARD_COMPOSER_MIN_HEIGHT = 104;
const STORYBOARD_COMPOSER_MAX_HEIGHT = 180;
const STORYBOARD_PROMPT_MIN_HEIGHT = 40;
const STORYBOARD_PROMPT_MAX_HEIGHT = 116;
const SCRIPT_GRID_TEMPLATE = "72px 150px minmax(280px, 1.4fr) minmax(220px, 1fr) 58px";
const EMPTY_STORYBOARD_ROWS: StoryboardRow[] = [];

export function storyboardNodeHeight(rowCount: number, composerHeight = STORYBOARD_COMPOSER_MIN_HEIGHT) {
    const visibleRows = Math.min(Math.max(rowCount, 1), 4);
    return STORYBOARD_HEADER_HEIGHT + visibleRows * STORYBOARD_ROW_HEIGHT + STORYBOARD_ADD_ROW_HEIGHT + Math.min(STORYBOARD_COMPOSER_MAX_HEIGHT, Math.max(STORYBOARD_COMPOSER_MIN_HEIGHT, composerHeight));
}

export function storyboardMinNodeHeight(composerHeight = STORYBOARD_COMPOSER_MIN_HEIGHT) {
    return STORYBOARD_HEADER_HEIGHT + STORYBOARD_ROW_HEIGHT + STORYBOARD_ADD_ROW_HEIGHT + Math.min(STORYBOARD_COMPOSER_MAX_HEIGHT, Math.max(STORYBOARD_COMPOSER_MIN_HEIGHT, composerHeight));
}

export function storyboardTableHeight(nodeHeight: number, composerHeight = STORYBOARD_COMPOSER_MIN_HEIGHT) {
    return Math.max(STORYBOARD_ROW_HEIGHT, nodeHeight - STORYBOARD_HEADER_HEIGHT - STORYBOARD_ADD_ROW_HEIGHT - Math.min(STORYBOARD_COMPOSER_MAX_HEIGHT, Math.max(STORYBOARD_COMPOSER_MIN_HEIGHT, composerHeight)));
}

const columnOptions: Array<{ label: string; value: StoryboardColumn }> = [
    { label: "序号", value: "shotNumber" },
    { label: "时长", value: "durationSeconds" },
    { label: "画面描述", value: "plotDescription" },
    { label: "台词/旁白", value: "dialogue" },
    { label: "景别", value: "shotSize" },
    { label: "情绪", value: "emotion" },
    { label: "光影氛围", value: "lightingAndAtmosphere" },
    { label: "音效", value: "audioEffects" },
    { label: "镜头设计", value: "camera" },
    { label: "运镜", value: "motion" },
    { label: "时间节拍", value: "timeBeats" },
    { label: "图片提示词", value: "imageGenerationPrompt" },
    { label: "视频提示词", value: "videoMotionPrompt" },
    { label: "负面要求", value: "negativePrompt" },
];

export function CanvasScriptNodeContent({ node, batch, pipeline, scale, mentionReferences, onOpen, onCreateImageNodes, onCreateVideoNodes, onGenerateImages, onGenerateVideos, onMergeVideos, onCreateActionBoards, onRetryBatch, onRetryBatchItem, onStopBatch, onCancelBatchItem, onAddRow, onRemoveRow, onUpdateRow, onPromptChange, onGenerateScript, onShotDurationChange, onShotCountChange, onComposerHeightChange, onConnectStart, onScrollTopChange, workspaceMode = "professional" }: {
    node: CanvasNodeData;
    batch?: CanvasGenerationBatch;
    pipeline: CanvasStoryboardPipelineProgress;
    scale: number;
    mentionReferences: CanvasResourceReference[];
    onOpen: () => void;
    onCreateImageNodes: () => void;
    onCreateVideoNodes: () => void;
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    onMergeVideos: () => void;
    onCreateActionBoards: () => void;
    onRetryBatch: (batchId: string) => void;
    onRetryBatchItem: (batchId: string, itemId: string) => void;
    onStopBatch: (batchId: string) => void;
    onCancelBatchItem: (batchId: string, itemId: string) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<StoryboardRow>) => void;
    onPromptChange: (prompt: string) => void;
    onGenerateScript: (prompt: string) => void;
    onShotDurationChange: (duration: StoryboardShotDuration) => void;
    onShotCountChange: (count: StoryboardShotCount) => void;
    onComposerHeightChange: (height: number) => void;
    onConnectStart: (event: ReactPointerEvent, rowId: string, handleType: "source" | "target") => void;
    onScrollTopChange: (scrollTop: number) => void;
    workspaceMode?: CanvasWorkspaceMode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const simpleMode = workspaceMode === "simple";
    const rows = node.metadata?.storyboard?.rows || [];
    const [prompt, setPrompt] = useState(node.metadata?.composerContent || "");
    const [scrollTop, setScrollTop] = useState(0);
    const composerHeightChangeRef = useRef(onComposerHeightChange);
    const reportedComposerHeightRef = useRef<number | null>(null);
    const composerHeight = node.metadata?.storyboardComposerHeight || STORYBOARD_COMPOSER_MIN_HEIGHT;
    const tableHeight = storyboardTableHeight(node.height, composerHeight);
    const totalDuration = rows.reduce((sum, row) => sum + (Number(row.durationSeconds) || 0), 0);
    const shotDuration = node.metadata?.storyboardShotDuration || "auto";
    const shotCount = node.metadata?.storyboardShotCount || "auto";
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const batchSummary = batch ? generationBatchSummary(batch) : null;
    const hasFailedBatchItems = Boolean(batch?.items.some((item) => item.status === "failed"));
    const hasWaitingBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting"));
    const hasActiveBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running"));
    const taskFeedback = node.metadata?.status === "loading"
        ? `${node.metadata.taskStage || "正在创建任务"}${typeof node.metadata.taskProgress === "number" ? ` · ${node.metadata.taskProgress}%` : ""}`
        : node.metadata?.status === "error" ? node.metadata.errorDetails : "";
    const submitPrompt = () => {
        const value = prompt.trim();
        if (value && node.metadata?.status !== "loading") onGenerateScript(value);
    };
    useLayoutEffect(() => {
        composerHeightChangeRef.current = onComposerHeightChange;
    }, [onComposerHeightChange]);
    const resizePrompt = useCallback((contentHeight: number) => {
        const promptHeight = Math.min(STORYBOARD_PROMPT_MAX_HEIGHT, Math.max(STORYBOARD_PROMPT_MIN_HEIGHT, contentHeight));
        const composerHeight = promptHeight + 64;
        if (reportedComposerHeightRef.current === composerHeight) return;
        reportedComposerHeightRef.current = composerHeight;
        composerHeightChangeRef.current(composerHeight);
    }, []);

    return (
        <div className="relative flex h-full w-full flex-col overflow-visible" style={{ color: theme.node.text }} onDoubleClick={(event) => event.stopPropagation()}>
            <div className="relative flex h-10 shrink-0 items-center gap-2 rounded-t-[17px] border-b px-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <Clapperboard className="size-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{node.title || "分镜脚本"}</span>
                {batchSummary ? <span className="min-w-0 max-w-[42%] truncate text-[11px] font-medium" title={batchSummary} style={{ color: batch?.status === "partial_failed" ? theme.accent.danger : theme.node.muted }}>{batchSummary}</span> : taskFeedback ? <span className="min-w-0 max-w-[38%] truncate text-[11px] font-medium" title={taskFeedback} style={{ color: node.metadata?.status === "error" ? theme.accent.danger : theme.node.muted }}>{taskFeedback}</span> : null}
                <span className="text-xs font-medium" style={{ color: theme.node.muted }}>{rows.length} 镜 · {totalDuration}s</span>
                {batch ? <>
                    {hasFailedBatchItems ? <Tooltip title="重试失败项"><button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRetryBatch(batch.id); }} aria-label="重试失败项"><RefreshCw className="size-3.5" /></button></Tooltip> : null}
                    {hasWaitingBatchItems ? <Tooltip title="停止剩余任务"><button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onStopBatch(batch.id); }} aria-label="停止剩余任务"><Square className="size-3.5" /></button></Tooltip> : null}
                    <Popover placement="bottomRight" trigger="click" content={<GenerationBatchDetails batch={batch} rows={rows} onRetryItem={(itemId) => onRetryBatchItem(batch.id, itemId)} onCancelItem={(itemId) => onCancelBatchItem(batch.id, itemId)} />}><Tooltip title="查看详情"><button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} aria-label="查看批次详情"><ListTree className="size-3.5" /></button></Tooltip></Popover>
                </> : null}
                {simpleMode ? null : <Tooltip title="生成动作拆分 12 宫格"><button type="button" disabled={!rows.length || hasActiveBatchItems} className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onCreateActionBoards(); }}><Grid3X3 className="size-3.5" /></button></Tooltip>}
                {simpleMode ? null : <Tooltip title="全屏编辑"><button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpen(); }}><Expand className="size-3.5" /></button></Tooltip>}
            </div>
            <StoryboardPipelineBar
                pipeline={pipeline}
                simpleMode={simpleMode}
                disabled={!rows.length || node.metadata?.status === "loading" || hasActiveBatchItems}
                theme={theme}
                onCreateImageNodes={onCreateImageNodes}
                onCreateVideoNodes={onCreateVideoNodes}
                onGenerateImages={onGenerateImages}
                onGenerateVideos={onGenerateVideos}
                onMergeVideos={onMergeVideos}
            />
            <div className="grid h-9 shrink-0 items-center border-b text-xs font-semibold" style={{ borderColor: theme.node.stroke, color: theme.node.muted, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                <HeaderCell borderColor={theme.node.stroke} align="center">序号</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke} align="center">时长</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>画面描述</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>台词/旁白</HeaderCell>
                <span className="text-center">操作</span>
            </div>
            <div
                data-canvas-wheel-scroll
                tabIndex={0}
                role="region"
                aria-label="分镜镜头列表"
                className="storyboard-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset"
                style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                onScroll={(event) => { const next = event.currentTarget.scrollTop; setScrollTop(next); onScrollTopChange(next); }}
                onWheel={(event) => event.stopPropagation()}
            >
                {rows.length ? rows.map((row) => (
                    <div key={row.id} className="relative grid border-b" style={{ height: STORYBOARD_ROW_HEIGHT, borderColor: theme.node.stroke, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                        <div className="flex flex-col items-center justify-center border-r tabular-nums" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}><span className="text-sm">{row.shotNumber}</span>{batchItemByRowId.get(row.id) ? <span className="max-w-16 truncate text-[9px] leading-3" title={generationBatchItemLabel(batchItemByRowId.get(row.id)!)}>{generationBatchItemLabel(batchItemByRowId.get(row.id)!)}</span> : null}</div>
                        <div className="grid grid-cols-[32px_1fr_32px] items-center border-r px-2" style={{ borderColor: theme.node.stroke }}>
                            <SmallButton title="减少 1 秒" onClick={() => onUpdateRow(row.id, { durationSeconds: Math.max(1, row.durationSeconds - 1) })}><Minus className="size-3" /></SmallButton>
                            <span className="text-center text-sm font-medium tabular-nums">{row.durationSeconds}s</span>
                            <SmallButton title="增加 1 秒" onClick={() => onUpdateRow(row.id, { durationSeconds: Math.min(60, row.durationSeconds + 1) })}><Plus className="size-3" /></SmallButton>
                        </div>
                        <CompactInput value={row.plotDescription} placeholder="描述画面内容" onChange={(value) => onUpdateRow(row.id, { plotDescription: value })} borderColor={theme.node.stroke} />
                        <CompactInput value={row.dialogue} placeholder="台词或旁白" onChange={(value) => onUpdateRow(row.id, { dialogue: value })} borderColor={theme.node.stroke} />
                        <div className="grid h-full place-items-center">
                            <button type="button" disabled={rows.length <= 1} className="grid size-7 place-items-center rounded outline-none opacity-55 transition enabled:hover:bg-red-500/10 enabled:hover:opacity-100 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-20" style={{ color: theme.accent.danger, "--tw-ring-color": theme.accent.danger } as CSSProperties} title={rows.length <= 1 ? "至少保留一个镜头" : "删除镜头"} aria-label={`删除镜头 ${row.shotNumber}`} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemoveRow(row.id); }}><Trash2 className="size-3.5" /></button>
                        </div>
                    </div>
                )) : <button type="button" className="grid h-full min-h-24 w-full place-items-center text-sm" style={{ color: theme.node.muted }} onClick={(event) => { event.stopPropagation(); onAddRow(); }}>+ 添加第一个镜头</button>}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-center border-b" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAddRow(); }}><Plus className="size-3.5" />添加行</button>
            </div>
            <div className="relative grid shrink-0 grid-rows-[minmax(0,1fr)_28px] gap-1.5 rounded-b-[17px] p-2.5" style={{ height: composerHeight, background: theme.node.panel }}>
                <CanvasResourceMentionTextarea
                    rows={1}
                    references={mentionReferences}
                    aria-label="分镜剧情与项目设定"
                    containerClassName="h-full min-h-0 overflow-hidden"
                    className="thin-scrollbar h-full min-h-0 w-full touch-pan-y resize-none overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border bg-transparent px-3 py-2 text-sm leading-5 outline-none transition placeholder:opacity-45 focus:ring-1"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    value={prompt}
                    placeholder="描述想生成的脚本或视频内容"
                    onContentSizeChange={resizePrompt}
                    onChange={(value) => {
                        setPrompt(value);
                        onPromptChange(value);
                    }}
                    onKeyDown={(event) => {
                        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                            event.preventDefault();
                            submitPrompt();
                        }
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
                <div className="flex min-w-0 items-center justify-end gap-2" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {simpleMode ? <span className="mr-auto text-[11px]" style={{ color: theme.node.muted }}>自动拆分镜头 · 默认时长</span> : <Select<StoryboardShotCount>
                        className="min-w-32"
                        size="small"
                        value={shotCount}
                        disabled={node.metadata?.status === "loading"}
                        options={[{ value: "auto", label: "分镜数量：自动拆分" }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1) as StoryboardShotCount, label: `分镜数量：${index + 1}` }))]}
                        popupMatchSelectWidth={false}
                        onChange={onShotCountChange}
                    />}
                    {simpleMode ? null : <Select<StoryboardShotDuration>
                        className="min-w-36"
                        size="small"
                        value={shotDuration}
                        disabled={node.metadata?.status === "loading"}
                        options={[
                            { value: "auto", label: "镜头：自动拆分" },
                            { value: "5", label: "镜头：单个5S" },
                            { value: "10", label: "镜头：单个10S" },
                            { value: "15", label: "镜头：单个15S" },
                            { value: "30", label: "镜头：单个30S" },
                        ]}
                        popupMatchSelectWidth={false}
                        onChange={onShotDurationChange}
                    />}
                    <Button
                        shape="circle"
                        icon={<Send className="size-4" />}
                        disabled={!prompt.trim() || node.metadata?.status === "loading"}
                        loading={node.metadata?.status === "loading"}
                        style={{ background: theme.toolbar.itemHover, borderColor: theme.node.stroke, color: theme.node.text }}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={submitPrompt}
                    />
                </div>
                <RowHandle side="left" top={composerHeight / 2} scale={scale} tone="idle" theme={theme} title="连接文本节点作为项目设定" onPointerDown={(event) => onConnectStart(event, "context", "target")} />
            </div>
            {rows.map((row, index) => {
                const top = STORYBOARD_HEADER_HEIGHT + index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop;
                if (top < STORYBOARD_HEADER_HEIGHT + 4 || top > STORYBOARD_HEADER_HEIGHT + tableHeight - 4) return null;
                return (
                    <div key={`ports-${row.id}`}>
                        <RowHandle side="left" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} onPointerDown={(event) => onConnectStart(event, row.id, "target")} />
                        <RowHandle side="right" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} onPointerDown={(event) => onConnectStart(event, row.id, "source")} />
                    </div>
                );
            })}
        </div>
    );
}

function StoryboardPipelineBar({ pipeline, simpleMode, disabled, theme, onCreateImageNodes, onCreateVideoNodes, onGenerateImages, onGenerateVideos, onMergeVideos }: {
    pipeline: CanvasStoryboardPipelineProgress;
    simpleMode: boolean;
    disabled: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onCreateImageNodes: () => void;
    onCreateVideoNodes: () => void;
    onGenerateImages: () => void;
    onGenerateVideos: () => void;
    onMergeVideos: () => void;
}) {
    const missingImages = Math.max(0, pipeline.images.total - pipeline.images.created);
    const missingVideos = Math.max(0, pipeline.videos.total - pipeline.videos.created);
    const canMerge = pipeline.successfulVideoNodeIds.length >= 2 && pipeline.final.success === 0;
    return (
        <div className="grid h-12 shrink-0 grid-cols-3 border-b" style={{ borderColor: theme.node.stroke, background: theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <PipelineStageCell label="分镜图" stage={pipeline.images} theme={theme}>
                {simpleMode ? (
                    <Button size="small" type="text" icon={<ImageIcon className="size-3" />} disabled={disabled || pipeline.images.incomplete === 0} onClick={onGenerateImages}>
                        {pipeline.images.incomplete ? `生成 ${pipeline.images.incomplete} 张分镜图` : "分镜图已完成"}
                    </Button>
                ) : (
                    <>
                        <Button size="small" type="text" disabled={disabled || missingImages === 0} onClick={onCreateImageNodes}>{missingImages ? `创建 ${missingImages} 个图片节点` : "图片节点已创建"}</Button>
                        <Button size="small" type="text" disabled={disabled || pipeline.images.incomplete === 0} onClick={onGenerateImages}>生成未完成的图片</Button>
                    </>
                )}
            </PipelineStageCell>
            <PipelineStageCell label="镜头视频" stage={pipeline.videos} theme={theme}>
                {simpleMode ? (
                    <Button size="small" type="text" icon={<Video className="size-3" />} disabled={disabled || pipeline.videos.incomplete === 0} onClick={onGenerateVideos}>
                        {pipeline.videos.incomplete ? `生成 ${pipeline.videos.incomplete} 个镜头视频` : "镜头视频已完成"}
                    </Button>
                ) : (
                    <>
                        <Button size="small" type="text" disabled={disabled || missingVideos === 0} onClick={onCreateVideoNodes}>{missingVideos ? `创建 ${missingVideos} 个视频节点` : "视频节点已创建"}</Button>
                        <Button size="small" type="text" disabled={disabled || pipeline.videos.incomplete === 0} onClick={onGenerateVideos}>生成未完成的视频</Button>
                    </>
                )}
            </PipelineStageCell>
            <PipelineStageCell label="合并成片" stage={pipeline.final} theme={theme} last>
                <Button size="small" type={canMerge ? "primary" : "text"} icon={<Merge className="size-3" />} disabled={!canMerge} onClick={onMergeVideos}>
                    {pipeline.final.success ? "成片已完成" : pipeline.successfulVideoNodeIds.length >= 2 ? `合并 ${pipeline.successfulVideoNodeIds.length} 段视频` : "至少完成 2 段视频"}
                </Button>
            </PipelineStageCell>
        </div>
    );
}

function PipelineStageCell({ label, stage, theme, children, last = false }: { label: string; stage: StoryboardPipelineStage; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; children: ReactNode; last?: boolean }) {
    return (
        <div className={`flex min-w-0 items-center gap-2 px-3 ${last ? "" : "border-r"}`} style={{ borderColor: theme.node.stroke }}>
            <div className="min-w-[64px] shrink-0">
                <div className="text-[11px] font-semibold">{label}</div>
                <div className="text-[9px] leading-3" style={{ color: stage.failed ? theme.accent.danger : theme.node.muted }}>{pipelineStatusLabel(stage)}</div>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-1 overflow-hidden [&_.ant-btn]:!h-7 [&_.ant-btn]:!px-2 [&_.ant-btn]:!text-[10px]">{children}</div>
        </div>
    );
}

function GenerationBatchDetails({ batch, rows, onRetryItem, onCancelItem }: { batch: CanvasGenerationBatch; rows: StoryboardRow[]; onRetryItem: (itemId: string) => void; onCancelItem: (itemId: string) => void }) {
    const shotByRowId = new Map(rows.map((row) => [row.id, row.shotNumber]));
    return <div className="w-80" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3"><span className="text-sm font-semibold">{generationBatchModeLabel(batch)}详情</span><span className="text-xs text-foreground/50">{batch.items.length} 项</span></div>
        <div className="thin-scrollbar max-h-72 overflow-y-auto">
            {batch.items.map((item) => {
                const cancellable = Boolean(item.taskId && (item.status === "queued" || item.status === "running"));
                const requiresPromptChange = isContentModerationError(item.errorDetails);
                return <div key={item.id} className="flex min-h-9 items-center gap-2 border-t border-foreground/10 py-1.5 first:border-t-0">
                    <span className="w-14 shrink-0 text-xs font-medium">镜头 {shotByRowId.get(item.rowId) || "--"}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/60" title={item.errorDetails}>{generationBatchItemLabel(item)}{item.retryCount ? ` · 重试 ${item.retryCount}` : ""}</span>
                    {item.status === "failed" ? <Tooltip title={requiresPromptChange ? "请先修改提示词，再重试这个镜头" : "只重试这个镜头"}><button type="button" className="grid size-7 shrink-0 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" onClick={() => onRetryItem(item.id)} aria-label={`重试镜头 ${shotByRowId.get(item.rowId) || ""}`}><RefreshCw className="size-3.5" /></button></Tooltip> : null}
                    {cancellable ? <Tooltip title="取消这个后台任务"><button type="button" className="grid size-7 shrink-0 place-items-center rounded outline-none transition hover:bg-red-500/10 focus-visible:ring-2" onClick={() => onCancelItem(item.id)} aria-label={`取消镜头 ${shotByRowId.get(item.rowId) || ""} 任务`}><X className="size-3.5" /></button></Tooltip> : null}
                </div>;
            })}
        </div>
    </div>;
}

function generationBatchModeLabel(batch: CanvasGenerationBatch) {
    return batch.mode === "storyboard_video" ? "视频生成" : batch.mode === "storyboard_image" ? "分镜图生成" : "动作板生成";
}

function generationBatchSummary(batch: CanvasGenerationBatch) {
    const count = (status: CanvasGenerationBatchItemStatus) => batch.items.filter((item) => item.status === status).length;
    const generating = count("submitting") + count("queued") + count("running");
    const stopped = count("cancelled");
    return `${generationBatchModeLabel(batch)}${batch.status === "completed" ? "完成" : batch.status === "cancelled" ? "已停止" : "中"} · 完成 ${count("succeeded")}/${batch.items.length} / 失败 ${count("failed")} / 生成中 ${generating} / 等待 ${count("waiting")}${stopped ? ` / 已停止 ${stopped}` : ""}`;
}

function generationBatchItemLabel(item: CanvasGenerationBatchItem) {
    if (item.costUncertain) return "费用待确认";
    if (isContentModerationError(item.errorDetails)) return "审核未通过，需修改提示词";
    const labels: Record<CanvasGenerationBatchItemStatus, string> = { waiting: "等待", submitting: "提交中", queued: "排队", running: "生成中", succeeded: "成功", failed: "失败", cancelled: "已停止" };
    return labels[item.status];
}

function batchItemTone(item?: CanvasGenerationBatchItem): CanvasNodeStatus | undefined {
    if (!item) return undefined;
    if (item.status === "succeeded") return "success";
    if (item.status === "failed" || item.status === "cancelled") return "error";
    if (item.status === "waiting") return "idle";
    return "loading";
}

export function CanvasScriptEditor({ node, open, onClose, onUpdateRows, onVisibleColumnsChange, onGenerateImages, onGenerateVideos }: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onUpdateRows: (rows: StoryboardRow[]) => void;
    onVisibleColumnsChange: (columns: StoryboardColumn[]) => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
}) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const rows = node?.metadata?.storyboard?.rows || EMPTY_STORYBOARD_ROWS;
    const visibleColumns = node?.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"];
    const filteredRows = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return keyword ? rows.filter((row) => [row.plotDescription, row.dialogue, row.camera, row.motion, row.timeBeats, row.imageGenerationPrompt, row.videoMotionPrompt, row.negativePrompt].some((value) => String(value || "").toLowerCase().includes(keyword))) : rows;
    }, [query, rows]);
    useEffect(() => {
        setSelectedIds((current) => {
            const next = current.filter((id) => rows.some((row) => row.id === id));
            return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
        });
    }, [rows]);
    const updateRow = (rowId: string, patch: Partial<StoryboardRow>) => onUpdateRows(rows.map((row) => row.id === rowId ? { ...row, ...patch } : row));
    const moveRow = (rowId: string, direction: -1 | 1) => {
        const index = rows.findIndex((row) => row.id === rowId);
        const nextIndex = index + direction;
        if (index < 0 || nextIndex < 0 || nextIndex >= rows.length) return;
        const next = [...rows];
        [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
        onUpdateRows(next.map((row, rowIndex) => ({ ...row, shotNumber: rowIndex + 1 })));
    };
    const duplicateRow = (row: StoryboardRow) => {
        const index = rows.findIndex((item) => item.id === row.id);
        const next = [...rows];
        next.splice(index + 1, 0, { ...row, id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, imageNodeId: undefined, videoNodeId: undefined, status: "idle" });
        onUpdateRows(next.map((item, rowIndex) => ({ ...item, shotNumber: rowIndex + 1 })));
    };
    const removeRow = (rowId: string) => onUpdateRows(rows.filter((row) => row.id !== rowId).map((row, index) => ({ ...row, shotNumber: index + 1 })));

    const columns: ColumnsType<StoryboardRow> = columnOptions.filter((option) => visibleColumns.includes(option.value)).map((option) => ({
        title: option.label,
        dataIndex: option.value,
        key: option.value,
        width: option.value === "shotNumber" ? 72 : option.value === "durationSeconds" ? 100 : option.value === "plotDescription" || option.value === "dialogue" || option.value === "timeBeats" || option.value.endsWith("Prompt") ? 260 : 170,
        fixed: option.value === "shotNumber" ? "left" as const : undefined,
        render: (_: unknown, row: StoryboardRow) => option.value === "shotNumber" ? <span className="font-semibold">{row.shotNumber}</span> : option.value === "durationSeconds" ? <InputNumber min={1} max={60} value={row.durationSeconds} addonAfter="s" onChange={(value) => updateRow(row.id, { durationSeconds: Number(value) || 1 })} /> : option.value === "shotSize" ? <Select className="w-full" value={row.shotSize || undefined} placeholder="选择景别" options={["特写", "近景", "中景", "全景", "远景"].map((value) => ({ value, label: value }))} onChange={(shotSize) => updateRow(row.id, { shotSize })} /> : <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} value={String(row[option.value] || "")} placeholder={`填写${option.label}`} onChange={(event) => updateRow(row.id, { [option.value]: event.target.value } as Partial<StoryboardRow>)} />,
    }));
    columns.push({
        title: "操作", key: "actions", dataIndex: "shotNumber", width: 150, fixed: "right" as const,
        render: (_: unknown, row: StoryboardRow) => <div className="flex gap-1"><SmallButton title="上移" onClick={() => moveRow(row.id, -1)}><ChevronUp className="size-3.5" /></SmallButton><SmallButton title="下移" onClick={() => moveRow(row.id, 1)}><ChevronDown className="size-3.5" /></SmallButton><SmallButton title="复制" onClick={() => duplicateRow(row)}><Copy className="size-3.5" /></SmallButton><SmallButton title="删除" onClick={() => removeRow(row.id)}><Trash2 className="size-3.5" /></SmallButton></div>,
    });

    return (
        <Modal title={node?.title || "分镜脚本"} open={open} onCancel={onClose} footer={null} width="min(1480px, calc(100vw - 40px))" centered destroyOnHidden>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input.Search className="w-72" allowClear placeholder="筛选画面、台词或提示词" value={query} onChange={(event) => setQuery(event.target.value)} />
                <Checkbox.Group className="script-column-picker" options={columnOptions} value={visibleColumns} onChange={(values) => onVisibleColumnsChange(values as StoryboardColumn[])} />
                <span className="min-w-0 flex-1" />
                <Button icon={<Plus className="size-4" />} onClick={() => onUpdateRows([...rows, editorRow(rows.length + 1)])}>新增镜头</Button>
                <Button icon={<ImageIcon className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateImages(selectedIds)}>生成分镜图</Button>
                <Button type="primary" icon={<Film className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateVideos(selectedIds)}>生成视频</Button>
            </div>
            <Table<StoryboardRow> rowKey="id" size="small" bordered sticky pagination={false} scroll={{ x: Math.max(900, columns.length * 180), y: "calc(78vh - 170px)" }} dataSource={filteredRows} columns={columns} rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }} />
        </Modal>
    );
}

function CompactInput({ value, placeholder, borderColor, onChange }: { value: string; placeholder: string; borderColor: string; onChange: (value: string) => void }) {
    return <textarea className="h-full resize-none border-r bg-transparent px-4 py-2.5 text-xs leading-5 outline-none transition placeholder:opacity-35 focus:bg-black/[0.02] dark:focus:bg-white/[0.025]" style={{ borderColor }} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} />;
}

function HeaderCell({ children, borderColor, align = "left" }: { children: ReactNode; borderColor: string; align?: "left" | "center" }) {
    return <span className={`flex h-full items-center border-r px-4 ${align === "center" ? "justify-center text-center" : "justify-start"}`} style={{ borderColor }}>{children}</span>;
}

function SmallButton({ title, children, onClick }: { title: string; children: ReactNode; onClick: () => void }) {
    return <button type="button" className="grid size-7 shrink-0 place-items-center rounded opacity-65 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10" title={title} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button>;
}

function editorRow(shotNumber: number): StoryboardRow {
    return { id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, shotNumber, durationSeconds: 6, plotDescription: "", dialogue: "", characters: [], shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "", negativePrompt: "", referenceNodeIds: [], status: "idle" };
}

function RowHandle({ side, top, scale, tone, theme, title, onPointerDown }: { side: "left" | "right"; top: number; scale: number; tone?: StoryboardRow["status"]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; title?: string; onPointerDown: (event: ReactPointerEvent) => void }) {
    const color = tone === "loading" ? theme.accent.primary : tone === "error" ? theme.accent.danger : tone === "success" ? theme.node.activeStroke : theme.node.muted;
    const inverseScale = 1 / Math.max(scale, 0.05);
    return (
        <button
            type="button"
            aria-label={title || `${side === "left" ? "输入" : "输出"}连接点`}
            title={title || `${side === "left" ? "引入参考" : "连接到图片、视频或生成节点"}`}
            className={`canvas-connection-handle absolute z-50 flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 ${side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
            style={{ top, width: 32 * inverseScale, height: 32 * inverseScale, "--tw-ring-color": theme.accent.primary } as CSSProperties}
            onPointerDown={onPointerDown}
        >
            <span className="block rounded-full shadow-sm transition-transform hover:scale-110" style={{ width: 14 * inverseScale, height: 14 * inverseScale, border: `${2 * inverseScale}px solid ${theme.node.panel}`, background: color }} />
        </button>
    );
}
