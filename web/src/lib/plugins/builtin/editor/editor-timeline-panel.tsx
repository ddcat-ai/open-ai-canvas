// 时间线面板（editor-shell 预设插件贡献，M2.4 手势 echo 最小件）。
// 渲染链路：store.project（当前命令状态）→ 轨道/片段绝对定位 → 拖拽手势
// （moveClip / trimClip）经 previewGesture 逐帧预览、commitGesture 一次性入历史。
// 手势数学与渲染同源（同一 pxPerMs），保证拖拽所见即所得。
// 撤销/重做与保存状态移入宿主顶栏（Concat 主菜单区），本面板保留缩放与片段统计。

import { useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Film, Magnet, Maximize, MousePointer2, Music2, Plus, Scissors, Slice, Subtitles, Trash2, Volume2, VolumeX, X, ZoomIn, ZoomOut } from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import {
    formatTimelineTime,
    getFitTimelineZoom,
    getRulerTickStep,
    getTimelinePxPerMs,
    getTimelineVisualEndMs,
    zoomIn,
    zoomOut,
} from "@/lib/timeline/timeline-view";
import { getAudioTracks, getSubtitleTracks, getVisualTracks } from "@/lib/timeline/timeline-tracks";
import { TRACK_KIND_BASE_LABELS } from "@/lib/timeline/editor-commands";
import { computeSnap } from "@/lib/timeline/timeline-snap";
import type { TimelineClip, TimelineProject, TimelineTrack, TimelineTrackKind } from "@/types/timeline";

const MIN_VISUAL_END_MS = 1_000;
const SNAP_MS = 10;
const TRIM_HANDLE_PX = 8;
// 轨道标签列宽度（w-48）：轨道徽标 + 轨道名 + 可见/静音/移除按钮。
// 时间线内容宽度必须补上该列，否则片段区 flex-1 只到
// trackWidth - 192，末端片段被 overflow-hidden 裁掉且无法滚动到达。
const LABEL_COLUMN_PX = 192;
// 剃刀/播放头分割两侧的最小保留时长（毫秒），避免切出空片段。
const MIN_SPLIT_MS = 100;

// 不可移除轨道的原因文案（title 悬停与点击提示共用，单一来源）。
const trackRemoveBlockedReason = (kind: TimelineTrack["kind"]) => `${TRACK_KIND_BASE_LABELS[kind]}轨道至少保留一条，无法移除`;

// 工具条按钮颜色角色（唯一来源，各按钮内不得重复字面量颜色）：
// 常态 = 次级前景 + hover 弱背景；选中/按下 = 反白块 + 强前景（中性，无 accent 蓝图标）。
const TOOL_FG_IDLE = "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]";
const TOOL_FG_ACTIVE = "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]";

type GestureMode = "move" | "trim-start" | "trim-end" | null;

// 与时间线相关的场景：playheadMs 是标尺交互的临时坐标，随缩放同步换算。
type TimelineTool = "select" | "razor";

type GestureState = {
    mode: Exclude<GestureMode, null>;
    pointerId: number;
    startClientX: number;
    originStartMs: number;
    originDurationMs: number;
    originSourceStartMs: number;
};


