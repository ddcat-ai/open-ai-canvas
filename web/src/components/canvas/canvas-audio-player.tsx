import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { AlertCircle, LoaderCircle, Pause, Play } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { CanvasTheme } from "@/lib/canvas-theme";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import { getCanvasAudioCurrentTimeMs, getCanvasAudioPlaybackSnapshot, seekCanvasAudio, stopCanvasAudio, subscribeCanvasAudioNode, toggleCanvasAudio } from "@/services/canvas-audio-playback";
import { AUDIO_WAVEFORM_BARS, loadAudioWaveform } from "@/lib/canvas/canvas-audio-waveform";
import type { CanvasNodeData } from "@/types/canvas";

type CanvasAudioPlayerProps = {
    node: CanvasNodeData;
    theme: CanvasTheme;
};

export function CanvasAudioPlayer({ node, theme }: CanvasAudioPlayerProps) {
    const { t } = useTranslation();
    const { updateMetadata } = useCanvasNodeActions();
    const subscribe = useCallback((listener: () => void) => subscribeCanvasAudioNode(node.id, listener), [node.id]);
    const getSnapshot = useCallback(() => getCanvasAudioPlaybackSnapshot(node.id), [node.id]);
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    const source = useMemo(
        () => ({
            nodeId: node.id,
            content: node.metadata?.content || "",
            storageKey: node.metadata?.storageKey,
            mimeType: node.metadata?.mimeType,
            durationMs: node.metadata?.durationMs,
        }),
        [node.id, node.metadata?.content, node.metadata?.durationMs, node.metadata?.mimeType, node.metadata?.storageKey],
    );
    const fallbackWaveform = useMemo(() => createStableWaveform(node.id), [node.id]);
    const [realWaveform, setRealWaveform] = useState<number[] | null>(() => {
        if (node.metadata?.waveformVersion === 2 && node.metadata?.waveform && node.metadata.waveform.length === AUDIO_WAVEFORM_BARS) {
            return node.metadata.waveform;
        }
        return null;
    });

    useEffect(() => {
        if (!source.content && !source.storageKey) return;
        if (node.metadata?.waveformVersion === 2 && node.metadata?.waveform && node.metadata.waveform.length === AUDIO_WAVEFORM_BARS) {
            setRealWaveform(node.metadata.waveform);
            return;
        }
        let cancelled = false;
        void loadAudioWaveform(source, AUDIO_WAVEFORM_BARS)
            .then((peaks) => {
                if (cancelled || !peaks.length) return;
                setRealWaveform(peaks);
                updateMetadata?.(node.id, { waveform: peaks, waveformVersion: 2 });
            })
            .catch(() => {
                // 解码失败或非浏览器环境时保留回退波形
            });
        return () => {
            cancelled = true;
        };
    }, [node.id, node.metadata?.waveform, node.metadata?.waveformVersion, source, updateMetadata]);

    const waveform = realWaveform || fallbackWaveform;
    const syncedDurationRef = useRef(0);
    const durationMs = snapshot.durationMs || node.metadata?.durationMs || 0;
    const progress = durationMs > 0 ? Math.min(1, Math.max(0, snapshot.currentTimeMs / durationMs)) : 0;

    const playheadRef = useRef<HTMLDivElement>(null);
    const timeDisplayRef = useRef<HTMLSpanElement>(null);
    const barsContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!snapshot.durationMs || snapshot.durationMs === node.metadata?.durationMs || syncedDurationRef.current === snapshot.durationMs) return;
        syncedDurationRef.current = snapshot.durationMs;
        updateMetadata?.(node.id, { durationMs: snapshot.durationMs });
    }, [node.id, node.metadata?.durationMs, snapshot.durationMs, updateMetadata]);

    useEffect(() => () => stopCanvasAudio(node.id), [node.id]);

    const stopCanvasEvent = (event: React.SyntheticEvent) => event.stopPropagation();
    const togglePlayback = () => {
        void toggleCanvasAudio(source);
    };

    const isPlaying = snapshot.phase === "playing";
    const isLoading = snapshot.phase === "loading";
    const isError = snapshot.phase === "error";

    // 播放状态下使用 60fps 硬件帧率驱动红色游标平滑位移，彻底消除原生 timeupdate 的 250ms 阶梯卡顿
    useEffect(() => {
        if (!isPlaying || !durationMs) {
            if (playheadRef.current) {
                playheadRef.current.style.left = `calc(12px + (100% - 24px) * ${Math.min(1, Math.max(0, progress))})`;
            }
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = `${formatAudioTime(snapshot.currentTimeMs)} / ${durationMs ? formatAudioTime(durationMs) : "00:00"}`;
            }
            return;
        }

        let animationFrameId: number;
        const tick = () => {
            const currentMs = getCanvasAudioCurrentTimeMs(node.id);
            const currentProgress = Math.min(1, Math.max(0, currentMs / durationMs));

            if (playheadRef.current) {
                playheadRef.current.style.left = `calc(12px + (100% - 24px) * ${currentProgress})`;
            }
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = `${formatAudioTime(currentMs)} / ${formatAudioTime(durationMs)}`;
            }
            if (barsContainerRef.current) {
                const bars = barsContainerRef.current.children;
                const totalBars = bars.length;
                for (let i = 0; i < totalBars; i++) {
                    const barSpan = bars[i].firstElementChild as HTMLElement | null;
                    if (barSpan) {
                        const isPassed = i / totalBars <= currentProgress;
                        const targetColor = isPassed ? "#ef4444" : "rgba(255, 255, 255, 0.35)";
                        if (barSpan.style.backgroundColor !== targetColor) {
                            barSpan.style.backgroundColor = targetColor;
                        }
                    }
                }
            }
            animationFrameId = requestAnimationFrame(tick);
        };

        animationFrameId = requestAnimationFrame(tick);
        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isPlaying, durationMs, node.id, progress, snapshot.currentTimeMs]);

    const handleWaveformPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        stopCanvasEvent(event);
        if (!durationMs || isError) return;
        const target = event.currentTarget;
        const computeAndSeek = (clientX: number) => {
            const rect = target.getBoundingClientRect();
            const availableWidth = rect.width - 24;
            if (availableWidth <= 0) return;
            const x = Math.max(0, Math.min(availableWidth, clientX - rect.left - 12));
            const pct = x / availableWidth;
            const targetMs = Math.round(pct * durationMs);
            seekCanvasAudio(node.id, targetMs, source);
            if (playheadRef.current) {
                playheadRef.current.style.left = `calc(12px + (100% - 24px) * ${pct})`;
            }
            if (timeDisplayRef.current) {
                timeDisplayRef.current.textContent = `${formatAudioTime(targetMs)} / ${formatAudioTime(durationMs)}`;
            }
        };
        computeAndSeek(event.clientX);

        const onPointerMove = (e: PointerEvent) => {
            computeAndSeek(e.clientX);
        };
        const onPointerUp = () => {
            window.removeEventListener("pointermove", onPointerMove);
            window.removeEventListener("pointerup", onPointerUp);
        };
        window.addEventListener("pointermove", onPointerMove);
        window.addEventListener("pointerup", onPointerUp);
    };
    const label = node.title || t("canvasA.audioPlayer.defaultTitle");

    return (
        <div
            role="group"
            aria-label={t("canvasA.audioPlayer.controls", { label })}
            className="flex h-full w-full min-w-0 flex-col justify-between p-3 select-none"
            style={{ color: theme.node.text }}
        >
            {/* 上部波形可视与进度拖拽槽 */}
            <div
                role="slider"
                aria-label={t("canvasA.audioPlayer.waveform", { label })}
                aria-valuemin={0}
                aria-valuemax={Math.max(1, durationMs)}
                aria-valuenow={snapshot.currentTimeMs}
                tabIndex={0}
                className="group relative flex h-[58px] w-full min-w-0 cursor-pointer items-center overflow-hidden rounded-xl border border-white/5 bg-[#202022] px-3 shadow-inner transition-colors hover:border-white/10"
                onPointerDown={handleWaveformPointerDown}
                onMouseDown={stopCanvasEvent}
                onClick={stopCanvasEvent}
                onWheel={stopCanvasEvent}
            >
                {/* 中心虚线基准线 */}
                <div className="pointer-events-none absolute inset-x-3 top-1/2 -translate-y-1/2 border-b border-dashed border-white/15" />

                {/* 细波形柱状图（对称垂直居中） */}
                <div ref={barsContainerRef} className="pointer-events-none relative z-10 flex h-full w-full items-center justify-between gap-[1.5px]">
                    {waveform.map((height, index) => {
                        const isPassed = durationMs > 0 && index / waveform.length <= progress;
                        const hasSound = height > 0;
                        return (
                            <div key={`${node.id}-${index}`} className="flex h-full flex-1 items-center justify-center max-w-[2.5px]">
                                {hasSound ? (
                                    <span
                                        className="w-full rounded-full transition-all duration-75"
                                        style={{
                                            height: `${Math.max(6, Math.round(height * 86))}%`,
                                            backgroundColor: isPassed ? "#ef4444" : "rgba(255, 255, 255, 0.35)",
                                        }}
                                    />
                                ) : null}
                            </div>
                        );
                    })}
                </div>

                {/* 垂直红色播放游标指针（原生无 transition 驱动以保证 60fps 丝滑平移） */}
                <div
                    ref={playheadRef}
                    className="pointer-events-none absolute bottom-1.5 top-1.5 z-20 w-[2px] rounded-full bg-red-500 shadow-sm"
                    style={{
                        left: `calc(12px + (100% - 24px) * ${Math.min(1, Math.max(0, progress))})`,
                        transform: "translateX(-50%)",
                    }}
                />
            </div>

            {/* 底部控制栏：时间在左，圆形播放按钮居中 */}
            <div className="relative flex h-8 w-full items-center justify-between px-1">
                {/* 左侧时间：00:00 / 00:02 */}
                <div className="text-xs font-medium tabular-nums tracking-wide text-foreground/85">
                    {isError ? (
                        <span className="flex items-center gap-1 text-[var(--accent-danger)]">
                            <AlertCircle className="size-3.5" />
                            <span className="max-w-[130px] truncate">{snapshot.error || t("canvasA.audioPlayer.playFailed")}</span>
                        </span>
                    ) : (
                        <span ref={timeDisplayRef}>
                            {formatAudioTime(snapshot.currentTimeMs)} / {durationMs ? formatAudioTime(durationMs) : "00:00"}
                        </span>
                    )}
                </div>

                {/* 居中圆形播放按钮 */}
                <div className="absolute left-1/2 -translate-x-1/2">
                    <button
                        type="button"
                        aria-label={isPlaying ? t("canvasA.audioPlayer.pause", { label }) : t("canvasA.audioPlayer.play", { label })}
                        className="grid size-8 place-items-center rounded-full border border-white/10 bg-[#2c2c2e] text-white shadow-md transition-[background-color,opacity] duration-150 hover:bg-[#38383a] disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={isLoading || (!source.content && !source.storageKey)}
                        onPointerDown={stopCanvasEvent}
                        onMouseDown={stopCanvasEvent}
                        onClick={(event) => {
                            event.stopPropagation();
                            togglePlayback();
                        }}
                    >
                        {isLoading ? (
                            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                        ) : isPlaying ? (
                            <Pause className="size-3.5 fill-current" aria-hidden="true" />
                        ) : (
                            <Play className="ml-0.5 size-3.5 fill-current" aria-hidden="true" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}

function createStableWaveform(nodeId: string, barCount = AUDIO_WAVEFORM_BARS) {
    let seed = 2166136261;
    for (let index = 0; index < nodeId.length; index += 1) {
        seed ^= nodeId.charCodeAt(index);
        seed = Math.imul(seed, 16777619);
    }
    return Array.from({ length: barCount }, (_, index) => {
        seed = Math.imul(seed ^ index, 16777619);
        const normalized = ((seed >>> 0) % 100) / 100;
        if (normalized < 0.25) return 0;
        return 0.15 + normalized * 0.75;
    });
}

function formatAudioTime(timeMs: number) {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
