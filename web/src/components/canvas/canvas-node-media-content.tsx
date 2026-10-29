// 画布节点的媒体内容：图片、视频、音频的预览、懒加载与失活占位。
//
// 视频只有在进入视口且被激活时才加载真实播放地址（useNearViewport / useVideoPlaybackUrl），
// 避免大画布上同时拉取大量视频。

import { Image as ImageIcon, ImageOff, LoaderCircle, Music2, Play, RotateCw, Video } from "lucide-react";
import "./canvas-image-state.css";
import { type CSSProperties, type ReactNode, type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useCanvasNodeActions } from "./canvas-node-action-context";
import { canvasNodeVideoPreviewReference } from "@/lib/canvas/canvas-media-preview";
import { createDefaultSubtitleStyle } from "@/types/timeline";
import { CanvasVideoPreviewImage } from "./canvas-video-preview-image";
import { VideoPlayer } from "@/components/video-player";
import { CanvasSubtitleOverlay } from "./canvas-subtitle-overlay";
import { type CanvasNodeData, CanvasNodeType } from "@/types/canvas";
import { CanvasAudioPlayer } from "./canvas-audio-player";
import { buildLibTVImagePreviewUrl, buildLibTVVideoSourceUrl } from "@/lib/canvas/libtv-import";
import { bindCanvasVideoHoverPreview } from "@/lib/canvas/canvas-video-hover-preview";
import { resolveVideoMediaUrl } from "@/services/file-storage";
import { hydrateCanvasVideoPreview } from "@/services/canvas-video-preview";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { fitImageMaterialNodeSize, fitImageNodeSize } from "@/lib/canvas/canvas-node-size";
import { getActiveUserScope } from "@/lib/user-scope";
import { isCanvasImageActive, prepareCanvasImage, subscribeCanvasImageActivity } from "@/services/canvas-image-loader";
import { peekCachedResourceObjectUrl } from "@/services/resource-blob-cache";
import { getResourceAccess, refreshResource, resourceIdFromStorageKey, resolveResourceAccessURL } from "@/services/api/resources";
import type { CanvasNodeContentProps } from "./canvas-node-content";
import { ErrorContent, LoadingContent } from "./canvas-node-status-content";

export function ImageNodeContent(props: CanvasNodeContentProps) {
    const hasImage = Boolean(props.node.metadata?.content || props.node.metadata?.storageKey);
    if (!hasImage && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent node={props.node} theme={props.theme} onOpenTaskDetails={props.onOpenTaskDetails} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} onReloadResource={props.onReloadResource} onOpenTaskDetails={props.onOpenTaskDetails} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame
                batchPreviewNodes={props.batchPreviewNodes}
                batchCount={props.batchCount}
                batchExpanded={props.batchExpanded}
                batchOpening={props.batchOpening}
                batchRecovering={props.batchRecovering}
                theme={props.theme}
                onToggleBatch={props.onToggleBatch}
            >
                {content}
            </BatchFrame>
        );
    }
    if (!hasImage) return <EmptyImageContent {...props} />;
    return (
        <ImageContent
            renderLOD={props.renderLOD}
            batchPreviewNodes={props.batchPreviewNodes}
            node={props.node}
            theme={props.theme}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
        />
    );
}

export function EmptyImageContent({ node, theme, isBatchRoot, batchCount, batchPreviewNodes, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: CanvasNodeContentProps) {
    const isCharacterReference = node.metadata?.workflowKind === "character" && node.metadata?.characterView === "multi";
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-[var(--r-lg)]" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            {isCharacterReference ? (
                <div className="max-w-[80%] text-center">
                    <div className="truncate text-xs font-medium" title={node.metadata?.characterName || node.title} style={{ color: theme.node.muted }}>
                        {node.metadata?.characterName || node.title}
                    </div>
                    <div className="mt-1 text-[var(--fs-tiny)] tracking-[0.12em] opacity-50">多视角参考 · 待生成</div>
                </div>
            ) : (
                <span className="text-[var(--fs-tiny)] tracking-[0.18em] opacity-50">空图片节点</span>
            )}
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchPreviewNodes={batchPreviewNodes} batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} theme={theme} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

