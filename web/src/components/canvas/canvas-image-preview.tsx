import { useEffect, useState } from "react";
import { Image as ImageIcon, LoaderCircle } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { resolveImageUrl } from "@/services/image-storage";

type CanvasImagePreviewProps = {
    src?: string;
    storageKey?: string;
    alt?: string;
    onClose: () => void;
};

export function CanvasImagePreview({ src = "", storageKey, alt = "图片", onClose }: CanvasImagePreviewProps) {
    const [resolvedSrc, setResolvedSrc] = useState(storageKey ? "" : src);
    const [loading, setLoading] = useState(Boolean(src || storageKey));
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setResolvedSrc(storageKey ? "" : src);
        setLoading(Boolean(src || storageKey));
        setError(false);
        if (!src && !storageKey) return () => {
            cancelled = true;
        };
        void resolveImageUrl(storageKey, src)
            .then((url) => {
                if (cancelled) return;
                if (!url) {
                    setLoading(false);
                    setError(true);
                    return;
                }
                setResolvedSrc(url);
            })
            .catch(() => {
                if (!cancelled) {
                    setLoading(false);
                    setError(true);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [src, storageKey]);

    if (!src && !storageKey) return null;

    return (
        <AppModal
            open
            flush
            title={
                <div className="flex min-w-0 items-center gap-2.5">
                    <span
                        className="grid size-7 shrink-0 place-items-center rounded-[var(--r-sm)] border"
                        style={{
                            borderColor: "var(--workspace-border)",
                            background: "color-mix(in srgb, var(--workspace-surface-strong) 72%, var(--workspace-surface))",
                            color: "var(--workspace-text-muted)",
                        }}
                    >
                        <ImageIcon className="size-4" />
                    </span>
                    <span className="min-w-0 truncate text-sm font-semibold" title={alt}>{alt}</span>
                </div>
            }
            footer={null}
            centered
            width="min(1160px, calc(100vw - 32px))"
            onCancel={onClose}
            className="canvas-image-preview-modal"
        >
            <div
                className="flex min-h-[min(72vh,680px)] items-center justify-center border-t p-4 sm:p-6"
                style={{
                    borderColor: "var(--workspace-border)",
                    background: "color-mix(in srgb, var(--workspace-surface) 86%, var(--background))",
                }}
            >
                <div
                    className="relative flex min-h-[min(62vh,560px)] w-full items-center justify-center overflow-hidden rounded-[var(--r-lg)] border p-3 sm:p-5"
                    style={{
                        borderColor: "var(--workspace-border-strong)",
                        background: "var(--workspace-surface-strong)",
                        boxShadow: "inset 0 1px 0 color-mix(in srgb, var(--foreground) 5%, transparent), 0 18px 50px color-mix(in srgb, var(--foreground) 14%, transparent)",
                    }}
                >
                    {loading && !error ? (
                        <div
                            className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                            style={{
                                borderColor: "var(--workspace-border)",
                                background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                            }}
                            role="status"
                            aria-label="图片加载中"
                        >
                            <div className="flex flex-col items-center gap-3" style={{ color: "var(--workspace-text-muted)" }}>
                                <span className="grid size-11 place-items-center rounded-full border bg-[var(--workspace-surface-strong)]" style={{ borderColor: "var(--workspace-border)" }}>
                                    <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" />
                                </span>
                                <span className="text-xs font-medium">正在加载高清图片</span>
                            </div>
                        </div>
                    ) : null}
                    {error ? (
                        <div
                            className="absolute inset-3 grid place-items-center rounded-[var(--r-md)] border border-dashed sm:inset-5"
                            style={{
                                borderColor: "var(--workspace-border-strong)",
                                background: "color-mix(in srgb, var(--workspace-surface-strong) 68%, var(--workspace-surface))",
                                color: "var(--workspace-text-muted)",
                            }}
                            role="alert"
                        >
                            <div className="flex flex-col items-center gap-3 text-center">
                                <ImageIcon className="size-8 opacity-45" />
                                <div>
                                    <div className="text-sm font-medium">图片暂时无法显示</div>
                                    <div className="mt-1 text-xs opacity-70">请关闭预览后重试</div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {resolvedSrc ? (
                        <img
                            src={resolvedSrc}
                            alt={alt}
                            draggable={false}
                            className={`max-h-[min(66vh,620px)] max-w-full rounded-[var(--r-sm)] border object-contain shadow-xl transition-opacity duration-200 motion-reduce:transition-none ${loading || error ? "opacity-0" : "opacity-100"}`}
                            style={{ borderColor: "var(--workspace-border-strong)" }}
                            onLoad={() => {
                                setLoading(false);
                                setError(false);
                            }}
                            onError={() => {
                                setLoading(false);
                                setError(true);
                            }}
                        />
                    ) : null}
                </div>
            </div>
        </AppModal>
    );
}
