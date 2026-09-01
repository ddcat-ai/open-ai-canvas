// 时间线面板（editor-shell 预设插件贡献，M2.4 手势 echo 最小件）。
// 渲染链路：store.project（当前命令状态）→ 轨道/片段绝对定位 → 拖拽手势
// （moveClip / trimClip）经 previewGesture 逐帧预览、commitGesture 一次性入历史。
// 手势数学与渲染同源（同一 pxPerMs），保证拖拽所见即所得。

import { useEffect, useRef, useState } from "react";
import { Loader2, Redo2, Scissors, Undo2, ZoomIn, ZoomOut } from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import {
    formatTimelineTime,
    getRulerTickStep,
    getTimelineTrackWidth,
    getTimelineVisualEndMs,
    zoomIn,
    zoomOut,
} from "@/lib/timeline/timeline-view";
import { getAudioTracks, getSubtitleTracks, getVisualTracks } from "@/lib/timeline/timeline-tracks";
import type { TimelineClip, TimelineProject, TimelineTrack } from "@/types/timeline";

const MIN_VISUAL_END_MS = 1_000;
const SNAP_MS = 10;
const TRIM_HANDLE_PX = 8;

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
    const { project, history, isDirty, saving, saveError, undo, redo, previewGesture, commitGesture, cancelGesture, selectedClipId, selectClip } =
        useEditorStoreContext();

    const containerRef = useRef<HTMLDivElement>(null);
    const [viewportWidth, setViewportWidth] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);

    useEffect(() => {
        const el = containerRef.current;
        if (el) setViewportWidth(el.clientWidth);
    }, []);

    if (!project) return <div className="flex h-full items-center justify-center text-sm text-foreground/45">时间线未加载</div>;

    const visualEndMs = Math.max(MIN_VISUAL_END_MS, getTimelineVisualEndMs(project.clips));
    const trackWidth = getTimelineTrackWidth(visualEndMs, zoomLevel, viewportWidth);
    const pxPerMs = trackWidth / visualEndMs;

    const visualTracks = getVisualTracks(project.tracks);
    const audioTracks = getAudioTracks(project.tracks);
    const subtitleTracks = getSubtitleTracks(project.tracks);

    const canUndo = (history?.undoStack.length ?? 0) > 0;
    const canRedo = (history?.redoStack.length ?? 0) > 0;

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--workspace-surface)]">
            {/* 工具条 */}
            <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border/60 px-3">
                <button
                    type="button"
                    aria-label="撤销"
                    title="撤销（Cmd/Ctrl+Z）"
                    onClick={undo}
                    disabled={!canUndo}
                    className="grid size-7 place-items-center rounded-md text-foreground/70 hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-35"
                >
                    <Undo2 className="size-4" />
                </button>
                <button
                    type="button"
                    aria-label="重做"
                    title="重做（Cmd/Ctrl+Shift+Z）"
                    onClick={redo}
                    disabled={!canRedo}
                    className="grid size-7 place-items-center rounded-md text-foreground/70 hover:bg-foreground/8 disabled:pointer-events-none disabled:opacity-35"
                >
                    <Redo2 className="size-4" />
                </button>
                <div className="mx-1 h-4 w-px bg-border/60" />
                <button
                    type="button"
                    aria-label="缩小时间线"
                    onClick={() => setZoomLevel((z) => zoomOut(z))}
                    className="grid size-7 place-items-center rounded-md text-foreground/70 hover:bg-foreground/8"
                >
                    <ZoomOut className="size-4" />
                </button>
                <span className="w-10 text-center text-xs tabular-nums text-foreground/50">{Math.round(zoomLevel * 100)}%</span>
                <button
                    type="button"
                    aria-label="放大时间线"
                    onClick={() => setZoomLevel((z) => zoomIn(z))}
                    className="grid size-7 place-items-center rounded-md text-foreground/70 hover:bg-foreground/8"
                >
                    <ZoomIn className="size-4" />
                </button>
                <div className="flex-1" />
                {saveError ? (
                    <span className="flex items-center gap-1 text-xs text-[var(--danger)]" title={saveError}>
                        保存失败
                    </span>
                ) : saving ? (
                    <span className="flex items-center gap-1 text-xs text-foreground/50">
                        <Loader2 className="size-3 animate-spin" /> 保存中…
                    </span>
                ) : isDirty ? (
                    <span className="text-xs text-foreground/50">未保存</span>
                ) : (
                    <span className="text-xs text-foreground/40">已保存</span>
                )}
            </div>

            {/* 时间线主体 */}
            <div ref={containerRef} className="min-h-0 flex-1 overflow-auto" data-canvas-no-zoom>
                {project.clips.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 text-foreground/45">
                        <Scissors className="size-8" />
                        <p className="text-sm">时间线暂无片段，从素材库拖入或后续接入画布节点</p>
                    </div>
                ) : (
                    <div className="min-w-full" style={{ width: trackWidth }}>
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
        <div className="sticky top-0 z-10 flex h-6 shrink-0 items-end border-b border-border/60 bg-[var(--workspace-surface)] px-2" style={{ width: endMs * pxPerMs }}>
            {ticks.map((t) => (
                <div key={t} className="relative" style={{ left: t * pxPerMs - 1 }}>
                    <div className="h-2 w-px bg-foreground/25" />
                    <span className="absolute left-1 top-2.5 whitespace-nowrap text-[10px] tabular-nums text-foreground/45">{formatTimelineTime(t)}</span>
                </div>
            ))}
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
        <div className="flex h-16 border-b border-border/40">
            <div className="flex w-36 shrink-0 items-center gap-2 border-r border-border/40 bg-foreground/3 px-3">
                <TrackBadge kind={track.kind} />
                <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-foreground/80">{track.label}</div>
                    <div className="text-[10px] text-foreground/40">{clips.length} 个片段</div>
                </div>
            </div>
            <div
                className="relative flex-1 overflow-hidden bg-foreground/2"
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
    const color =
        kind === "video" || kind === "image"
            ? "bg-[var(--workspace-accent)]/80"
            : kind === "audio"
              ? "bg-[var(--success)]/80"
              : "bg-[var(--warning)]/80";
    return <div className={`size-2.5 shrink-0 rounded-sm ${color}`} title={kind} />;
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
        if (gestureRef.current) return;
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
                    ? "border-[var(--workspace-accent)] ring-1 ring-[var(--workspace-accent)]/60 bg-[var(--workspace-accent)]/25 text-foreground"
                    : isSubtitle
                      ? "border-[var(--warning)]/40 bg-[var(--warning)]/15 text-[var(--warning)]"
                      : isAudio
                        ? "border-[var(--success)]/40 bg-[var(--success)]/15 text-[var(--success)]"
                        : "border-[var(--workspace-accent)]/40 bg-[var(--workspace-accent)]/12 text-foreground/85"
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