export function VideoNodeContent({ node, theme, mediaActive = false, onMediaPlayRequest }: CanvasNodeContentProps) {
    const playerBoxRef = useRef<HTMLDivElement>(null);
    const { updateMediaNode } = useCanvasNodeActions();
    const { url, loading, onError } = useVideoPlaybackUrl(node, mediaActive);
    const preview = canvasNodeVideoPreviewReference(node);
    const subtitleEntries = node.metadata?.subtitleEntries || [];
    const subtitleStyle = node.metadata?.subtitleStyle || createDefaultSubtitleStyle();
    const [currentTimeMs, setCurrentTimeMs] = useState(0);
    const [videoSize, setVideoSize] = useState<{ width: number; height: number } | null>(null);
    const [videoReady, setVideoReady] = useState(false);
    // 播放器身份是节点上的媒体（storageKey），不是当前签名地址：续签只换 src，不重建播放器、不退回静态预览。
    const playerKey = node.metadata?.storageKey || node.id;

    useEffect(() => {
        setVideoReady(false);
    }, [playerKey]);

    useEffect(() => {
        if (!url) setVideoReady(false);
    }, [url]);

    useEffect(() => {
        const box = playerBoxRef.current;
        const video = box?.querySelector("video");
        if (!video) return;
        const handleLoadedMetadata = () => {
            const width = video.videoWidth;
            const height = video.videoHeight;
            const durationMs = Number.isFinite(video.duration) && video.duration > 0 ? Math.round(video.duration * 1000) : 0;
            if (width > 0 && height > 0) {
                setVideoSize({ width, height });
            }
            if (width <= 0 && height <= 0 && durationMs <= 0) return;
            updateMediaNode?.(node.id, (current) => {
                const metadata = current.metadata;
                const nextMetadata = { ...metadata };
                let changed = false;
                if (width > 0 && height > 0 && (metadata?.naturalWidth !== width || metadata?.naturalHeight !== height)) {
                    nextMetadata.naturalWidth = width;
                    nextMetadata.naturalHeight = height;
                    changed = true;
                }
                if (durationMs > 0 && (!metadata?.durationMs || metadata.durationMs <= 0)) {
                    nextMetadata.durationMs = durationMs;
                    changed = true;
                }
                return changed ? { ...current, metadata: nextMetadata } : current;
            });
        };
        video.addEventListener("loadedmetadata", handleLoadedMetadata);
        handleLoadedMetadata();
        if (!subtitleEntries.length) return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        const handleTimeUpdate = () => setCurrentTimeMs(Math.round(video.currentTime * 1000));
        video.addEventListener("timeupdate", handleTimeUpdate);
        return () => {
            video.removeEventListener("timeupdate", handleTimeUpdate);
            video.removeEventListener("loadedmetadata", handleLoadedMetadata);
        };
    }, [node.id, node.metadata?.naturalHeight, node.metadata?.naturalWidth, subtitleEntries.length, updateMediaNode, url]);

    if (!node.metadata?.content && !node.metadata?.storageKey) return <EmptyMediaContent icon={<Video className="size-7 opacity-35" />} label="空视频节点" color={theme.node.placeholder} />;
    if (!mediaActive) return <InactiveVideoPreview node={node} theme={theme} onPlay={() => onMediaPlayRequest?.(node.id)} />;

    const sourceRatio = (videoSize?.width || node.metadata?.naturalWidth || node.width) / Math.max(1, videoSize?.height || node.metadata?.naturalHeight || node.height);
    const fitHeight = Math.min(node.height, node.width / Math.max(0.01, sourceRatio));
    const fitWidth = Math.round(fitHeight * sourceRatio);
    const activeEntry = subtitleEntries.find((entry) => currentTimeMs >= entry.startMs && currentTimeMs < entry.endMs);
    const activeHighlight = activeEntry ? (node.metadata?.subtitleHighlights || []).find((item) => item.entryIndex === activeEntry.index) : undefined;

    return (
        <div ref={playerBoxRef} className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-[var(--node-radius)] bg-black">
            {preview ? (
                <CanvasVideoPreviewImage
                    node={node}
                    alt={`${node.title || "视频"} 静态预览`}
                    loading="eager"
                    decoding="sync"
                    draggable={false}
                    className={`absolute inset-0 size-full select-none object-contain transition-opacity duration-150 ${videoReady ? "opacity-0" : "opacity-100"}`}
                    loadingFallback={<LoaderCircle className="size-5 animate-spin text-white/55" />}
                    fallback={<Video className="size-7 text-white/40" />}
                />
            ) : !url || loading ? (
                <MediaLoadingState icon={<LoaderCircle className="size-5 animate-spin" />} label={loading ? "正在加载视频" : "视频资源不可用"} />
            ) : null}
            {url ? (
                <div className={`relative z-[1] transition-opacity duration-150 ${videoReady ? "opacity-100" : "opacity-0"}`} style={{ width: fitWidth, height: Math.round(fitHeight) }}>
                    <VideoPlayer
                        key={playerKey}
                        src={url}
                        mimeType={node.metadata?.mimeType}
                        title={node.title || "视频"}
                        hasAudio={inferVideoHasAudio(node.metadata)}
                        autoPlay
                        preload="metadata"
                        brandColor={theme.accent.primary}
                        className="h-full w-full rounded-[var(--node-radius)] bg-black"
                        dataCanvasNoZoom
                        compactControls
                        onCanPlay={() => setVideoReady(true)}
                        onError={onError}
                    />
                    {activeEntry && activeEntry.text.trim() ? <CanvasSubtitleOverlay text={activeEntry.text} highlight={activeHighlight} style={subtitleStyle} /> : null}
                </div>
            ) : null}
        </div>
    );
}

