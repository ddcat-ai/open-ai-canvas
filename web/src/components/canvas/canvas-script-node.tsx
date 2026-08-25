import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, Input, InputNumber, Modal, Segmented, Select, Table, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronDown, ChevronUp, Clapperboard, Copy, Expand, Film, Grid3X3, Image as ImageIcon, ListTree, Merge, MoreHorizontal, Plus, RefreshCw, Send, Square, Trash2, Video } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { StoryboardAssetsCell } from "@/components/canvas/storyboard-assets-cell";
import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { pipelineStatusLabel, type CanvasStoryboardPipelineProgress, type StoryboardPipelineStage } from "@/lib/canvas/canvas-storyboard-progress";
import { generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { generationTaskShowsProgress, generationTaskStageLabel } from "@/lib/generation-task-display";
import { navigateToSettings } from "@/lib/settings-navigation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { STORYBOARD_COMPOSER_MIN_HEIGHT, STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/lib/canvas/canvas-storyboard-layout";
import type {
    CanvasGenerationBatch,
    CanvasGenerationBatchItem,
    CanvasGenerationBatchItemStatus,
    CanvasNodeData,
    CanvasNodeStatus,
    CanvasWorkspaceMode,
    StoryboardColumn,
    StoryboardRow,
    StoryboardShotCount,
    StoryboardShotDuration,
    StoryboardVideoInputMode,
} from "@/types/canvas";
import type { TaskStatus } from "@/services/api/task-center";

const STORYBOARD_PROMPT_MIN_HEIGHT = 40;
const STORYBOARD_PROMPT_MAX_HEIGHT = 116;
const SCRIPT_GRID_TEMPLATE = "64px 76px minmax(300px, 1.55fr) minmax(220px, 1fr) 180px";
const EMPTY_STORYBOARD_ROWS: StoryboardRow[] = [];
const DEFAULT_STORYBOARD_COLUMNS: StoryboardColumn[] = ["shotNumber", "durationSeconds", "videoMotionPrompt", "dialogue", "assets"];
const LEGACY_STORYBOARD_COLUMNS: StoryboardColumn[] = ["shotNumber", "durationSeconds", "plotDescription", "dialogue"];
const PREVIOUS_DEFAULT_STORYBOARD_COLUMNS: StoryboardColumn[] = ["shotNumber", "plotDescription", "videoMotionPrompt", "dialogue"];

function resolveStoryboardVisibleColumns(columns?: StoryboardColumn[]) {
    const isLegacyDefault = columns?.length === LEGACY_STORYBOARD_COLUMNS.length && LEGACY_STORYBOARD_COLUMNS.every((column) => columns.includes(column));
    const isPreviousDefault = columns?.length === PREVIOUS_DEFAULT_STORYBOARD_COLUMNS.length && PREVIOUS_DEFAULT_STORYBOARD_COLUMNS.every((column) => columns.includes(column));
    if (!columns?.length || isLegacyDefault || isPreviousDefault) {
        return DEFAULT_STORYBOARD_COLUMNS;
    }
    return columns;
}

const columnOptions: Array<{ label: string; value: StoryboardColumn }> = [
    { label: "序号", value: "shotNumber" },
    { label: "时长", value: "durationSeconds" },
    { label: "画面描述", value: "plotDescription" },
    { label: "台词/旁白", value: "dialogue" },
    { label: "镜头意图", value: "narrativeIntent" },
    { label: "观众视点", value: "viewerPOV" },
    { label: "表演调度", value: "performanceBlocking" },
    { label: "景别", value: "shotSize" },
    { label: "情绪", value: "emotion" },
    { label: "光影氛围", value: "lightingAndAtmosphere" },
    { label: "音效", value: "audioEffects" },
    { label: "镜头设计", value: "camera" },
    { label: "运镜", value: "motion" },
    { label: "时间节拍", value: "timeBeats" },
    { label: "图片提示词", value: "imageGenerationPrompt" },
    { label: "视频提示词", value: "videoMotionPrompt" },
    { label: "关联资产", value: "assets" },
    { label: "连续性出口", value: "continuityOut" },
    { label: "负面要求", value: "negativePrompt" },
];

export function CanvasScriptNodeContent({
    node,
    nodes,
    batch,
    pipeline,
    scale,
    mentionReferences,
    onOpen,
    onCreateImageNodes,
    onCreateVideoNodes,
    onGenerateImages,
    onGenerateVideos,
    onVideoInputModeChange,
    onMergeVideos,
    onCreateActionBoards,
    onRetryBatch,
    onRetryBatchItem,
    onStopBatch,
    onAddRow,
    onRemoveRow,
    onUpdateRow,
    onPromptChange,
    onGenerateScript,
    onModelChange,
    onShotDurationChange,
    onShotCountChange,
    onComposerHeightChange,
    onConnectStart,
    onScrollTopChange,
    workspaceMode = "professional",
}: {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    batch?: CanvasGenerationBatch;
    pipeline: CanvasStoryboardPipelineProgress;
    scale: number;
    mentionReferences: CanvasResourceReference[];
    onOpen: () => void;
    onCreateImageNodes: () => void;
    onCreateVideoNodes: () => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
    onMergeVideos: () => void;
    onCreateActionBoards: () => void;
    onRetryBatch: (batchId: string) => void;
    onRetryBatchItem: (batchId: string, itemId: string) => void;
    onStopBatch: (batchId: string) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<StoryboardRow>) => void;
    onPromptChange: (prompt: string) => void;
    onGenerateScript: (prompt: string) => void;
    onModelChange: (model: string) => void;
    onShotDurationChange: (duration: StoryboardShotDuration) => void;
    onShotCountChange: (count: StoryboardShotCount) => void;
    onComposerHeightChange: (height: number) => void;
    onConnectStart: (event: ReactPointerEvent, rowId: string, handleType: "source" | "target") => void;
    onScrollTopChange: (scrollTop: number) => void;
    workspaceMode?: CanvasWorkspaceMode;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const generationConfig = buildGenerationConfig(effectiveConfig, node, "text");
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
    const videoInputMode = node.metadata?.storyboardVideoInputMode || "direct";
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const batchSummary = batch ? generationBatchSummary(batch) : null;
    const hasFailedBatchItems = Boolean(batch?.items.some((item) => item.status === "failed"));
    const hasWaitingBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting"));
    const hasActiveBatchItems = Boolean(batch?.items.some((item) => item.status === "waiting" || item.status === "submitting" || item.status === "queued" || item.status === "running"));
    const taskStatus = node.metadata?.taskStatus;
    const displayStatus: TaskStatus = taskStatus === "queued" || taskStatus === "succeeded" || taskStatus === "failed" || taskStatus === "cancelled" ? taskStatus : "running";
    const displayTask = node.metadata?.taskId
        ? {
              provider: node.metadata.taskProvider,
              status: displayStatus,
              stage: node.metadata.taskStage,
              officialStatus: node.metadata.taskOfficialStatus,
              errorCode: node.metadata.taskErrorCode,
          }
        : null;
    const taskFeedback =
        node.metadata?.status === "loading"
            ? displayTask
                ? `${generationTaskStageLabel(displayTask)}${generationTaskShowsProgress(displayTask) && typeof node.metadata.taskProgress === "number" ? ` · ${node.metadata.taskProgress}%` : ""}`
                : "正在创建任务"
            : node.metadata?.status === "error"
              ? generationErrorMessage(node.metadata.errorDetails)
              : "";
    const [batchDetailsOpen, setBatchDetailsOpen] = useState(false);
    const [moreMenuOpen, setMoreMenuOpen] = useState(false);
    const pipelineDisabled = !rows.length || node.metadata?.status === "loading" || hasActiveBatchItems;
    const missingImages = Math.max(0, pipeline.images.total - pipeline.images.created);
    const missingVideos = Math.max(0, pipeline.videos.total - pipeline.videos.created);
    const canMerge = pipeline.successfulVideoNodeIds.length >= 2 && pipeline.final.success === 0;
    const allRowIds = pipeline.rows.map((item) => item.row.id);
    const moreMenuItems: MenuProps["items"] = [
        { key: "generate-images", icon: <ImageIcon className="size-3.5" />, label: "生成未完成分镜图", disabled: pipelineDisabled || pipeline.images.incomplete === 0, onClick: () => onGenerateImages(allRowIds) },
        { key: "generate-videos", icon: <Video className="size-3.5" />, label: "生成未完成视频", disabled: pipelineDisabled || pipeline.videos.incomplete === 0, onClick: () => onGenerateVideos(allRowIds) },
        {
            key: "merge",
            icon: <Merge className="size-3.5" />,
            label: pipeline.final.success ? "成片已完成" : pipeline.successfulVideoNodeIds.length >= 2 ? `合并 ${pipeline.successfulVideoNodeIds.length} 段视频` : "合并成片（至少 2 段视频）",
            disabled: !canMerge,
            onClick: () => onMergeVideos(),
        },
        { type: "divider" },
        {
            key: "video-input",
            icon: <Film className="size-3.5" />,
            label: "视频输入模式",
            children: [
                { key: "video-input-direct", label: videoInputMode === "direct" ? "✓ 直接生成" : "直接生成", onClick: () => onVideoInputModeChange("direct") },
                { key: "video-input-keyframe", label: videoInputMode === "keyframe" ? "✓ 先做首帧" : "先做首帧", onClick: () => onVideoInputModeChange("keyframe") },
            ],
        },
        ...(!simpleMode
            ? [
                  { type: "divider" as const },
                  { key: "create-image-nodes", icon: <Grid3X3 className="size-3.5" />, label: missingImages ? `创建 ${missingImages} 个图片节点` : "图片节点已创建", disabled: pipelineDisabled || missingImages === 0, onClick: () => onCreateImageNodes() },
                  { key: "create-video-nodes", icon: <Film className="size-3.5" />, label: missingVideos ? `创建 ${missingVideos} 个视频节点` : "视频节点已创建", disabled: pipelineDisabled || missingVideos === 0, onClick: () => onCreateVideoNodes() },
                  { key: "action-boards", icon: <Grid3X3 className="size-3.5" />, label: "生成动作拆分 12 宫格", disabled: !rows.length || hasActiveBatchItems, onClick: () => onCreateActionBoards() },
              ]
            : []),
        ...(batch
            ? [
                  { type: "divider" as const },
                  { key: "retry", icon: <RefreshCw className="size-3.5" />, label: "重试失败项", disabled: !hasFailedBatchItems, onClick: () => onRetryBatch(batch.id) },
                  { key: "stop", icon: <Square className="size-3.5" />, label: "停止剩余任务", disabled: !hasWaitingBatchItems, onClick: () => onStopBatch(batch.id) },
                  { key: "details", icon: <ListTree className="size-3.5" />, label: "查看批次详情", onClick: () => setBatchDetailsOpen(true) },
              ]
            : []),
    ];
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
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={node.title || "分镜脚本"}>
                    {node.title || "分镜脚本"}
                </span>
                {batchSummary ? (
                    <span className="min-w-0 max-w-[42%] truncate text-[var(--fs-label)] font-medium" title={batchSummary} style={{ color: batch?.status === "partial_failed" ? theme.accent.danger : theme.node.muted }}>
                        {batchSummary}
                    </span>
                ) : taskFeedback ? (
                    <span className="min-w-0 max-w-[38%] truncate text-[var(--fs-label)] font-medium" title={taskFeedback} style={{ color: node.metadata?.status === "error" ? theme.accent.danger : theme.node.muted }}>
                        {taskFeedback}
                    </span>
                ) : null}
                <span className="text-[var(--fs-caption)] font-semibold tabular-nums" style={{ color: theme.node.muted }}>
                    {rows.length} 镜 · {totalDuration}s
                </span>
                <Tooltip title="全屏编辑">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onOpen();
                        }}
                        aria-label="全屏编辑"
                    >
                        <Expand className="size-3.5" />
                    </button>
                </Tooltip>
                <Dropdown open={moreMenuOpen} onOpenChange={setMoreMenuOpen} menu={{ items: moreMenuItems, onClick: () => setMoreMenuOpen(false) }} trigger={["click"]} placement="bottomRight">
                    <button
                        type="button"
                        className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                        onMouseDown={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            setMoreMenuOpen(true);
                        }}
                        aria-label="更多操作"
                    >
                        <MoreHorizontal className="size-3.5" />
                    </button>
                </Dropdown>
            </div>
            {batch ? (
                <Modal title="批次详情" open={batchDetailsOpen} onCancel={() => setBatchDetailsOpen(false)} footer={null} width={560} centered destroyOnHidden>
                    <GenerationBatchDetails batch={batch} rows={rows} onRetryItem={(itemId) => onRetryBatchItem(batch.id, itemId)} />
                </Modal>
            ) : null}
            <StoryboardMiniPipeline pipeline={pipeline} theme={theme} rows={rows} />
            <div className="storyboard-header-gutter grid h-9 shrink-0 items-center border-b text-xs font-semibold" style={{ borderColor: theme.node.stroke, color: theme.node.muted, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                <HeaderCell borderColor={theme.node.stroke} align="center">
                    序号
                </HeaderCell>
                <HeaderCell borderColor={theme.node.stroke} align="center">时长</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>视频提示词</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>台词/旁白</HeaderCell>
                <span className="px-3">关联资产</span>
            </div>
            <div
                data-canvas-wheel-scroll
                tabIndex={0}
                role="region"
                aria-label="分镜镜头列表"
                className="storyboard-scrollbar min-h-0 flex-1 overflow-y-scroll overflow-x-hidden outline-none focus-visible:ring-1 focus-visible:ring-inset"
                style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                onScroll={(event) => {
                    const next = event.currentTarget.scrollTop;
                    setScrollTop(next);
                    onScrollTopChange(next);
                }}
                onWheel={(event) => event.stopPropagation()}
            >
                {rows.length ? (
                    rows.map((row) => (
                        <div key={row.id} className="relative grid border-b" style={{ height: STORYBOARD_ROW_HEIGHT, borderColor: theme.node.stroke, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                            <div className="flex flex-col items-center justify-center gap-0.5 border-r tabular-nums" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}>
                                <div className="flex items-center gap-0.5">
                                    <span className="text-sm">{row.shotNumber}</span>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{ items: [{ key: "delete", label: "删除镜头", icon: <Trash2 className="size-3.5" />, danger: true, disabled: rows.length <= 1, onClick: () => onRemoveRow(row.id) }] }}
                                    >
                                        <button
                                            type="button"
                                            className="grid size-5 place-items-center rounded outline-none opacity-45 transition hover:bg-black/5 hover:opacity-100 focus-visible:ring-2 dark:hover:bg-white/10"
                                            aria-label={`镜头 ${row.shotNumber} 操作`}
                                            onMouseDown={(event) => event.stopPropagation()}
                                            onPointerDown={(event) => event.stopPropagation()}
                                            onClick={(event) => event.stopPropagation()}
                                        >
                                            <MoreHorizontal className="size-3" />
                                        </button>
                                    </Dropdown>
                                </div>
                                {batchItemByRowId.get(row.id) ? (
                                    <span className="max-w-14 truncate text-[var(--fs-micro)] leading-3" title={generationBatchItemLabel(batchItemByRowId.get(row.id)!)}>
                                        {generationBatchItemLabel(batchItemByRowId.get(row.id)!)}
                                    </span>
                                ) : null}
                            </div>
                            <CompactDurationInput value={row.durationSeconds} borderColor={theme.node.stroke} onChange={(durationSeconds) => onUpdateRow(row.id, { durationSeconds })} />
                            <CompactInput value={row.videoMotionPrompt} placeholder="描述视频运动、镜头和动作" onChange={(value) => onUpdateRow(row.id, { videoMotionPrompt: value })} borderColor={theme.node.stroke} />
                            <CompactInput value={row.dialogue} placeholder="台词或旁白" onChange={(value) => onUpdateRow(row.id, { dialogue: value })} borderColor={theme.node.stroke} />
                            <div className="flex h-full min-w-0 items-center px-3">
                                <StoryboardAssetsCell bindings={row.assetBindings || []} nodes={nodes} />
                            </div>
                        </div>
                    ))
                ) : (
                    <button
                        type="button"
                        className="grid h-full min-h-36 w-full place-items-center"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onAddRow();
                        }}
                    >
                        <span className="flex flex-col items-center gap-2.5">
                            <span className="text-sm font-bold">＋ 添加第一个镜头</span>
                            <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.faint }}>
                                可先连接「故事梗概 / 项目画风」节点，或在下方输入提示词一键生成分镜表
                            </span>
                        </span>
                    </button>
                )}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-center border-b" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <button
                    type="button"
                    className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                    style={{ "--tw-ring-color": theme.node.muted } as CSSProperties}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                        event.stopPropagation();
                        onAddRow();
                    }}
                >
                    <Plus className="size-3.5" />
                    添加行
                </button>
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
                    <Tooltip title="脚本生成需要文本理解与结构化输出能力，仅展示文本模型；视频/图片模型无法生成分镜表" placement="topLeft">
                        <div className="mr-auto min-w-36 max-w-56 flex-1">
                            <ModelPicker
                                className="!h-7 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                                fullWidth
                                config={generationConfig}
                                value={generationConfig.model}
                                capability="text"
                                placeholder="选择文本模型"
                                showSelectedPrice={false}
                                onChange={onModelChange}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            />
                        </div>
                    </Tooltip>
                    {simpleMode ? (
                        <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            自动拆分 · 时长自动
                        </span>
                    ) : (
                        <Select<StoryboardShotCount>
                            className="min-w-24"
                            size="small"
                            value={shotCount}
                            disabled={node.metadata?.status === "loading"}
                            options={[{ value: "auto", label: "自动拆分" }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1) as StoryboardShotCount, label: `${index + 1} 镜` }))]}
                            popupMatchSelectWidth={false}
                            onChange={onShotCountChange}
                        />
                    )}
                    {simpleMode ? null : (
                        <Select<StoryboardShotDuration>
                            className="min-w-24"
                            size="small"
                            value={shotDuration}
                            disabled={node.metadata?.status === "loading"}
                            options={[
                                { value: "auto", label: "时长自动" },
                                { value: "5", label: "5 秒" },
                                { value: "10", label: "10 秒" },
                                { value: "15", label: "15 秒" },
                                { value: "30", label: "30 秒" },
                            ]}
                            popupMatchSelectWidth={false}
                            onChange={onShotDurationChange}
                        />
                    )}
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

