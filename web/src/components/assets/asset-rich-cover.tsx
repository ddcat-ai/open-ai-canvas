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
                    <span className={`grid place-items-center rounded-full border border-white/15 font-light text-white/75 ${size === "hero" ? "size-24 text-4xl" : "size-14 text-2xl"}`}>{initial(asset.title)}</span>
                </span>
            ) : (
                <span className="absolute inset-0 animate-pulse bg-white/[.04] motion-reduce:animate-none" aria-hidden />
            )}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/55 to-transparent" />
            {asset.data.voiceName ? (
                <span className="pointer-events-none absolute bottom-2 right-2 inline-flex max-w-[70%] items-center gap-1 rounded-full bg-black/55 px-2 py-0.5 text-[10px] text-white/85 backdrop-blur">
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
        <span className="relative flex h-full w-full items-center justify-center gap-[3px] bg-[linear-gradient(135deg,color-mix(in_srgb,var(--foreground)_8%,transparent),color-mix(in_srgb,var(--foreground)_2%,transparent))] px-[14%]" aria-hidden>
            {waveBars(seed).map((height, index) => (
                <span key={index} className={`w-[3px] shrink rounded-full transition-colors duration-200 ${active ? "bg-[var(--workspace-accent)]" : "bg-foreground/30"}`} style={{ height: `${height}%` }} />
            ))}
        </span>
    );
}

/** 音频试听按钮：放在卡片按钮之外（绝对定位），避免嵌套可交互元素。 */
export function AudioPlayButton({ asset, className = "", onPlayingChange }: { asset: AudioAsset; className?: string; onPlayingChange?: (playing: boolean) => void }) {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlayingState] = useState(false);
    const setPlaying = (value: boolean) => {
        setPlayingState(value);
        onPlayingChange?.(value);
    };
    useEffect(() => () => audioRef.current?.pause(), []);
    const toggle = async () => {
        const audio = audioRef.current || (audioRef.current = new Audio());
        if (playing) {
            audio.pause();
            setPlaying(false);
            return;
        }
        setPlaying(true);
        try {
            audio.src = asset.data.storageKey?.startsWith("resource:") ? resolveResourceAccessURL((await getResourceAccess(asset.data.storageKey, "display", "playback")).url) : asset.data.url;
            audio.onended = () => setPlaying(false);
            await audio.play();
        } catch {
            setPlaying(false);
        }
    };
    return (
        <button
            type="button"
            aria-label={`${playing ? "暂停" : "试听"} ${asset.title}`}
            title={playing ? "暂停" : "试听"}
            onClick={(event) => {
                event.stopPropagation();
                void toggle();
            }}
            className={`z-[3] grid size-9 place-items-center rounded-full bg-black/60 text-white outline-none backdrop-blur transition hover:scale-105 hover:bg-black/75 focus-visible:ring-2 focus-visible:ring-white/70 motion-reduce:transition-none ${className}`}
        >
            {playing ? <Pause className="size-4" /> : <Play className="size-4 translate-x-px" />}
        </button>
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
