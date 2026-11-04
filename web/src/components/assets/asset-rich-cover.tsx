import { Mic, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getResourceAccess, resolveResourceAccessURL } from "@/services/api/resources";
import type { AudioAsset, EntityAsset } from "@/stores/use-asset-store";

function initial(name: string) {
    return Array.from(name.trim())[0] || "角";
}

/** 换取资源展示地址；一次换取供多个 <img> 共用，避免两个图片组件各自加载、各自失败。 */
function useResourceDisplayUrl(storageKey: string | undefined, variant: "original" | "thumbnail") {
    const [resolved, setResolved] = useState<{ key: string; url: string; failed: boolean } | null>(null);
    const key = storageKey ? `${storageKey}:${variant}` : "";
    useEffect(() => {
        if (!storageKey) return;
        let cancelled = false;
        getResourceAccess(storageKey, "display", variant)
            .catch(() => (variant === "thumbnail" ? getResourceAccess(storageKey, "display", "original") : Promise.reject(new Error("resource unavailable"))))
            .then((access) => {
                if (!cancelled) setResolved({ key, url: resolveResourceAccessURL(access.url), failed: false });
            })
            .catch(() => {
                if (!cancelled) setResolved({ key, url: "", failed: true });
            });
        return () => {
            cancelled = true;
        };
    }, [key, storageKey, variant]);
    return resolved?.key === key ? resolved : null;
}

/**
 * 角色卡封面：立绘 + 同图模糊底，名字首字作空态。素材库卡片、素材档案与画布素材选择共用，
 * 保证角色卡在任何入口都长得像一张角色卡，而不是一个灰底图标。
 */
export function CharacterAssetCover({ asset, size = "card" }: { asset: EntityAsset; size?: "card" | "hero" }) {
    const storageKey = asset.data.coverStorageKey;
    const cover = useResourceDisplayUrl(storageKey, size === "hero" ? "original" : "thumbnail");
    const [broken, setBroken] = useState("");
    const url = cover?.url && broken !== cover.url ? cover.url : "";
    const showEmpty = !storageKey || cover?.failed || (cover && !url);
    return (
        <span className="relative isolate block h-full w-full overflow-hidden bg-[#111114]">
            {url ? (
                <>
                    <img src={url} alt="" aria-hidden className="absolute inset-0 h-full w-full scale-125 object-cover opacity-45 blur-2xl saturate-125" draggable={false} />
                    <img src={url} alt={asset.title} decoding="async" className="absolute inset-0 h-full w-full object-contain p-2" draggable={false} onError={() => setBroken(url)} />
                </>
            ) : showEmpty ? (
                <span className="absolute inset-0 grid place-items-center bg-[radial-gradient(circle_at_50%_40%,rgba(255,255,255,.1),transparent_62%)]">
                    <span className={`grid place-items-center rounded-full border border-white/15 font-normal text-white/75 ${size === "hero" ? "size-24 text-4xl" : "size-14 text-2xl"}`}>{initial(asset.title)}</span>
                </span>
            ) : (
                <span className="absolute inset-0 animate-pulse bg-white/[.04] motion-reduce:animate-none" aria-hidden />
            )}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
            {asset.data.voiceName ? (
                <span className="pointer-events-none absolute bottom-2 right-2 inline-flex max-w-[70%] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[var(--fs-label)] text-white/85 backdrop-blur">
                    <Mic className="size-3 shrink-0" />
                    <span className="truncate">{asset.data.voiceName}</span>
                </span>
            ) : null}
        </span>
    );
}

export function characterAssetSummary(asset: EntityAsset) {
    const role = typeof asset.data.definition.role === "string" ? asset.data.definition.role.trim() : "";
    const appearance = typeof asset.data.definition.appearance === "string" ? asset.data.definition.appearance.trim() : "";
    const states = [asset.data.visualStatus === "ready" ? "形象就绪" : "形象待完善", asset.data.voiceName ? `声音：${asset.data.voiceName}` : "未绑定声音"];
    return [role || appearance, ...states].filter(Boolean).join(" · ");
}