export function inferVideoHasAudio(metadata: CanvasNodeData["metadata"]): boolean | undefined {
    if (typeof metadata?.hasAudio === "boolean") return metadata.hasAudio;
    // Generated nodes from older saves may not have `hasAudio` yet. In that
    // case an explicit generation setting is the only persisted signal we
    // have; leave all other videos in the unknown state.
    const value = metadata?.generateAudio?.trim().toLowerCase();
    if (["false", "0", "off", "no", "disabled"].includes(value || "")) return false;
    if (["true", "1", "on", "yes", "enabled"].includes(value || "")) return true;
    return undefined;
}

export function AudioNodeContent({ node, theme }: CanvasNodeContentProps) {
    if (!node.metadata?.content && !node.metadata?.storageKey) return <EmptyMediaContent icon={<Music2 className="size-7 opacity-35" />} label="空音频节点" color={theme.node.placeholder} />;
    return <CanvasAudioPlayer node={node} theme={theme} />;
}

export function InactiveVideoPreview({ node, theme, onPlay }: Pick<CanvasNodeContentProps, "node" | "theme"> & { onPlay: () => void }) {
    const previewRef = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(previewRef);
    const persistedPreview = canvasNodeVideoPreviewReference(node);
    const persistedPreviewSource = persistedPreview?.src || "";
    const persistedPreviewStorageKey = persistedPreview?.storageKey || "";
    const hasPersistedPreview = Boolean(persistedPreviewSource || persistedPreviewStorageKey);
    const { updateMetadata } = useCanvasNodeActions();
    const updateMetadataRef = useRef(updateMetadata);
    const [hydrating, setHydrating] = useState(false);
    const [localPreviewUrl, setLocalPreviewUrl] = useState("");
    const localPreviewUrlRef = useRef("");

    useEffect(() => {
        const element = previewRef.current;
        if (!element) return;
        const content = node.metadata?.content || "";
        const fallback = node.metadata?.importSource?.provider === "libtv" ? buildLibTVVideoSourceUrl(content) : content;
        return bindCanvasVideoHoverPreview(element, () => resolveVideoMediaUrl(node.metadata?.storageKey, fallback));
    }, [node.metadata?.content, node.metadata?.storageKey, node.metadata?.importSource?.provider]);

    useEffect(() => {
        updateMetadataRef.current = updateMetadata;
    }, [updateMetadata]);

    useEffect(
        () => () => {
            if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
        },
        [],
    );

    useEffect(() => {
        if (hasPersistedPreview || !nearViewport || (!node.metadata?.content && !node.metadata?.storageKey) || !updateMetadataRef.current) {
            if (hasPersistedPreview && localPreviewUrlRef.current) {
                URL.revokeObjectURL(localPreviewUrlRef.current);
                localPreviewUrlRef.current = "";
                setLocalPreviewUrl("");
            }
            setHydrating(false);
            return;
        }
        if (localPreviewUrlRef.current) {
            URL.revokeObjectURL(localPreviewUrlRef.current);
            localPreviewUrlRef.current = "";
            setLocalPreviewUrl("");
        }
        const controller = new AbortController();
        setHydrating(true);
        void hydrateCanvasVideoPreview(node, controller.signal)
            .then((hydrated) => {
                if (!hydrated || controller.signal.aborted) {
                    if (hydrated?.localUrl) URL.revokeObjectURL(hydrated.localUrl);
                    return;
                }
                if (localPreviewUrlRef.current) URL.revokeObjectURL(localPreviewUrlRef.current);
                localPreviewUrlRef.current = hydrated.localUrl;
                setLocalPreviewUrl(hydrated.localUrl);
                void hydrated.persisted.then((videoPreview) => {
                    if (!controller.signal.aborted && videoPreview) updateMetadataRef.current?.(node.id, { videoPreview });
                });
            })
            .catch(() => undefined)
            .finally(() => {
                if (!controller.signal.aborted) setHydrating(false);
            });
        return () => {
            controller.abort();
        };
    }, [hasPersistedPreview, nearViewport, node.id, node.metadata?.content, node.metadata?.storageKey, persistedPreviewSource, persistedPreviewStorageKey]);

    if (hasPersistedPreview || localPreviewUrl) {
        return (
            <div ref={previewRef} className="group/video-preview relative size-full overflow-hidden rounded-[var(--node-radius)] bg-black">
                {hasPersistedPreview ? (
                    <CanvasVideoPreviewImage
                        node={node}
                        alt={`${node.title || "视频"} 静态预览`}
                        loading="lazy"
                        decoding="sync"
                        draggable={false}
                        className="pointer-events-none size-full select-none object-contain"
                        loadingFallback={<LoaderCircle className="size-5 animate-spin text-white/55" />}
                        fallback={<Video className="size-7 text-white/40" />}
                    />
                ) : (
                    <img src={localPreviewUrl} alt={`${node.title || "视频"} 静态预览`} loading="lazy" decoding="sync" draggable={false} className="pointer-events-none size-full select-none object-contain" />
                )}
                <VideoPreviewPlayButton title={node.title || "视频"} onPlay={onPlay} />
            </div>
        );
    }
    return (
        <div ref={previewRef} className="group/video-preview relative size-full">
            <InactiveMediaCard icon={<Video className="size-7" />} title={node.title || "视频"} hint={hydrating ? "正在生成首帧" : nearViewport ? "点击播放视频" : "进入视口后加载首帧"} theme={theme} />
            <VideoPreviewPlayButton title={node.title || "视频"} onPlay={onPlay} />
        </div>
    );
}