function storyboardStepState(stage: StoryboardPipelineStage): "done" | "current" | "error" | "idle" {
    if (stage.failed > 0 && stage.success === 0) return "error";
    if (stage.success > 0) return "done";
    if (stage.loading > 0 || stage.incomplete > 0) return "current";
    return "idle";
}

function StoryboardMiniPipeline({ pipeline, theme, rows }: { pipeline: CanvasStoryboardPipelineProgress; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; rows: StoryboardRow[] }) {
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

function GenerationBatchDetails({ batch, rows, onRetryItem }: { batch: CanvasGenerationBatch; rows: StoryboardRow[]; onRetryItem: (itemId: string) => void }) {
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

export function CanvasScriptEditor({
    node,
    nodes,
    open,
    onClose,
    onUpdateRows,
    onVisibleColumnsChange,
    onGenerateImages,
    onGenerateVideos,
    onVideoInputModeChange,
}: {
    node: CanvasNodeData | null;
    nodes: CanvasNodeData[];
    open: boolean;
    onClose: () => void;
    onUpdateRows: (rows: StoryboardRow[]) => void;
    onVisibleColumnsChange: (columns: StoryboardColumn[]) => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
}) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const rows = node?.metadata?.storyboard?.rows || EMPTY_STORYBOARD_ROWS;
    const visibleColumns = resolveStoryboardVisibleColumns(node?.metadata?.storyboard?.visibleColumns);
    const videoInputMode = node?.metadata?.storyboardVideoInputMode || "direct";
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const filteredRows = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return keyword
            ? rows.filter((row) =>
                  [row.plotDescription, row.dialogue, row.camera, row.motion, row.timeBeats, row.imageGenerationPrompt, row.videoMotionPrompt, row.negativePrompt, ...(row.assetBindings || []).map((binding) => nodeById.get(binding.nodeId)?.title || "")].some((value) =>
                      String(value || "")
                          .toLowerCase()
                          .includes(keyword),
                  ),
              )
            : rows;
    }, [nodeById, query, rows]);
    useEffect(() => {
        setSelectedIds((current) => {
            const next = current.filter((id) => rows.some((row) => row.id === id));
            return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
        });
    }, [rows]);
    const updateRow = (rowId: string, patch: Partial<StoryboardRow>) => onUpdateRows(rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)));
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

    const columns: ColumnsType<StoryboardRow> = columnOptions
        .filter((option) => visibleColumns.includes(option.value))
        .map((option) => ({
            title: option.label,
            dataIndex: option.value,
            key: option.value,
            width: option.value === "shotNumber" ? 72 : option.value === "durationSeconds" ? 100 : option.value === "assets" ? 220 : option.value === "plotDescription" || option.value === "dialogue" || option.value === "timeBeats" || option.value.endsWith("Prompt") ? 260 : 170,
            fixed: option.value === "shotNumber" ? ("left" as const) : undefined,
            render: (_: unknown, row: StoryboardRow) =>
                option.value === "shotNumber" ? (
                    <span className="font-semibold">{row.shotNumber}</span>
                ) : option.value === "durationSeconds" ? (
                    <InputNumber min={1} max={60} value={row.durationSeconds} addonAfter="s" onChange={(value) => updateRow(row.id, { durationSeconds: Number(value) || 1 })} />
                ) : option.value === "assets" ? (
                    <StoryboardAssetsCell bindings={row.assetBindings || []} nodes={nodes} />
                ) : option.value === "shotSize" ? (
                    <Select
                        className="w-full"
                        value={row.shotSize || undefined}
                        placeholder="选择景别"
                        options={["特写", "近景", "中景", "全景", "远景"].map((value) => ({ value, label: value }))}
                        onChange={(shotSize) => updateRow(row.id, { shotSize })}
                    />
                ) : (
                    <Input.TextArea
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={String(row[option.value] || "")}
                        placeholder={`填写${option.label}`}
                        onChange={(event) => updateRow(row.id, { [option.value]: event.target.value } as Partial<StoryboardRow>)}
                    />
                ),
        }));
    columns.push({
        title: "操作",
        key: "actions",
        dataIndex: "shotNumber",
        width: 150,
        fixed: "right" as const,
        render: (_: unknown, row: StoryboardRow) => (
            <div className="flex gap-1">
                <SmallButton title="上移" onClick={() => moveRow(row.id, -1)}>
                    <ChevronUp className="size-3.5" />
                </SmallButton>
                <SmallButton title="下移" onClick={() => moveRow(row.id, 1)}>
                    <ChevronDown className="size-3.5" />
                </SmallButton>
                <SmallButton title="复制" onClick={() => duplicateRow(row)}>
                    <Copy className="size-3.5" />
                </SmallButton>
                <SmallButton title="删除" onClick={() => removeRow(row.id)}>
                    <Trash2 className="size-3.5" />
                </SmallButton>
            </div>
        ),
    });

    return (
        <Modal title={node?.title || "分镜脚本"} open={open} onCancel={onClose} footer={null} width="min(1480px, calc(100vw - 40px))" centered destroyOnHidden>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input.Search className="w-72" allowClear placeholder="筛选画面、台词或提示词" value={query} onChange={(event) => setQuery(event.target.value)} />
                <Checkbox.Group className="script-column-picker" options={columnOptions} value={visibleColumns} onChange={(values) => onVisibleColumnsChange(values as StoryboardColumn[])} />
                <span className="min-w-0 flex-1" />
                <Button icon={<Plus className="size-4" />} onClick={() => onUpdateRows([...rows, editorRow(rows.length + 1)])}>
                    新增镜头
                </Button>
                <Button icon={<ImageIcon className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateImages(selectedIds)}>
                    生成{videoInputMode === "keyframe" ? "首帧" : "分镜图"}
                </Button>
                <Segmented<StoryboardVideoInputMode>
                    value={videoInputMode}
                    options={[
                        { value: "direct", label: "直接生成" },
                        { value: "keyframe", label: "先做首帧" },
                    ]}
                    onChange={onVideoInputModeChange}
                />
                <Button type="primary" icon={<Film className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateVideos(selectedIds)}>
                    {videoInputMode === "keyframe" ? "确认首帧并生成" : "生成视频"}
                </Button>
            </div>
            <Table<StoryboardRow>
                rowKey="id"
                size="small"
                bordered
                sticky
                pagination={false}
                scroll={{ x: Math.max(900, columns.length * 180), y: "calc(78vh - 170px)" }}
                dataSource={filteredRows}
                columns={columns}
                rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }}
            />
        </Modal>
    );
}

