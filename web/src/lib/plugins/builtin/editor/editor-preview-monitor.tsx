// 预览监视器（editor-shell 预设插件贡献 preview-renderer 插槽，M3.2）。
// 浏览器内近似预览：真实媒体帧（storageKey → resolveMediaUrl）+ 播放头 + 时间码。
// 近似渲染与导出（M3.7 的 buildTimelineRenderPlan）共享同一条"片段→媒体"解析路径，
// 但这里只做时序呈现，不承诺像素级预览——像素级交给导出任务（M4）。

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronDown, Film, Gauge, Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import { resolveMediaUrl } from "@/services/file-storage";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

const PREVIEW_TICK_MS = 100;

function getClipAtTime(project: TimelineProject, timeMs: number): TimelineClip | null {
    return (
        project.clips.find((clip) => clip.kind === "video" && clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs) ??
        project.clips.find((clip) => clip.kind === "image" && clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs) ??
        null
    );
}

function useClipMediaUrl(clip: TimelineClip | null): string | null {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let cancelled = false;
        setUrl(null);
        if (!clip) return;
        const direct = clip.directMedia;
        const source = direct?.dataUrl ?? direct?.url ?? direct?.storageKey;
        if (direct?.storageKey) {
            resolveMediaUrl(direct.storageKey, direct.url ?? "")
                .catch(() => null)
                .then((resolved) => {
                    if (!cancelled && resolved) setUrl(resolved);
                });
        } else if (source) {
            setUrl(source);
        }
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clip?.id, clip?.nodeId, clip?.directMedia?.storageKey, clip?.directMedia?.url, clip?.directMedia?.dataUrl]);
    return url;
}

export function EditorPreviewMonitor() {
    const { project, selectedClipId } = useEditorStoreContext();
    const durationMs = project?.durationMs ?? 0;
    const [playbackMs, setPlaybackMs] = useState(0);
    const [playing, setPlaying] = useState(false);
    const [speed, setSpeed] = useState(1);
    const speedRef = useRef(1);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number | null>(null);

    const activeClip = project ? getClipAtTime(project, playbackMs) : null;
    const activeMediaUrl = useClipMediaUrl(activeClip);

    const stop = useCallback(() => {
        setPlaying(false);
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        lastTickRef.current = null;
    }, []);

    const toggle = useCallback(() => {
        if (!project || durationMs <= 0) return;
        if (playing) {
            stop();
            return;
        }
        setPlaying(true);
        const tick = (now: number) => {
            if (lastTickRef.current === null) lastTickRef.current = now;
            const delta = now - lastTickRef.current;
            lastTickRef.current = now;
            setPlaybackMs((prev) => {
                const next = prev + delta * speedRef.current;
                if (next >= durationMs) {
                    stop();
                    return durationMs;
                }
                return next;
            });
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [playing, durationMs, project, stop]);

    // 项目切换/时长变化时重置播放
    useEffect(() => {
        setPlaybackMs(0);
        stop();
    }, [project, stop]);

    useEffect(() => () => stop(), [stop]);

    const scrub = (e: React.ChangeEvent<HTMLInputElement>) => {
        setPlaybackMs(Number(e.target.value));
    };

    const stepBy = (deltaMs: number) => {
        if (!project) return;
        setPlaybackMs((prev) => Math.min(durationMs, Math.max(0, prev + deltaMs)));
    };

    const changeSpeed = (next: number) => {
        speedRef.current = next;
        setSpeed(next);
    };

    return (
        <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-black/70">
            {/* 预览画面（占满整卡，Concat 监视器恒黑） */}
            <div className="absolute inset-0 flex items-center justify-center overflow-hidden p-6">
                {activeClip && activeMediaUrl ? (
                    <video
                        key={activeClip.id}
                        src={activeMediaUrl}
                        className="max-h-full max-w-full rounded-md object-contain shadow-lg"
                        muted
                        playsInline
                        preload="metadata"
                    />
                ) : (
                    <div className="flex flex-col items-center gap-3 text-center">
                        <div className="grid size-14 place-items-center rounded-xl bg-white/10">
                            <Film className="size-6 text-white/60" />
                        </div>
                        <div className="max-w-xs text-xs leading-relaxed text-white/70">
                            {project && project.clips.length > 0
                                ? activeClip
                                    ? "当前时间点片段无媒体源（占位/字幕/音频）"
                                    : "播放头位于空白处"
                                : "时间线暂无片段，导入素材后在此预览"}
                        </div>
                    </div>
                )}
                {activeClip && (
                    <div className="absolute left-4 top-4 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90 backdrop-blur">
                        {activeClip.nodeId || activeClip.id} · {activeClip.kind}
                    </div>
                )}
            </div>

            {/* 播放控制：叠加在画面底部（Concat 式），不占独立行，拖拽拉高预览时始终贴画面底 */}
            <div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 bg-gradient-to-t from-black/85 via-black/50 to-transparent px-3 pb-2.5 pt-8">
                <span className="shrink-0 text-xs tabular-nums text-white/90">
                    {formatTimelineTime(playbackMs)}
                    <span className="text-white/50"> / {formatTimelineTime(durationMs)}</span>
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        aria-label="回到开头"
                        title="回到开头"
                        onClick={() => setPlaybackMs(0)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35"
                    >
                        <SkipBack className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="后退 1 秒"
                        title="后退 1 秒"
                        onClick={() => stepBy(-1000)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35"
                    >
                        <StepBack className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={playing ? "暂停" : "播放"}
                        onClick={toggle}
                        disabled={durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md bg-white/15 text-white transition-colors hover:bg-white/25 disabled:pointer-events-none disabled:opacity-35"
                    >
                        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
                    </button>
                    <button
                        type="button"
                        aria-label="前进 1 秒"
                        title="前进 1 秒"
                        onClick={() => stepBy(1000)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35"
                    >
                        <StepForward className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="跳到结尾"
                        title="跳到结尾"
                        onClick={() => setPlaybackMs(durationMs)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-white/80 transition-colors hover:bg-white/15 hover:text-white disabled:pointer-events-none disabled:opacity-35"
                    >
                        <SkipForward className="size-4" />
                    </button>
                </div>
                <input
                    type="range"
                    min={0}
                    max={Math.max(durationMs, 1)}
                    step={10}
                    value={Math.min(playbackMs, Math.max(durationMs, 1))}
                    onChange={scrub}
                    className="h-1 min-w-0 flex-1 accent-white/90"
                    aria-label="播放头"
                />
                <div className="relative shrink-0">
                    <button
                        type="button"
                        aria-label="播放速度"
                        title="播放速度"
                        onClick={() => setSpeedMenuOpen((v) => !v)}
                        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-white/80 transition-colors hover:bg-white/15 hover:text-white"
                    >
                        <Gauge className="size-3.5" />
                        <span className="tabular-nums">{speed}x</span>
                        <ChevronDown className={`size-3 transition-transform ${speedMenuOpen ? "rotate-180" : ""}`} />
                    </button>
                    {speedMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setSpeedMenuOpen(false)} />
                            <div className="absolute bottom-full right-0 z-50 mb-1 w-24 overflow-hidden rounded-md border border-white/10 bg-neutral-900 py-1 shadow-xl">
                                {[0.5, 1, 1.5, 2].map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => {
                                            changeSpeed(s);
                                            setSpeedMenuOpen(false);
                                        }}
                                        className={`flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] transition-colors hover:bg-white/10 ${s === speed ? "text-white" : "text-white/70"}`}
                                    >
                                        <span>{s}x</span>
                                        {s === speed && <span className="text-white/50">✓</span>}
                                    </button>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
