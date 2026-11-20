import { useEffect, useState } from "react";
import { AudioLines, FileText, Image as ImageIcon, LoaderCircle, Video } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AIMessageMarkdown } from "@/components/ai/ai-message-markdown";
import { CachedResourceImage } from "@/components/cached-resource-image";
import type { CanvasAssetKind } from "@/lib/canvas/canvas-asset-catalog";
import { isResourceUrl } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import type { CanvasNodeData } from "@/types/canvas";

import { useVideoPlaybackUrl } from "./canvas-node-media-content";
import { CanvasVideoPreviewImage } from "./canvas-video-preview-image";

export function canvasAssetKindIcon(kind: CanvasAssetKind, className = "size-4") {
    if (kind === "image") return <ImageIcon className={className} aria-hidden="true" />;
    if (kind === "video") return <Video className={className} aria-hidden="true" />;
    if (kind === "audio") return <AudioLines className={className} aria-hidden="true" />;
    return <FileText className={className} aria-hidden="true" />;
}

/** 文本节点正文；兼容旧同步把正文写成资源地址、原文保存在 prompt 的情况。 */
export function canvasAssetText(node: CanvasNodeData) {
    const content = node.metadata?.content || "";
    const prompt = node.metadata?.prompt || "";
    return isResourceUrl(content) && prompt && !isResourceUrl(prompt) ? prompt : content;
}

/** 网格卡片缩略图：图片和视频用封面，其余类型显示正文摘要或类型图标。 */
export function CanvasAssetThumbnail({ node, kind, iconClassName = "size-6" }: { node: CanvasNodeData; kind: CanvasAssetKind; iconClassName?: string }) {
    const fallback = <span className="grid size-full place-items-center text-muted-foreground">{canvasAssetKindIcon(kind, iconClassName)}</span>;
    if (kind === "image") {
        return (
            <CachedResourceImage
                storageKey={node.metadata?.storageKey}
                src={node.metadata?.previewContent || node.metadata?.content}
                variant="thumbnail"
                alt=""
                loading="lazy"
                decoding="async"
                draggable={false}
                className="size-full object-cover"
                fallback={fallback}
            />
        );
    }
    if (kind === "video") return <CanvasVideoPreviewImage node={node} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" fallback={fallback} />;
    if (kind === "txt" || kind === "markdown") {
        const text = canvasAssetText(node).trim();
        if (text) return <span className="line-clamp-6 size-full overflow-hidden whitespace-pre-wrap break-words p-3 text-left text-[var(--fs-label)] leading-4 text-muted-foreground">{text}</span>;
    }
    return fallback;
}

/** 详情面板的完整预览。只读，不写回画布。 */
export function CanvasAssetPreview({ node, kind }: { node: CanvasNodeData; kind: CanvasAssetKind }) {
    const { t } = useTranslation();
    if (kind === "image") {
        return (
            <CachedResourceImage
                key={node.metadata?.storageKey || node.metadata?.content}
                storageKey={node.metadata?.storageKey}
                src={node.metadata?.content}
                alt={node.title}
                eager
                draggable={false}
                className="max-h-full max-w-full object-contain"
                fallback={<PreviewMessage text={t("canvasA.assetPreview.imageUnavailable")} />}
                loadingFallback={<PreviewMessage text={t("canvasA.assetPreview.imageLoading")} loading />}
            />
        );
    }
    if (kind === "video") return <VideoPreview key={node.metadata?.storageKey || node.metadata?.content} node={node} />;
    if (kind === "audio") return <AudioPreview key={node.metadata?.storageKey || node.metadata?.content} node={node} />;
    if (kind === "markdown") {
        return (
            <div className="thin-scrollbar size-full overflow-y-auto px-6 py-5 text-sm">
                <AIMessageMarkdown>{canvasAssetText(node) || " "}</AIMessageMarkdown>
            </div>
        );
    }
    return <pre className="thin-scrollbar m-0 size-full overflow-y-auto whitespace-pre-wrap break-words px-6 py-5 font-mono text-sm leading-6">{canvasAssetText(node)}</pre>;
}

function PreviewMessage({ text, loading = false }: { text: string; loading?: boolean }) {
    return (
        <span role="status" className="inline-flex items-center gap-2 text-sm text-muted-foreground">
            {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : null}
            {text}
        </span>
    );
}

function VideoPreview({ node }: { node: CanvasNodeData }) {
    const { t } = useTranslation();
    const { url, loading, onError } = useVideoPlaybackUrl(node, true);
    if (loading && !url) return <PreviewMessage text={t("canvasA.assetPreview.videoLoading")} loading />;
    if (!url) return <PreviewMessage text={t("canvasA.assetPreview.videoUnavailable")} />;
    return <video src={url} controls playsInline preload="metadata" className="max-h-full max-w-full bg-black" aria-label={node.title || t("canvasA.media.video")} onError={onError} />;
}

function AudioPreview({ node }: { node: CanvasNodeData }) {
    const { t } = useTranslation();
    const storageKey = node.metadata?.storageKey;
    const fallback = node.metadata?.content || "";
    const [state, setState] = useState<{ url: string; loading: boolean }>({ url: "", loading: true });
    useEffect(() => {
        let active = true;
        void resolveMediaUrl(storageKey, fallback)
            .then((url) => active && setState({ url, loading: false }))
            .catch(() => active && setState({ url: fallback, loading: false }));
        return () => {
            active = false;
        };
    }, [fallback, storageKey]);
    if (state.loading) return <PreviewMessage text={t("canvasA.assetPreview.audioLoading")} loading />;
    if (!state.url) return <PreviewMessage text={t("canvasA.assetPreview.audioUnavailable")} />;
    return (
        <div className="flex w-full max-w-xl flex-col items-center gap-4 px-6">
            <AudioLines className="size-10 text-muted-foreground" aria-hidden="true" />
            <audio src={state.url} controls preload="metadata" className="w-full" aria-label={node.title || t("canvasA.media.audio")} />
        </div>
    );
}