export function VideoPreviewPlayButton({ title, onPlay }: { title: string; onPlay: () => void }) {
    return (
        <button
            type="button"
            className="absolute left-1/2 top-1/2 z-[var(--node-z-overlay)] grid size-11 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-black/62 text-white shadow-lg backdrop-blur transition-[background-color,opacity] duration-150 hover:bg-black/78 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            aria-label={`播放 ${title}`}
            title="播放视频"
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
                event.stopPropagation();
                onPlay();
            }}
        >
            <Play className="ml-0.5 size-5 fill-current" />
        </button>
    );
}

const videoPlaybackRecoveryMaxAttempts = 8;
const videoPlaybackRecoveryDelayMs = 1_500;

function waitForVideoPlaybackRecovery(signal: AbortSignal) {
    return new Promise<void>((resolve) => {
        let timer = 0;
        const finish = () => {
            window.clearTimeout(timer);
            signal.removeEventListener("abort", finish);
            resolve();
        };
        timer = window.setTimeout(finish, videoPlaybackRecoveryDelayMs);
        signal.addEventListener("abort", finish, { once: true });
    });
}

export function useVideoPlaybackUrl(node: CanvasNodeData, active: boolean) {
    const rawContent = node.metadata?.content || "";
    const fallback = node.metadata?.importSource?.provider === "libtv" ? buildLibTVVideoSourceUrl(rawContent) : rawContent;
    const storageKey = node.metadata?.storageKey || "";
    const [url, setUrl] = useState("");
    const [loading, setLoading] = useState(false);
    const recoveryRef = useRef<AbortController | null>(null);
    const recoveryAttemptedRef = useRef(false);
    const sourceGenerationRef = useRef(0);

    useEffect(() => {
        sourceGenerationRef.current += 1;
        recoveryAttemptedRef.current = false;
        recoveryRef.current?.abort();
        recoveryRef.current = null;
        let cancelled = false;
        if (!active) {
            setUrl("");
            setLoading(false);
            return () => {
                cancelled = true;
            };
        }
        setLoading(true);
        void resolveVideoMediaUrl(storageKey, fallback)
            .then((resolved) => {
                if (!cancelled) setUrl(resolved);
            })
            .catch(() => {
                if (!cancelled) setUrl(fallback);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
            recoveryRef.current?.abort();
        };
    }, [active, fallback, storageKey]);

    const onError = () => {
        const resourceId = resourceIdFromStorageKey(storageKey);
        if (!active || !resourceId || recoveryAttemptedRef.current) {
            if (!resourceId) setUrl("");
            return;
        }
        recoveryAttemptedRef.current = true;
        const controller = new AbortController();
        const generation = sourceGenerationRef.current;
        recoveryRef.current?.abort();
        recoveryRef.current = controller;
        setUrl("");
        setLoading(true);

        const recover = async () => {
            for (let attempt = 0; attempt < videoPlaybackRecoveryMaxAttempts; attempt += 1) {
                if (controller.signal.aborted || generation !== sourceGenerationRef.current) return;
                if (attempt > 0) await waitForVideoPlaybackRecovery(controller.signal);
                if (controller.signal.aborted || generation !== sourceGenerationRef.current) return;

                let resource: Awaited<ReturnType<typeof refreshResource>>;
                try {
                    resource = await refreshResource(resourceId);
                } catch {
                    break;
                }
                const status = String(resource.playbackStatus || "").toLowerCase();
                if (resource.status !== "ready" || status === "none" || status === "failed") break;
                if (status !== "ready") {
                    if (resource.provider !== "local") break;
                    continue;
                }

                try {
                    const access = await getResourceAccess(storageKey, "display", "playback", "", { forceRefresh: true });
                    if (access.actualVariant !== "playback") continue;
                    const resolved = resolveResourceAccessURL(access.url);
                    if (!resolved) continue;
                    if (!controller.signal.aborted && generation === sourceGenerationRef.current) {
                        setUrl(resolved);
                        setLoading(false);
                    }
                    return;
                } catch {
                    // A ready status can race the access endpoint; the next bounded refresh retries it.
                }
            }
            if (!controller.signal.aborted && generation === sourceGenerationRef.current) {
                setUrl("");
                setLoading(false);
            }
        };

        void recover().finally(() => {
            if (recoveryRef.current === controller) recoveryRef.current = null;
        });
    };

    return { url, loading, onError };
}

export function InactiveMediaCard({ icon, title, hint, theme }: { icon: ReactNode; title: string; hint: string; theme: CanvasTheme }) {
    return (
        <div className="flex size-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] px-4 text-center" style={{ background: theme.node.fill, color: theme.node.muted }}>
            <span className="opacity-40">{icon}</span>
            <span className="max-w-full truncate text-xs font-medium" title={title}>
                {title}
            </span>
            <span className="text-[var(--fs-tiny)] opacity-50">{hint}</span>
        </div>
    );
}

export function MediaLoadingState({ icon, label }: { icon: ReactNode; label: string }) {
    return (
        <div role="status" className="flex size-full flex-col items-center justify-center gap-2 rounded-[var(--node-radius)] bg-black text-white/75">
            <span className="grid size-10 place-items-center rounded-full bg-white/10">{icon}</span>
            <span className="text-xs font-medium">{label}</span>
        </div>
    );
}

export function EmptyMediaContent({ icon, label, color }: { icon: ReactNode; label: string; color: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color }}>
            {icon}
            <span className="text-sm">{label}</span>
        </div>
    );
}

