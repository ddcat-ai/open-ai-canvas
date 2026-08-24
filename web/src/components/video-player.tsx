import { useMemo } from "react";
import type { ComponentProps } from "react";

import { useLocaleStore } from "@/stores/use-locale-store";
import { MediaPlayer, MediaProvider, type VideoMimeType } from "@vidstack/react";
import { DefaultVideoLayout, defaultLayoutIcons, type DefaultLayoutTranslations } from "@vidstack/react/player/layouts/default";
import "@vidstack/react/player/styles/base.css";
import "@vidstack/react/player/styles/default/theme.css";
import "@vidstack/react/player/styles/default/layouts/video.css";
import "./video-player.css";
import { t } from "@/i18n";

type MediaPlayerProps = ComponentProps<typeof MediaPlayer>;

type VideoPlayerProps = {
    src: string;
    mimeType?: string;
    title?: string;
    className?: string;
    brandColor?: string;
    preload?: MediaPlayerProps["preload"];
    autoPlay?: boolean;
    dataCanvasNoZoom?: boolean;
    compactControls?: boolean;
    onCanPlay?: MediaPlayerProps["onCanPlay"];
};

// vidstack 的翻译表是「英文原文 → 本地文案」；英文界面直接不传（组件回落内置英文）
const zhCNTranslations = {
    Accessibility: t("domain:accessibility"),
    AirPlay: t("domain:airplay"),
    Audio: t("domain:audio"),
    Auto: t("domain:auto"),
    Boost: t("domain:volume-boost"),
    Captions: t("domain:subtitles"),
    "Caption Styles": t("domain:caption-styles"),
    Chapters: t("domain:chapters"),
    "Closed-Captions Off": t("domain:captions-off"),
    "Closed-Captions On": t("domain:captions-on"),
    Connected: t("domain:connected"),
    Connecting: t("domain:connecting"),
    Default: t("domain:default"),
    Disabled: t("domain:disabled-2"),
    Disconnected: t("domain:disconnected"),
    Download: t("domain:download"),
    "Enter Fullscreen": t("domain:enter-fullscreen"),
    "Enter PiP": t("domain:enter-picture-in-picture"),
    "Exit Fullscreen": t("domain:exit-fullscreen"),
    "Exit PiP": t("domain:exit-picture-in-picture"),
    Fullscreen: t("domain:fullscreen"),
    Loop: t("domain:loop-playback"),
    Mute: t("domain:mute"),
    Normal: t("domain:normal"),
    Off: t("domain:close"),
    Pause: t("domain:pause"),
    Play: t("domain:play"),
    Playback: t("domain:play"),
    PiP: t("domain:picture-in-picture"),
    Quality: t("domain:quality-2"),
    Replay: t("domain:replay"),
    Reset: t("domain:reset-3"),
    Seek: t("domain:seek"),
    "Seek Backward": t("domain:rewind"),
    "Seek Forward": t("domain:forward"),
    Settings: t("domain:settings"),
    Speed: t("domain:playback-speed"),
    Unmute: t("domain:unmute"),
    Volume: t("domain:volume"),
} satisfies Partial<DefaultLayoutTranslations>;

const supportedVideoMimeTypes = new Set<VideoMimeType>(["video/mp4", "video/webm", "video/3gp", "video/ogg", "video/avi", "video/mpeg", "video/object"]);

/**
 * 统一视频播放表面，保留原生媒体 URL 契约，同时提供可访问的完整控件布局。
 * 画布节点需要隔离播放器手势，避免拖动进度条时被误判为拖动画布。
 */
export function VideoPlayer({ src, mimeType, title = t("domain:video"), className, brandColor = "#f5f5f5", preload = "metadata", autoPlay = false, dataCanvasNoZoom = false, compactControls = false, onCanPlay }: VideoPlayerProps) {
    const stopCanvasControlInteraction = (event: { target: EventTarget | null; stopPropagation: () => void }) => {
        if (!dataCanvasNoZoom || !(event.target instanceof Element)) return;
        if (event.target.closest(".vds-controls,.vds-menu-items")) event.stopPropagation();
    };
    const type = mimeType && supportedVideoMimeTypes.has(mimeType as VideoMimeType) ? (mimeType as VideoMimeType) : "video/mp4";
    const locale = useLocaleStore((state) => state.locale);
    const mediaSource = useMemo(() => ({ src, type }), [src, type]);

    return (
        <MediaPlayer
            className={`canvas-video-player ${compactControls ? "canvas-video-player-compact" : ""} ${className || ""}`}
            src={mediaSource}
            title={title}
            viewType="video"
            streamType="on-demand"
            playsInline
            autoPlay={autoPlay}
            load="eager"
            preload={preload}
            data-canvas-no-zoom={dataCanvasNoZoom ? "true" : undefined}
            style={{ "--video-brand": brandColor }}
            onCanPlay={onCanPlay}
            onPointerDown={stopCanvasControlInteraction}
            onMouseDown={stopCanvasControlInteraction}
        >
            <MediaProvider />
            <DefaultVideoLayout icons={defaultLayoutIcons} translations={locale === "en" ? undefined : zhCNTranslations} />
        </MediaPlayer>
    );
}
