import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { resolveCanvasAppearance, resolveCanvasGridColor, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { resolveCanvasPointerIntent } from "@/lib/canvas/canvas-selection";
import { isDiscreteCanvasWheel } from "@/lib/canvas/canvas-wheel";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { applyCanvasLiveViewport, CANVAS_GRID_BLEED, canvasGridMetrics, subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import type { ViewportTransform } from "@/types/canvas";

type CanvasViewportProps = {
    interactive?: boolean;
    containerRef: React.RefObject<HTMLDivElement | null>;
    viewport: ViewportTransform;
    appearance?: CanvasAppearance;
    backgroundMode?: CanvasBackgroundMode;
    onViewportChange: (viewport: ViewportTransform) => void;
    onSelectedImageWheel?: (deltaPixels: number) => boolean;
    onViewportPreviewChange?: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    boxSelectEnabled?: boolean;
    onCanvasDoubleClick?: (event: React.MouseEvent<HTMLDivElement>) => void;
    onCanvasDeselect?: () => void;
    onContextMenu?: (event: React.MouseEvent) => void;
    onDrop?: (event: React.DragEvent<HTMLDivElement>) => void;
    onFileDragEnter?: (event: React.DragEvent<HTMLDivElement>) => void;
    onFileDragLeave?: (event: React.DragEvent<HTMLDivElement>) => void;
    onFileDragOver?: (event: React.DragEvent<HTMLDivElement>) => void;
    children: React.ReactNode;
    graphicsLayer?: React.ReactNode;
};

const CANVAS_WHEEL_IGNORE_SELECTOR = "input,textarea,select,[contenteditable]:not([contenteditable='false']),[data-canvas-no-zoom],[data-canvas-wheel-scroll],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const CANVAS_POINTER_IGNORE_SELECTOR = "[data-canvas-no-zoom],[data-connection-create-menu],.ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown";
const CANVAS_INTERNAL_DRAG_SELECTOR = "[data-canvas-batch-table]";
const WHEEL_ZOOM_DELTA = 72;
const TRACKPAD_PINCH_ZOOM_DELTA = 24;

type TouchPoint = { x: number; y: number };

type PinchState = {
    active: boolean;
    pointerIds: [number, number];
    initialDistance: number;
    worldX: number;
    worldY: number;
    initialScale: number;
};

export function CanvasViewport({
    interactive = true,
    containerRef,
    viewport,
    appearance,
    backgroundMode = "dots",
    onViewportChange,
    onSelectedImageWheel,
    onViewportPreviewChange,
    onCanvasMouseDown,
    boxSelectEnabled = false,
    onCanvasDoubleClick,
    onCanvasDeselect,
    onContextMenu,
    onDrop,
    onFileDragEnter,
    onFileDragLeave,
    onFileDragOver,
    graphicsLayer,
    children,
}: CanvasViewportProps) {
    const colorTheme = useActiveTheme();
    const resolvedAppearance = resolveCanvasAppearance(appearance, colorTheme);
    const panState = useRef({
        isPanning: false,
        pointerId: -1,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const viewportRef = useRef(viewport);
    const scaleRef = useRef(viewport.k);
    const containerRectRef = useRef<DOMRect | null>(null);
    const frameRef = useRef<number | null>(null);
    const nextViewportRef = useRef<ViewportTransform | null>(null);
    const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastPreviewNotifyRef = useRef(0);
    const interactingRef = useRef(false);
    const touchPointsRef = useRef(new Map<number, TouchPoint>());
    const pinchStateRef = useRef<PinchState>({ active: false, pointerIds: [-1, -1], initialDistance: 1, worldX: 0, worldY: 0, initialScale: viewport.k });
    const spacePressedRef = useRef(false);
    const controlPressedRef = useRef(false);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useLayoutEffect(() => {
        if (interactive) return;
        const container = containerRef.current;
        for (const id of [panState.current.pointerId, ...touchPointsRef.current.keys()]) {
            if (container?.hasPointerCapture(id)) container.releasePointerCapture(id);
        }
        panState.current.isPanning = false;
        pinchStateRef.current.active = false;
        touchPointsRef.current.clear();
        interactingRef.current = false;
        if (frameRef.current) cancelAnimationFrame(frameRef.current);
        if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
        frameRef.current = null;
        syncTimerRef.current = null;
        nextViewportRef.current = null;
        delete container?.dataset.canvasViewportInteracting;
        setIsPanning(false);
        setIsSpacePressed(false);
        document.body.style.cursor = "default";
    }, [interactive, containerRef]);

    useLayoutEffect(() => {
        if (interactingRef.current) return;
        viewportRef.current = viewport;
        scaleRef.current = viewport.k;
        applyCanvasLiveViewport(containerRef.current, viewport);
    }, [containerRef, viewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        return subscribeCanvasViewportPreview(container, (next) => {
            viewportRef.current = next;
            scaleRef.current = next.k;
        });
    }, [containerRef]);

    useEffect(
        () => () => {
            if (frameRef.current) cancelAnimationFrame(frameRef.current);
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
            delete containerRef.current?.dataset.canvasViewportInteracting;
            document.body.style.cursor = "";
        },
        [containerRef],
    );

    const syncViewport = useCallback(() => {
        if (interactive) onViewportChange(viewportRef.current);
    }, [interactive, onViewportChange]);

    const scheduleViewportChange = useCallback(
        (next: ViewportTransform, commitAfterIdle = false) => {
            viewportRef.current = next;
            scaleRef.current = next.k;
            onViewportPreviewChange?.(next);
            const container = containerRef.current;
            if (container) container.dataset.canvasViewportInteracting = "true";
            nextViewportRef.current = next;
            if (!frameRef.current)
                frameRef.current = requestAnimationFrame((now) => {
                    frameRef.current = null;
                    const pending = nextViewportRef.current;
                    if (!pending) return;
                    const notify = now - lastPreviewNotifyRef.current >= 32;
                    applyCanvasLiveViewport(containerRef.current, pending, notify);
                    if (notify) lastPreviewNotifyRef.current = now;
                });
            if (!commitAfterIdle) return;
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
            syncTimerRef.current = setTimeout(() => {
                interactingRef.current = false;
                delete containerRef.current?.dataset.canvasViewportInteracting;
                syncViewport();
                syncTimerRef.current = null;
            }, 120);
        },
        [containerRef, onViewportPreviewChange, syncViewport],
    );

    useEffect(() => {
        if (!interactive) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Control") controlPressedRef.current = true;
            if (event.code !== "Space") return;
            if (event.target instanceof Element && event.target.closest("input,textarea,select,button,[contenteditable='true']")) return;
            event.preventDefault();
            spacePressedRef.current = true;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.key === "Control") controlPressedRef.current = false;
            if (event.code !== "Space") return;
            spacePressedRef.current = false;
            setIsSpacePressed(false);
        };

        const handleBlur = () => {
            controlPressedRef.current = false;
            spacePressedRef.current = false;
            setIsSpacePressed(false);
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("keyup", handleKeyUp, true);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("keyup", handleKeyUp, true);
            window.removeEventListener("blur", handleBlur);
        };
    }, [interactive]);

    const handleWheel = useCallback(
        (event: WheelEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const deltaX = wheelDeltaToPixels(event.deltaX, event.deltaMode);
            const deltaY = wheelDeltaToPixels(event.deltaY, event.deltaMode);
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            const isPinchZoom = event.ctrlKey || event.metaKey;
            // Chromium also sets ctrlKey for touchpad pinch, but does not send a Control keydown.
            const editing = document.activeElement?.matches("input,textarea,select,[contenteditable]:not([contenteditable='false'])");
            if (event.ctrlKey && controlPressedRef.current && !event.metaKey && !event.shiftKey && !editing && !target?.closest(CANVAS_WHEEL_IGNORE_SELECTOR) && onSelectedImageWheel?.(deltaY)) {
                event.preventDefault();
                return;
            }
            if (target?.closest(CANVAS_WHEEL_IGNORE_SELECTOR) && !isPinchZoom) {
                // 内部区域保留纵向滚动，但横向手势不能泄漏为 macOS 浏览器前进/后退。
                if (event.shiftKey || absX > absY) event.preventDefault();
                return;
            }

            // Ctrl/Meta + 滚轮在画布内始终由画布接管，避免浮层区域触发浏览器页面缩放。
            event.preventDefault();
            interactingRef.current = true;
            const current = viewportRef.current;
            const looksLikeMouseWheel = isDiscreteCanvasWheel(event.deltaY, event.deltaMode);
            const looksLikeTrackpadPan = !isPinchZoom && (event.shiftKey || absX > 0 || (!looksLikeMouseWheel && absY > 0));

            if (looksLikeTrackpadPan) {
                const panX = event.shiftKey && absX < 1 ? deltaY : deltaX;
                scheduleViewportChange(
                    {
                        x: current.x - panX,
                        y: current.y - (event.shiftKey && absX < 1 ? 0 : deltaY),
                        k: current.k,
                    },
                    true,
                );
                return;
            }

            const rect = containerRectRef.current || containerRef.current?.getBoundingClientRect();
            if (!rect) return;
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            const zoomDelta = isPinchZoom && !looksLikeMouseWheel ? TRACKPAD_PINCH_ZOOM_DELTA : WHEEL_ZOOM_DELTA;
            const factor = Math.pow(1.1, -deltaY / zoomDelta);
            const newScale = clampScale(current.k * factor);
            const worldX = (mouseX - current.x) / current.k;
            const worldY = (mouseY - current.y) / current.k;

            scheduleViewportChange(
                {
                    x: mouseX - worldX * newScale,
                    y: mouseY - worldY * newScale,
                    k: newScale,
                },
                true,
            );
        },
        [containerRef, onSelectedImageWheel, scheduleViewportChange],
    );

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!interactive) return;
        const target = event.target instanceof Element ? event.target : null;
        // AntD 浮层通过 Portal 渲染到节点 DOM 之外；若不统一排除，会被误判为画布空白并捕获指针。
        if (target?.closest(CANVAS_POINTER_IGNORE_SELECTOR)) return;
        const isBackgroundClick = !target?.closest("[data-node-id],[data-connection-id]");
        const isTouch = event.pointerType === "touch";

        const pointerIntent = resolveCanvasPointerIntent({
            altKey: event.altKey,
            background: isBackgroundClick,
            boxSelectEnabled,
            button: event.button,
            ctrlKey: event.ctrlKey,
            metaKey: event.metaKey,
            pointerType: event.pointerType,
            shiftKey: event.shiftKey,
            spacePressed: spacePressedRef.current,
        });
        if (pointerIntent === "select") {
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            onCanvasMouseDown?.(event);
            return;
        }

        if (isTouch) {
            touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            if (touchPointsRef.current.size >= 2) {
                const [[firstId, first], [secondId, second]] = Array.from(touchPointsRef.current.entries());
                event.preventDefault();
                event.currentTarget.setPointerCapture(firstId);
                event.currentTarget.setPointerCapture(secondId);
                const rect = containerRectRef.current || event.currentTarget.getBoundingClientRect();
                const current = viewportRef.current;
                const centerX = (first.x + second.x) / 2 - rect.left;
                const centerY = (first.y + second.y) / 2 - rect.top;
                pinchStateRef.current = {
                    active: true,
                    pointerIds: [firstId, secondId],
                    initialDistance: Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1),
                    worldX: (centerX - current.x) / current.k,
                    worldY: (centerY - current.y) / current.k,
                    initialScale: current.k,
                };
                panState.current.isPanning = false;
                interactingRef.current = true;
                return;
            }

            if (!isBackgroundClick) return;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            if (!event.isPrimary) return;
            const current = viewportRef.current;
            interactingRef.current = true;
            panState.current = {
                isPanning: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                initialX: current.x,
                initialY: current.y,
                hasMoved: false,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
            return;
        }

        if (pointerIntent === "pan") {
            const current = viewportRef.current;
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            interactingRef.current = true;
            panState.current = {
                isPanning: true,
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                initialX: current.x,
                initialY: current.y,
                hasMoved: false,
            };
            setIsPanning(true);
            document.body.style.cursor = "grabbing";
        }
    };

    useEffect(() => {
        if (!interactive) return;
        const handlePointerMove = (event: PointerEvent) => {
            if (event.pointerType === "touch" && touchPointsRef.current.has(event.pointerId)) {
                touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
                const pinch = pinchStateRef.current;
                if (pinch.active) {
                    const first = touchPointsRef.current.get(pinch.pointerIds[0]);
                    const second = touchPointsRef.current.get(pinch.pointerIds[1]);
                    const rect = containerRectRef.current || containerRef.current?.getBoundingClientRect();
                    if (!first || !second || !rect) return;
                    event.preventDefault();
                    const centerX = (first.x + second.x) / 2 - rect.left;
                    const centerY = (first.y + second.y) / 2 - rect.top;
                    const distance = Math.max(Math.hypot(second.x - first.x, second.y - first.y), 1);
                    const scale = clampScale(pinch.initialScale * (distance / pinch.initialDistance));
                    scheduleViewportChange({
                        x: centerX - pinch.worldX * scale,
                        y: centerY - pinch.worldY * scale,
                        k: scale,
                    });
                    return;
                }
            }

            if (!panState.current.isPanning || panState.current.pointerId !== event.pointerId) return;

            const dx = event.clientX - panState.current.startX;
            const dy = event.clientY - panState.current.startY;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
                panState.current.hasMoved = true;
            }

            scheduleViewportChange({
                x: panState.current.initialX + dx,
                y: panState.current.initialY + dy,
                k: scaleRef.current,
            });
        };

        const handlePointerEnd = (event: PointerEvent) => {
            if (event.pointerType === "touch" && pinchStateRef.current.active && pinchStateRef.current.pointerIds.includes(event.pointerId)) {
                pinchStateRef.current.active = false;
                touchPointsRef.current.clear();
                panState.current.isPanning = false;
                panState.current.pointerId = -1;
                interactingRef.current = false;
                if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
                delete containerRef.current?.dataset.canvasViewportInteracting;
                syncViewport();
                setIsPanning(false);
                document.body.style.cursor = "";
                return;
            }

            if (event.pointerType === "touch") touchPointsRef.current.delete(event.pointerId);
            if (!panState.current.isPanning || panState.current.pointerId !== event.pointerId) return;

            if (event.type === "pointerup" && !panState.current.hasMoved) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            panState.current.pointerId = -1;
            interactingRef.current = false;
            if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
            delete containerRef.current?.dataset.canvasViewportInteracting;
            syncViewport();
            setIsPanning(false);
            document.body.style.cursor = "";
        };

        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerEnd);
        window.addEventListener("pointercancel", handlePointerEnd);
        return () => {
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", handlePointerEnd);
            window.removeEventListener("pointercancel", handlePointerEnd);
        };
    }, [interactive, containerRef, onCanvasDeselect, scheduleViewportChange, syncViewport]);

    useEffect(() => {
        const container = containerRef.current;
        if (!container || !interactive) return;
        const updateRect = () => {
            containerRectRef.current = container.getBoundingClientRect();
        };
        updateRect();
        const observer = new ResizeObserver(updateRect);
        observer.observe(container);
        window.addEventListener("resize", updateRect);
        container.addEventListener("wheel", handleWheel, { passive: false, capture: true });
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateRect);
            container.removeEventListener("wheel", handleWheel, { capture: true });
        };
    }, [interactive, containerRef, handleWheel]);

    return (
        <div
            ref={containerRef}
            data-canvas-viewport
            data-popover-anchor-container
            data-canvas-pan-state={isPanning ? "grabbing" : isSpacePressed || !boxSelectEnabled ? "grab" : undefined}
            className={`relative h-full w-full select-none overflow-clip touch-none ${isPanning ? "cursor-grabbing" : isSpacePressed || !boxSelectEnabled ? "cursor-grab" : "canvas-cursor-select"}`}
            style={
                {
                    background: resolvedAppearance.background,
                    overscrollBehavior: "none",
                    "--canvas-live-x": `${viewport.x}px`,
                    "--canvas-live-y": `${viewport.y}px`,
                    "--canvas-live-scale": viewport.k,
                    "--canvas-live-inverse-scale": 1 / Math.max(viewport.k, 0.05),
                    "--canvas-committed-scale": viewport.k,
                    "--canvas-live-scale-ratio": 1,
                } as React.CSSProperties
            }
            onPointerDown={handlePointerDown}
            onDoubleClick={(event) => {
                const target = event.target instanceof Element ? event.target : null;
                if (!target?.closest("[data-node-id],[data-connection-id],[data-canvas-no-zoom]")) onCanvasDoubleClick?.(event);
            }}
            onContextMenu={onContextMenu}
            onDragEnter={(event) => {
                if (isCanvasInternalDragEvent(event)) {
                    event.preventDefault();
                    onFileDragEnter?.(event);
                    return;
                }
                onFileDragEnter?.(event);
            }}
            onDragLeave={(event) => {
                if (isCanvasInternalDragEvent(event)) {
                    event.preventDefault();
                    onFileDragLeave?.(event);
                    return;
                }
                onFileDragLeave?.(event);
            }}
            onDragOver={(event) => {
                if (isCanvasInternalDragEvent(event)) {
                    event.preventDefault();
                    onFileDragOver?.(event);
                    return;
                }
                event.preventDefault();
                onFileDragOver?.(event);
            }}
            onDrop={(event) => {
                if (isCanvasInternalDragEvent(event)) {
                    event.preventDefault();
                    return;
                }
                onDrop?.(event);
            }}
        >
            <CanvasGrid appearance={appearance} mode={backgroundMode} viewport={viewport} />
            {graphicsLayer}
            <div data-canvas-world-layer data-popover-anchor-container className="canvas-world-layer absolute origin-top-left">
                <div data-canvas-world-raster-layer data-popover-anchor-container className="canvas-world-raster-layer absolute origin-top-left">
                    {children}
                </div>
            </div>
        </div>
    );
}

