// 预览监视器（editor-shell 预设插件贡献 preview-renderer 插槽，M3.2）。
// 浏览器内近似预览：真实媒体帧（storageKey → resolveMediaUrl）+ 播放头 + 时间码。
// 近似渲染与导出（M3.7 的 buildTimelineRenderPlan）共享同一条"片段→媒体"解析路径，
// 但这里只做时序呈现，不承诺像素级预览——像素级交给导出任务（M4）。
//
// 播放模型：时间线 transport（store.transportMs）与监视器共享。
// - 本地 playbackRef 以 rAF 逐帧推进（60fps 时间码），节流回写 store（~80ms），
//   驱动时间线播放头；外部 scrub（时间线标尺）经 transportMs 回推本地时钟。
// - <video> 元素从动于时钟：播放时 play()、暂停时 pause()、位置偏差 > 阈值才硬 seek，
//   播放速率同步 playbackRate —— 画面与声音由浏览器管线真实推进（不再纯读时间码）。
// - 静音跟随所在音频/视频轨道（muted），不再硬编码 muted（否则"有声音"永远不成立）。

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
    AlertTriangle,
    Captions,
    ChevronDown,
    Download,
    Film,
    Gauge,
    Image as ImageIcon,
    LoaderCircle,
    Pause,
    Play,
    SkipBack,
    SkipForward,
    StepBack,
    StepForward,
    Type,
    Video,
    Volume2,
} from "lucide-react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import { resolveMediaUrl } from "@/services/file-storage";
import { playbackVariantUrl, refreshResource, resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

// 本地播放时钟 → store.transportMs 的回写节流（毫秒）。太密会让时间线面板每帧重渲染。
const STORE_PUSH_INTERVAL_MS = 80;
// 外部 seek 与本地时钟差超过该值（毫秒）视为"拖动跳转"：先暂停再跟随，避免播放中抢时钟。
const SEEK_JUMP_MS = 500;
// 视频元素位置校正阈值（秒）：仅当偏差超过该值才硬 seek，避免逐帧写 currentTime。
const VIDEO_SEEK_TOLERANCE_S = 0.35;

function getClipAtTime(project: TimelineProject, timeMs: number): TimelineClip | null {
    // 隐藏轨道（visible === false）上的片段不参与预览合成。
    const hiddenTrackIds = new Set(project.tracks.filter((t) => t.visible === false).map((t) => t.id));
    const visible = (clip: TimelineClip) => !hiddenTrackIds.has(clip.trackId);
    return (
        project.clips.find((clip) => visible(clip) && clip.kind === "video" && clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs) ??
        project.clips.find((clip) => visible(clip) && clip.kind === "image" && clip.startMs <= timeMs && timeMs < clip.startMs + clip.durationMs) ??
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

/** clip 内部当前应播放的源时间（毫秒）：transport 相对 clip 起点 + 源起点偏移。 */
function clipSourceTimeMs(clip: TimelineClip, transportMs: number): number {
    return Math.max(0, transportMs - clip.startMs + (clip.sourceStartMs ?? 0));
}

function clipKindLabel(kind: TimelineClip["kind"]): string {
    switch (kind) {
        case "video":
            return "视频";
        case "image":
            return "图片";
        case "audio":
            return "音频";
        case "subtitle":
            return "字幕";
        case "text":
            return "文字";
    }
}

function clipDisplayTitle(clip: TimelineClip): string {
    return clip.directMedia?.title || clip.title || clip.text || clip.nodeId || clip.id;
}

function ClipKindIcon({ kind, className }: { kind: TimelineClip["kind"]; className?: string }) {
    const Icon =
        kind === "video" ? Video : kind === "image" ? ImageIcon : kind === "audio" ? Volume2 : kind === "subtitle" ? Captions : Type;
    return <Icon className={className} />;
}

export function EditorPreviewMonitor() {
    const { project, transportMs, setTransportMs } = useEditorStoreContext();
    const durationMs = project?.durationMs ?? 0;

    // 本地播放时钟（毫秒）：逐帧刷新本组件；播放态节流回写 store 驱动时间线播放头。
    const [playbackMs, setPlaybackMs] = useState(0);
    const playbackRef = useRef(0);
    const [playing, setPlaying] = useState(false);
    const playingRef = useRef(false);
    const [speed, setSpeed] = useState(1);
    const speedRef = useRef(1);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);
    const rafRef = useRef<number | null>(null);
    const lastTickRef = useRef<number | null>(null);
    const lastStorePushRef = useRef(0);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const activeClip = project ? getClipAtTime(project, playbackMs) : null;
    const activeMediaUrl = useClipMediaUrl(activeClip);
    const activeTrack = project?.tracks.find((t) => t.id === activeClip?.trackId) ?? null;

    // 播放回退：H.264 原件直接播放；H.265/HEVC 原件多数浏览器无法解码（黑屏），
    // <video> onError 后切换后端 playback 转码副本（variant=playback），副本就绪前轮询。
    const storageKey = activeClip?.directMedia?.storageKey;
    const mediaResourceId = storageKey ? resourceIdFromStorageKey(storageKey) : null;
    const [mediaTier, setMediaTier] = useState<"primary" | "variant">("primary");
    const [variantReadyTick, setVariantReadyTick] = useState(0);
    const [mediaErrorHint, setMediaErrorHint] = useState<string | null>(null);

    useEffect(() => {
        setMediaTier("primary");
        setVariantReadyTick(0);
        setMediaErrorHint(null);
    }, [activeClip?.id, storageKey, activeMediaUrl]);

    useEffect(() => {
        if (mediaTier !== "variant" || !mediaResourceId) return;
        let cancelled = false;
        let failures = 0;
        let polls = 0;
        const timer = window.setInterval(async () => {
            try {
                const res = await refreshResource(mediaResourceId);
                if (cancelled) return;
                if (res.playbackStatus === "ready") {
                    setMediaErrorHint(null);
                    setVariantReadyTick((n) => n + 1);
                    window.clearInterval(timer);
                } else if (res.playbackStatus === "failed") {
                    setMediaErrorHint("兼容副本生成失败，可下载原片后用本地播放器观看。");
                    window.clearInterval(timer);
                } else if (res.playbackStatus === "none") {
                    // 后端判定无需转码（远端存储/无 ffmpeg/编码不可处理）：无副本可等，
                    // 停轮询回到原件原生播放，避免"正在生成"永挂。
                    setMediaTier("primary");
                    setMediaErrorHint(null);
                    window.clearInterval(timer);
                } else if ((polls += 1) >= 120) {
                    // processing 上限保护（约 5 分钟）：转码异常卡死时不再无限轮询。
                    setMediaErrorHint("兼容版本生成超时，可下载原片后用本地播放器观看。");
                    window.clearInterval(timer);
                } else {
                    setMediaErrorHint("视频编码此浏览器暂不支持，正在生成兼容版本（H.264）…");
                }
                failures = 0;
            } catch {
                if (cancelled) return;
                failures += 1;
                if (failures >= 4) {
                    window.clearInterval(timer);
                    setMediaErrorHint("兼容版本生成服务暂不可达，请稍后重新打开预览重试。");
                }
            }
        }, 2500);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [mediaTier, mediaResourceId]);

    const handleMediaError = () => {
        // 图片/无资源：无播放副本可切，仅提示。
        if (activeClip?.kind !== "video" || !mediaResourceId) {
            setMediaErrorHint("该媒体无法解码，可下载原片后用本地播放器观看。");
            return;
        }
        if (mediaTier === "primary") {
            // 原件解码失败（大概率 H.265）：切后端 playback 副本。
            setMediaTier("variant");
            setMediaErrorHint("视频编码此浏览器暂不支持，正在生成兼容版本（H.264）…");
        } else {
            // 副本尚未就绪时后端回退原件仍会失败；轮询 effect 会在就绪后重载。
            setMediaErrorHint("视频编码此浏览器暂不支持，正在生成兼容版本（H.264）…");
        }
    };

    const isVideoClip = activeClip?.kind === "video";
    const videoSrc = isVideoClip && mediaResourceId && mediaTier === "variant" ? playbackVariantUrl(mediaResourceId) : isVideoClip ? activeMediaUrl : null;
    const imageSrc = activeClip?.kind === "image" ? activeMediaUrl : null;
    const videoMuted = activeTrack?.muted === true;

    const syncPlayback = useCallback(
        (ms: number) => {
            const t = Math.max(0, Math.min(durationMs, Math.round(ms)));
            playbackRef.current = t;
            setPlaybackMs(t);
            setTransportMs(t);
        },
        [durationMs, setTransportMs],
    );

    const stop = useCallback(() => {
        playingRef.current = false;
        setPlaying(false);
        if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        lastTickRef.current = null;
        lastStorePushRef.current = 0;
        const v = videoRef.current;
        if (v && !v.paused) v.pause();
        setTransportMs(playbackRef.current);
    }, [setTransportMs]);

    // 外部 transport 变化（时间线标尺 scrub / 跳转）：回推本地时钟；
    // 播放中大幅跳动视为拖动跳转，先暂停避免与本地时钟互相抢写。
    useEffect(() => {
        if (transportMs === playbackRef.current) return;
        if (playingRef.current) {
            // 播放中收到的 transport 写入只可能是自身节流回写或外部 scrub；
            // 大幅跳动视为拖动/跳转：暂停并跟随。小幅忽略，避免本地时钟被旧回写值拉回（回跳）。
            if (Math.abs(transportMs - playbackRef.current) > SEEK_JUMP_MS) {
                stop();
                playbackRef.current = transportMs;
                setPlaybackMs(transportMs);
            }
            return;
        }
        playbackRef.current = transportMs;
        setPlaybackMs(transportMs);
        // stop 已是最新引用；transportMs 为唯一驱动源
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [transportMs]);

    const toggle = useCallback(() => {
        if (!project || durationMs <= 0) return;
        if (playingRef.current) {
            stop();
            return;
        }
        // 停在末尾再点播放：从头开始。
        if (playbackRef.current >= durationMs - 50) {
            playbackRef.current = 0;
            setPlaybackMs(0);
            setTransportMs(0);
        }
        playingRef.current = true;
        lastTickRef.current = null;
        setPlaying(true);
        const tick = (now: number) => {
            if (lastTickRef.current === null) lastTickRef.current = now;
            const delta = now - lastTickRef.current;
            lastTickRef.current = now;
            const next = Math.min(durationMs, Math.max(0, playbackRef.current + delta * speedRef.current));
            playbackRef.current = next;
            setPlaybackMs(next);
            if (now - lastStorePushRef.current >= STORE_PUSH_INTERVAL_MS) {
                lastStorePushRef.current = now;
                setTransportMs(next);
            }
            if (next >= durationMs) {
                stop();
                return;
            }
            rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
    }, [durationMs, project, stop, setTransportMs]);

    // 项目切换/时长变化时重置播放
    useEffect(() => {
        syncPlayback(0);
        stop();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [project, durationMs]);

    useEffect(() => () => stop(), [stop]);

    const stepBy = (deltaMs: number) => {
        if (!project || durationMs <= 0) return;
        syncPlayback(playbackRef.current + deltaMs);
    };

    const changeSpeed = (next: number) => {
        speedRef.current = next;
        setSpeed(next);
    };

    // —— <video> 从动驱动 ——

    const applyVideoPosition = (v: HTMLVideoElement) => {
        if (!activeClip || activeClip.kind !== "video") return;
        const targetS = clipSourceTimeMs(activeClip, playbackRef.current) / 1000;
        const maxS = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : targetS;
        const t = Math.min(targetS, maxS);
        if (Math.abs(v.currentTime - t) > VIDEO_SEEK_TOLERANCE_S) v.currentTime = t;
    };

    // 时钟推进/外部 seek：校正视频位置（播放同速时偏差小，几乎不触发硬 seek）。
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !isVideoClip) return;
        if (v.readyState < HTMLMediaElement.HAVE_METADATA) return;
        applyVideoPosition(v);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playbackMs, mediaTier, variantReadyTick, activeClip?.id]);

    // 播放/暂停：真实驱动浏览器管线（画面 + 声音）。
    useEffect(() => {
        const v = videoRef.current;
        if (!v || !isVideoClip) return;
        if (playing) {
            const p = v.play();
            if (p) p.catch(() => {
                // 浏览器 autoplay/格式限制：onError 已接管提示与回退。
            });
        } else if (!v.paused) {
            v.pause();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [playing, mediaTier, variantReadyTick, activeClip?.id, videoSrc]);

    // 变速：同步视频播放速率，保持音画与时钟一致。
    useEffect(() => {
        const v = videoRef.current;
        if (v && isVideoClip) v.playbackRate = speed;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [speed, mediaTier, variantReadyTick, activeClip?.id]);

    const handleLoadedMetadata = () => {
        const v = videoRef.current;
        if (!v) return;
        applyVideoPosition(v);
        if (playingRef.current) {
            const p = v.play();
            if (p) p.catch(() => {});
        }
    };

    // 源素材比片段短：video 提前播完 → 把时钟对齐到片段结尾，让后续片段/结束自然衔接。
    const handleVideoEnded = () => {
        if (!activeClip || activeClip.kind !== "video") return;
        const clipEndMs = activeClip.startMs + activeClip.durationMs;
        if (clipEndMs >= durationMs - 50) {
            stop();
            syncPlayback(durationMs);
        } else {
            syncPlayback(clipEndMs);
        }
    };

    // 播放条随监视器面板宽度自适应：窄面板逐级隐藏次要信息（先“/ 总时长”，再时间码与速度文字/箭头），
    // 极窄时让整条可横向滚动兜底；走带按钮始终固定尺寸，不缩小、不重叠。阈值即对应内容的最小显示宽度。
    const transportRef = useRef<HTMLDivElement | null>(null);
    const [transportWidth, setTransportWidth] = useState(Number.POSITIVE_INFINITY);
    useLayoutEffect(() => {
        const el = transportRef.current;
        if (!el) return;
        const update = () => setTransportWidth(Math.round(el.getBoundingClientRect().width));
        update();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(update);
        observer.observe(el);
        return () => observer.disconnect();
    }, []);
    const compact = transportWidth < 340;
    const hideTotal = !compact && transportWidth < 440;
    const allowScroll = transportWidth < 240;

    const showEmpty = !activeClip || (!videoSrc && !imageSrc);

    return (
        <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--director-sequencer-surface)]">
            {/* 顶部信息条：媒体标题/元数据常驻在画面外的标题栏，不再悬浮遮挡画面内容 */}
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    {activeClip ? (
                        <>
                            <ClipKindIcon kind={activeClip.kind} className="size-3.5 shrink-0 text-[var(--director-dock-fg)]/55" />
                            <span className="truncate text-xs font-medium text-[var(--director-dock-fg-strong)]" title={clipDisplayTitle(activeClip)}>
                                {clipDisplayTitle(activeClip)}
                            </span>
                            <span className="hidden shrink-0 rounded-full bg-[var(--director-dock-active-surface)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--director-dock-fg)]/85 sm:inline-flex">
                                {clipKindLabel(activeClip.kind)}
                            </span>
                            {activeTrack && (
                                <span className="hidden shrink-0 rounded-full border border-[var(--director-sequencer-border)] px-1.5 py-0.5 text-[10px] leading-none text-[var(--director-dock-fg)]/55 md:inline-flex">
                                    {activeTrack.label}
                                </span>
                            )}
                        </>
                    ) : (
                        <span className="truncate text-xs text-[var(--director-dock-fg)]/40">预览监视器</span>
                    )}
                </div>
                {mediaErrorHint && (
                    <span
                        title={mediaErrorHint}
                        className="flex min-w-0 max-w-[42%] items-center gap-1.5 rounded-md bg-[var(--director-danger)]/10 px-2 py-1 text-[11px] text-[var(--director-danger)]"
                    >
                        {mediaErrorHint.includes("正在生成") ? (
                            <LoaderCircle className="size-3 shrink-0 animate-spin" />
                        ) : (
                            <AlertTriangle className="size-3 shrink-0" />
                        )}
                        <span className="truncate">{mediaErrorHint}</span>
                        {mediaResourceId && (
                            <a
                                href={resourceFileUrl(mediaResourceId)}
                                download
                                title="下载原片，用本地播放器观看"
                                className="grid size-4 shrink-0 place-items-center rounded hover:bg-[var(--director-danger)]/15"
                            >
                                <Download className="size-3" />
                            </a>
                        )}
                    </span>
                )}
            </div>
            {/* 预览画面：恒黑舞台，占满控制条以上剩余空间（Concat 监视器风格） */}
            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-black p-6">
                {showEmpty ? (
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
                ) : isVideoClip && videoSrc ? (
                    <video
                        key={`v:${activeClip!.id}:${mediaTier}:${variantReadyTick}`}
                        ref={videoRef}
                        src={videoSrc}
                        muted={videoMuted}
                        playsInline
                        preload="auto"
                        className="max-h-full max-w-full rounded-md object-contain shadow-lg"
                        onError={handleMediaError}
                        onLoadedMetadata={handleLoadedMetadata}
                        onEnded={handleVideoEnded}
                    />
                ) : imageSrc ? (
                    <img
                        key={`i:${activeClip!.id}`}
                        src={imageSrc}
                        alt=""
                        className="max-h-full max-w-full rounded-md object-contain shadow-lg"
                        onError={handleMediaError}
                    />
                ) : null}
            </div>

            {/* 播放控制条：画面下方的独立一行（Concat 布局），不悬浮叠加、无进度条；
                播放/暂停用反白块 + 图标形态（Play/Pause）表达状态，图标保持中性（无 accent 蓝）。
                宽度自适应见上方 transportWidth 逻辑。 */}
            <div
                ref={transportRef}
                className={`grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 border-t border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-3 ${
                    allowScroll ? "overflow-x-auto [scrollbar-width:thin]" : ""
                }`}
            >
                <span className="truncate text-xs tabular-nums text-[var(--director-dock-fg)]">
                    {!compact && formatTimelineTime(playbackMs)}
                    {!compact && !hideTotal && (
                        <span className="opacity-60"> / {formatTimelineTime(durationMs)}</span>
                    )}
                </span>
                <div className="flex shrink-0 items-center gap-0.5">
                    <button
                        type="button"
                        aria-label="回到开头"
                        title="回到开头"
                        onClick={() => syncPlayback(0)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-40"
                    >
                        <SkipBack className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="后退 1 秒"
                        title="后退 1 秒"
                        onClick={() => stepBy(-1000)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-40"
                    >
                        <StepBack className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label={playing ? "暂停" : "播放"}
                        onClick={toggle}
                        disabled={durationMs <= 0}
                        className={`grid size-7 place-items-center rounded-md transition-colors disabled:pointer-events-none disabled:opacity-40 ${
                            playing
                                ? "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]"
                                : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                        }`}
                    >
                        {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
                    </button>
                    <button
                        type="button"
                        aria-label="前进 1 秒"
                        title="前进 1 秒"
                        onClick={() => stepBy(1000)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-40"
                    >
                        <StepForward className="size-4" />
                    </button>
                    <button
                        type="button"
                        aria-label="跳到结尾"
                        title="跳到结尾"
                        onClick={() => syncPlayback(durationMs)}
                        disabled={!project || durationMs <= 0}
                        className="grid size-7 place-items-center rounded-md text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)] disabled:pointer-events-none disabled:opacity-40"
                    >
                        <SkipForward className="size-4" />
                    </button>
                </div>
                <div className="relative justify-self-end">
                    <button
                        type="button"
                        aria-label="播放速度"
                        title="播放速度"
                        onClick={() => setSpeedMenuOpen((v) => !v)}
                        className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-medium text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                    >
                        <Gauge className="size-3.5" />
                        {!compact && <span className="tabular-nums">{speed}x</span>}
                        {!compact && (
                            <ChevronDown className={`size-3 transition-transform ${speedMenuOpen ? "rotate-180" : ""}`} />
                        )}
                    </button>
                    {speedMenuOpen && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setSpeedMenuOpen(false)} />
                            <div className="absolute bottom-full right-0 z-50 mb-1 w-24 overflow-hidden rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] py-1 shadow-xl">
                                {[0.5, 1, 1.5, 2].map((s) => (
                                    <button
                                        key={s}
                                        type="button"
                                        onClick={() => {
                                            changeSpeed(s);
                                            setSpeedMenuOpen(false);
                                        }}
                                        className={`flex w-full items-center justify-between px-2.5 py-1.5 text-[11px] transition-colors hover:bg-[var(--director-control-hover)] ${
                                            s === speed ? "text-[var(--director-dock-fg-strong)]" : "text-[var(--director-dock-fg)]"
                                        }`}
                                    >
                                        <span>{s}x</span>
                                        {s === speed && <span className="opacity-60">✓</span>}
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
