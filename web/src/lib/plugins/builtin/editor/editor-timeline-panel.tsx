// 时间线面板（editor-shell 预设插件贡献，M2.4 手势 echo 最小件）。
// 渲染链路：store.project（当前命令状态）→ 轨道/片段绝对定位 → 拖拽手势
// （moveClip / trimClip）经 previewGesture 逐帧预览、commitGesture 一次性入历史。
// 手势数学与渲染同源（同一 pxPerMs），保证拖拽所见即所得。
// 撤销/重做与保存状态移入宿主顶栏（Concat 主菜单区），本面板保留缩放与片段统计。

import { useEffect, useRef, useState } from "react";
import { Film, Music2, Scissors, Subtitles, ZoomIn, ZoomOut } from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import {
    formatTimelineTime,
    getRulerTickStep,
    getTimelinePxPerMs,
    getTimelineVisualEndMs,
    zoomIn,
    zoomOut,
} from "@/lib/timeline/timeline-view";
import { getAudioTracks, getSubtitleTracks, getVisualTracks } from "@/lib/timeline/timeline-tracks";
import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

const MIN_VISUAL_END_MS = 1_000;
const SNAP_MS = 10;
const TRIM_HANDLE_PX = 8;
// 轨道标签列宽度（w-40）。时间线内容宽度必须补上该列，否则片段区 flex-1 只到
// trackWidth - 160，末端片段被 overflow-hidden 裁掉且无法滚动到达。
const LABEL_COLUMN_PX = 160;

type GestureMode = "move" | "trim-start" | "trim-end" | null;

type GestureState = {
    mode: Exclude<GestureMode, null>;
    pointerId: number;
    startClientX: number;
    originStartMs: number;
    originDurationMs: number;
    originSourceStartMs: number;
};

function snapMs(deltaMs: number): number {
    return Math.round(deltaMs / SNAP_MS) * SNAP_MS;
}

export function EditorTimelinePanel() {
    const { project, previewGesture, commitGesture, cancelGesture, selectedClipId, selectClip } =
        useEditorStoreContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);

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

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--director-sequencer-surface)]">
            {/* 工具条：缩放 + 片段统计（撤销/重做在宿主顶栏） */}
            <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3">
                <button
                    type="button"
                    aria-label="缩小时间线"
                    onClick={() => setZoomLevel((z) => zoomOut(z))}
                    className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                >
                    <ZoomOut className="size-4" />
                </button>
                <span className="w-10 text-center text-xs tabular-nums text-[var(--director-dock-fg)]">{Math.round(zoomLevel * 100)}%</span>
                <button
                    type="button"
                    aria-label="放大时间线"
                    onClick={() => setZoomLevel((z) => zoomIn(z))}
                    className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                >
                    <ZoomIn className="size-4" />
                </button>
                <div className="flex-1" />
                <span className="text-xs tabular-nums text-[var(--director-dock-fg)]">片段 {project.clips.length}</span>
            </div>

            {/* 时间线主体 */}
            <div ref={containerRef} className="director-scroll min-h-0 flex-1 overflow-auto bg-[var(--director-sequencer-surface)]" data-canvas-no-zoom>
                {project.clips.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-[var(--director-dock-fg)]">
                        <Scissors className="size-8" />
                        <p className="text-sm">时间线暂无片段，从素材库拖入或后续接入画布节点</p>
                    </div>
                ) : (
                    <div className="min-w-full" style={{ width: contentWidth }}>
                        <TimelineRuler pxPerMs={pxPerMs} endMs={visualEndMs} />
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
                                            onSelectClip={selectClip}
                                        />
                                    ))}
                                </div>
                            ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function TimelineRuler({ pxPerMs, endMs }: { pxPerMs: number; endMs: number }) {
    const step = getRulerTickStep(pxPerMs);
    const ticks: number[] = [];
    for (let t = 0; t <= endMs; t += step) ticks.push(t);
    return (
        <div className="sticky top-0 z-10 flex h-6 shrink-0 w-full items-end border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)]">
            {/* 左列占位与 TrackRow 轨道标签列（w-40）同宽，sticky 跟随横向滚动，保证 0ms 刻度与片段区起点对齐 */}
            <div className="sticky left-0 z-10 w-40 shrink-0 self-stretch border-r border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)]" />
            <div className="relative h-full flex-1">
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
}: {
    track: TimelineTrack;
    project: TimelineProject;
    pxPerMs: number;
    onGesture: (cmd: { op: string; payload: unknown }) => void;
    onCommit: () => void;
    onCancel: () => void;
    selectedClipId: string | null;
    onSelectClip: (id: string | null) => void;
}) {
    const clips = project.clips.filter((c) => c.trackId === track.id);
    return (
        <div className="flex h-16 border-b border-[var(--director-sequencer-border)]">
            <div className="sticky left-0 z-10 flex w-40 shrink-0 items-center gap-2 border-r border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3">
                <TrackBadge kind={track.kind} />
                <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-[var(--director-dock-fg-strong)]">{track.label}</div>
                    <div className="text-[10px] text-[var(--director-dock-fg)]">{clips.length} 个片段</div>
                </div>
            </div>
            <div
                className="relative flex-1 overflow-hidden bg-[var(--director-sequencer-grid)]"
                onPointerDown={(e) => {
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
}: {
    clip: TimelineClip;
    pxPerMs: number;
    onGesture: (cmd: { op: string; payload: unknown }) => void;
    onCommit: () => void;
    onCancel: () => void;
    selected: boolean;
    onSelectClip: (id: string | null) => void;
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
        const deltaMs = snapMs((e.clientX - g.startClientX) / pxPerMs);

        if (g.mode === "move") {
            const newStartMs = Math.max(0, g.originStartMs + deltaMs);
            onGesture({ op: "moveClip", payload: { id: clip.id, startMs: newStartMs } });
        } else if (g.mode === "trim-end") {
            const sourceDuration = clip.sourceDurationMs ?? 0;
            let newDurationMs = Math.max(SNAP_MS, g.originDurationMs + deltaMs);
            if (sourceDuration > 0) newDurationMs = Math.min(newDurationMs, sourceDuration - g.originSourceStartMs);
            onGesture({ op: "trimClip", payload: { id: clip.id, durationMs: newDurationMs } });
        } else {
            // trim-start：右端保持不动，起始点前移，源起点同步前移
            const sourceDuration = clip.sourceDurationMs ?? 0;
            const rightEdge = g.originStartMs + g.originDurationMs;
            let newStartMs = Math.max(0, Math.min(g.originStartMs + deltaMs, rightEdge - SNAP_MS));
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
            onPointerDown={(e) => beginGesture(e, "move")}
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