/** 音频封面图形：确定性波形，不含交互（可放进按钮里）。 */
export function AudioWaveArt({ seed, active = false }: { seed: string; active?: boolean }) {
    return (
        <span className="relative flex h-full w-full items-center justify-center gap-1 bg-[linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_8%,transparent),color-mix(in_srgb,var(--foreground)_2%,transparent))] px-[14%]" aria-hidden>
            {waveBars(seed).map((height, index) => (
                <span key={index} className={`w-[3px] shrink rounded-full transition-colors duration-200 ${active ? "bg-[var(--workspace-accent)]" : "bg-foreground/30"}`} style={{ height: `${height}%` }} />
            ))}
        </span>
    );
}

// 同一时间只试听一条：素材网格里点下一条时暂停上一条，不叠音。
let activePreviewAudio: HTMLAudioElement | null = null;

async function audioPreviewSource(asset: AudioAsset) {
    // 签名地址会过期，每次重新装载时都现换，不复用旧地址。
    return asset.data.storageKey?.startsWith("resource:") ? resolveResourceAccessURL((await getResourceAccess(asset.data.storageKey, "display", "playback")).url) : asset.data.url;
}

export type AudioPreviewState = {
    playing: boolean;
    currentMs: number;
    durationMs: number;
    toggle: () => Promise<void>;
    seek: (ratio: number) => Promise<void>;
};

/** 音频试听状态：懒创建 <audio>，进度与时长随播放更新，卸载时停止播放。传 null 时不做任何事。 */
export function useAudioPreview(asset: AudioAsset | null, onPlayingChange?: (playing: boolean) => void): AudioPreviewState {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [measuredDurationMs, setMeasuredDurationMs] = useState(0);
    const onPlayingChangeRef = useRef(onPlayingChange);
    const assetRef = useRef(asset);
    const reportedPlayingRef = useRef(false);

    useEffect(() => {
        onPlayingChangeRef.current = onPlayingChange;
        assetRef.current = asset;
    });

    useEffect(() => {
        // 只在状态真正变化时通知，挂载时不发一次多余的 false。
        if (reportedPlayingRef.current === playing) return;
        reportedPlayingRef.current = playing;
        onPlayingChangeRef.current?.(playing);
    }, [playing]);

    useEffect(
        () => () => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.pause();
            if (activePreviewAudio === audio) activePreviewAudio = null;
        },
        [],
    );

    const ensureAudio = () => {
        if (audioRef.current) return audioRef.current;
        const audio = new Audio();
        audio.preload = "metadata";
        audio.addEventListener("timeupdate", () => setCurrentMs(Math.round(audio.currentTime * 1000)));
        audio.addEventListener("loadedmetadata", () => {
            if (Number.isFinite(audio.duration) && audio.duration > 0) setMeasuredDurationMs(Math.round(audio.duration * 1000));
        });
        audio.addEventListener("play", () => setPlaying(true));
        audio.addEventListener("pause", () => setPlaying(false));
        audio.addEventListener("ended", () => {
            setPlaying(false);
            setCurrentMs(0);
        });
        audioRef.current = audio;
        return audio;
    };

    const ensureSource = async (audio: HTMLAudioElement) => {
        const current = assetRef.current;
        if (!current) return false;
        // 首次装载或上次加载失败（多半是签名过期）时重新换取地址。
        if (!audio.src || audio.error) {
            const position = audio.currentTime;
            audio.src = await audioPreviewSource(current);
            if (position > 0) audio.currentTime = position;
        }
        return Boolean(audio.src);
    };

    const toggle = async () => {
        if (!assetRef.current) return;
        const audio = ensureAudio();
        if (!audio.paused) {
            audio.pause();
            return;
        }
        // 先给出暂停态反馈，换取地址和缓冲期间按钮不显得没反应。
        setPlaying(true);
        try {
            if (!(await ensureSource(audio))) throw new Error("音频地址为空");
            if (activePreviewAudio && activePreviewAudio !== audio) activePreviewAudio.pause();
            activePreviewAudio = audio;
            await audio.play();
        } catch {
            setPlaying(false);
        }
    };

    const seek = async (ratio: number) => {
        if (!assetRef.current) return;
        const audio = ensureAudio();
        try {
            if (!(await ensureSource(audio))) return;
            if (audio.readyState < HTMLMediaElement.HAVE_METADATA) {
                await new Promise<void>((resolve) => {
                    const done = () => resolve();
                    audio.addEventListener("loadedmetadata", done, { once: true });
                    audio.addEventListener("error", done, { once: true });
                });
            }
            const seconds = Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : (assetRef.current.data.durationMs || 0) / 1000;
            if (!seconds) return;
            audio.currentTime = Math.min(seconds, Math.max(0, ratio * seconds));
            setCurrentMs(Math.round(audio.currentTime * 1000));
        } catch {
            // 地址换取失败时保持原进度；下一次播放会重新尝试。
        }
    };

    return { playing, currentMs, durationMs: measuredDurationMs || asset?.data.durationMs || 0, toggle, seek };
}