function isCanvasInternalDragEvent(event: React.DragEvent<HTMLDivElement>) {
    const target = event.target instanceof Element ? event.target : null;
    return Boolean(target?.closest(CANVAS_INTERNAL_DRAG_SELECTOR));
}

const CANVAS_GRID_BASE: Record<Exclude<CanvasBackgroundMode, "blank">, number> = { dots: 24, lines: 32 };

export function CanvasGrid({ appearance, mode, viewport }: { appearance?: CanvasAppearance; mode: CanvasBackgroundMode; viewport: ViewportTransform }) {
    const colorTheme = useActiveTheme();
    const gridColor = resolveCanvasGridColor(appearance, colorTheme, mode);
    if (mode === "blank") return null;
    const base = CANVAS_GRID_BASE[mode];
    const backgroundImage = mode === "dots" ? `radial-gradient(circle, ${gridColor} 1px, transparent 1.4px)` : `linear-gradient(${gridColor} 1px, transparent 1px), linear-gradient(90deg, ${gridColor} 1px, transparent 1px)`;
    // 首帧和提交后的位置由 render 给出；交互期由 applyCanvasLiveViewport 直接写 transform，不触发 React。
    const { spacing, offsetX, offsetY } = canvasGridMetrics(viewport, base);

    return (
        <div
            data-canvas-grid-layer
            data-canvas-grid-base={base}
            aria-hidden
            className="pointer-events-none absolute"
            style={{
                top: -CANVAS_GRID_BLEED,
                left: -CANVAS_GRID_BLEED,
                right: 0,
                bottom: 0,
                backgroundImage,
                backgroundSize: `${spacing}px ${spacing}px`,
                transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`,
                opacity: mode === "dots" ? 0.62 : 0.4,
            }}
        />
    );
}

function wheelDeltaToPixels(delta: number, deltaMode: number) {
    if (deltaMode === 1) return delta * 16;
    if (deltaMode === 2) return delta * 720;
    return delta;
}

function clampScale(scale: number) {
    return Math.min(Math.max(scale, 0.05), 2);
}
