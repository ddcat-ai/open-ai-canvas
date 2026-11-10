import { useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ArrowLeftRight } from "lucide-react";

/** 临时对比视图，位置只属于当前预览，不写入画布或媒体版本。 */
export function CanvasImageComparison({ before, after, beforeLabel, afterLabel, label = "图片对比分隔线" }: { before: ReactNode; after: ReactNode; beforeLabel: ReactNode; afterLabel: ReactNode; label?: string }) {
    const [split, setSplit] = useState(50);
    const host = useRef<HTMLDivElement>(null);
    const move = (event: PointerEvent<HTMLDivElement>) => {
        const rect = host.current?.getBoundingClientRect();
        if (rect?.width) setSplit(Math.min(100, Math.max(0, ((event.clientX - rect.left) / rect.width) * 100)));
    };
    const finish = (event: PointerEvent<HTMLDivElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    };
    return (
        <div
            ref={host}
            className="relative size-full cursor-ew-resize touch-none select-none overflow-hidden"
            data-canvas-no-zoom
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
                if (event.button !== 0 || !event.isPrimary) return;
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                move(event);
            }}
            onPointerMove={(event) => {
                if (event.currentTarget.hasPointerCapture(event.pointerId)) move(event);
            }}
            onPointerUp={finish}
            onPointerCancel={finish}
        >
            <div className="absolute inset-0">{after}</div>
            <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}>
                {before}
            </div>
            <div
                role="slider"
                tabIndex={0}
                aria-label={label}
                aria-orientation="horizontal"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(split)}
                className="absolute inset-y-0 z-[1] w-0.5 -translate-x-1/2 bg-[var(--btn-solid-bg)] outline-none focus-visible:ring-2"
                style={{ left: `${split}%` }}
                onKeyDown={(event) => {
                    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
                    event.preventDefault();
                    event.stopPropagation();
                    setSplit((value) => (event.key === "Home" ? 0 : event.key === "End" ? 100 : Math.min(100, Math.max(0, value + (event.key === "ArrowRight" ? 5 : -5)))));
                }}
            >
                <span className="absolute left-1/2 top-1/2 grid size-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-[var(--btn-solid-bg)] text-[var(--btn-solid-fg)]">
                    <ArrowLeftRight className="size-4" aria-hidden />
                </span>
            </div>
            <span className="pointer-events-none absolute bottom-3 left-3 max-w-[45%] truncate rounded-[var(--r-sm)] bg-[var(--workspace-surface)] px-2 py-1 text-xs text-[var(--foreground)]">{beforeLabel}</span>
            <span className="pointer-events-none absolute bottom-3 right-3 max-w-[45%] truncate rounded-[var(--r-sm)] bg-[var(--workspace-surface)] px-2 py-1 text-xs text-[var(--foreground)]">{afterLabel}</span>
        </div>
    );
}
