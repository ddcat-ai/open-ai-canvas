import { Button } from "antd";
import { ChevronLeft, ChevronRight, Download, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import { resourceFileUrl } from "@/services/api/resources";

type ImageItem = { resourceId: string; title: string; caption?: string };
type View = { scale: number; x: number; y: number };
const fitted: View = { scale: 1, x: 0, y: 0 };

function ImageViewport({ item }: { item: ImageItem }) {
    const host = useRef<HTMLDivElement>(null);
    const image = useRef<HTMLImageElement>(null);
    const drag = useRef<{ id: number; x: number; y: number } | null>(null);
    const [view, setView] = useState<View>(fitted);
    const [dragging, setDragging] = useState(false);
    const [failed, setFailed] = useState(false);
    const [loaded, setLoaded] = useState(false);

    const bounded = (next: View): View => {
        const box = host.current;
        const img = image.current;
        if (!box || !img?.naturalWidth) return next;
        const fit = Math.min(box.clientWidth / img.naturalWidth, box.clientHeight / img.naturalHeight);
        const maxX = Math.max(0, (img.naturalWidth * fit * next.scale - box.clientWidth) / 2);
        const maxY = Math.max(0, (img.naturalHeight * fit * next.scale - box.clientHeight) / 2);
        return { ...next, x: Math.max(-maxX, Math.min(maxX, next.x)), y: Math.max(-maxY, Math.min(maxY, next.y)) };
    };
    const zoom = (factor: number, x = 0, y = 0) =>
        setView((previous) => {
            const scale = Math.max(1, Math.min(8, previous.scale * factor));
            const ratio = scale / previous.scale;
            return bounded({ scale, x: x - (x - previous.x) * ratio, y: y - (y - previous.y) * ratio });
        });

    useEffect(() => {
        const box = host.current;
        if (!box) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            event.stopPropagation();
            if (!image.current?.complete || !image.current.naturalWidth) return;
            const rect = box.getBoundingClientRect();
            const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? box.clientHeight : 1);
            zoom(Math.exp(-Math.max(-120, Math.min(120, delta)) * 0.002), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
        };
        // 原生非 passive 监听保证滚轮只缩放图片，不滚动背景页面。
        box.addEventListener("wheel", wheel, { passive: false });
        const observer = new ResizeObserver(() => setView((previous) => bounded(previous)));
        observer.observe(box);
        return () => {
            box.removeEventListener("wheel", wheel);
            observer.disconnect();
        };
    }, []);

    const endDrag = () => {
        drag.current = null;
        setDragging(false);
    };
    return (
        <>
            <div
                ref={host}
                className="ect-image-viewport"
                data-zoom={view.scale}
                data-dragging={dragging || undefined}
                onPointerDown={(event) => {
                    if (event.button !== 0 || view.scale <= 1 || !loaded) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                    setDragging(true);
                }}
                onPointerMove={(event) => {
                    const previous = drag.current;
                    if (!previous || previous.id !== event.pointerId) return;
                    const dx = event.clientX - previous.x,
                        dy = event.clientY - previous.y;
                    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
                    setView((current) => bounded({ ...current, x: current.x + dx, y: current.y + dy }));
                }}
                onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
                    endDrag();
                }}
                onPointerCancel={endDrag}
                onLostPointerCapture={endDrag}
                onDoubleClick={() => setView(fitted)}
            >
                <img
                    ref={image}
                    src={resourceFileUrl(item.resourceId)}
                    alt={item.title}
                    draggable={false}
                    style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
                    onLoad={() => {
                        setLoaded(true);
                        setFailed(false);
                    }}
                    onError={() => {
                        setLoaded(false);
                        setFailed(true);
                    }}
                />
                {!loaded ? (
                    <span className="ect-image-state" role={failed ? "alert" : "status"}>
                        {failed ? "原图未能载入，可关闭后重新打开" : "正在载入原图…"}
                    </span>
                ) : null}
            </div>
            <div className="ect-image-tools" role="group" aria-label="图片缩放">
                <Button icon={<ZoomOut size={16} />} aria-label="缩小图片" disabled={view.scale <= 1 || !loaded} onClick={() => zoom(1 / 1.25)} />
                <output aria-live="polite">{Math.round(view.scale * 100)}%</output>
                <Button icon={<ZoomIn size={16} />} aria-label="放大图片" disabled={view.scale >= 8 || !loaded} onClick={() => zoom(1.25)} />
                <Button icon={<RotateCcw size={14} />} onClick={() => setView(fitted)}>
                    适应窗口
                </Button>
            </div>
        </>
    );
}

export function TryOnImageViewer({ items, index, onClose, onIndex }: { items: ImageItem[]; index: number; onClose: () => void; onIndex: (index: number) => void }) {
    const item = items[index];
    useEffect(() => {
        const keydown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]"))) return;
            if (event.key === "ArrowLeft" && index > 0) {
                event.preventDefault();
                onIndex(index - 1);
            }
            if (event.key === "ArrowRight" && index < items.length - 1) {
                event.preventDefault();
                onIndex(index + 1);
            }
        };
        window.addEventListener("keydown", keydown);
        return () => window.removeEventListener("keydown", keydown);
    }, [index, items.length, onIndex]);
    if (!item) return null;
    return (
        <AppModal open title={`${item.title}${items.length > 1 ? ` · ${index + 1}/${items.length}` : ""}`} footer={null} width="min(1800px, calc(100vw - 32px))" onCancel={onClose} centered className="ect-lightbox">
            <div className="ect-lightbox-body">
                <ImageViewport key={`${index}:${item.resourceId}`} item={item} />
                <button type="button" className="ect-lightbox-nav is-prev" disabled={index === 0} onClick={() => onIndex(index - 1)} aria-label="上一张">
                    <ChevronLeft size={22} />
                </button>
                <button type="button" className="ect-lightbox-nav is-next" disabled={index >= items.length - 1} onClick={() => onIndex(index + 1)} aria-label="下一张">
                    <ChevronRight size={22} />
                </button>
            </div>
            <footer className="ect-lightbox-foot">
                <span>
                    {item.caption}
                    <span className="ect-lightbox-help">滚轮缩放 · 放大后按住左键拖动 · 双击复位</span>
                </span>
                <Button href={`${resourceFileUrl(item.resourceId)}?download=1`} download icon={<Download size={14} />}>
                    下载原图
                </Button>
            </footer>
        </AppModal>
    );
}