export function formatPreviewClock(ms: number) {
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** 音频试听按钮：放在卡片按钮之外（绝对定位），避免嵌套可交互元素。 */
export function AudioPlayButton({ asset, className = "", onPlayingChange, preview }: { asset: AudioAsset; className?: string; onPlayingChange?: (playing: boolean) => void; preview?: AudioPreviewState }) {
    const ownPreview = useAudioPreview(preview ? null : asset, onPlayingChange);
    const { playing, toggle } = preview || ownPreview;
    return (
        <button
            type="button"
            aria-label={`${playing ? "暂停" : "试听"} ${asset.title}`}
            title={playing ? "暂停" : "试听"}
            onClick={(event) => {
                event.stopPropagation();
                void toggle();
            }}
            className={`z-[3] grid size-9 place-items-center rounded-full bg-black/60 text-white outline-none backdrop-blur transition-colors duration-150 hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none ${className}`}
        >
            {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
    );
}

/** 素材卡片上的试听条：播放/暂停、可拖动进度和「当前 / 总时长」，不用打开素材档案就能听。 */
export function AudioPreviewBar({ asset, className = "" }: { asset: AudioAsset; className?: string }) {
    const preview = useAudioPreview(asset);
    const { currentMs, durationMs, seek } = preview;
    const progress = durationMs > 0 ? Math.min(1, currentMs / durationMs) : 0;
    return (
        <div className={`assets-audio-preview ${className}`} onClick={(event) => event.stopPropagation()}>
            <AudioPlayButton asset={asset} preview={preview} className="assets-audio-preview-toggle" />
            <input
                type="range"
                min={0}
                max={1000}
                step={1}
                value={Math.round(progress * 1000)}
                disabled={!durationMs}
                aria-label={`${asset.title} 试听进度`}
                aria-valuetext={`${formatPreviewClock(currentMs)} / ${formatPreviewClock(durationMs)}`}
                className="assets-audio-preview-range"
                onChange={(event) => void seek(Number(event.target.value) / 1000)}
            />
            <span className="assets-audio-preview-time">
                {preview.playing || currentMs > 0 ? `${formatPreviewClock(currentMs)} / ` : ""}
                {durationMs ? formatPreviewClock(durationMs) : "--:--"}
            </span>
        </div>
    );
}

function waveBars(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const bars: number[] = [];
    for (let index = 0; index < 28; index += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.55 + 1.2));
        bars.push(Math.round((0.16 + 0.8 * (hash / 233280) * envelope) * 100));
    }
    return bars;
}
