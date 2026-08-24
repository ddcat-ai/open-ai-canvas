import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Checkbox, Dropdown, Input, InputNumber, Modal, Segmented, Select, Table, Tooltip } from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronDown, ChevronUp, Clapperboard, Copy, Expand, Film, Grid3X3, Image as ImageIcon, ListTree, Merge, MoreHorizontal, Plus, RefreshCw, Send, Square, Trash2, Video } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
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
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const STORYBOARD_PROMPT_MIN_HEIGHT = 40;
const STORYBOARD_PROMPT_MAX_HEIGHT = 116;
const SCRIPT_GRID_TEMPLATE = "72px minmax(220px, 1fr) minmax(300px, 1.4fr) minmax(220px, 1fr) 58px";
const EMPTY_STORYBOARD_ROWS: StoryboardRow[] = [];
const DEFAULT_STORYBOARD_COLUMNS: StoryboardColumn[] = ["shotNumber", "plotDescription", "videoMotionPrompt", "dialogue"];
const LEGACY_STORYBOARD_COLUMNS: StoryboardColumn[] = ["shotNumber", "durationSeconds", "plotDescription", "dialogue"];

function resolveStoryboardVisibleColumns(columns?: StoryboardColumn[]) {
    if (!columns?.length || (columns.length === LEGACY_STORYBOARD_COLUMNS.length && LEGACY_STORYBOARD_COLUMNS.every((column) => columns.includes(column)))) {
        return DEFAULT_STORYBOARD_COLUMNS;
    }
    return columns;
}

const columnOptions: Array<{ label: string; value: StoryboardColumn }> = [
    { label: t("canvas:no-4"), value: "shotNumber" },
    { label: t("canvas:duration-5"), value: "durationSeconds" },
    { label: t("canvas:scene-description"), value: "plotDescription" },
    { label: t("canvas:dialogue-vo-4"), value: "dialogue" },
    { label: t("canvas:shot-intent"), value: "narrativeIntent" },
    { label: t("canvas:audience-pov"), value: "viewerPOV" },
    { label: t("canvas:acting-direction"), value: "performanceBlocking" },
    { label: t("canvas:shot-size"), value: "shotSize" },
    { label: t("canvas:emotion"), value: "emotion" },
    { label: t("canvas:lighting-and-mood"), value: "lightingAndAtmosphere" },
    { label: t("canvas:sound-effects"), value: "audioEffects" },
    { label: t("canvas:shot-design"), value: "camera" },
    { label: t("canvas:camera-move"), value: "motion" },
    { label: t("canvas:time-beats"), value: "timeBeats" },
    { label: t("canvas:image-prompt-2"), value: "imageGenerationPrompt" },
    { label: t("canvas:video-prompt-4"), value: "videoMotionPrompt" },
    { label: t("canvas:continuity-exit"), value: "continuityOut" },
    { label: t("canvas:negative-requirements"), value: "negativePrompt" },
];