function CompactInput({ value, placeholder, borderColor, onChange }: { value: string; placeholder: string; borderColor: string; onChange: (value: string) => void }) {
    return (
        <textarea
            className="thin-scrollbar h-full w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-r bg-transparent px-4 py-2.5 text-xs leading-5 outline-none transition placeholder:opacity-35 focus:bg-black/[0.02] dark:focus:bg-white/[0.025]"
            style={{ borderColor }}
            value={value}
            placeholder={placeholder}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        />
    );
}

function CompactDurationInput({ value, borderColor, onChange }: { value: number; borderColor: string; onChange: (value: number) => void }) {
    return (
        <label className="flex h-full items-center justify-center gap-1 border-r text-xs tabular-nums text-foreground/60" style={{ borderColor }}>
            <input
                type="number"
                min={1}
                max={60}
                value={value}
                className="w-9 bg-transparent text-right outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary)]"
                aria-label="镜头时长（秒）"
                onChange={(event) => onChange(Math.max(1, Math.min(60, Number(event.target.value) || 1)))}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
            />
            秒
        </label>
    );
}

function HeaderCell({ children, borderColor, align = "left" }: { children: ReactNode; borderColor: string; align?: "left" | "center" }) {
    return (
        <span className={`flex h-full items-center border-r px-4 ${align === "center" ? "justify-center text-center" : "justify-start"}`} style={{ borderColor }}>
            {children}
        </span>
    );
}

