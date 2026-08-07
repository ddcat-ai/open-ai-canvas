import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { App, Button, Checkbox, Input, InputNumber, Modal, Popover, Segmented, Select, Table, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { ChevronDown, ChevronUp, Clapperboard, Copy, Expand, Eye, Film, Grid3X3, Image as ImageIcon, ListTree, Merge, Minus, Plus, RefreshCw, Send, Square, Trash2, Video, X } from "lucide-react";

import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { ModelPicker } from "@/components/model-picker";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { expandStoryboardTextMentions } from "@/lib/canvas/canvas-project-domain";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { pipelineStatusLabel, type CanvasStoryboardPipelineProgress, type StoryboardPipelineStage } from "@/lib/canvas/canvas-storyboard-progress";
import { generationErrorMessage, isContentModerationError } from "@/lib/generation-error";
import { navigateToSettings } from "@/lib/settings-navigation";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    STORYBOARD_INPUT_SLOTS,
    STORYBOARD_SLOT_HANDLE,
    STORYBOARD_SLOT_LABEL,
    collectStoryboardInputSlots,
    storyboardInputSlotSummary,
    storyboardSlotHandleLocalTops,
} from "@/lib/canvas/storyboard-input-slots";
import type { StoryboardPromptPreview } from "@/services/api/auth";
import { useEffectiveConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasConnection, CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasGenerationBatchItemStatus, CanvasNodeData, CanvasNodeStatus, CanvasWorkspaceMode, StoryboardColumn, StoryboardInputSlot, StoryboardRow, StoryboardShotCount, StoryboardShotDuration, StoryboardVideoInputMode } from "@/types/canvas";

export const STORYBOARD_ROW_HEIGHT = 48;
export const STORYBOARD_HEADER_HEIGHT = 124;
const STORYBOARD_ADD_ROW_HEIGHT = 36;
const STORYBOARD_COMPOSER_MIN_HEIGHT = 136;
const STORYBOARD_COMPOSER_MAX_HEIGHT = 220;
const STORYBOARD_PROMPT_MIN_HEIGHT = 40;
const STORYBOARD_PROMPT_MAX_HEIGHT = 116;
const STORYBOARD_BRIEF_BAR_HEIGHT = 30;
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
    { label: "连续性出口", value: "continuityOut" },
    { label: "负面要求", value: "negativePrompt" },
];

