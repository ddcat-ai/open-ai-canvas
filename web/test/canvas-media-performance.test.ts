import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import { resolveActiveCanvasMediaNodeId } from "../src/lib/canvas/canvas-performance-mode";
import { videoMetadata } from "../src/lib/canvas/canvas-generation-task-sync";
import { canvasNodeVideoPreviewUrl, canvasVideoAssetPreviewUrl } from "../src/lib/canvas/canvas-media-preview";
import { collectImageStorageKeys } from "../src/services/image-storage";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { detectVideoAudioTrack, detectVideoAudioTrackFromBlob, detectVideoAudioTrackFromUrl } from "../src/lib/video-poster";

const canvasNodeContentSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node-content.tsx"), "utf8");
const canvasAudioPlayerSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-audio-player.tsx"), "utf8");
const canvasMentionSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-resource-mention-textarea.tsx"), "utf8");
const canvasNodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");
const videoPlayerSource = readFileSync(resolve(import.meta.dir, "../src/components/video-player.tsx"), "utf8");

function node(id: string, type: CanvasNodeType): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: {} };
}

describe("canvas media activation", () => {
    const nodes = [node("video", CanvasNodeType.Video), node("audio", CanvasNodeType.Audio), node("image", CanvasNodeType.Image)];
    const nodeById = new Map(nodes.map((item) => [item.id, item]));

    test("activates exactly one selected video or audio node", () => {
        expect(resolveActiveCanvasMediaNodeId(new Set(["video"]), nodeById)).toBe("video");
        expect(resolveActiveCanvasMediaNodeId(new Set(["audio"]), nodeById)).toBe("audio");
    });

    test("keeps media inactive for empty, multi-selection, and non-media selection", () => {
        expect(resolveActiveCanvasMediaNodeId(new Set(), nodeById)).toBeNull();
        expect(resolveActiveCanvasMediaNodeId(new Set(["video", "audio"]), nodeById)).toBeNull();
        expect(resolveActiveCanvasMediaNodeId(new Set(["image"]), nodeById)).toBeNull();
        expect(resolveActiveCanvasMediaNodeId(new Set(["missing"]), nodeById)).toBeNull();
    });
});

describe("canvas dimension header rendering", () => {
    test("tracks live viewport scale without React width commits", () => {
        expect(canvasNodeSource).toContain("calc(var(--canvas-node-width) * var(--canvas-live-scale, 1))");
        expect(canvasNodeSource).toContain('"--canvas-node-width": `${node.width}px`');
    });
});

describe("audio canvas interaction", () => {
    test("uses a lightweight player without a native audio element or inactive mask", () => {
        expect(canvasNodeContentSource).toContain("<CanvasAudioPlayer node={node} theme={theme} />");
        expect(canvasNodeContentSource).not.toContain("<audio");
        expect(canvasNodeContentSource).not.toContain("InactiveAudioPreview");
        expect(canvasNodeContentSource.match(/function AudioNodeContent[\s\S]*?\n}\n/)?.[0] || "").not.toContain("useNodeResourceUrl");
        expect(canvasAudioPlayerSource).not.toContain("播放结束，点击重新播放");
        expect(canvasAudioPlayerSource).not.toContain("pr-24");
        expect(canvasAudioPlayerSource).toContain("formatAudioTime(snapshot.currentTimeMs)}/{durationMs ? formatAudioTime(durationMs) : \"--:--\"");
    });

    test("isolates player controls from canvas gestures", () => {
        expect(canvasAudioPlayerSource).toContain("onPointerDown={stopCanvasEvent}");
        expect(canvasAudioPlayerSource).toContain("onMouseDown={stopCanvasEvent}");
        expect(canvasAudioPlayerSource).toContain("onWheel={stopCanvasEvent}");
        expect(canvasAudioPlayerSource).toContain("onClick={(event) => {");
        expect(canvasAudioPlayerSource).toContain("togglePlayback();");
    });

});