function SmallButton({ title, children, onClick, disabled }: { title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="grid size-7 shrink-0 place-items-center rounded opacity-65 transition enabled:hover:bg-black/5 enabled:hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 dark:enabled:hover:bg-white/10"
            title={title}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onClick();
            }}
        >
            {children}
        </button>
    );
}

function editorRow(shotNumber: number): StoryboardRow {
    return {
        id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        shotNumber,
        durationSeconds: 6,
        plotDescription: "",
        dialogue: "",
        characters: [],
        narrativeIntent: "",
        viewerPOV: "",
        performanceBlocking: "",
        shotSize: "",
        emotion: "",
        lightingAndAtmosphere: "",
        audioEffects: "",
        camera: "",
        motion: "",
        timeBeats: "",
        imageGenerationPrompt: "",
        videoMotionPrompt: "",
        mustHave: [],
        optionalDetails: [],
        continuityOut: "",
        negativePrompt: "",
        assetBindings: [],
        status: "idle",
    };
}

function RowHandle({
    side,
    top,
    scale,
    tone,
    theme,
    title,
    onPointerDown,
}: {
    side: "left" | "right";
    top: number;
    scale: number;
    tone?: StoryboardRow["status"];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    title?: string;
    onPointerDown: (event: ReactPointerEvent) => void;
}) {
    const color = tone === "loading" ? theme.accent.primary : tone === "error" ? theme.accent.danger : tone === "success" ? theme.node.activeStroke : theme.node.muted;
    const inverseHitScale = 1 / Math.max(scale, 0.05);
    return (
        <button
            type="button"
            aria-label={title || `${side === "left" ? "输入" : "输出"}连接点`}
            title={title || `${side === "left" ? "引入参考" : "连接到图片、视频或生成节点"}`}
            className={`canvas-connection-handle absolute z-[var(--node-z-handle)] flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 ${side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
            style={{ top, width: 32 * inverseHitScale, height: 32 * inverseHitScale, "--tw-ring-color": theme.accent.primary } as CSSProperties}
            onPointerDown={onPointerDown}
        >
            <span className="block size-2.5 rounded-full border-2 shadow-sm transition-transform hover:scale-110" style={{ boxSizing: "border-box", borderColor: theme.node.panel, background: color }} />
        </button>
    );
}