export function CanvasScriptNodeContent({ node, batch, pipeline, scale, mentionReferences, canvasNodes = [], canvasConnections = [], onOpen, onCreateImageNodes, onCreateVideoNodes, onGenerateImages, onGenerateVideos, onVideoInputModeChange, onMergeVideos, onCreateActionBoards, onRetryBatch, onRetryBatchItem, onStopBatch, onCancelBatchItem, onAddRow, onRemoveRow, onUpdateRow, onPromptChange, onGenerateScript, onPreviewPlannerPrompt, onModelChange, onShotDurationChange, onShotCountChange, onComposerHeightChange, onConnectStart, onScrollTopChange, workspaceMode = "professional" }: {
    node: CanvasNodeData;
    batch?: CanvasGenerationBatch;
    pipeline: CanvasStoryboardPipelineProgress;
    scale: number;
    mentionReferences: CanvasResourceReference[];
    /** 用于五槽摘要；缺省则只显示口不统计 */
    canvasNodes?: CanvasNodeData[];
    canvasConnections?: CanvasConnection[];
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
    onCancelBatchItem: (batchId: string, itemId: string) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<StoryboardRow>) => void;
    onPromptChange: (prompt: string) => void;
    onGenerateScript: (prompt: string) => void;
    /** 与真实发送同一路径 compile 的完整规划 Prompt（模板+偏好+变量） */
    onPreviewPlannerPrompt?: (prompt: string) => Promise<StoryboardPromptPreview>;
    onModelChange: (model: string) => void;
    onShotDurationChange: (duration: StoryboardShotDuration) => void;
    onShotCountChange: (count: StoryboardShotCount) => void;
    onComposerHeightChange: (height: number) => void;
    /** handleKey: 五槽 handleId（storyboard:*）或行 id */
    onConnectStart: (event: ReactPointerEvent, handleKey: string, handleType: "source" | "target") => void;
    onScrollTopChange: (scrollTop: number) => void;
    workspaceMode?: CanvasWorkspaceMode;
}) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const effectiveConfig = useEffectiveConfig();
    const generationConfig = buildGenerationConfig(effectiveConfig, node, "text");
    const simpleMode = workspaceMode === "simple";
    const rows = node.metadata?.storyboard?.rows || [];
    const [prompt, setPrompt] = useState(node.metadata?.composerContent || "");
    const [previewOpen, setPreviewOpen] = useState(false);
    const [plannerPrompt, setPlannerPrompt] = useState("");
    const [plannerMode, setPlannerMode] = useState("");
    const [plannerLoading, setPlannerLoading] = useState(false);
    const [plannerError, setPlannerError] = useState("");
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
    const taskFeedback = node.metadata?.status === "loading"
        ? `${node.metadata.taskStage || "正在创建任务"}${typeof node.metadata.taskProgress === "number" ? ` · ${node.metadata.taskProgress}%` : ""}`
        : node.metadata?.status === "error" ? generationErrorMessage(node.metadata.errorDetails) : "";
    const lastSubmissionPrompt = node.metadata?.lastStoryboardSubmissionPrompt?.trim() || "";
    const lastSubmissionAt = node.metadata?.lastStoryboardSubmissionAt;
    const liveExpandedBrief = useMemo(
        () => expandStoryboardTextMentions(prompt, mentionReferences),
        [mentionReferences, prompt],
    );
    const activeReferenceCount = useMemo(
        () => mentionReferences.filter((item) => item.active && item.kind !== "skill").length,
        [mentionReferences],
    );
    const hasTextReferenceInBrief = /【文本参考：/.test(liveExpandedBrief);
    const hasCharacterReferenceInBrief = /【角色参考：/.test(liveExpandedBrief);
    const mentionTokenCount = useMemo(() => (prompt.match(/@\[(?:node|skill):[^\]]+\]/g) || []).length, [prompt]);
    const briefChangedFromLast = Boolean(lastSubmissionPrompt && lastSubmissionPrompt !== liveExpandedBrief.trim());
    const inputSlots = useMemo(
        () => (canvasNodes.length ? collectStoryboardInputSlots(node.id, canvasNodes, canvasConnections) : null),
        [canvasConnections, canvasNodes, node.id],
    );
    const slotSummary = useMemo(() => (inputSlots ? storyboardInputSlotSummary(inputSlots) : []), [inputSlots]);
    const slotLocalTops = useMemo(() => storyboardSlotHandleLocalTops(composerHeight), [composerHeight]);
    const submitPrompt = () => {
        const value = prompt.trim();
        if (value && node.metadata?.status !== "loading") onGenerateScript(value);
    };
    const copyLiveBrief = async () => {
        try {
            await navigator.clipboard.writeText(liveExpandedBrief);
            message.success("已复制 brief");
        } catch {
            message.error("复制失败");
        }
    };
    const copyPlannerPrompt = async () => {
        if (!plannerPrompt.trim()) {
            message.warning("规划 Prompt 尚未加载");
            return;
        }
        try {
            await navigator.clipboard.writeText(plannerPrompt);
            message.success("已复制完整规划 Prompt");
        } catch {
            message.error("复制失败");
        }
    };
    const loadPlannerPreview = useCallback(async () => {
        const raw = prompt.trim();
        if (!raw) {
            setPlannerPrompt("");
            setPlannerMode("");
            setPlannerError("请先填写 brief");
            return;
        }
        if (!onPreviewPlannerPrompt) {
            setPlannerError("当前环境未接入规划 Prompt 预览");
            return;
        }
        setPlannerLoading(true);
        setPlannerError("");
        try {
            const preview = await onPreviewPlannerPrompt(raw);
            setPlannerPrompt(preview.plannerPrompt || "");
            setPlannerMode(preview.customizationMode || "inherit");
        } catch (error) {
            setPlannerPrompt("");
            setPlannerMode("");
            setPlannerError(error instanceof Error ? error.message : "加载规划 Prompt 失败");
        } finally {
            setPlannerLoading(false);
        }
    }, [onPreviewPlannerPrompt, prompt]);
    useLayoutEffect(() => {
        composerHeightChangeRef.current = onComposerHeightChange;
    }, [onComposerHeightChange]);
    useEffect(() => {
        if (!previewOpen) return;
        void loadPlannerPreview();
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopPropagation();
            setPreviewOpen(false);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [loadPlannerPreview, previewOpen]);
    const resizePrompt = useCallback((contentHeight: number) => {
        const promptHeight = Math.min(STORYBOARD_PROMPT_MAX_HEIGHT, Math.max(STORYBOARD_PROMPT_MIN_HEIGHT, contentHeight));
        // 输入区 + 「将发送」摘要条 + 底部控件
        const nextHeight = promptHeight + STORYBOARD_BRIEF_BAR_HEIGHT + 72;
        if (reportedComposerHeightRef.current === nextHeight) return;
        reportedComposerHeightRef.current = nextHeight;
        composerHeightChangeRef.current(nextHeight);
    }, []);

    return (
        <div className="relative flex h-full w-full flex-col overflow-visible" style={{ color: theme.node.text }} onDoubleClick={(event) => event.stopPropagation()}>
            <div className="relative flex h-10 shrink-0 items-center gap-2 rounded-t-[17px] border-b px-4" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <Clapperboard className="size-4" />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={node.title || "分镜脚本"}>{node.title || "分镜脚本"}</span>
                {batchSummary ? <span className="min-w-0 max-w-[42%] truncate text-[var(--fs-label)] font-medium" title={batchSummary} style={{ color: batch?.status === "partial_failed" ? theme.accent.danger : theme.node.muted }}>{batchSummary}</span> : taskFeedback ? <span className="min-w-0 max-w-[38%] truncate text-[var(--fs-label)] font-medium" title={taskFeedback} style={{ color: node.metadata?.status === "error" ? theme.accent.danger : theme.node.muted }}>{taskFeedback}</span> : null}
                <span className="text-[var(--fs-caption)] font-semibold tabular-nums" style={{ color: theme.node.muted }}>{rows.length} 镜 · {totalDuration}s</span>
                <Tooltip title="全屏编辑"><button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onOpen(); }} aria-label="全屏编辑"><Expand className="size-3.5" /></button></Tooltip>
                <Dropdown menu={{ items: moreMenuItems }} trigger={["click"]} placement="bottomRight">
                    <button type="button" className="grid size-7 place-items-center rounded outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()} aria-label="更多操作"><MoreHorizontal className="size-3.5" /></button>
                </Dropdown>
            </div>
            {batch ? <Modal title="批次详情" open={batchDetailsOpen} onCancel={() => setBatchDetailsOpen(false)} footer={null} width={560} centered destroyOnHidden>
                <GenerationBatchDetails batch={batch} rows={rows} onRetryItem={(itemId) => onRetryBatchItem(batch.id, itemId)} onCancelItem={(itemId) => onCancelBatchItem(batch.id, itemId)} />
            </Modal> : null}
            <StoryboardMiniPipeline pipeline={pipeline} theme={theme} rows={rows} />
            <div className="storyboard-header-gutter grid h-9 shrink-0 items-center border-b text-xs font-semibold" style={{ borderColor: theme.node.stroke, color: theme.node.muted, gridTemplateColumns: SCRIPT_GRID_TEMPLATE }}>
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
                        <div className="flex flex-col items-center justify-center border-r tabular-nums" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}><span className="text-sm">{row.shotNumber}</span>{batchItemByRowId.get(row.id) ? <span className="max-w-16 truncate text-[var(--fs-micro)] leading-3" title={generationBatchItemLabel(batchItemByRowId.get(row.id)!)}>{generationBatchItemLabel(batchItemByRowId.get(row.id)!)}</span> : null}</div>
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
                )) : (
                    <button type="button" className="grid h-full min-h-36 w-full place-items-center" onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAddRow(); }}>
                        <span className="flex flex-col items-center gap-2.5">
                            <span className="text-sm font-bold">＋ 添加第一个镜头</span>
                            <span className="text-[var(--fs-label)] font-medium" style={{ color: theme.node.faint }}>可先连接「故事梗概 / 项目画风」节点，或在下方输入提示词一键生成分镜表</span>
                        </span>
                    </button>
                )}
            </div>
            <div className="flex h-9 shrink-0 items-center justify-center border-b" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                <button type="button" className="inline-flex h-7 items-center gap-1 rounded px-2 text-xs font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10" style={{ "--tw-ring-color": theme.node.muted } as CSSProperties} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAddRow(); }}><Plus className="size-3.5" />添加行</button>
            </div>
            <div className="relative grid shrink-0 grid-rows-[minmax(0,1fr)_auto_28px] gap-1 rounded-b-[17px] p-2.5" style={{ height: composerHeight, background: theme.node.panel }}>
                <CanvasResourceMentionTextarea
                    rows={1}
                    references={mentionReferences}
                    aria-label="分镜剧情与项目设定"
                    containerClassName="h-full min-h-0 overflow-hidden"
                    className="thin-scrollbar h-full min-h-0 w-full touch-pan-y resize-none overflow-y-auto overflow-x-hidden overscroll-contain rounded-md border bg-transparent px-3 py-2 text-sm leading-5 outline-none transition placeholder:opacity-45 focus:ring-1"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties}
                    value={prompt}
                    placeholder="描述想生成的脚本或视频内容；可用 @ 引用已连接的文本/角色"
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
                <div
                    className="flex min-h-7 shrink-0 flex-wrap items-center gap-1.5 rounded-md border px-2 py-1"
                    style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Eye className="size-3.5 shrink-0 opacity-70" />
                    <span className="text-[10px] leading-4">
                        五槽
                        {slotSummary.length
                            ? slotSummary.filter((item) => item.count > 0).map((item) => ` · ${item.label}${item.count}`).join("") || " · 未接线"
                            : (activeReferenceCount ? ` · 可引用 ${activeReferenceCount}` : " · 未接线")}
                        {mentionTokenCount ? ` · @${mentionTokenCount}` : ""}
                        {hasTextReferenceInBrief ? " · 含文本参考" : mentionTokenCount ? " · 文本未展开?" : ""}
                    </span>
                    <button
                        type="button"
                        className="ml-auto inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] font-medium outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                        style={{ color: theme.accent.primary, "--tw-ring-color": theme.accent.primary } as CSSProperties}
                        onClick={(event) => {
                            event.stopPropagation();
                            setPreviewOpen(true);
                        }}
                    >
                        <Eye className="size-3" />
                        发送前预览
                    </button>
                    {lastSubmissionPrompt ? (
                        <Tooltip title={briefChangedFromLast ? "与上次发出内容不同" : "与上次相同"}>
                            <button
                                type="button"
                                className="inline-flex h-6 items-center gap-1 rounded px-1.5 text-[10px] outline-none transition hover:bg-black/5 dark:hover:bg-white/10"
                                style={{ color: theme.node.muted }}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setPreviewOpen(true);
                                }}
                            >
                                <ListTree className="size-3" />
                                上次
                            </button>
                        </Tooltip>
                    ) : null}
                </div>
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
                    {simpleMode ? <span className="text-[var(--fs-label)]" style={{ color: theme.node.muted }}>自动拆分 · 时长自动</span> : <Select<StoryboardShotCount>
                        className="min-w-24"
                        size="small"
                        value={shotCount}
                        disabled={node.metadata?.status === "loading"}
                        options={[{ value: "auto", label: "自动拆分" }, ...Array.from({ length: 10 }, (_, index) => ({ value: String(index + 1) as StoryboardShotCount, label: `${index + 1} 镜` }))]}
                        popupMatchSelectWidth={false}
                        onChange={onShotCountChange}
                    />}
                    {simpleMode ? null : <Select<StoryboardShotDuration>
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
                {STORYBOARD_INPUT_SLOTS.map((slot) => {
                    const count = inputSlots?.[slot]?.length || 0;
                    return (
                        <SlotHandle
                            key={slot}
                            slot={slot}
                            top={slotLocalTops[slot]}
                            scale={scale}
                            filled={count > 0}
                            theme={theme}
                            title={slotConnectTip(slot, count)}
                            onPointerDown={(event) => onConnectStart(event, STORYBOARD_SLOT_HANDLE[slot], "target")}
                        />
                    );
                })}
            </div>
            {rows.map((row, index) => {
                const top = STORYBOARD_HEADER_HEIGHT + index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop;
                if (top < STORYBOARD_HEADER_HEIGHT + 4 || top > STORYBOARD_HEADER_HEIGHT + tableHeight - 4) return null;
                return (
                    <div key={`ports-${row.id}`}>
                        <RowHandle side="left" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} title="本镜额外参考" onPointerDown={(event) => onConnectStart(event, row.id, "target")} />
                        <RowHandle side="right" top={top} scale={scale} tone={batchItemTone(batchItemByRowId.get(row.id)) || row.status} theme={theme} onPointerDown={(event) => onConnectStart(event, row.id, "source")} />
                    </div>
                );
            })}
            {previewOpen
                ? createPortal(
                    <div
                        className="ant-modal fixed inset-0 z-[4000] grid place-items-center px-4"
                        data-canvas-no-zoom
                        role="dialog"
                        aria-modal="true"
                        aria-label="自动分镜发送前预览"
                        style={{ background: "rgba(0,0,0,0.48)" }}
                        onMouseDown={(event) => {
                            // 点遮罩关闭；点内容不关
                            if (event.target === event.currentTarget) {
                                event.preventDefault();
                                event.stopPropagation();
                                setPreviewOpen(false);
                            }
                        }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        onWheel={(event) => event.stopPropagation()}
                    >
                        <div
                            className="ant-modal-content flex max-h-[min(88vh,900px)] w-[min(860px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border shadow-2xl backdrop-blur-2xl"
                            style={{
                                borderColor: theme.node.stroke,
                                background: theme.node.panel,
                                color: theme.node.text,
                            }}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => event.stopPropagation()}
                        >
                            <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                                <div className="min-w-0 flex-1 text-sm font-semibold">自动分镜 · 发送前预览</div>
                                <button
                                    type="button"
                                    className="grid size-8 place-items-center rounded-md outline-none transition hover:bg-black/5 focus-visible:ring-2 dark:hover:bg-white/10"
                                    style={{ color: theme.node.muted, "--tw-ring-color": theme.accent.primary } as CSSProperties}
                                    aria-label="关闭预览"
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setPreviewOpen(false);
                                    }}
                                >
                                    <X className="size-4" />
                                </button>
                            </div>
                            <div className="thin-scrollbar min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
                                <div className="rounded-md border px-3 py-2 text-[11px] leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                    五槽输入白盒：正文进 plan；角色下游必送；背景/画风/道具下游默认可送可关；正文不进动作板/图/视频。
                                    {hasTextReferenceInBrief ? " 已检测到【文本参考】。" : mentionTokenCount ? " 有 @，但未见【文本参考】展开。" : ""}
                                </div>
                                {slotSummary.length ? (
                                    <div>
                                        <div className="mb-1 text-xs font-medium opacity-70">输入槽</div>
                                        <div className="grid gap-1.5 sm:grid-cols-2">
                                            {slotSummary.map((item) => (
                                                <div key={item.slot} className="rounded-md border px-2 py-1.5 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                                    <span className="font-medium" style={{ color: theme.node.text }}>{item.label}</span>
                                                    {" · "}
                                                    {item.count ? item.titles.join("、") + (item.count > item.titles.length ? ` 等${item.count}个` : "") : "未连接"}
                                                    {item.slot === "story" ? "（下游不送）" : item.slot === "characters" ? "（下游必送）" : "（下游默认可关）"}
                                                </div>
                                            ))}
                                        </div>
                                        {inputSlots?.legacyContext?.length ? (
                                            <div className="mt-1.5 text-[11px]" style={{ color: theme.accent.danger }}>
                                                有 {inputSlots.legacyContext.length} 条旧连接未归类，请拖到正确输入口。
                                            </div>
                                        ) : null}
                                    </div>
                                ) : null}
                                <div>
                                    <div className="mb-1 text-xs font-medium opacity-70">① Brief（写入模板「剧情」变量，@ 已展开）</div>
                                    <pre className="thin-scrollbar max-h-[22vh] overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-[12px] leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                        {liveExpandedBrief.trim() || "（空）"}
                                    </pre>
                                </div>
                                <div>
                                    <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-medium opacity-70">
                                        <span>② 最终规划 Prompt（进模型）</span>
                                        {plannerLoading ? <span style={{ color: theme.accent.primary }}>加载中…</span> : null}
                                        {!plannerLoading && plannerMode ? (
                                            <span className="rounded px-1.5 py-0.5 text-[10px] font-normal" style={{ background: theme.node.fill, color: theme.node.muted, border: `1px solid ${theme.node.stroke}` }}>
                                                偏好：{plannerMode === "append" ? "追加 append" : plannerMode === "rewrite" ? "重写 rewrite" : "继承平台模板 inherit"}
                                            </span>
                                        ) : null}
                                        <button
                                            type="button"
                                            className="ml-auto text-[10px] outline-none transition hover:opacity-80"
                                            style={{ color: theme.accent.primary }}
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                void loadPlannerPreview();
                                            }}
                                        >
                                            刷新
                                        </button>
                                    </div>
                                    {plannerError ? (
                                        <div className="rounded-md border px-3 py-2 text-[12px] leading-5" style={{ borderColor: theme.accent.danger, color: theme.accent.danger, background: theme.node.fill }}>
                                            {plannerError}
                                        </div>
                                    ) : (
                                        <pre className="thin-scrollbar max-h-[38vh] overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-[12px] leading-5" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                            {plannerLoading ? "正在 compile 规划 Prompt…" : (plannerPrompt.trim() || "（空）")}
                                        </pre>
                                    )}
                                </div>
                                {lastSubmissionPrompt ? (
                                    <div>
                                        <div className="mb-1 text-xs font-medium opacity-70">
                                            上次已发送 brief
                                            {lastSubmissionAt ? ` · ${new Date(lastSubmissionAt).toLocaleString()}` : ""}
                                            {briefChangedFromLast ? " · 与当前不同" : " · 与当前相同"}
                                        </div>
                                        <pre className="thin-scrollbar max-h-32 overflow-auto whitespace-pre-wrap rounded-md border px-3 py-2 text-[11px] leading-5 opacity-80" style={{ borderColor: theme.node.stroke, background: theme.node.fill, color: theme.node.muted }}>
                                            {lastSubmissionPrompt}
                                        </pre>
                                    </div>
                                ) : null}
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t px-4 py-3" style={{ borderColor: theme.node.stroke }}>
                                <Button
                                    icon={<Copy className="size-3.5" />}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void copyLiveBrief();
                                    }}
                                >
                                    复制 Brief
                                </Button>
                                <Button
                                    icon={<Copy className="size-3.5" />}
                                    disabled={!plannerPrompt.trim()}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        void copyPlannerPrompt();
                                    }}
                                >
                                    复制规划 Prompt
                                </Button>
                                <Button
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setPreviewOpen(false);
                                    }}
                                >
                                    关闭
                                </Button>
                                <Button
                                    type="primary"
                                    icon={<Send className="size-3.5" />}
                                    disabled={!prompt.trim() || node.metadata?.status === "loading"}
                                    loading={node.metadata?.status === "loading"}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setPreviewOpen(false);
                                        submitPrompt();
                                    }}
                                >
                                    确认发送
                                </Button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}
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
        { key: "final", label: "合并成片", state: pipeline.final.success > 0 ? "done" : pipeline.final.failed > 0 ? "error" : pipeline.final.loading > 0 || pipeline.successfulVideoNodeIds.length >= 2 ? "current" : "idle", hint: pipelineStatusLabel(pipeline.final) },
    ];
    return (
        <div className="flex h-9 shrink-0 items-center justify-center overflow-hidden border-b px-4" style={{ borderColor: theme.node.stroke, background: theme.node.fill }} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            {steps.map((step, index) => (
                <Fragment key={step.key}>
                    {index > 0 ? <span className="mx-2.5 h-px min-w-3.5 flex-1 max-w-20" style={{ background: theme.node.stroke }} /> : null}
                    <span className="flex items-center gap-1.5 whitespace-nowrap text-[var(--fs-tiny)]" title={step.hint} style={{ color: step.state === "done" ? theme.node.muted : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.faint, fontWeight: step.state === "current" || step.state === "error" ? 700 : 500 }}>
                        <span className="size-2 shrink-0 rounded-full" style={{ background: step.state === "done" ? theme.node.activeStroke : step.state === "current" ? theme.accent.primary : step.state === "error" ? theme.accent.danger : theme.node.stroke, boxShadow: step.state === "current" ? `0 0 0 3px ${theme.accent.primarySoft}` : undefined }} />
                        {step.label}
                    </span>
                </Fragment>
            ))}
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
                    <span className="min-w-0 flex-1 truncate text-xs text-foreground/60" title={item.errorDetails ? generationErrorMessage(item.errorDetails) : undefined}>{generationBatchItemLabel(item)}{item.retryCount ? ` · 重试 ${item.retryCount}` : ""}</span>
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

export function CanvasScriptEditor({ node, open, onClose, onUpdateRows, onVisibleColumnsChange, onGenerateImages, onGenerateVideos, onVideoInputModeChange, onFocusNode }: {
    node: CanvasNodeData | null;
    open: boolean;
    onClose: () => void;
    onUpdateRows: (rows: StoryboardRow[]) => void;
    onVisibleColumnsChange: (columns: StoryboardColumn[]) => void;
    onGenerateImages: (rowIds: string[]) => void;
    onGenerateVideos: (rowIds: string[]) => void;
    onVideoInputModeChange: (mode: StoryboardVideoInputMode) => void;
    /** 从分镜行回溯到画布上的图/视频节点 */
    onFocusNode?: (nodeId: string) => void;
}) {
    const [query, setQuery] = useState("");
    const [selectedIds, setSelectedIds] = useState<string[]>([]);
    const rows = node?.metadata?.storyboard?.rows || EMPTY_STORYBOARD_ROWS;
    const visibleColumns = node?.metadata?.storyboard?.visibleColumns || ["shotNumber", "durationSeconds", "plotDescription", "dialogue"];
    const videoInputMode = node?.metadata?.storyboardVideoInputMode || "direct";
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
        title: "最终发送 / 回溯",
        key: "submissionTrace",
        dataIndex: "lastImageSubmissionPrompt",
        width: 280,
        render: (_: unknown, row: StoryboardRow) => (
            <div className="space-y-1.5 py-1 text-[11px] leading-4">
                <div className="rounded border border-black/5 bg-black/[0.02] px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="mb-0.5 flex items-center justify-between gap-1 opacity-60">
                        <span>图 · 最终 prompt</span>
                        {row.imageNodeId && onFocusNode ? (
                            <button type="button" className="text-[10px] text-current underline-offset-2 hover:underline" onClick={() => onFocusNode(row.imageNodeId!)}>
                                定位节点
                            </button>
                        ) : null}
                    </div>
                    <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words opacity-80">{row.lastImageSubmissionPrompt?.trim() || "尚未同步/生成"}</div>
                </div>
                <div className="rounded border border-black/5 bg-black/[0.02] px-1.5 py-1 dark:border-white/10 dark:bg-white/[0.03]">
                    <div className="mb-0.5 flex items-center justify-between gap-1 opacity-60">
                        <span>视频 · 最终 prompt</span>
                        {row.videoNodeId && onFocusNode ? (
                            <button type="button" className="text-[10px] text-current underline-offset-2 hover:underline" onClick={() => onFocusNode(row.videoNodeId!)}>
                                定位节点
                            </button>
                        ) : null}
                    </div>
                    <div className="max-h-16 overflow-y-auto whitespace-pre-wrap break-words opacity-80">{row.lastVideoSubmissionPrompt?.trim() || "尚未同步/生成"}</div>
                </div>
            </div>
        ),
    });
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
                <Button icon={<ImageIcon className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateImages(selectedIds)}>生成{videoInputMode === "keyframe" ? "首帧" : "分镜图"}</Button>
                <Segmented<StoryboardVideoInputMode> value={videoInputMode} options={[{ value: "direct", label: "直接生成" }, { value: "keyframe", label: "先做首帧" }]} onChange={onVideoInputModeChange} />
                <Button type="primary" icon={<Film className="size-4" />} disabled={!selectedIds.length} onClick={() => onGenerateVideos(selectedIds)}>{videoInputMode === "keyframe" ? "确认首帧并生成" : "生成视频"}</Button>
            </div>
            <Table<StoryboardRow> rowKey="id" size="small" bordered sticky pagination={false} scroll={{ x: Math.max(900, columns.length * 180), y: "calc(78vh - 170px)" }} dataSource={filteredRows} columns={columns} rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys.map(String)) }} />
        </Modal>
    );
}

