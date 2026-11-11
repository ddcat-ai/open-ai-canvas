import { useCallback, useEffect, useRef, useState } from "react";
import { Image as ImageIcon, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { AppModal } from "@/components/ui/product/app-modal";
import { resolveImageUrl } from "@/services/image-storage";
import { useCachedResourceUrl } from "@/hooks/use-cached-resource-url";

type CanvasImagePreviewProps = {
    src?: string;
    storageKey?: string;
    alt?: string;
    onClose: () => void;
};

const INITIAL_ZOOM = { scale: 1, x: 0, y: 0 };
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

export function CanvasImagePreview({ src = "", storageKey, alt: altProp, onClose }: CanvasImagePreviewProps) {
    const { t } = useTranslation();
    const alt = altProp ?? t("canvasB.common.image");
    const cachedUrl = useCachedResourceUrl(storageKey);
    const [resolvedSrc, setResolvedSrc] = useState(storageKey ? "" : src);
    const [loading, setLoading] = useState(Boolean(src || storageKey));
    const [error, setError] = useState(false);
    const [zoom, setZoom] = useState(INITIAL_ZOOM);
    const zoomRef = useRef(INITIAL_ZOOM);
    const imageRef = useRef<HTMLImageElement>(null);
    const stageRef = useRef<HTMLDivElement>(null);
    const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState(false);

    const bindWheel = useCallback(
        (element: HTMLDivElement | null) => {
            if (!element) return;
            const handleWheel = (event: WheelEvent) => {
                event.preventDefault();
                event.stopPropagation();
                if (loading || error || event.target !== imageRef.current || !stageRef.current || !Number.isFinite(event.deltaY)) return;
                const rect = stageRef.current.getBoundingClientRect();
                const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1;
                const delta = Math.max(-100, Math.min(100, event.deltaY * unit));
                const previous = zoomRef.current;
                const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, previous.scale * Math.exp(-delta * 0.002)));
                if (scale === previous.scale) return;
                const ratio = scale / previous.scale;
                const pointerX = event.clientX - rect.left - rect.width / 2;
                const pointerY = event.clientY - rect.top - rect.height / 2;
                // 保持鼠标下的图像位置不变；状态 ref 同步累积连续滚轮事件。
                const next = {
                    scale,
                    x: pointerX - (pointerX - previous.x) * ratio,
                    y: pointerY - (pointerY - previous.y) * ratio,
                };
                zoomRef.current = next;
                setZoom(next);
            };
            // React 的委托 wheel 监听是 passive，原生监听才能阻止页面/浏览器缩放。
            element.addEventListener("wheel", handleWheel, { passive: false });
            return () => element.removeEventListener("wheel", handleWheel);
        },
        [loading, error],
    );

    useEffect(() => {
        let cancelled = false;
        // 本会话刚上传的图片直接用内存中的原图 Blob，打开预览不再等待服务器回传。
        const localSrc = cachedUrl;
        setResolvedSrc(storageKey ? localSrc : src);
        setLoading(Boolean(src || storageKey));
        setError(false);
        zoomRef.current = INITIAL_ZOOM;
        setZoom(INITIAL_ZOOM);
        dragRef.current = null;
        setDragging(false);
        if (localSrc || (!src && !storageKey))
            return () => {
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
    }, [src, storageKey, cachedUrl]);

    if (!src && !storageKey) return null;

    return (
        <AppModal open flush title={alt} footer={null} centered width="fit-content" onCancel={onClose} className="canvas-image-preview-modal" classNames={{ header: "sr-only" }}>
            <div ref={bindWheel} data-canvas-no-zoom className="relative grid max-w-[94vw] place-items-center overflow-visible overscroll-contain">
                <div ref={stageRef} className="relative grid max-h-[84vh] max-w-[94vw] place-items-center">
                    {loading && !error ? (
                        <span
                            className="absolute left-1/2 top-4 z-10 inline-flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-2 text-xs font-medium text-white"
                            style={{ background: "color-mix(in srgb, black 64%, transparent)" }}
                            role="status"
                            aria-label={t("canvasB.imagePreview.loadingLabel")}
                        >
                            <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
                            {t("canvasB.imagePreview.loadingHd")}
                        </span>
                    ) : null}
                    {error ? (
                        <div className="absolute inset-0 z-10 grid place-items-center" role="alert">
                            <div className="flex items-center gap-2 rounded-full px-4 py-2 text-sm text-white" style={{ background: "color-mix(in srgb, black 68%, transparent)" }}>
                                <ImageIcon className="size-4 opacity-80" />
                                <div>
                                    <div className="font-medium">{t("canvasB.imagePreview.unavailable")}</div>
                                    <div className="text-xs opacity-75">{t("canvasB.imagePreview.retryHint")}</div>
                                </div>
                            </div>
                        </div>
                    ) : null}
                    {resolvedSrc ? (
                        <img
                            key={resolvedSrc}
                            ref={imageRef}
                            src={resolvedSrc}
                            alt={alt}
                            title="滚轮缩放，拖动查看"
                            draggable={false}
                            className={`block max-h-[84vh] max-w-[94vw] select-none rounded-[var(--r-sm)] object-contain transition-opacity duration-200 motion-reduce:transition-none ${loading || error ? "opacity-0" : "opacity-100"}`}
                            style={{
                                boxShadow: "var(--shadow-lg)",
                                transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})`,
                                transformOrigin: "center",
                                touchAction: "none",
                                cursor: loading || error ? undefined : dragging ? "grabbing" : "grab",
                            }}
                            onPointerDown={(event) => {
                                if (loading || error || event.button !== 0) return;
                                event.preventDefault();
                                event.stopPropagation();
                                event.currentTarget.setPointerCapture(event.pointerId);
                                dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                                setDragging(true);
                            }}
                            onPointerMove={(event) => {
                                const drag = dragRef.current;
                                if (!drag || drag.pointerId !== event.pointerId) return;
                                event.preventDefault();
                                event.stopPropagation();
                                const next = { ...zoomRef.current, x: zoomRef.current.x + event.clientX - drag.x, y: zoomRef.current.y + event.clientY - drag.y };
                                dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
                                zoomRef.current = next;
                                setZoom(next);
                            }}
                            onPointerUp={(event) => {
                                if (dragRef.current?.pointerId !== event.pointerId) return;
                                event.stopPropagation();
                                dragRef.current = null;
                                setDragging(false);
                                if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                            }}
                            onPointerCancel={() => {
                                dragRef.current = null;
                                setDragging(false);
                            }}
                            onLostPointerCapture={() => {
                                dragRef.current = null;
                                setDragging(false);
                            }}
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