export function CanvasScriptNodeContent({
    node,
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
    const { t } = useTranslation("canvas");
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
                : t("canvas:creating-tasks")
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
        { key: "generate-images", icon: <ImageIcon className="size-3.5" />, label: t("canvas:generate-unfinished-storyboard-frames"), disabled: pipelineDisabled || pipeline.images.incomplete === 0, onClick: () => onGenerateImages(allRowIds) },
        { key: "generate-videos", icon: <Video className="size-3.5" />, label: t("canvas:generate-unfinished-videos"), disabled: pipelineDisabled || pipeline.videos.incomplete === 0, onClick: () => onGenerateVideos(allRowIds) },
        {
            key: "merge",
            icon: <Merge className="size-3.5" />,
            label: pipeline.final.success ? t("canvas:final-cut-finished") : pipeline.successfulVideoNodeIds.length >= 2 ? t("canvas:merge-param-videos", { length: pipeline.successfulVideoNodeIds.length }) : t("canvas:merge-final-cut-at-least-2-videos"),
            disabled: !canMerge,
            onClick: () => onMergeVideos(),
        },
        { type: "divider" },
        {
            key: "video-input",
            icon: <Film className="size-3.5" />,
            label: t("canvas:video-input-mode"),
            children: [
                { key: "video-input-direct", label: videoInputMode === "direct" ? t("canvas:direct-generation") : t("canvas:direct-generation-2"), onClick: () => onVideoInputModeChange("direct") },
                { key: "video-input-keyframe", label: videoInputMode === "keyframe" ? t("canvas:first-frame-first") : t("canvas:first-frame-first-2"), onClick: () => onVideoInputModeChange("keyframe") },
            ],
        },
        ...(!simpleMode
            ? [
                  { type: "divider" as const },
                  {
                      key: "create-image-nodes",
                      icon: <Grid3X3 className="size-3.5" />,
                      label: missingImages ? t("canvas:create-param-image-nodes", { missingImages: missingImages }) : t("canvas:image-node-created"),
                      disabled: pipelineDisabled || missingImages === 0,
                      onClick: () => onCreateImageNodes(),
                  },
                  {
                      key: "create-video-nodes",
                      icon: <Film className="size-3.5" />,
                      label: missingVideos ? t("canvas:create-param-video-nodes", { missingVideos: missingVideos }) : t("canvas:video-node-created"),
                      disabled: pipelineDisabled || missingVideos === 0,
                      onClick: () => onCreateVideoNodes(),
                  },
                  { key: "action-boards", icon: <Grid3X3 className="size-3.5" />, label: t("canvas:generate-12-grid-action-board"), disabled: !rows.length || hasActiveBatchItems, onClick: () => onCreateActionBoards() },
              ]
            : []),
        ...(batch
            ? [
                  { type: "divider" as const },
                  { key: "retry", icon: <RefreshCw className="size-3.5" />, label: t("canvas:retry-failed-items"), disabled: !hasFailedBatchItems, onClick: () => onRetryBatch(batch.id) },
                  { key: "stop", icon: <Square className="size-3.5" />, label: t("canvas:stop-remaining-tasks-2"), disabled: !hasWaitingBatchItems, onClick: () => onStopBatch(batch.id) },
                  { key: "details", icon: <ListTree className="size-3.5" />, label: t("canvas:view-batch-details"), onClick: () => setBatchDetailsOpen(true) },
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
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={node.title || t("canvas:storyboard-script")}>
                    {node.title || t("canvas:storyboard-script")}
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
                    {rows.length} {t("canvas:shots-4")} {totalDuration}s
                </span>
                <Tooltip title={t("canvas:fullscreen-edit")}>
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
                        aria-label={t("canvas:fullscreen-edit")}
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
                        aria-label={t("canvas:more-actions")}
                    >
                        <MoreHorizontal className="size-3.5" />
                    </button>
                </Dropdown>
            </div>
            {batch ? (
                <Modal title={t("canvas:batch-details")} open={batchDetailsOpen} onCancel={() => setBatchDetailsOpen(false)} footer={null} width={560} centered destroyOnHidden>
                    <GenerationBatchDetails batch={batch} rows={rows} onRetryItem={(itemId) => onRetryBatchItem(batch.id, itemId)} />
                </Modal>
            ) : null}
            <StoryboardMiniPipeline pipeline={pipeline} theme={theme} rows={rows} />
            <div className="storyboard-header-gutter grid h-9 shrink-0 items-center border-b text-xs font-semibold" style={{ borderColor: theme.node.stroke, color: theme.node.muted, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
                <HeaderCell borderColor={theme.node.stroke} align="center">
                    {t("canvas:no-4")}
                </HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>{t("canvas:visuals-3")}</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>{t("canvas:video-prompt-4")}</HeaderCell>
                <HeaderCell borderColor={theme.node.stroke}>{t("canvas:dialogue-vo-4")}</HeaderCell>
                <span className="text-center">{t("canvas:actions-4")}</span>
            </div>
            <div
                data-canvas-wheel-scroll
                tabIndex={0}
                role="region"
                aria-label={t("canvas:shot-list-2")}
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
                            <div className="flex flex-col items-center justify-center border-r tabular-nums" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}>
                                <span className="text-sm">{row.shotNumber}</span>
                                {batchItemByRowId.get(row.id) ? (
                                    <span className="max-w-16 truncate text-[var(--fs-micro)] leading-3" title={generationBatchItemLabel(batchItemByRowId.get(row.id)!)}>
                                        {generationBatchItemLabel(batchItemByRowId.get(row.id)!)}
                                    </span>
                                ) : null}
                            </div>
                            <CompactInput value={row.plotDescription} placeholder={t("canvas:describe-the-visuals")} onChange={(value) => onUpdateRow(row.id, { plotDescription: value })} borderColor={theme.node.stroke} />
                            <CompactInput value={row.videoMotionPrompt} placeholder={t("canvas:describe-video-motion-camera-and-action")} onChange={(value) => onUpdateRow(row.id, { videoMotionPrompt: value })} borderColor={theme.node.stroke} />
                            <CompactInput value={row.dialogue} placeholder={t("canvas:dialogue-or-voice-over")} onChange={(value) => onUpdateRow(row.id, { dialogue: value })} borderColor={theme.node.stroke} />
                            <div className="grid h-full place-items-center">
                                <button
                                    type="button"
                                    disabled={rows.length <= 1}
                                    className="grid size-7 place-items-center rounded outline-none opacity-55 transition enabled:hover:bg-red-500/10 enabled:hover:opacity-100 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-20"
                                    style={{ color: theme.accent.danger, "--tw-ring-color": theme.accent.danger } as CSSProperties}
                                    title={rows.length <= 1 ? t("canvas:keep-at-least-one-shot") : t("canvas:delete-shot")}
                                    aria-label={t("canvas:delete-shot-param", { shotNumber: row.shotNumber })}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        onRemoveRow(row.id);
                                    }}
                                >
                                    <Trash2 className="size-3.5" />
                                </button>
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
                            <span className="text-sm font-bold">{t("canvas:add-first-shot-3")}</span>
                            <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.faint }}>
                                {t("canvas:connect-a-synopsis-project-style-node-or-type-a-prompt-below-to-generate-3")}
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
                    {t("canvas:add-row-3")}
                </button>
            </div>
            <div className="relative grid shrink-0 grid-rows-[minmax(0,1fr)_28px] gap-1.5 rounded-b-[17px] p-2.5" style={{ height: composerHeight, background: theme.node.panel }}>
                <CanvasResourceMentionTextarea
                    rows={1}
                    references={mentionReferences}
                    aria-label={t("canvas:storyboard-plot-and-project-setup")}
                    containerClassName="h-full min-h-0 overflow-hidden"
                    className="thin-scrollbar h-full min-h-0 w-full touch-pan-y resize-none overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border bg-transparent px-3 py-2 text-sm leading-5 outline-none transition placeholder:opacity-45 focus:ring-1"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    value={prompt}
                    placeholder={t("canvas:describe-the-script-or-video-to-generate")}
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
                    <Tooltip title={t("canvas:script-generation-needs-text-understanding-and-structured-output-only-te")} placement="topLeft">
                        <div className="mr-auto min-w-36 max-w-56 flex-1">
                            <ModelPicker
                                className="!h-7 !w-full !min-w-0 !text-[var(--fs-tiny)] !font-normal [&_img]:!size-3 [&_.lucide]:!size-3"
                                fullWidth
                                config={generationConfig}
                                value={generationConfig.model}
                                capability="text"
                                placeholder={t("canvas:select-text-model")}
                                showSelectedPrice={false}
                                onChange={onModelChange}
                                onMissingConfig={() => navigateToSettings({ continueCreation: true })}
                            />
                        </div>
                    </Tooltip>
                    {simpleMode ? (
                        <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                            {t("canvas:auto-split-auto-duration-3")}
                        </span>
                    ) : (
                        <Select<StoryboardShotCount>
                            className="min-w-24"
                            size="small"
                            value={shotCount}
                            disabled={node.metadata?.status === "loading"}
                            options={[{ value: "auto", label: t("canvas:auto-split") }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1) as StoryboardShotCount, label: t("canvas:shots-n", { n: index + 1 }) }))]}
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
                                { value: "auto", label: t("canvas:auto-duration") },
                                { value: "5", label: t("canvas:5s") },
                                { value: "10", label: t("canvas:10s") },
                                { value: "15", label: t("canvas:15s") },
                                { value: "30", label: t("canvas:30s") },
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
                <RowHandle side="left" top={composerHeight / 2} scale={scale} tone="idle" theme={theme} title={t("canvas:connect-a-text-node-as-project-setup")} onPointerDown={(event) => onConnectStart(event, "context", "target")} />
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
    const { t } = useTranslation("canvas");
    const steps: Array<{ key: string; label: string; state: "done" | "current" | "error" | "idle"; hint: string }> = [
        { key: "script", label: t("canvas:storyboards"), state: rows.length > 0 ? "done" : "idle", hint: rows.length > 0 ? t("canvas:param-shots", { length: rows.length }) : t("canvas:shots-to-add") },
        { key: "images", label: t("canvas:storyboard-frame-optional"), state: storyboardStepState(pipeline.images), hint: pipelineStatusLabel(pipeline.images) },
        { key: "videos", label: t("canvas:videos-4"), state: storyboardStepState(pipeline.videos), hint: pipelineStatusLabel(pipeline.videos) },
        {
            key: "final",
            label: t("canvas:merge-videos-2"),
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
    const { t } = useTranslation("canvas");
    const shotByRowId = new Map(rows.map((row) => [row.id, row.shotNumber]));
    return (
        <div className="w-80" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">
                    {generationBatchModeLabel(batch)}
                    {t("canvas:details-7")}
                </span>
                <span className="text-xs text-foreground/50">
                    {batch.items.length} {t("canvas:items-7")}
                </span>
            </div>
            <div className="thin-scrollbar max-h-72 overflow-y-auto">
                {batch.items.map((item) => {
                    const requiresPromptChange = isContentModerationError(item.errorDetails);
                    return (
                        <div key={item.id} className="flex min-h-9 items-center gap-2 border-t border-foreground/10 py-1.5 first:border-t-0">
                            <span className="w-14 shrink-0 text-xs font-medium">
                                {t("canvas:shots-4")} {shotByRowId.get(item.rowId) || "--"}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-xs text-foreground/60" title={item.errorDetails ? generationErrorMessage(item.errorDetails) : undefined}>
                                {generationBatchItemLabel(item)}
                                {item.retryCount ? t("canvas:param-retried", { retryCount: item.retryCount }) : ""}
                            </span>
                            {item.status === "failed" ? (
                                <Tooltip title={requiresPromptChange ? t("canvas:edit-the-prompt-before-retrying-this-shot") : t("canvas:retry-this-shot-only")}>
                                    <button
                                        type="button"
                                        className="grid size-7 shrink-0 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                                        onClick={() => onRetryItem(item.id)}
                                        aria-label={t("canvas:retry-shot-name", { name: shotByRowId.get(item.rowId) || "" })}
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
    const { t } = useTranslation("canvas");
    return batch.mode === "storyboard_video" ? t("canvas:video-generation") : batch.mode === "storyboard_image" ? t("canvas:storyboard-frame-generation") : t("canvas:action-board-generation");
}

function generationBatchSummary(batch: CanvasGenerationBatch) {
    const { t } = useTranslation("canvas");
    const count = (status: CanvasGenerationBatchItemStatus) => batch.items.filter((item) => item.status === status).length;
    const generating = count("submitting") + count("queued") + count("running");
    const stopped = count("cancelled");
    return t("canvas:batch-status-summary", {
        mode: generationBatchModeLabel(batch),
        status: batch.status === "completed" ? t("canvas:done-3") : batch.status === "cancelled" ? t("canvas:cancelled-2") : t("canvas:in-progress"),
        done: count("succeeded"),
        total: batch.items.length,
        failed: count("failed"),
        generating,
    });
}

function generationBatchItemLabel(item: CanvasGenerationBatchItem) {
    const { t } = useTranslation("canvas");
    if (item.costUncertain) return t("canvas:cost-to-be-confirmed");
    if (isContentModerationError(item.errorDetails)) return t("canvas:failed-moderation-edit-the-prompt-first");
    const labels: Record<CanvasGenerationBatchItemStatus, string> = {
        waiting: t("canvas:waiting"),
        submitting: t("canvas:submitting"),
        queued: t("canvas:queued-2"),
        running: t("canvas:generating-3"),
        succeeded: t("canvas:success"),
        failed: t("canvas:failed-2"),
        cancelled: t("canvas:stopped"),
    };
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
    open,
    onClose,
    onUpdateRows,
    onVisibleColumnsChange,
    onGenerateImages,
    onGenerateVideos,
    onVideoInputModeChange,
}: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onUpdateRows: (rows: StoryboardRow[]) => void;
    onVisibleColumnsChange: (columns: StoryboardColumn[]) => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
}) {
    const { t } = useTranslation("canvas");
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const rows = node?.metadata?.storyboard?.rows || EMPTY_STORYBOARD_ROWS;
    const visibleColumns = resolveStoryboardVisibleColumns(node?.metadata?.storyboard?.visibleColumns);
    const videoInputMode = node?.metadata?.storyboardVideoInputMode || "direct";
    const filteredRows = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return keyword
            ? rows.filter((row) =>
                  [row.plotDescription, row.dialogue, row.camera, row.motion, row.timeBeats, row.imageGenerationPrompt, row.videoMotionPrompt, row.negativePrompt].some((value) =>
                      String(value || "")
                          .toLowerCase()
                          .includes(keyword),
                  ),
              )
            : rows;
    }, [query, rows]);
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
            width: option.value === "shotNumber" ? 72 : option.value === "durationSeconds" ? 100 : option.value === "plotDescription" || option.value === "dialogue" || option.value === "timeBeats" || option.value.endsWith("Prompt") ? 260 : 170,
            fixed: option.value === "shotNumber" ? ("left" as const) : undefined,
            render: (_: unknown, row: StoryboardRow) =>
                option.value === "shotNumber" ? (
                    <span className="font-semibold">{row.shotNumber}</span>
                ) : option.value === "durationSeconds" ? (
                    <InputNumber min={1} max={60} value={row.durationSeconds} addonAfter="s" onChange={(value) => updateRow(row.id, { durationSeconds: Number(value) || 1 })} />
                ) : option.value === "shotSize" ? (
                    <Select
                        className="w-full"
                        value={row.shotSize || undefined}
                        placeholder={t("canvas:choose-shot-size")}
                        options={[t("canvas:close-up-2"), t("canvas:close-up"), t("canvas:medium-shot"), t("canvas:full-view"), t("canvas:wide-shot")].map((value) => ({ value, label: value }))}
                        onChange={(shotSize) => updateRow(row.id, { shotSize })}
                    />
                ) : (
                    <Input.TextArea
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={String(row[option.value] || "")}
                        placeholder={t("canvas:fill-in-param", { label: option.label })}
                        onChange={(event) => updateRow(row.id, { [option.value]: event.target.value } as Partial<StoryboardRow>)}
                    />
                ),
        }));
    columns.push({
        title: t("canvas:actions-4"),
        key: "actions",
        dataIndex: "shotNumber",
        width: 150,
        fixed: "right" as const,
        render: (_: unknown, row: StoryboardRow) => (
            <div className="flex gap-1">
                <SmallButton title={t("canvas:move-up")} onClick={() => moveRow(row.id, -1)}>
                    <ChevronUp className="size-3.5" />
                </SmallButton>
                <SmallButton title={t("canvas:move-down")} onClick={() => moveRow(row.id, 1)}>
                    <ChevronDown className="size-3.5" />
                </SmallButton>
                <SmallButton title={t("canvas:copy-4")} onClick={() => duplicateRow(row)}>
                    <Copy className="size-3.5" />
                </SmallButton>
                <SmallButton title={t("canvas:delete-5")} onClick={() => removeRow(row.id)}>
                    <Trash2 className="size-3.5" />
                </SmallButton>
            </div>
        ),
    });

    return (
        <Modal title={node?.title || t("canvas:storyboard-script")} open={open} onCancel={onClose} footer={null} width="min(1480px, calc(100vw - 40px))" centered destroyOnHidden>
            <div className="mb-3 flex flex-wrap items-center gap-2">
                <Input.Search className="w-72" allowClear placeholder={t("canvas:filter-visuals-dialogue-or-prompts")} value={query} onChange={(event) => setQuery(event.target.value)} />
                <Checkbox.Group className="script-column-picker" options={columnOptions} value={visibleColumns} onChange={(values) => onVisibleColumnsChange(values as StoryboardColumn[])} />
                <span className="min-w-0 flex-1" />
                <Button icon={<Plus className="size-4" />} onClick={() => onUpdateRows([...rows, editorRow(rows.length + 1)])}>
                    {t("canvas:add-shot-2")}
                </Button>
                <Button icon={<ImageIcon className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateImages(selectedIds)}>
                    {t("canvas:generate-5")}
                    {videoInputMode === "keyframe" ? t("canvas:first-frame") : t("canvas:storyboard-frame")}
                </Button>
                <Segmented<StoryboardVideoInputMode>
                    value={videoInputMode}
                    options={[
                        { value: "direct", label: t("canvas:direct-generation-2") },
                        { value: "keyframe", label: t("canvas:first-frame-first-2") },
                    ]}
                    onChange={onVideoInputModeChange}
                />
                <Button type="primary" icon={<Film className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateVideos(selectedIds)}>
                    {videoInputMode === "keyframe" ? t("canvas:confirm-first-frame-and-generate") : t("canvas:generate-video")}
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
        referenceNodeIds: [],
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
            aria-label={title || t("canvas:connection-port-aria", { side: side === "left" ? t("canvas:input") : t("canvas:output") })}
            title={title || `${side === "left" ? t("canvas:add-references") : t("canvas:connect-to-an-image-video-or-generation-node")}`}
            className={`canvas-connection-handle absolute z-[var(--node-z-handle)] flex -translate-y-1/2 cursor-pointer items-center justify-center rounded-full outline-none focus-visible:ring-2 ${side === "left" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2"}`}
            style={{ top, width: 32 * inverseHitScale, height: 32 * inverseHitScale, "--tw-ring-color": theme.accent.primary } as CSSProperties}
            onPointerDown={onPointerDown}
        >
            <span className="block size-2.5 rounded-full border-2 shadow-sm transition-transform hover:scale-110" style={{ boxSizing: "border-box", borderColor: theme.node.panel, background: color }} />
        </button>
    );
}