function CompactInput({ value, placeholder, borderColor, onChange }: { value: string; placeholder: string; borderColor: string; onChange: (value: string) => void }) {
    return <textarea className="thin-scrollbar h-full w-full resize-none overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words border-r bg-transparent px-4 py-2.5 text-xs leading-5 outline-none transition placeholder:opacity-35 focus:bg-black/[0.02] dark:focus:bg-white/[0.025]" style={{ borderColor }} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} />;
}

function HeaderCell({ children, borderColor, align = "left" }: { children: ReactNode; borderColor: string; align?: "left" | "center" }) {
    return <span className={`flex h-full items-center border-r px-4 ${align === "center" ? "justify-center text-center" : "justify-start"}`} style={{ borderColor }}>{children}</span>;
}

function SmallButton({ title, children, onClick, disabled }: { title: string; children: ReactNode; onClick: () => void; disabled?: boolean }) {
    return <button type="button" disabled={disabled} className="grid size-7 shrink-0 place-items-center rounded opacity-65 transition enabled:hover:bg-black/5 enabled:hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-25 dark:enabled:hover:bg-white/10" title={title} onMouseDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onClick(); }}>{children}</button>;
}

function editorRow(shotNumber: number): StoryboardRow {
    return { id: `shot-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, shotNumber, durationSeconds: 6, plotDescription: "", dialogue: "", characters: [], narrativeIntent: "", viewerPOV: "", performanceBlocking: "", shotSize: "", emotion: "", lightingAndAtmosphere: "", audioEffects: "", camera: "", motion: "", timeBeats: "", imageGenerationPrompt: "", videoMotionPrompt: "", mustHave: [], optionalDetails: [], continuityOut: "", negativePrompt: "", referenceNodeIds: [], status: "idle" };
}

function slotConnectTip(slot: StoryboardInputSlot, count: number) {
    const base = {
        story: "正文：章节/剧情文本 → 仅自动分镜用，下游图视频默认不送",
        characters: "角色：角色卡 → 分镜 + 下游图/视频必送",
        background: "背景：场景文/图 → 分镜用；下游默认可送可关",
        style: "画风：项目画风 → 自动分镜建议必连；下游默认可送可关",
        props: "道具：道具/参考图 → 分镜资产；下游默认可送可关",
    }[slot];
    return count ? `${STORYBOARD_SLOT_LABEL[slot]} · 已连 ${count} · ${base}` : `${STORYBOARD_SLOT_LABEL[slot]} · ${base}`;
}

function SlotHandle({ slot, top, scale, filled, theme, title, onPointerDown }: {
    slot: StoryboardInputSlot;
    top: number;
    scale: number;
    filled: boolean;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    title: string;
    onPointerDown: (event: ReactPointerEvent) => void;
}) {
    const inverseHitScale = 1 / Math.max(scale, 0.05);
    const color = filled ? theme.accent.primary : theme.node.muted;
    return (
        <button
            type="button"
            aria-label={title}
            title={title}
            className="canvas-connection-handle absolute z-50 flex -translate-y-1/2 -translate-x-1/2 cursor-pointer items-center gap-0.5 rounded-full outline-none focus-visible:ring-2 left-0"
            style={{ top, height: 28 * inverseHitScale, paddingLeft: 2 * inverseHitScale, "--tw-ring-color": theme.accent.primary } as CSSProperties}
            onPointerDown={onPointerDown}
        >
            <span
                className="pointer-events-none max-w-[36px] truncate rounded px-0.5 text-[9px] font-semibold leading-none"
                style={{ color: theme.node.muted, transform: `scale(${inverseHitScale})`, transformOrigin: "right center" }}
            >
                {STORYBOARD_SLOT_LABEL[slot]}
            </span>
            <span className="block size-2.5 shrink-0 rounded-full border-2 shadow-sm transition-transform hover:scale-110" style={{ boxSizing: "border-box", borderColor: theme.node.panel, background: color }} />
        </button>
    );
}

function RowHandle({ side, top, scale, tone, theme, title, onPointerDown }: { side: "left" | "right"; top: number; scale: number; tone?: StoryboardRow["status"]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; title?: string; onPointerDown: (event: ReactPointerEvent) => void }) {
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