export function ImageContent({
    renderLOD = "full",
    node,
    theme,
    isBatchRoot,
    batchCount,
    batchPreviewNodes,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
}: Pick<CanvasNodeContentProps, "renderLOD" | "node" | "theme" | "isBatchRoot" | "batchCount" | "batchPreviewNodes" | "batchExpanded" | "batchOpening" | "batchRecovering" | "onToggleBatch">) {
    const imageContainerRef = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(imageContainerRef, renderLOD !== "shell");
    const resourceVariant = renderLOD === "full" && (node.metadata?.imageLayer || node.metadata?.imageLayerGroup) ? "original" : "thumbnail";
    const { url, loading, failed: accessFailed, originalWidth, originalHeight } = useNodeResourceUrl(node, nearViewport, resourceVariant);
    const importedFromLibTV = node.metadata?.importSource?.provider === "libtv";
    const { updateMediaNode } = useCanvasNodeActions();
    const measuredSizeRef = useRef<{ width: number; height: number } | null>(null);

    /**
     * 让节点跟随图片真实比例。
     *
     * 上传接口的 width/height 是可选的（services/api/resources.ts），拿不到时节点会落到
     * 默认的横向比例，竖图就被放进一个宽盒子、两侧留黑。这里在图片解码后量真实尺寸并校正。
     *
     * 判据是「用户有没有手动定过尺寸」，**不是**「有没有量过尺寸」——后者会让所有已经
     * 存过 naturalWidth 的旧节点永远得不到修正（第一版就是这么写的，所以没生效）。
     * 手动拉过（manualSize）或自由比例（freeResize）的节点只补记尺寸、不动宽高。
     */
    const fitToImage = (element: HTMLImageElement, sourceSize?: { width?: number; height?: number }) => {
        // LibTV 已提供原图尺寸和节点尺寸；960px 缩略图不能反向覆盖这些数据。
        if (importedFromLibTV) return;
        const naturalWidth = sourceSize?.width || element.naturalWidth;
        const naturalHeight = sourceSize?.height || element.naturalHeight;
        if (!naturalWidth || !naturalHeight) return;
        if (measuredSizeRef.current?.width === naturalWidth && measuredSizeRef.current.height === naturalHeight) return;
        measuredSizeRef.current = { width: naturalWidth, height: naturalHeight };
        updateMediaNode?.(node.id, (current) => {
            const metadata = current.metadata;
            const needsMetadata = metadata?.naturalWidth !== naturalWidth || metadata?.naturalHeight !== naturalHeight;
            if (current.metadata?.freeResize || current.metadata?.manualSize || current.metadata?.locked) {
                return needsMetadata ? { ...current, metadata: { ...metadata, naturalWidth, naturalHeight } } : current;
            }
            // 独立素材使用有界预览框；解码回调不能重新把细长文字放大成超宽节点。
            const materialPreview = metadata?.imageLayerMaterial || (metadata?.isBatchRoot && batchPreviewNodes?.some((child) => child.metadata?.imageLayerMaterial));
            const size = materialPreview ? fitImageMaterialNodeSize(naturalWidth, naturalHeight) : fitImageNodeSize(naturalWidth, naturalHeight);
            const needsResize = Math.abs(size.width - current.width) >= 1 || Math.abs(size.height - current.height) >= 1;
            if (!needsMetadata && !needsResize) return current;
            return {
                ...current,
                ...(needsResize ? size : {}),
                metadata: needsMetadata ? { ...metadata, naturalWidth, naturalHeight } : metadata,
            };
        });
    };

    return (
        <BatchFrame
            batchPreviewNodes={renderLOD === "full" ? batchPreviewNodes : undefined}
            batchCount={isBatchRoot && renderLOD === "full" ? batchCount : 0}
            batchExpanded={batchExpanded}
            batchOpening={batchOpening}
            batchRecovering={batchRecovering}
            theme={theme}
            onToggleBatch={onToggleBatch}
        >
            <div ref={imageContainerRef} className="relative h-full w-full overflow-hidden rounded-[var(--node-radius)]">
                <RetainedCanvasImage
                    identity={`${getActiveUserScope()}:${node.id}:${node.metadata?.storageKey || node.metadata?.content || "empty"}`}
                    src={url}
                    storageKey={node.metadata?.storageKey}
                    fallbackSrc={node.metadata?.content || ""}
                    originalSize={{ width: originalWidth, height: originalHeight }}
                    alt={node.title}
                    fitToImage={fitToImage}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                    loading={loading}
                    accessFailed={accessFailed}
                    theme={theme}
                />
                {node.metadata?.imageLayerGroup?.incomplete ? (
                    <div role="status" className="absolute bottom-2 left-2 right-2 rounded bg-black/75 px-2 py-1 text-xs text-amber-300">
                        部分合成：{node.metadata.imageLayerGroup.incomplete.completed}/{node.metadata.imageLayerGroup.incomplete.total} 层已通过{node.metadata.imageLayerGroup.incomplete.missingBackground ? "，缺少完整背景" : ""}，展开可查看并重试失败层
                    </div>
                ) : null}
                {node.metadata?.imageLayerGroup?.compositeStatus === "updating" || node.metadata?.imageLayerGroup?.compositeStatus === "error" ? (
                    <div role="status" className="absolute inset-0 grid place-items-center bg-black/60 p-4 text-center text-xs text-white">
                        {node.metadata.imageLayerGroup.compositeStatus === "updating" ? "正在更新合成图…" : node.metadata.imageLayerGroup.compositeError || "合成图更新失败，请在图层管理中重试"}
                    </div>
                ) : null}
            </div>
        </BatchFrame>
    );
}

