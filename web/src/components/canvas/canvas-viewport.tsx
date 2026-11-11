import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { resolveCanvasAppearance, resolveCanvasGridColor, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { resolveCanvasPointerIntent } from "@/lib/canvas/canvas-selection";
import { isDiscreteCanvasWheel } from "@/lib/canvas/canvas-wheel";
import { canvasWheelBelongsToViewport, canvasWheelIntentTarget, createCanvasWheelIntent } from "@/lib/canvas/canvas-wheel-intent";
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
    onViewportPreviewChange?: (viewport: ViewportTransform) => void;
    onCanvasMouseDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
    boxSelectEnabled?: boolean;
    panOverNodes?: boolean;
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
    onViewportPreviewChange,
    onCanvasMouseDown,
    boxSelectEnabled = false,
    panOverNodes = false,
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
        button: -1,
        startX: 0,
        startY: 0,
        initialX: 0,
        initialY: 0,
        hasMoved: false,
    });
    const suppressNextContextMenuRef = useRef(false);
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
    const wheelIntentRef = useRef(createCanvasWheelIntent<Element>());
    const spacePressedRef = useRef(false);
    const [isSpacePressed, setIsSpacePressed] = useState(false);
    const [isPanning, setIsPanning] = useState(false);

    useLayoutEffect(() => {
        if (interactive) return;
        const container = containerRef.current;
        for (const id of [panState.current.pointerId, ...touchPointsRef.current.keys()]) {
            if (container?.hasPointerCapture(id)) container.releasePointerCapture(id);
        }
        panState.current.isPanning = false;
        panState.current.button = -1;
        suppressNextContextMenuRef.current = false;
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
            if (event.code !== "Space") return;
            if (event.target instanceof Element && event.target.closest("input,textarea,select,button,[contenteditable='true']")) return;
            event.preventDefault();
            spacePressedRef.current = true;
            setIsSpacePressed(true);
        };

        const handleKeyUp = (event: KeyboardEvent) => {
            if (event.code !== "Space") return;
            spacePressedRef.current = false;
            setIsSpacePressed(false);
        };

        const handleBlur = () => {
            wheelIntentRef.current.reset();
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
            const container = containerRef.current;
            const target = event.target instanceof Element ? event.target : null;
            if (!container || event.defaultPrevented || !canvasWheelBelongsToViewport(target, container)) return;
            if (target?.closest(".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,[role='dialog'],[role='menu'],[role='listbox'],[data-canvas-resource-mention-menu]")) return;

            const deltaX = wheelDeltaToPixels(event.deltaX, event.deltaMode);
            const deltaY = wheelDeltaToPixels(event.deltaY, event.deltaMode);
            const absX = Math.abs(deltaX);
            const absY = Math.abs(deltaY);
            const isPinchZoom = event.ctrlKey || event.metaKey;
            const intentTarget = canvasWheelIntentTarget(target);
            const forceCanvas = isPinchZoom || event.shiftKey || absX > absY;
            const wheelOwner = wheelIntentRef.current.resolve(intentTarget, event, performance.now(), forceCanvas);
            if (intentTarget && wheelOwner === "scroll") return;
            if (!intentTarget && target?.closest(CANVAS_WHEEL_IGNORE_SELECTOR) && !isPinchZoom) {
                // 普通滚动仍留在既有输入、弹层和滚动面板边界内。
                if (event.shiftKey || absX > absY) event.preventDefault();
                return;
            }

            // Modifier wheel/pinch is canvas zoom only inside this canvas or its prompt panel.
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

            const rect = containerRectRef.current || container.getBoundingClientRect();
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
        [containerRef, scheduleViewportChange],
    );

    const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
        if (!interactive) return;
        // 若浏览器没有派发上一次拖动后的 contextmenu，下一次按下时丢弃过期抑制标记。
        suppressNextContextMenuRef.current = false;
        const target = event.target instanceof Element ? event.target : null;
        // AntD 浮层通过 Portal 渲染到节点 DOM 之外；若不统一排除，会被误判为画布空白并捕获指针。
        if (target?.closest(CANVAS_POINTER_IGNORE_SELECTOR)) return;
        const isBackgroundClick = panOverNodes || !target?.closest("[data-node-id],[data-connection-id]");
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
                button: event.button,
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
            // 保留右键单击的 contextmenu；右键拖动在移动后由 contextmenu 回调拦截。
            if (event.button !== 2) event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            interactingRef.current = true;
            panState.current = {
                isPanning: true,
                pointerId: event.pointerId,
                button: event.button,
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
                if (panState.current.button === 2) event.preventDefault();
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
                panState.current.button = -1;
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

            const { button, hasMoved } = panState.current;
            if (event.type === "pointerup" && button === 2 && hasMoved) {
                suppressNextContextMenuRef.current = true;
            }
            if (event.type === "pointerup" && button !== 2 && !hasMoved) {
                onCanvasDeselect?.();
            }
            panState.current.isPanning = false;
            panState.current.pointerId = -1;
            panState.current.button = -1;
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
        const handleWheelPointerMove = (event: PointerEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const belongs = canvasWheelBelongsToViewport(target, container);
            const promptEditorModal = target?.closest(".canvas-prompt-editor-modal");
            const popup = target?.closest(".ant-modal,.ant-popover,.ant-dropdown,.ant-select-dropdown,.ant-picker-dropdown,[role='dialog'],[role='menu'],[role='listbox'],[data-canvas-resource-mention-menu]");
            const intentTarget = belongs && (!popup || promptEditorModal) ? canvasWheelIntentTarget(target) : null;
            wheelIntentRef.current.move(intentTarget, event, performance.now());
        };
        updateRect();
        const observer = new ResizeObserver(updateRect);
        observer.observe(container);
        window.addEventListener("resize", updateRect);
        window.addEventListener("pointermove", handleWheelPointerMove, true);
        window.addEventListener("wheel", handleWheel, { passive: false, capture: true });
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", updateRect);
            window.removeEventListener("pointermove", handleWheelPointerMove, true);
            window.removeEventListener("wheel", handleWheel, { capture: true });
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
            onContextMenu={(event) => {
                const isRightButtonDrag = panState.current.isPanning && panState.current.button === 2 && panState.current.hasMoved;
                if (suppressNextContextMenuRef.current || isRightButtonDrag) {
                    suppressNextContextMenuRef.current = false;
                    event.preventDefault();
                    return;
                }
                onContextMenu?.(event);
            }}
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