describe("video canvas controls", () => {
    test("keeps the compact video's volume control visible", async () => {
        const playerCSS = await Bun.file(new URL("../src/components/video-player.css", import.meta.url)).text();
        expect(playerCSS).toContain('data-player-variant="compact"');
        expect(playerCSS).toContain(".vds-controls-group:has(.vds-time-slider)");
        expect(playerCSS).toContain(".vds-controls-group:has(.vds-time-group)");
        expect(playerCSS).toContain("bottom: calc(100% + var(--gap, 10px))");
        expect(playerCSS).toContain(".vds-video-layout[data-sm] .vds-volume .vds-volume-popup");
        expect(playerCSS).toContain("left: 50%;");
        expect(playerCSS).toContain("place-items: center;");
        expect(playerCSS).toContain(".vds-video-layout[data-sm] .vds-volume .vds-volume-slider");
        expect(playerCSS).toContain(".vds-volume .vds-volume-popup::after");
        expect(playerCSS).toContain("bottom: calc(-1 * var(--gap, 6px))");
        expect(playerCSS).toContain(".canvas-video-player:is([data-fullscreen], :fullscreen, :-webkit-full-screen) .vds-video-layout .vds-controls-group:has(.vds-time-group)");
        expect(playerCSS).toContain("min-height: 82px;");
        expect(playerCSS).toContain("margin: 0;");
        expect(playerCSS).toContain("right: calc(var(--canvas-video-control-size) + var(--canvas-video-control-gap) + 22px)");
        expect(playerCSS).toContain(".vds-controls-group:has(.vds-time-group) .vds-fullscreen-button");
        expect(playerCSS).toContain("margin-left: auto;");
        expect(playerCSS).toContain(".vds-controls-group:has(.vds-time-slider) .vds-time-slider");
        expect(playerCSS).toContain("pointer-events: auto !important;");
        expect(playerCSS).toContain("touch-action: none;");
        expect(playerCSS).toContain("z-index: 11;");
        expect(playerCSS).toContain("left: calc(var(--canvas-video-control-size) * 3 + var(--canvas-video-control-gap) + 40px)");
        expect(playerCSS).toContain("padding: 0 0 0 calc(var(--canvas-video-control-size) + var(--canvas-video-control-gap) + 2px)");
        expect(playerCSS).toContain("pointer-events: none !important;");
        expect(playerCSS).toContain(".vds-controls-group:has(> .vds-play-button) > .vds-controls-spacer");
        expect(playerCSS).toContain(".vds-controls-group:has(> .vds-play-button) .vds-play-button");
        expect(playerCSS).toContain("transform: none;");
        expect(playerCSS).toContain(".vds-video-layout[data-lg] .vds-controls-group:has(.vds-time-group)");
        expect(playerCSS).toContain(".vds-video-layout[data-lg] .vds-controls-group:has(.vds-time-slider)");
        expect(playerCSS).toContain("bottom: calc(var(--canvas-video-control-size) + 12px)");
        expect(playerCSS).toContain("flex: 0 0 var(--canvas-video-control-size)");
        expect(playerCSS).toContain("flex-shrink: 0");
        expect(playerCSS).toContain("--video-volume-height: 64px");
        expect(playerCSS).toContain("--video-volume-bg: rgba(12, 13, 16, 0.92)");
        expect(playerCSS).toContain("--video-volume-panel-width: 42px");
        expect(playerCSS).toContain("--video-volume-slider-width: 28px");
        expect(playerCSS).toContain("width: var(--video-volume-panel-width)");
        expect(playerCSS).toContain("--media-slider-width: var(--video-volume-slider-width)");
        expect(playerCSS).toContain('.canvas-video-player[data-no-audio="true"] .vds-volume .vds-mute-button');
        expect(playerCSS).toContain("cursor: not-allowed;");
        expect(playerCSS).toContain("data-player-variant=\"compact\"]:is([data-fullscreen], :fullscreen, :-webkit-full-screen)");
        expect(playerCSS).toContain("height: var(--canvas-video-control-size);");
        expect(playerCSS).toContain("min-height: var(--canvas-video-control-size);");
        expect(playerCSS).toContain("padding: 0 0 0 calc(var(--canvas-video-control-size)");
        expect(playerCSS).toContain(".vds-controls-group:has(.vds-volume) > :not(.vds-volume)");
        expect(playerCSS).toContain("bottom: max(12px, env(safe-area-inset-bottom))");
        expect(playerCSS).toContain("play, time, progress, volume, fullscreen");
        expect(playerCSS).toContain("pointer-events: auto;");
        expect(playerCSS).toContain(".vds-controls-group > :is(.vds-caption-button, .vds-download-button, .vds-pip-button, .vds-airplay-button, .vds-google-cast-button, .vds-chapters-button)");
        expect(playerCSS).not.toContain("canvas-video-player-compact:not([data-fullscreen]) .vds-video-layout[data-sm] .vds-controls-group:first-child");
        expect(playerCSS).not.toContain("canvas-video-player-compact:not([data-fullscreen]) .vds-video-layout[data-lg] .vds-controls-group:last-child");
    });

    test("does not duplicate the node title or expose player settings", () => {
        expect(videoPlayerSource).toContain("chapterTitle: null");
        expect(videoPlayerSource).toContain("settingsMenu: null");
        expect(videoPlayerSource).toContain('data-player-variant={compactControls ? "compact" : "dialog"}');
    });

    test("uses the muted icon state only when a video is known to have no audio", () => {
        expect(videoPlayerSource).toContain("hasAudio?: boolean");
        expect(videoPlayerSource).toContain("mediaPlayerRef.current?.el");
        expect(videoPlayerSource).toContain("muted={noAudio ? true : undefined}");
        expect(videoPlayerSource).toContain('data-no-audio={noAudio ? "true" : undefined}');
        expect(videoPlayerSource).toContain("VolumeLow: defaultLayoutIcons.MuteButton.Mute");
        expect(videoPlayerSource).toContain("VolumeHigh: defaultLayoutIcons.MuteButton.Mute");
        expect(videoPlayerSource).toContain("muteButton.disabled = noAudio;");
        expect(videoPlayerSource).toContain("(volumeSlider as HTMLElement & { disabled?: boolean }).disabled = noAudio;");
        expect(videoPlayerSource).toContain('event.target.closest(".vds-volume,.vds-mute-button,.vds-volume-slider")');
        expect(videoPlayerSource).toContain("onKeyDown={stopCanvasControlInteraction}");
        expect(videoPlayerSource).not.toContain("onPointerDownCapture={stopCanvasControlInteraction}");
        expect(videoPlayerSource).not.toContain("onMouseDownCapture={stopCanvasControlInteraction}");
        expect(videoPlayerSource).not.toContain("onClickCapture={stopCanvasControlClick}");
        expect(canvasNodeContentSource).toContain("hasAudio={inferVideoHasAudio(node.metadata)} autoPlay={mediaActive}");
        expect(canvasNodeContentSource).toContain('if (["false", "0", "off", "no", "disabled"].includes(value || "")) return false;');
    });

    test("recognizes an explicitly empty audio track list", () => {
        const media = { audioTracks: { length: 0 }, readyState: 4 } as unknown as HTMLMediaElement;
        expect(detectVideoAudioTrack(media)).toBeUndefined();
        expect(detectVideoAudioTrack({ audioTracks: { length: 0 }, readyState: 2 } as unknown as HTMLMediaElement)).toBeUndefined();
    });

    test("does not treat an undecoded audio byte counter as proof of silence", () => {
        const media = { readyState: 4, webkitAudioDecodedByteCount: 0 } as unknown as HTMLMediaElement;
        expect(detectVideoAudioTrack(media)).toBeUndefined();
        expect(detectVideoAudioTrack({ readyState: 4, webkitAudioDecodedByteCount: 128 } as unknown as HTMLMediaElement)).toBe(true);
    });

    test("does not treat an unsupported empty capture stream as proof of silence", () => {
        const media = { readyState: 4, captureStream: () => ({ getAudioTracks: () => [] }) } as unknown as HTMLMediaElement;
        expect(detectVideoAudioTrack(media)).toBeUndefined();
    });

    test("falls back to the MP4 track handler when browser audio APIs are unavailable", async () => {
        expect(await detectVideoAudioTrackFromBlob(new Blob([isoBmffMovie(["vide"])], { type: "video/mp4" }))).toBe(false);
        expect(await detectVideoAudioTrackFromBlob(new Blob([isoBmffMovie(["vide", "soun"])], { type: "video/mp4" }))).toBe(true);
        expect(await detectVideoAudioTrackFromBlob(new Blob([isoBmffMovie(["soun"])], { type: "video/mp4" }))).toBe(true);
    });

    test("probes remote MP4 ranges when browser audio APIs are unavailable", async () => {
        const originalFetch = globalThis.fetch;
        const movie = isoBmffMovie(["vide"]);
        globalThis.fetch = (async () => new Response(movie, {
            status: 206,
            headers: {
                "content-range": `bytes 0-${movie.byteLength - 1}/${movie.byteLength}`,
                "content-length": String(movie.byteLength),
            },
        })) as typeof fetch;
        try {
            expect(await detectVideoAudioTrackFromUrl(`https://media.example/silent-${movie.byteLength}.mp4`)).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test("keeps the first activation click from being treated as a node drag", () => {
        expect(videoPlayerSource).toContain("onClick={stopCanvasControlClick}");
        expect(videoPlayerSource).toContain('event.target.closest(".vds-controls,.vds-menu-items")');
        expect(videoPlayerSource).toContain("event.nativeEvent?.composedPath?.()");
        expect(videoPlayerSource).toContain("if (autoPlay && !autoPlayAttemptedRef.current)");
        expect(videoPlayerSource).toContain("autoPlayAttemptedRef.current = true;");
        expect(videoPlayerSource).toContain("noGestures={dataCanvasNoZoom}");
        expect(videoPlayerSource).toContain("smallLayoutWhen={compactControls ? true : undefined}");
    });

    test("allows a runtime-positive probe to correct stale silent metadata", () => {
        expect(videoPlayerSource).toContain("hasAudio === true || detectedHasAudio === true ? true");
        expect(videoPlayerSource).toContain("hasAudio === false ? false : undefined");
        expect(videoPlayerSource).toContain("detectedHasAudio === false ? false");
        expect(videoPlayerSource).toContain("detectVideoAudioTrackFromUrl(src)");
    });

    test("raises only selected video nodes above the canvas dock so controls remain reachable", () => {
        expect(canvasNodeSource).toContain('isSelected && data.type === CanvasNodeType.Video ? "z-[var(--z-node-toolbar)]"');
    });
});

function isoBmffMovie(handlerTypes: string[]) {
    const handlers = handlerTypes.map((handlerType) => {
        const payload = new Uint8Array(20);
        writeFourcc(payload, 8, handlerType);
        return box("trak", box("mdia", box("hdlr", payload)));
    });
    return concat([box("ftyp", new Uint8Array(4)), box("moov", handlers)]);
}

function box(type: string, payload: Uint8Array | Uint8Array[]) {
    const content = Array.isArray(payload) ? concat(payload) : payload;
    const bytes = new Uint8Array(8 + content.byteLength);
    new DataView(bytes.buffer).setUint32(0, bytes.byteLength);
    writeFourcc(bytes, 4, type);
    bytes.set(content, 8);
    return bytes;
}

function concat(parts: Uint8Array[]) {
    const bytes = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
    let offset = 0;
    for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
    }
    return bytes;
}

function writeFourcc(bytes: Uint8Array, offset: number, value: string) {
    for (let index = 0; index < 4; index += 1) bytes[offset + index] = value.charCodeAt(index) || 0;
}

describe("passive video previews", () => {
    test("素材引用菜单使用被动视频首帧回退，而不是视频图标", () => {
        expect(canvasMentionSource).toContain('muted playsInline preload="metadata"');
        expect(canvasMentionSource).toContain("onloadedmetadata = () => primeVideoPreviewFrame(media)");
        expect(canvasMentionSource).toContain("onLoadedMetadata={(event) => primeVideoPreviewFrame(event.currentTarget)}");
        expect(canvasMentionSource).toContain("video.currentTime = Math.min(0.001, video.duration)");
        expect(canvasMentionSource).toContain("reference.kind === \"video\" && reference.previewUrl");
    });

    test("persists uploaded posters in video node metadata and prefers them over legacy previews", () => {
        const metadata = videoMetadata({
            url: "blob:video",
            storageKey: "video:user:1",
            bytes: 1024,
            mimeType: "video/mp4",
            hasAudio: false,
            preview: { url: "blob:poster", storageKey: "image:user:1", width: 400, height: 225, bytes: 256, mimeType: "image/jpeg" },
        });
        const video = node("video", CanvasNodeType.Video);
        video.metadata = { ...metadata, previewContent: "https://example.com/legacy-poster.jpg" };

        expect(metadata.videoPreview).toEqual({ content: "blob:poster", storageKey: "image:user:1", width: 400, height: 225, bytes: 256, mimeType: "image/jpeg" });
        expect(metadata.hasAudio).toBe(false);
        expect(collectImageStorageKeys(metadata)).toContain("image:user:1");
        expect(canvasNodeVideoPreviewUrl(video)).toBe("blob:poster");
    });

    test("uses explicit posters without ever returning the original video URL", () => {
        const video = node("video", CanvasNodeType.Video);
        video.metadata = { content: "https://example.com/video.mp4", previewContent: "https://example.com/poster.jpg" };
        expect(canvasNodeVideoPreviewUrl(video)).toBe("https://example.com/poster.jpg");

        video.metadata.previewContent = video.metadata.content;
        expect(canvasNodeVideoPreviewUrl(video)).toBe("");
    });

    test("derives LibTV snapshots and keeps unsupported videos as lightweight placeholders", () => {
        const video = node("video", CanvasNodeType.Video);
        video.metadata = { content: "https://libtv-res.liblib.art/path/video.mp4" };
        expect(canvasNodeVideoPreviewUrl(video)).toContain("video%2Fsnapshot");
        expect(canvasVideoAssetPreviewUrl("https://example.com/video.mp4")).toBe("");
        expect(canvasVideoAssetPreviewUrl("https://example.com/video.mp4", "https://example.com/video.mp4")).toBe("");
        expect(canvasVideoAssetPreviewUrl("https://example.com/video.mp4", "https://example.com/poster.jpg")).toBe("https://example.com/poster.jpg");
    });
});