const IMAGE_SLOW_HINT_MS = 8000;

/** A stable visible img is updated only after a queued candidate has loaded and decoded. */
export function RetainedCanvasImage({
    identity,
    src,
    storageKey,
    fallbackSrc,
    originalSize,
    alt,
    fitToImage,
    className,
    loading,
    accessFailed = false,
    theme,
}: {
    identity: string;
    src: string;
    storageKey?: string;
    fallbackSrc: string;
    originalSize: { width?: number; height?: number };
    alt?: string;
    fitToImage: (image: HTMLImageElement, size?: { width?: number; height?: number }) => void;
    className: string;
    loading: boolean;
    /** 访问地址换取失败且没有回退地址。 */
    accessFailed?: boolean;
    theme: CanvasTheme;
}) {
    const [displayed, setDisplayed] = useState<{ identity: string; src: string } | null>(null);
    const [preparing, setPreparing] = useState(false);
    const [slowIdentity, setSlowIdentity] = useState("");
    const [failedIdentity, setFailedIdentity] = useState("");
    const [retry, setRetry] = useState({ identity: "", count: 0 });
    // 当前这次加载实际请求的地址；只有它占用了下载并发位时骨架才播放微光。
    const [attemptSrc, setAttemptSrc] = useState("");
    const activeSnapshot = useCallback(() => isCanvasImageActive(attemptSrc), [attemptSrc]);
    const downloading = useSyncExternalStore(subscribeCanvasImageActivity, activeSnapshot, () => false);
    const displayedRef = useRef(displayed);
    displayedRef.current = displayed;
    const originalWidth = originalSize.width;
    const originalHeight = originalSize.height;
    const currentRef = useRef({ identity, src, storageKey, fallbackSrc, originalSize, fitToImage });
    currentRef.current = { identity, src, storageKey, fallbackSrc, originalSize, fitToImage };
    const currentDisplayedSrc = displayed?.identity === identity ? displayed.src : "";
    const retryCount = retry.identity === identity ? retry.count : 0;

    useEffect(() => {
        const controller = new AbortController();
        const target = currentRef.current;
        const resourceKey = target.storageKey?.startsWith("resource:") ? target.storageKey : "";
        const alreadyShown = displayedRef.current?.identity === identity && displayedRef.current.src === target.src;
        // 手动重试时即使没有地址也要重新换取访问地址；其他情况下没有地址就等待上游给出。
        if (alreadyShown || (!target.src && !(retryCount > 0 && resourceKey))) {
            setPreparing(false);
            return () => controller.abort();
        }
        setPreparing(true);
        setFailedIdentity((current) => (current === identity ? "" : current));
        // 大图在慢网络下可能要几十秒，超过阈值后在骨架上提示仍在加载，避免像是卡死。
        const slowTimer = window.setTimeout(() => setSlowIdentity(identity), IMAGE_SLOW_HINT_MS);
        const isCurrent = () => !controller.signal.aborted && currentRef.current.identity === identity && currentRef.current.src === target.src;
        const isAbort = (error: unknown) => controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
        const show = (image: HTMLImageElement, url: string, size: { width?: number; height?: number }) => {
            currentRef.current.fitToImage(image, size);
            setDisplayed({ identity, src: url });
        };
        const attempt = (url: string) => {
            if (!controller.signal.aborted) setAttemptSrc(url);
            return prepareCanvasImage(url, controller.signal);
        };
        const prepare = async () => {
            try {
                if (target.src && retryCount === 0) {
                    try {
                        const candidate = await attempt(target.src);
                        if (isCurrent()) show(candidate, target.src, target.originalSize);
                        return;
                    } catch (error) {
                        if (isAbort(error)) return;
                        if (!resourceKey) throw error;
                    }
                }
                if (!resourceKey) {
                    const candidate = await attempt(target.src);
                    if (isCurrent()) show(candidate, target.src, target.originalSize);
                    return;
                }
                // 失败最常见的原因是缓存的签名地址过期或被 CDN 拒绝：强制重新签发原图地址再试一次，
                // 即使新地址与旧地址相同也重试（失败的解码不会被缓存）。
                const access = await getResourceAccess(resourceKey, "display", "original", "", { forceRefresh: true });
                const originalURL = resolveResourceAccessURL(access.url);
                if (!originalURL) throw new Error("资源访问地址为空");
                const original = await attempt(originalURL);
                if (isCurrent()) show(original, originalURL, { width: access.originalWidth, height: access.originalHeight });
            } catch (error) {
                if (isAbort(error) || !isCurrent()) return;
                // 已显示过同一资源时保留旧画面；首次加载失败才进入可重试的失败态。
                if (displayedRef.current?.identity !== identity) setFailedIdentity(identity);
            } finally {
                window.clearTimeout(slowTimer);
                if (isCurrent()) {
                    setPreparing(false);
                    setSlowIdentity((current) => (current === identity ? "" : current));
                }
            }
        };
        void prepare();
        return () => {
            window.clearTimeout(slowTimer);
            controller.abort();
        };
    }, [identity, originalHeight, originalWidth, retryCount, src, storageKey]);

    const failed = !currentDisplayedSrc && !preparing && (failedIdentity === identity || (accessFailed && !loading));
    const surfaceStyle = { "--canvas-gen-ink": theme.node.text, "--canvas-gen-surface": theme.node.fill, "--canvas-image-muted": theme.node.muted } as CSSProperties;
    const reload = () => {
        setFailedIdentity("");
        setRetry((current) => ({ identity, count: (current.identity === identity ? current.count : 0) + 1 }));
    };

    return (
        <>
            <img
                src={currentDisplayedSrc || undefined}
                alt={alt || ""}
                // 世界层每次缩放提交都会按新倍率重新栅格化；async 解码会让 Chromium 先画出
                // 空白再补图（缩放时白闪）。图片已由 prepareCanvasImage 预解码，同步解码只阻塞栅格不阻塞主线程。
                decoding="sync"
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                className={`absolute inset-0 ${className}`}
                // 刚生成完成的节点只在图片真正解码可见时播放出现动画（见 globals.css 的 data-generation-reveal）。
                data-canvas-image-ready={currentDisplayedSrc ? "true" : "false"}
                style={{ visibility: currentDisplayedSrc ? "visible" : "hidden" }}
            />
            {currentDisplayedSrc ? (
                <span className="canvas-image-reveal-sweep" aria-hidden="true" style={{ "--canvas-gen-surface": theme.node.fill } as CSSProperties} />
            ) : loading || preparing ? (
                <span className="canvas-image-skeleton" data-active={downloading ? "true" : undefined} role="status" aria-label="正在载入图片" style={surfaceStyle}>
                    {slowIdentity === identity ? <span className="canvas-image-state-hint">图片较大，仍在加载</span> : null}
                </span>
            ) : failed ? (
                <div className="canvas-image-state" data-state="error" role="alert" style={surfaceStyle}>
                    <ImageOff className="canvas-image-state-icon" aria-hidden="true" />
                    <span className="canvas-image-state-label">图片暂时无法显示</span>
                    <button
                        type="button"
                        data-canvas-no-zoom
                        className="canvas-image-state-retry"
                        onPointerDown={(event) => event.stopPropagation()}
                        onDoubleClick={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            reload();
                        }}
                    >
                        <RotateCw aria-hidden="true" />
                        重新加载
                    </button>
                </div>
            ) : (
                // 尚未进入视口或还没有地址：用静态底板占住节点，不再露出画布网格。
                <div className="canvas-image-state" data-state="idle" aria-hidden="true" style={surfaceStyle}>
                    <ImageIcon className="canvas-image-state-icon" />
                </div>
            )}
        </>
    );
}

