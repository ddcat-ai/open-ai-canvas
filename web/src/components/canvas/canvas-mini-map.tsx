import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

export function Minimap({ nodes, viewport, viewportSize, canvasContainerRef, onViewportPreviewChange, onViewportChange }: { nodes: CanvasNodeData[]; viewport: ViewportTransform; viewportSize: { width: number; height: number }; canvasContainerRef?: RefObject<HTMLDivElement | null>; onViewportPreviewChange?: (viewport: ViewportTransform) => void; onViewportChange: (viewport: ViewportTransform) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRectRef = useRef<HTMLDivElement>(null);
    const liveViewportRef = useRef(viewport);
    const [isDragging, setIsDragging] = useState(false);
    const width = 240;
    const height = 160;
    const displayNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes)), [nodes]);

    const { worldBounds, scale, offset } = useMemo(() => {
        if (!displayNodes.length) {
            return { worldBounds: { x: -500, y: -500, w: 1000, h: 1000 }, scale: 0.16, offset: { x: 40, y: 0 } };
        }

        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;

        displayNodes.forEach((node) => {
            minX = Math.min(minX, node.position.x);
            minY = Math.min(minY, node.position.y);
            maxX = Math.max(maxX, node.position.x + node.width);
            maxY = Math.max(maxY, node.position.y + node.height);
        });

        minX -= 500;
        minY -= 500;
        maxX += 500;
        maxY += 500;

        const boundsWidth = maxX - minX;
        const boundsHeight = maxY - minY;
        const nextScale = Math.min(width / boundsWidth, height / boundsHeight);
        const mapContentW = boundsWidth * nextScale;
        const mapContentH = boundsHeight * nextScale;

        return {
            worldBounds: { x: minX, y: minY, w: boundsWidth, h: boundsHeight },
            scale: nextScale,
            offset: { x: (width - mapContentW) / 2, y: (height - mapContentH) / 2 },
        };
    }, [displayNodes]);

    const toMinimap = useCallback(
        (worldX: number, worldY: number) => {
            return {
                x: (worldX - worldBounds.x) * scale + offset.x,
                y: (worldY - worldBounds.y) * scale + offset.y,
            };
        },
        [offset.x, offset.y, scale, worldBounds.x, worldBounds.y],
    );

    const toWorld = useCallback(
        (minimapX: number, minimapY: number) => {
            return {
                x: (minimapX - offset.x) / scale + worldBounds.x,
                y: (minimapY - offset.y) / scale + worldBounds.y,
            };
        },
        [offset.x, offset.y, scale, worldBounds.x, worldBounds.y],
    );

    const viewportRect = useMemo(() => {
        const vx = -viewport.x / viewport.k;
        const vy = -viewport.y / viewport.k;
        const vw = viewportSize.width / viewport.k;
        const vh = viewportSize.height / viewport.k;
        const p1 = toMinimap(vx, vy);
        const p2 = toMinimap(vx + vw, vy + vh);

        return {
            x: p1.x,
            y: p1.y,
            w: Math.max(p2.x - p1.x, 4),
            h: Math.max(p2.y - p1.y, 4),
        };
    }, [toMinimap, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);

    const updateViewportRect = useCallback((nextViewport: ViewportTransform) => {
        liveViewportRef.current = nextViewport;
        const element = viewportRectRef.current;
        if (!element) return;
        const vx = -nextViewport.x / nextViewport.k;
        const vy = -nextViewport.y / nextViewport.k;
        const p1 = toMinimap(vx, vy);
        const p2 = toMinimap(vx + viewportSize.width / nextViewport.k, vy + viewportSize.height / nextViewport.k);
        element.style.left = `${p1.x}px`;
        element.style.top = `${p1.y}px`;
        element.style.width = `${Math.max(p2.x - p1.x, 4)}px`;
        element.style.height = `${Math.max(p2.y - p1.y, 4)}px`;
    }, [toMinimap, viewportSize.height, viewportSize.width]);

    useEffect(() => updateViewportRect(viewport), [updateViewportRect, viewport]);

    useEffect(() => {
        const canvasContainer = canvasContainerRef?.current;
        if (!canvasContainer) return;
        return subscribeCanvasViewportPreview(canvasContainer, updateViewportRect);
    }, [canvasContainerRef, updateViewportRect]);

    const updateViewportFromEvent = (event: React.PointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;

        const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const scale = liveViewportRef.current.k;
        const next = {
            x: viewportSize.width / 2 - world.x * scale,
            y: viewportSize.height / 2 - world.y * scale,
            k: scale,
        };
        liveViewportRef.current = next;
        onViewportPreviewChange?.(next);
    };

    return (
        <div className="absolute bottom-24 left-6 z-50 overflow-hidden rounded-lg border shadow-2xl backdrop-blur-sm" style={{ width, height, background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
            <div
                ref={containerRef}
                className="relative h-full w-full cursor-crosshair"
                onPointerDown={(event) => {
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    setIsDragging(true);
                    updateViewportFromEvent(event);
                }}
                onPointerMove={(event) => {
                    if (isDragging) updateViewportFromEvent(event);
                }}
                onPointerUp={() => {
                    setIsDragging(false);
                    onViewportChange(liveViewportRef.current);
                }}
                onPointerCancel={() => {
                    setIsDragging(false);
                    onViewportChange(liveViewportRef.current);
                }}
            >
                {displayNodes.map((node) => {
                    const pos = toMinimap(node.position.x, node.position.y);
                    const frame = isFrameNode(node);
                    const color = node.type === CanvasNodeType.Image ? "#10b981" : node.type === CanvasNodeType.Video ? "#f97316" : node.type === CanvasNodeType.Audio ? "#a855f7" : node.type === CanvasNodeType.Config ? "#60a5fa" : node.type === CanvasNodeType.Skill ? "#818cf8" : frame ? theme.frame.stroke : theme.node.muted;
                    return (
                        <div
                            key={node.id}
                            className="absolute rounded-[1px]"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                width: Math.max(node.width * scale, 2),
                                height: Math.max(node.height * scale, 2),
                                backgroundColor: frame ? (node.metadata?.frame?.collapsed ? theme.frame.preview : "transparent") : color,
                                border: frame ? `1px solid ${color}` : undefined,
                                opacity: frame ? 0.95 : 0.8,
                            }}
                        />
                    );
                })}
                <div ref={viewportRectRef} className="pointer-events-none absolute border" style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h, borderColor: theme.node.activeStroke, background: `${theme.node.activeStroke}18` }} />
            </div>
        </div>
    );
}