export function EditorTimelinePanel() {
    const { project, dispatch, previewGesture, commitGesture, cancelGesture, selectedClipId, selectClip } =
        useEditorStoreContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [activeTool, setActiveTool] = useState<TimelineTool>("select");
    const [playheadMs, setPlayheadMs] = useState(0);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [addMenuOpen, setAddMenuOpen] = useState(false);
    // 点击不可移除轨道 X 时的原因提示（2.2s 后自动消失）。
    const [removeBlockedHint, setRemoveBlockedHint] = useState<{ id: number; text: string } | null>(null);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        setViewportWidth(el.clientWidth);
        const observer = new ResizeObserver((entries) => {
            const width = entries[0]?.contentRect.width;
            if (width) setViewportWidth(width);
        });
        observer.observe(el);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!removeBlockedHint) return;
        const timer = window.setTimeout(() => setRemoveBlockedHint(null), 2200);
        return () => window.clearTimeout(timer);
    }, [removeBlockedHint]);

    if (!project) return <div className="flex h-full items-center justify-center text-sm text-[var(--director-dock-fg)]">时间线未加载</div>;

    const visualEndMs = Math.max(MIN_VISUAL_END_MS, getTimelineVisualEndMs(project.clips));
    // 像素/毫秒由缩放级别独立决定（不随时长漂移）：拖动片段时轨道随内容等比扩展，
    // 手势映射与渲染同源，末片段向右拖不再被旧实现（trackWidth 随时长阶梯跳变）钉住。
    const pxPerMs = getTimelinePxPerMs(zoomLevel);
    const trackWidth = Math.max(viewportWidth, Math.ceil(visualEndMs * pxPerMs));
    // 内容宽度 = 逻辑轨道宽度 + 标签列；标签列 sticky 固定后，滚动到最右端时
    // 末端片段仍完整可见（flex-1 片段区 = 内容宽度 - 标签列 ≥ 轨道宽度）。
    const contentWidth = Math.max(viewportWidth, trackWidth + LABEL_COLUMN_PX);

    const visualTracks = getVisualTracks(project.tracks);
    const audioTracks = getAudioTracks(project.tracks);
    const subtitleTracks = getSubtitleTracks(project.tracks);
    const clipAtPlayhead =
        project.clips.find(
            (clip) =>
                clip.kind !== "subtitle" &&
                clip.startMs + MIN_SPLIT_MS <= playheadMs &&
                playheadMs <= clip.startMs + clip.durationMs - MIN_SPLIT_MS,
        ) ?? null;
    const selectedClip = project.clips.find((clip) => clip.id === selectedClipId) ?? null;

    const handleSplitAtPlayhead = () => {
        if (!clipAtPlayhead) return;
        dispatch({ op: "splitClip", payload: { id: clipAtPlayhead.id, splitAtMs: playheadMs } });
    };
    const handleDeleteSelected = () => {
        if (!selectedClip) return;
        dispatch({ op: "removeClip", payload: { id: selectedClip.id } });
        selectClip(null);
    };
    const handleScrub = (ms: number) => {
        setPlayheadMs(Math.max(0, Math.min(visualEndMs, Math.round(ms))));
    };
    const handleFitWidth = () => {
        const availViewport = Math.max(320, viewportWidth - LABEL_COLUMN_PX);
        setZoomLevel(getFitTimelineZoom(visualEndMs, availViewport));
    };
    const handleAddTrack = (kind: TimelineTrackKind) => {
        setAddMenuOpen(false);
        dispatch({ op: "addTrack", payload: { kind } });
    };
    const handleRemoveTrack = (trackId: string) => {
        dispatch({ op: "removeTrack", payload: { trackId } });
        // 选中片段若落在被删轨道上，需同步清空，否则留下悬挂选中态。
        if (selectedClipId) {
            const clip = project.clips.find((c) => c.id === selectedClipId);
            if (clip && clip.trackId === trackId) selectClip(null);
        }
    };
    const handleToggleTrackFlag = (trackId: string, flag: "visible" | "muted", value: boolean) => {
        dispatch({ op: "setTrackFlag", payload: { trackId, flag, value } });
    };

    const handleRemoveTrackBlocked = (kind: TimelineTrack["kind"]) => {
        setRemoveBlockedHint({ id: Date.now(), text: trackRemoveBlockedReason(kind) });
    };

    return (
        <div className="relative flex h-full min-h-0 flex-col bg-[var(--director-sequencer-surface)]">
            {/* 工具条：左侧编辑工具，右侧缩放/时码（撤销/重做在宿主顶栏） */}
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3">
                {/* 工具模式：选择 / 剃刀 */}
                <div className="flex items-center gap-0.5 rounded-md bg-[var(--director-control-hover)] p-0.5">
                    <button
                        type="button"
                        aria-label="选择工具"
                        aria-pressed={activeTool === "select"}
                        title="选择工具"
                        onClick={() => setActiveTool("select")}
                        className={`grid size-6 place-items-center rounded-[6px] transition-colors ${
                            activeTool === "select" ? TOOL_FG_ACTIVE : TOOL_FG_IDLE
                        }`}
                    >
                        <MousePointer2 className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="剃刀工具"
                        aria-pressed={activeTool === "razor"}
                        title="剃刀工具：点击片段在光标处分割"
                        onClick={() => setActiveTool((tool) => (tool === "razor" ? "select" : "razor"))}
                        className={`grid size-6 place-items-center rounded-[6px] transition-colors ${
                            activeTool === "razor" ? TOOL_FG_ACTIVE : TOOL_FG_IDLE
                        }`}
                    >
                        <Slice className="size-4" />
                    </button>
                </div>
                <div className="mx-1 h-5 w-px bg-[var(--director-sequencer-border)]" />
                {/* 在播放头分割当前片段 */}
                <button
                    type="button"
                    aria-label="在播放头分割"
                    disabled={!clipAtPlayhead}
                    title="在播放头分割片段"
                    onClick={handleSplitAtPlayhead}
                    className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                    <Scissors className="size-4" />
                </button>
                {/* 删除选中片段 */}
                <button
                    type="button"
                    aria-label="删除选中片段"
                    disabled={!selectedClip}
                    title="删除选中片段"
                    onClick={handleDeleteSelected}
                    className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE} disabled:cursor-not-allowed disabled:opacity-40`}
                >
                    <Trash2 className="size-4" />
                </button>
                <div className="mx-1 h-5 w-px bg-[var(--director-sequencer-border)]" />
                {/* 吸附开关 */}
                <button
                    type="button"
                    aria-label="吸附"
                    aria-pressed={snapEnabled}
                    title="吸附（拖动与时间刻度对齐）"
                    onClick={() => setSnapEnabled((v) => !v)}
                    className={`grid size-7 place-items-center rounded-md transition-colors ${
                        snapEnabled ? TOOL_FG_ACTIVE : TOOL_FG_IDLE
                    }`}
                >
                    <Magnet className="size-4" />
                </button>
                {/* 新增轨道 */}
                <div className="relative">
                    <button
                        type="button"
                        aria-label="新增轨道"
                        aria-expanded={addMenuOpen}
                        title="新增轨道"
                        onClick={() => setAddMenuOpen((v) => !v)}
                        className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE}`}
                    >
                        <Plus className="size-4" />
                    </button>
                    {addMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setAddMenuOpen(false)} />
                            <div className="absolute left-0 top-8 z-50 min-w-32 overflow-hidden rounded-lg border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] py-1 shadow-xl">
                                <button
                                    type="button"
                                    onClick={() => handleAddTrack("video")}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${TOOL_FG_IDLE}`}
                                >
                                    <Film className="size-3.5" />
                                    视频轨道
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAddTrack("audio")}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${TOOL_FG_IDLE}`}
                                >
                                    <Music2 className="size-3.5" />
                                    音频轨道
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleAddTrack("subtitle")}
                                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs ${TOOL_FG_IDLE}`}
                                >
                                    <Subtitles className="size-3.5" />
                                    字幕轨道
                                </button>
                            </div>
                        </>
                    )}
                </div>
                <div className="flex-1" />
                {/* 播放头时码 */}
                <span className="w-16 text-right text-xs tabular-nums text-[var(--director-dock-fg)]">{formatTimelineTime(playheadMs)}</span>
                <span className="text-xs tabular-nums text-[var(--director-dock-fg)]">片段 {project.clips.length}</span>
                <div className="mx-1 h-5 w-px bg-[var(--director-sequencer-border)]" />
                {/* 适应宽度 */}
                <button
                    type="button"
                    aria-label="适应宽度"
                    title="适应宽度"
                    onClick={handleFitWidth}
                    className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE}`}
                >
                    <Maximize className="size-4" />
                </button>
                <button
                    type="button"
                    aria-label="缩小时间线"
                    title="缩小时间线"
                    onClick={() => setZoomLevel((z) => zoomOut(z))}
                    className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE}`}
                >
                    <ZoomOut className="size-4" />
                </button>
                <span className="w-10 text-center text-xs tabular-nums text-[var(--director-dock-fg)]">{Math.round(zoomLevel * 100)}%</span>
                <button
                    type="button"
                    aria-label="放大时间线"
                    title="放大时间线"
                    onClick={() => setZoomLevel((z) => zoomIn(z))}
                    className={`grid size-7 place-items-center rounded-md ${TOOL_FG_IDLE}`}
                >
                    <ZoomIn className="size-4" />
                </button>
            </div>

            {/* 时间线主体 */}
            <div ref={containerRef} className="director-scroll min-h-0 flex-1 overflow-auto bg-[var(--director-sequencer-surface)]" data-canvas-no-zoom>
                {project.clips.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--director-dock-fg)]">
                        <Scissors className="size-8" />
                        <p className="text-sm">时间线暂无片段，从素材库拖入或后续接入画布节点</p>
                    </div>
                ) : (
                    <div className="relative min-w-full" style={{ width: contentWidth }}>
                        <TimelineRuler
                            pxPerMs={pxPerMs}
                            endMs={visualEndMs}
                            playheadMs={playheadMs}
                            snapEnabled={snapEnabled}
                            onScrub={handleScrub}
                        />
                        {[
                            { label: "视觉轨道", tracks: visualTracks },
                            { label: "音频轨道", tracks: audioTracks },
                            { label: "字幕轨道", tracks: subtitleTracks },
                        ]
                            .filter((group) => group.tracks.length > 0)
                            .map((group) => (
                                <div key={group.label}>
                                    {group.tracks.map((track) => (
                                        <TrackRow
                                            key={track.id}
                                            track={track}
                                            project={project}
                                            pxPerMs={pxPerMs}
                                            onGesture={previewGesture}
                                            onCommit={commitGesture}
                                            onCancel={cancelGesture}
                                            selectedClipId={selectedClipId}
                                            razorActive={activeTool === "razor"}
                                            snapEnabled={snapEnabled}
                                            playheadMs={playheadMs}
                                            onSelectClip={selectClip}

                                            removable={project.tracks.filter((t) => t.kind === track.kind).length > 1}
                                             onRemoveTrack={handleRemoveTrack}
                                             onRemoveBlocked={handleRemoveTrackBlocked}
                                            onToggleTrackFlag={handleToggleTrackFlag}
                                            onSplitClip={(clipId, splitAtMs) =>
                                                dispatch({ op: "splitClip", payload: { id: clipId, splitAtMs } })
                                            }
                                        />
                                    ))}
                                </div>
                            ))}

                        {/* 播放头：贯穿标尺与全部轨道，与标尺拖动同源（视觉/音频/字幕均覆盖） */}
                        <div
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 z-[14] w-px bg-[var(--director-danger)]"
                            style={{ left: LABEL_COLUMN_PX + playheadMs * pxPerMs }}
                        >
                            <div className="absolute -left-[5px] top-0 size-2.5 rotate-45 rounded-[2px] bg-[var(--director-danger)]" />
                        </div>
                    </div>
                )}

            {/* 点击不可移除轨道 X 时的原因提示（短暂居中浮现，不拦截交互） */}
            {removeBlockedHint && (
                <div
                    key={removeBlockedHint.id}
                    role="status"
                    aria-live="polite"
                    className="pointer-events-none absolute left-1/2 top-12 z-50 -translate-x-1/2 whitespace-nowrap rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3 py-1.5 text-xs text-[var(--director-dock-fg-strong)] shadow-lg"
                >
                    {removeBlockedHint.text}
                </div>
            )}
            </div>
        </div>
    );
}

function TimelineRuler({
    pxPerMs,
    endMs,
    playheadMs,
    snapEnabled,
    onScrub,
}: {
    pxPerMs: number;
    endMs: number;
    playheadMs: number;
    snapEnabled: boolean;
    onScrub: (ms: number) => void;
}) {
    const step = getRulerTickStep(pxPerMs);
    const ticks: number[] = [];
    for (let t = 0; t <= endMs; t += step) ticks.push(t);
    const areaRef = useRef<HTMLDivElement | null>(null);
    const dragPointerRef = useRef<number | null>(null);
    const moveTo = (clientX: number) => {
        const rect = areaRef.current!.getBoundingClientRect();
        let ms = (clientX - rect.left) / pxPerMs;
        if (snapEnabled) ms = Math.round(ms / SNAP_MS) * SNAP_MS;
        onScrub(ms);
    };
    return (
        <div className="sticky top-0 z-10 flex h-6 shrink-0 w-full items-end border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)]">
            {/* 左列占位与 TrackRow 轨道标签列（w-48）同宽，sticky 跟随横向滚动，保证 0ms 刻度与片段区起点对齐 */}
            <div className="sticky left-0 z-10 w-48 shrink-0 self-stretch border-r border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)]">
                {/* 当前播放头时码，跟随拖动实时刷新 */}
                <span className="absolute bottom-1 right-2 text-[10px] tabular-nums text-[var(--director-danger)]">{formatTimelineTime(playheadMs)}</span>
            </div>
            <div
                ref={areaRef}
                role="slider"
                aria-label="播放头"
                aria-valuemin={0}
                aria-valuemax={Math.round(endMs)}
                aria-valuenow={Math.round(playheadMs)}
                aria-orientation="horizontal"
                className="relative h-full flex-1 cursor-col-resize select-none touch-none"
                onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    dragPointerRef.current = e.pointerId;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    moveTo(e.clientX);
                }}
                onPointerMove={(e) => {
                    if (dragPointerRef.current === e.pointerId) moveTo(e.clientX);
                }}
                onPointerUp={() => {
                    dragPointerRef.current = null;
                }}
                onPointerCancel={() => {
                    dragPointerRef.current = null;
                }}
            >
                {ticks.map((t) => (
                    <div key={t} className="absolute bottom-0" style={{ left: t * pxPerMs - 1 }}>
                        <div className="h-2 w-px bg-[var(--director-sequencer-muted)]" />
                        <span className="absolute bottom-2.5 left-1 whitespace-nowrap text-[10px] tabular-nums text-[var(--director-dock-fg)]">{formatTimelineTime(t)}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}

function TrackRow({
    track,
    project,
    pxPerMs,
    onGesture,
    onCommit,
    onCancel,
    selectedClipId,
    onSelectClip,
    razorActive,
    snapEnabled,
    playheadMs,
    onSplitClip,
    removable,
    onRemoveTrack,
    onRemoveBlocked,
    onToggleTrackFlag,
}: {
    track: TimelineTrack;
    project: TimelineProject;
    pxPerMs: number;
    onGesture: (cmd: { op: string; payload: unknown }) => void;
    onCommit: () => void;
    onCancel: () => void;
    selectedClipId: string | null;
    onSelectClip: (id: string | null) => void;
    razorActive: boolean;
    snapEnabled: boolean;
    playheadMs: number;
    onSplitClip: (clipId: string, splitAtMs: number) => void;
    removable: boolean;
    onRemoveTrack: (trackId: string) => void;
    onRemoveBlocked: (kind: TimelineTrack["kind"]) => void;
    onToggleTrackFlag: (trackId: string, flag: "visible" | "muted", value: boolean) => void;
}) {
    const clips = project.clips.filter((c) => c.trackId === track.id);
    return (
        <div className="group flex h-16 border-b border-[var(--director-sequencer-border)]">
            <div className="sticky left-0 z-10 flex w-48 shrink-0 items-center gap-1 border-r border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-2">
                <TrackBadge kind={track.kind} />
                <div className="min-w-0 flex-1">
                    <div
                        className={`truncate text-xs font-medium ${
                            track.visible === false
                                ? "text-[var(--director-dock-fg)]"
                                : "text-[var(--director-dock-fg-strong)]"
                        }`}
                    >
                        {track.label}
                    </div>
                    <div className="text-[10px] text-[var(--director-dock-fg)]">{clips.length} 个片段</div>
                </div>
                <button
                    type="button"
                    aria-label={track.visible === false ? "显示轨道" : "隐藏轨道"}
                    title={track.visible === false ? "显示轨道" : "隐藏轨道"}
                    aria-pressed={track.visible === false}
                    onClick={() => onToggleTrackFlag(track.id, "visible", track.visible === false)}
                    className={`grid size-6 shrink-0 place-items-center rounded-md transition-colors ${
                        track.visible === false
                            ? "bg-[var(--director-control-hover)] text-[var(--director-dock-fg-strong)]"
                            : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                    }`}
                >
                    {track.visible === false ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
                </button>
                <button
                    type="button"
                    aria-label={track.muted ? "取消静音" : "静音轨道"}
                    title={track.muted ? "取消静音" : "静音轨道"}
                    aria-pressed={track.muted === true}
                    onClick={() => onToggleTrackFlag(track.id, "muted", !track.muted)}
                    className={`grid size-6 shrink-0 place-items-center rounded-md transition-colors ${
                        track.muted === true
                            ? "bg-[var(--director-control-hover)] text-[var(--director-dock-fg-strong)]"
                            : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                    }`}
                >
                    {track.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <button
                    type="button"
                    aria-label={`移除轨道 ${track.label}`}
                    title={removable ? "移除轨道" : trackRemoveBlockedReason(track.kind)}
                    onClick={() => (removable ? onRemoveTrack(track.id) : onRemoveBlocked(track.kind))}
                    className={`grid size-6 shrink-0 place-items-center rounded-md transition-opacity ${
                        removable
                            ? "text-[var(--director-dock-fg)] opacity-0 hover:bg-[var(--director-control-hover)] hover:text-[var(--director-danger)] focus-visible:opacity-100 group-hover:opacity-100"
                            : "cursor-not-allowed text-[var(--director-dock-fg)] opacity-40 hover:bg-[var(--director-control-hover)] hover:opacity-100 focus-visible:opacity-100"
                    }`}
                >
                    <X className="size-3.5" />
                </button>
            </div>
            <div
                className={`relative flex-1 overflow-hidden bg-[var(--director-sequencer-grid)] transition-opacity ${
                    razorActive ? "cursor-crosshair" : ""
                } ${track.visible === false ? "opacity-40" : ""}`}
                onPointerDown={(e) => {
                    if (razorActive) return;
                    if (e.target === e.currentTarget) onSelectClip(null);
                }}
            >
                {clips.map((clip) => (
                    <ClipItem
                        key={clip.id}
                        clip={clip}
                        pxPerMs={pxPerMs}
                        onGesture={onGesture}
                        onCommit={onCommit}
                        onCancel={onCancel}
                        selected={selectedClipId === clip.id}
                        onSelectClip={onSelectClip}
                        razorActive={razorActive}
                        snapEnabled={snapEnabled}
                        playheadMs={playheadMs}
                        clips={project.clips}
                        onSplitClip={onSplitClip}
                    />
                ))}
            </div>
        </div>
    );
}

function TrackBadge({ kind }: { kind: TimelineTrack["kind"] }) {
    const cls =
        kind === "video" || kind === "image"
            ? "text-[var(--director-dock-fg)]"
            : kind === "audio"
              ? "text-[var(--director-success)]"
              : "text-[var(--director-warning)]";
    return (
        <div className={`grid size-6 shrink-0 place-items-center rounded-md bg-[var(--director-dock-active-surface)] ${cls}`} title={kind}>
            {kind === "subtitle" ? <Subtitles className="size-3.5" /> : kind === "audio" ? <Music2 className="size-3.5" /> : <Film className="size-3.5" />}
        </div>
    );
}

function ClipItem({
    clip,
    pxPerMs,
    onGesture,
    onCommit,
    onCancel,
    selected,
    onSelectClip,
    razorActive,
    snapEnabled,
    playheadMs,
    clips,
    onSplitClip,
}: {
    clip: TimelineClip;
    pxPerMs: number;
    onGesture: (cmd: { op: string; payload: unknown }) => void;
    onCommit: () => void;
    onCancel: () => void;
    selected: boolean;
    onSelectClip: (id: string | null) => void;
    razorActive: boolean;
    snapEnabled: boolean;
    playheadMs: number;
    clips: TimelineClip[];
    onSplitClip: (clipId: string, splitAtMs: number) => void;
}) {
    const gestureRef = useRef<GestureState | null>(null);

    const beginGesture = (e: React.PointerEvent, mode: Exclude<GestureMode, null>) => {
        if (gestureRef.current) return;
        onSelectClip(clip.id);
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
        gestureRef.current = {
            mode,
            pointerId: e.pointerId,
            startClientX: e.clientX,
            originStartMs: clip.startMs,
            originDurationMs: clip.durationMs,
            originSourceStartMs: clip.sourceStartMs ?? 0,
        };
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) return;
        const deltaMs = (e.clientX - g.startClientX) / pxPerMs;

        if (g.mode === "move") {
            const candidateMs = Math.max(0, g.originStartMs + deltaMs);
            // 移动吸附：候选左边缘吸附到其他片段边缘/播放头；右边缘吸附则通过“目标边缘-自身时长”换算回起始点，取偏移更小者
            const leftSnap = computeSnap({
                candidateMs,
                playheadMs,
                clips,
                excludeClipId: clip.id,
                pxPerMs,
                thresholdPx: 8,
                enabled: snapEnabled,
            });
            const rightSnap = computeSnap({
                candidateMs: candidateMs + clip.durationMs,
                playheadMs,
                clips,
                excludeClipId: clip.id,
                pxPerMs,
                thresholdPx: 8,
                enabled: snapEnabled,
            });
            // computeSnap 未命中时返回 { snappedMs: candidateMs, targets: [] }：
            // 只有 targets 非空才算“命中”。若某侧未命中而其距离为 0（候选值不变），
            // 直接与另一侧命中距离比较会把真正命中的一侧丢弃（0 永远最小）。
            const leftHit = leftSnap.targets.length > 0;
            const rightHit = rightSnap.targets.length > 0;
            let snappedMs = candidateMs;
            if (leftHit && rightHit) {
                const rightAltStartMs = rightSnap.snappedMs - clip.durationMs;
                snappedMs =
                    Math.abs(rightAltStartMs - candidateMs) < Math.abs(leftSnap.snappedMs - candidateMs)
                        ? Math.max(0, rightAltStartMs)
                        : leftSnap.snappedMs;
            } else if (leftHit) {
                snappedMs = leftSnap.snappedMs;
            } else if (rightHit) {
                snappedMs = Math.max(0, rightSnap.snappedMs - clip.durationMs);
            }
            onGesture({ op: "moveClip", payload: { id: clip.id, startMs: snappedMs } });
        } else if (g.mode === "trim-end") {
            const sourceDuration = clip.sourceDurationMs ?? 0;
            const newRightEdge = g.originStartMs + g.originDurationMs + deltaMs;
            const { snappedMs } = computeSnap({
                candidateMs: newRightEdge,
                playheadMs,
                clips,
                excludeClipId: clip.id,
                pxPerMs,
                thresholdPx: 8,
                enabled: snapEnabled,
            });
            let newDurationMs = Math.max(SNAP_MS, snappedMs - g.originStartMs);
            if (sourceDuration > 0) newDurationMs = Math.min(newDurationMs, sourceDuration - g.originSourceStartMs);
            onGesture({ op: "trimClip", payload: { id: clip.id, durationMs: newDurationMs } });
        } else {
            // trim-start：右端保持不动，起始点前移，源起点同步前移
            const sourceDuration = clip.sourceDurationMs ?? 0;
            const rightEdge = g.originStartMs + g.originDurationMs;
            const candidateMs = Math.max(0, Math.min(g.originStartMs + deltaMs, rightEdge - SNAP_MS));
            const { snappedMs } = computeSnap({
                candidateMs,
                playheadMs,
                clips,
                excludeClipId: clip.id,
                pxPerMs,
                thresholdPx: 8,
                enabled: snapEnabled,
            });
            const newStartMs = Math.max(0, Math.min(snappedMs, rightEdge - SNAP_MS));
            let newSourceStartMs = g.originSourceStartMs + (newStartMs - g.originStartMs);
            if (sourceDuration > 0) newSourceStartMs = Math.min(newSourceStartMs, sourceDuration - SNAP_MS);
            onGesture({
                op: "trimClip",
                payload: { id: clip.id, startMs: newStartMs, durationMs: rightEdge - newStartMs, sourceStartMs: Math.max(0, newSourceStartMs) },
            });
        }
    };

    const endGesture = (e: React.PointerEvent) => {
        const g = gestureRef.current;
        if (!g || e.pointerId !== g.pointerId) return;
        gestureRef.current = null;
        try {
            e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
            // pointer capture 可能已被隐式释放
        }
        onCommit();
    };

    const isSubtitle = clip.kind === "subtitle";
    const isAudio = clip.kind === "audio";
    const left = clip.startMs * pxPerMs;
    const width = clip.durationMs * pxPerMs;
    const label = clip.text || clip.nodeId || clip.id;
    const playheadInside = playheadMs >= clip.startMs && playheadMs <= clip.startMs + clip.durationMs;

    const razorSplitAt = (e: React.PointerEvent) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const atMs = clip.startMs + (e.clientX - rect.left) / pxPerMs;
        const splitMs = Math.round(atMs);
        if (splitMs - clip.startMs < MIN_SPLIT_MS || clip.startMs + clip.durationMs - splitMs < MIN_SPLIT_MS) return;
        onSplitClip(clip.id, splitMs);
    };

    return (
        <div
            className={`group absolute top-1.5 bottom-1.5 select-none rounded-md border text-xs shadow-sm ${
                selected
                    ? "border-[var(--director-accent)] ring-1 ring-[var(--director-accent)]/60 bg-[var(--director-accent)]/25 text-[var(--director-dock-fg-strong)]"
                    : isSubtitle
                      ? "border-[var(--director-warning)]/40 bg-[var(--director-warning)]/15 text-[var(--director-warning)]"
                      : isAudio
                        ? "border-[var(--director-success)]/40 bg-[var(--director-success)]/15 text-[var(--director-success)]"
                        : "border-[var(--director-sequencer-border)] bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]"
            }`}
            style={{ left, width, touchAction: "none" }}
            title={`${label} · ${formatTimelineTime(clip.startMs)} +${formatTimelineTime(clip.durationMs)}`}
            onPointerDown={(e) => {
                // 剃刀模式（字幕除外）：单击即在光标处分割；否则开始移动手势
                if (razorActive && !isSubtitle) {
                    razorSplitAt(e);
                    return;
                }
                beginGesture(e, "move");
            }}
            onPointerMove={onPointerMove}
            onPointerUp={endGesture}
            onPointerCancel={endGesture}
        >
            <div
                className="absolute inset-y-0 left-0 cursor-ew-resize rounded-l-md"
                style={{ width: TRIM_HANDLE_PX }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    beginGesture(e, "trim-start");
                }}
            />
            <div className="pointer-events-none flex h-full items-center gap-1 px-2">
                <span className="truncate">{label}</span>
            </div>
            {/* 播放头经过片段时的对齐标线（razor/对齐视觉辅助） */}
            {playheadInside && (
                <div
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 w-px bg-[var(--director-danger)]/60"
                    style={{ left: (playheadMs - clip.startMs) * pxPerMs }}
                />
            )}
            <div
                className="absolute inset-y-0 right-0 cursor-ew-resize rounded-r-md"
                style={{ width: TRIM_HANDLE_PX }}
                onPointerDown={(e) => {
                    e.stopPropagation();
                    beginGesture(e, "trim-end");
                }}
            />
        </div>
    );
}
