// 预览监视器（editor-shell 预设插件贡献 preview-renderer 插槽，M3.2）。
// 浏览器内近似预览：真实媒体帧（storageKey → resolveMediaUrl）+ 播放头 + 时间码。
// 近似渲染与导出（M3.7 的 buildTimelineRenderPlan）共享同一条"片段→媒体"解析路径，
// 但这里只做时序呈现，不承诺像素级预览——像素级交给导出任务（M4）。

import { useCallback, useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";

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
                const next = prev + delta;
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

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--workspace-surface)]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
                <span className="text-xs font-medium text-foreground/75">预览</span>
                <span className="text-xs tabular-nums text-foreground/45">
                    {formatTimelineTime(playbackMs)} / {formatTimelineTime(durationMs)}
                </span>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black/60 p-4">
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
                        <div className="grid size-16 place-items-center rounded-xl bg-[var(--workspace-accent)]/15 text-3xl">🎬</div>
                        <div className="max-w-xs text-xs leading-relaxed text-foreground/55">
                            {project && project.clips.length > 0
                                ? activeClip
                                    ? "当前时间点片段无媒体源（占位/字幕/音频）"
                                    : "播放头位于空白处"
                                : "时间线暂无片段，导入素材后在此预览"}
                        </div>
                    </div>
                )}
                {activeClip && (
                    <div className="absolute bottom-4 left-4 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white/90 backdrop-blur">
                        {activeClip.nodeId || activeClip.id} · {activeClip.kind}
                    </div>
                )}
            </div>

            <div className="flex h-10 shrink-0 items-center gap-3 border-t border-border/60 px-3">
                <button
                    type="button"
                    aria-label={playing ? "暂停" : "播放"}
                    onClick={toggle}
                    disabled={durationMs <= 0}
                    className="grid size-7 place-items-center rounded-md bg-[var(--workspace-accent)] text-white hover:opacity-85 disabled:pointer-events-none disabled:opacity-35"
                >
                    {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
                </button>
                <input
                    type="range"
                    min={0}
                    max={Math.max(durationMs, 1)}
                    step={10}
                    value={Math.min(playbackMs, Math.max(durationMs, 1))}
                    onChange={scrub}
                    className="h-1 min-w-0 flex-1 accent-[var(--workspace-accent)]"
                    aria-label="播放头"
                />
                <span className="w-14 text-right text-xs tabular-nums text-foreground/45">
                    {selectedClipId ? "已选片段" : formatTimelineTime(playbackMs)}
                </span>
            </div>
        </div>
    );
}