export function useNodeResourceUrl(node: CanvasNodeData, eager: boolean, variant: "original" | "thumbnail" = "original") {
    const storageKey = node.metadata?.storageKey || "";
    const rawContent = node.metadata?.content || "";
    const content = node.type === CanvasNodeType.Video && node.metadata?.importSource?.provider === "libtv" ? buildLibTVVideoSourceUrl(rawContent) : rawContent;
    // `previewContent` is intentionally passive-only.  When a media node is
    // activated, VideoPlayer/Audio must receive the playable asset, never the
    // LibTV OSS snapshot URL stored for the thumbnail.
    const fallback =
        node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio
            ? content
            : node.metadata?.previewContent || (node.type === CanvasNodeType.Image && node.metadata?.importSource?.provider === "libtv" ? buildLibTVImagePreviewUrl(content) : content);
    const isRemoteResource = storageKey.startsWith("resource:");
    // Inline data URLs are already local, but decoding thousands of them is
    // still expensive. Images must wait for the same viewport gate as remote
    // resources; otherwise DOM virtualization does not reduce image work.
    const isLazyVisual = node.type === CanvasNodeType.Image;
    const isHttpUrl = Boolean(fallback && !fallback.startsWith("data:"));
    // 本会话刚上传的图片已在内存里有 Blob URL（primeResourceBlobCache），直接上屏，
    // 不必再请求访问地址并把原图从服务器完整下载一遍。只用于图片：音视频播放仍走播放副本合同。
    const sessionBlobUrl = eager && isRemoteResource && isLazyVisual ? peekCachedResourceObjectUrl(storageKey) : "";
    const initialUrl = sessionBlobUrl || (eager && !isRemoteResource && isLazyVisual && isHttpUrl ? fallback : isRemoteResource || isLazyVisual ? "" : fallback);
    const scope = getActiveUserScope();
    const identity = `${scope}:${node.id}:${storageKey || fallback}`;
    const [resolved, setResolved] = useState<{ identity: string; url: string; loading: boolean; failed?: boolean; originalWidth?: number; originalHeight?: number }>(() => ({ identity, url: initialUrl, loading: !initialUrl && isRemoteResource && eager }));
    const current = resolved.identity === identity ? resolved : { identity, url: initialUrl, loading: !initialUrl && isRemoteResource && eager };

    useEffect(() => {
        if (!isRemoteResource) {
            setResolved({ identity, url: isLazyVisual && !eager ? "" : fallback, loading: false });
            return;
        }
        if (!eager) {
            setResolved({ identity, url: "", loading: false });
            return;
        }
        const localUrl = isLazyVisual ? peekCachedResourceObjectUrl(storageKey) : "";
        if (localUrl) {
            setResolved({ identity, url: localUrl, loading: false });
            return;
        }
        let cancelled = false;
        setResolved({ identity, url: "", loading: true });
        void getResourceAccess(storageKey, "display", variant)
            .then((access) => {
                if (!cancelled) setResolved({ identity, url: resolveResourceAccessURL(access.url), loading: false, originalWidth: access.originalWidth, originalHeight: access.originalHeight });
            })
            .catch(() => {
                // 没有可用的回退地址时标记失败，节点显示「加载失败 + 重新加载」，而不是一块无提示的空白。
                if (!cancelled) setResolved({ identity, url: fallback, loading: false, failed: !fallback });
            });
        return () => {
            cancelled = true;
        };
    }, [eager, fallback, identity, isLazyVisual, isRemoteResource, storageKey, variant]);

    const isThumbnail = variant === "thumbnail";
    return { url: current.url, loading: current.loading, failed: Boolean(current.failed), originalWidth: isThumbnail ? current.originalWidth : undefined, originalHeight: isThumbnail ? current.originalHeight : undefined };
}

