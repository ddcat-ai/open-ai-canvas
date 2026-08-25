import { useEffect, useMemo, useState } from "react";
import { Modal, Tooltip } from "antd";
import { Image as ImageIcon, Music2, Play, UserRound } from "lucide-react";

import { isStoryboardPreviewAsset } from "@/lib/canvas/canvas-storyboard-materializer";
import { resolveMediaUrl } from "@/services/file-storage";
import { CanvasNodeType, type CanvasNodeData, type StoryboardAssetBinding } from "@/types/canvas";

const ROLE_LABELS: Record<StoryboardAssetBinding["role"], string> = {
    character: "角色",
    environment: "场景",
    wardrobe: "服装",
    prop: "道具",
    weapon: "武器",
    style: "风格",
    motion: "动态",
    audio: "音频",
};

export function StoryboardAssetsCell({ bindings, nodes, limit = 4 }: { bindings: StoryboardAssetBinding[]; nodes: CanvasNodeData[]; limit?: number }) {
    const [previewNode, setPreviewNode] = useState<CanvasNodeData | null>(null);
    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    const assets = bindings.map((binding) => ({ binding, node: nodeById.get(binding.nodeId) })).filter((item) => !item.node || isStoryboardPreviewAsset(item.node));
    const visible = assets.slice(0, limit);
    const hiddenCount = Math.max(0, assets.length - visible.length);

    if (!assets.length) return <span className="text-[var(--fs-caption)] text-foreground/35">未关联</span>;
    return (
        <>
            <div className="flex min-w-0 items-center gap-1.5" aria-label={`已关联 ${assets.length} 个资产`}>
                {visible.map(({ binding, node }) => (
                    <Tooltip key={binding.nodeId} title={`${node?.title || "资产已失效"} · ${ROLE_LABELS[binding.role]}`}>
                        <button
                            type="button"
                            disabled={!node}
                            className="relative grid size-9 shrink-0 place-items-center overflow-hidden rounded-md border border-foreground/10 bg-foreground/[0.035] text-foreground/45 outline-none transition enabled:hover:border-foreground/30 enabled:hover:text-foreground/70 focus-visible:ring-2 focus-visible:ring-[var(--color-primary)] disabled:cursor-not-allowed"
                            aria-label={`预览${node?.title || "失效资产"}`}
                            onMouseDown={(event) => event.stopPropagation()}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (node) setPreviewNode(node);
                            }}
                        >
                            {node ? <AssetThumbnail node={node} /> : <ImageIcon className="size-4" />}
                            <span className="absolute bottom-0.5 right-0.5 rounded bg-black/65 px-1 text-[8px] leading-3 text-white">{ROLE_LABELS[binding.role].slice(0, 1)}</span>
                        </button>
                    </Tooltip>
                ))}
                {hiddenCount ? <span className="shrink-0 text-[var(--fs-caption)] font-medium text-foreground/45">+{hiddenCount}</span> : null}
            </div>
            <AssetPreviewModal node={previewNode} onClose={() => setPreviewNode(null)} />
        </>
    );
}

function AssetThumbnail({ node }: { node: CanvasNodeData }) {
    const source = useNodeMediaSource(node);
    if (node.type === CanvasNodeType.Audio) return <Music2 className="size-4" />;
    if (node.metadata?.workflowKind === "character" && !source) return <UserRound className="size-4" />;
    if (node.type === CanvasNodeType.Video) {
        return source ? (
            <>
                <video src={source} muted playsInline preload="metadata" className="size-full object-cover" aria-hidden />
                <span className="absolute inset-0 grid place-items-center bg-black/15"><Play className="size-3.5 fill-white text-white" /></span>
            </>
        ) : <Play className="size-4" />;
    }
    return source ? <img src={source} alt="" loading="lazy" decoding="async" draggable={false} className="size-full object-cover" /> : <ImageIcon className="size-4" />;
}

function AssetPreviewModal({ node, onClose }: { node: CanvasNodeData | null; onClose: () => void }) {
    const source = useNodeMediaSource(node);
    return (
        <Modal title={node?.title || "资产预览"} open={Boolean(node)} onCancel={onClose} footer={null} width={880} centered destroyOnHidden>
            {node ? (
                <div className="grid min-h-56 place-items-center overflow-hidden rounded-lg bg-black/[0.035] p-3 dark:bg-white/[0.035]" data-canvas-no-zoom>
                    {node.type === CanvasNodeType.Video && source ? <video src={source} controls autoPlay playsInline className="max-h-[68vh] max-w-full rounded-md" />
                        : node.type === CanvasNodeType.Audio && source ? <audio src={source} controls autoPlay className="w-full max-w-xl" />
                            : source ? <img src={source} alt={node.title || "资产预览"} className="max-h-[68vh] max-w-full object-contain" />
                                : <span className="text-sm text-foreground/45">当前资产没有可预览的媒体内容</span>}
                </div>
            ) : null}
        </Modal>
    );
}

function useNodeMediaSource(node: CanvasNodeData | null) {
    const fallback = node ? node.metadata?.workflowKind === "character"
        ? node.metadata.characterCoverUrl || ""
        : node.type === CanvasNodeType.Drawing
            ? node.metadata?.drawingPreviewUrl || node.metadata?.content || ""
            : node.metadata?.content || "" : "";
    const storageKey = node?.metadata?.storageKey;
    const [source, setSource] = useState(fallback);
    useEffect(() => {
        let cancelled = false;
        setSource(fallback);
        if (storageKey) void resolveMediaUrl(storageKey, fallback).then((url) => {
            if (!cancelled) setSource(url || fallback);
        }).catch(() => {
            if (!cancelled) setSource(fallback);
        });
        return () => { cancelled = true; };
    }, [fallback, storageKey]);
    return source;
}
