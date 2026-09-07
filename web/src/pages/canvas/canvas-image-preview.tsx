import { useEffect, useMemo, useState } from "react";
import { Check, Clipboard, Download, X } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { formatBytes, getDataUrlByteSize } from "@/lib/image-utils";
import { modelDisplayName, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

type CanvasImagePreviewTheme = {
    node: {
        text: string;
        muted: string;
        panel: string;
        fill: string;
        stroke: string;
    };
};

type CanvasImagePreviewProps = {
    open: boolean;
    node: CanvasNodeData | null;
    theme: CanvasImagePreviewTheme;
    onClose: () => void;
    onDownload: (node: CanvasNodeData) => void;
};

export function CanvasImagePreview({ open, node, theme, onClose, onDownload }: CanvasImagePreviewProps) {
    const config = useEffectiveConfig();
    const [loadedSize, setLoadedSize] = useState<{ nodeId: string; width: number; height: number } | null>(null);
    const [copiedPrompt, setCopiedPrompt] = useState(false);
    const currentNode = node?.type === CanvasNodeType.Image && node.metadata?.content ? node : null;
    const prompt = currentNode?.metadata?.prompt?.trim() || currentNode?.metadata?.composerContent?.trim() || "";
    const model = currentNode?.metadata?.model?.trim();
    const modelLabel = model ? modelDisplayName(config, model) : currentNode?.metadata?.workflowProvider || "未记录";
    const dimensions = useMemo(() => {
        if (!currentNode) return null;
        const width = loadedSize?.nodeId === currentNode.id ? loadedSize.width : currentNode.metadata?.naturalWidth;
        const height = loadedSize?.nodeId === currentNode.id ? loadedSize.height : currentNode.metadata?.naturalHeight;
        return width && height ? `${Math.round(width)} × ${Math.round(height)}` : "未记录";
    }, [currentNode, loadedSize]);
    const bytes = currentNode ? currentNode.metadata?.bytes || getDataUrlByteSize(currentNode.metadata?.content || "") : 0;
    const generationTime = currentNode?.metadata?.taskCompletedAt || currentNode?.updatedAt || currentNode?.createdAt;

    useEffect(() => {
        if (!open) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [onClose, open]);

    useEffect(() => {
        setCopiedPrompt(false);
        setLoadedSize(null);
    }, [currentNode?.id]);

    if (!open || !currentNode) return null;

    const copyPrompt = () => {
        if (!prompt || !navigator.clipboard?.writeText) return;
        void navigator.clipboard.writeText(prompt).then(() => {
            setCopiedPrompt(true);
            window.setTimeout(() => setCopiedPrompt(false), 1600);
        }).catch(() => undefined);
    };

    return (
        <div
            className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center bg-black/80 p-3 sm:p-6"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={`${currentNode.title || "图片"}预览`}
                className="flex h-[min(900px,calc(100vh-24px))] w-full max-w-[1400px] overflow-hidden rounded-2xl border shadow-2xl sm:h-[min(900px,calc(100vh-48px))]"
                style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <section className="relative flex min-w-0 flex-1 items-center justify-center bg-black/20">
                    <div className="canvas-image-preview-main relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden px-8 py-8 sm:px-14">
                        <CachedResourceImage
                            storageKey={currentNode.metadata?.storageKey}
                            src={currentNode.metadata?.content || ""}
                            alt={currentNode.title || "图片预览"}
                            eager
                            className="block h-full w-auto max-w-full select-none object-contain"
                            onLoad={(event) => {
                                const image = event.currentTarget;
                                setLoadedSize({ nodeId: currentNode.id, width: image.naturalWidth, height: image.naturalHeight });
                            }}
                        />
                    </div>
                </section>

                <aside className="flex w-[min(340px,34vw)] shrink-0 flex-col border-l" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex h-14 shrink-0 items-center justify-between border-b px-5" style={{ borderColor: theme.node.stroke }}>
                        <div className="min-w-0 text-sm font-medium">生成信息</div>
                        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-white/10" aria-label="关闭图片预览" onClick={onClose}>
                            <X className="size-4" />
                        </button>
                    </div>

                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-5">
                        <InfoRow label="模型" value={modelLabel} />
                        <div className="mt-5">
                            <div className="mb-2 flex items-center justify-between text-xs" style={{ color: theme.node.muted }}>
                                <span>提示词</span>
                                {prompt ? <button type="button" className="inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs transition hover:bg-white/10" aria-label="复制提示词" onClick={copyPrompt}>{copiedPrompt ? <Check className="size-3" /> : <Clipboard className="size-3" />}{copiedPrompt ? "已复制" : "复制"}</button> : null}
                            </div>
                            <div className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs leading-5" style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.muted }}>
                                {prompt || "未记录提示词"}
                            </div>
                        </div>

                        <div className="mt-6">
                            <div className="mb-3 text-xs" style={{ color: theme.node.muted }}>生成时间</div>
                            <div className="text-sm">{formatDateTime(generationTime)}</div>
                        </div>

                        <div className="mt-7 border-t pt-5" style={{ borderColor: theme.node.stroke }}>
                            <div className="mb-3 text-xs" style={{ color: theme.node.muted }}>图片信息</div>
                            <div className="grid grid-cols-[1fr_auto] gap-y-3 text-sm">
                                <span style={{ color: theme.node.muted }}>尺寸</span><span>{dimensions}</span>
                                <span style={{ color: theme.node.muted }}>大小</span><span>{formatBytes(bytes) || "未记录"}</span>
                                <span style={{ color: theme.node.muted }}>格式</span><span>{formatMimeType(currentNode.metadata?.mimeType)}</span>
                            </div>
                        </div>
                    </div>

                    <div className="shrink-0 border-t p-5" style={{ borderColor: theme.node.stroke }}>
                        <button type="button" className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-medium transition hover:bg-white/85" style={{ color: "var(--color-neutral-950)" }} onClick={() => onDownload(currentNode)}>
                            <Download className="size-4" />
                            下载图片
                        </button>
                    </div>
                </aside>
            </div>
        </div>
    );
}

function InfoRow({ label, value }: { label: string; value: string }) {
    return <div className="flex items-center justify-between gap-4 text-sm"><span className="shrink-0 text-xs opacity-55">{label}</span><span className="min-w-0 truncate text-right">{value}</span></div>;
}

function formatDateTime(value?: string) {
    if (!value) return "未记录";
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}

function formatMimeType(value?: string) {
    const mime = value?.split(";", 1)[0]?.trim();
    if (!mime) return "图片";
    return mime.replace(/^image\//, "").toUpperCase();
}