export function useNearViewport(ref: RefObject<Element | null>, enabled = true) {
    const [nearViewport, setNearViewport] = useState(false);
    useEffect(() => {
        if (!enabled || nearViewport) return;
        const element = ref.current;
        if (!element || typeof IntersectionObserver === "undefined") {
            setNearViewport(true);
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setNearViewport(true);
                    observer.disconnect();
                }
            },
            { rootMargin: "600px" },
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [enabled, nearViewport, ref]);
    return nearViewport;
}

export function BatchPreviewImage({ node }: { node: CanvasNodeData }) {
    const ref = useRef<HTMLDivElement>(null);
    const nearViewport = useNearViewport(ref);
    const { url } = useNodeResourceUrl(node, nearViewport);
    return (
        <div ref={ref} className="h-full w-full overflow-hidden rounded-[inherit]">
            {url ? <img src={url} alt={`子图预览：${node.title}`} className="h-full w-full object-contain" draggable={false} /> : null}
        </div>
    );
}

export function BatchFrame({
    batchCount,
    batchPreviewNodes,
    batchExpanded,
    batchOpening,
    batchRecovering,
    theme,
    onToggleBatch,
    children,
}: {
    batchCount: number;
    batchPreviewNodes?: CanvasNodeData[];
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    theme: CanvasTheme;
    onToggleBatch?: () => void;
    children: ReactNode;
}) {
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[var(--r-lg)] transition-[transform,opacity] duration-200"
                            style={{
                                inset: 0,
                                background: theme.node.panel,
                                boxShadow: `inset 0 0 0 1px ${theme.node.stroke}`,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        >
                            {batchPreviewNodes?.[index] ? <BatchPreviewImage node={batchPreviewNodes[index]} /> : null}
                        </div>
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
