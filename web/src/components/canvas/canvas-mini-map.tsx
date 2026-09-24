import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;

type MinimapProps = {
    nodes: CanvasNodeData[];
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    canvasContainerRef?: RefObject<HTMLDivElement | null>;
    onViewportPreviewChange?: (viewport: ViewportTransform) => void;
    onViewportChange: (viewport: ViewportTransform) => void;
};

export function Minimap({ nodes, viewport, viewportSize, canvasContainerRef, onViewportPreviewChange, onViewportChange }: MinimapProps) {
    const theme = canvasThemes[useActiveTheme()];
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const liveViewportRef = useRef(viewport);
    const [isDragging, setIsDragging] = useState(false);
    const width = MINIMAP_WIDTH;
    const height = MINIMAP_HEIGHT;
    const displayNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes)), [nodes]);
    const { worldBounds, scale, offset } = useMemo(() => {
        if (!displayNodes.length) return { worldBounds: { x: -500, y: -500, w: 1000, h: 1000 }, scale: 0.16, offset: { x: 40, y: 0 } };
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
        const boundsWidth = Math.max(maxX - minX, 1);
        const boundsHeight = Math.max(maxY - minY, 1);
        const nextScale = Math.min(width / boundsWidth, height / boundsHeight);
        return {
            worldBounds: { x: minX, y: minY, w: boundsWidth, h: boundsHeight },
            scale: nextScale,
            offset: { x: (width - boundsWidth * nextScale) / 2, y: (height - boundsHeight * nextScale) / 2 },
        };
    }, [displayNodes, height, width]);
    const toMinimap = useCallback((worldX: number, worldY: number) => ({ x: (worldX - worldBounds.x) * scale + offset.x, y: (worldY - worldBounds.y) * scale + offset.y }), [offset.x, offset.y, scale, worldBounds.x, worldBounds.y]);
    const toWorld = useCallback((minimapX: number, minimapY: number) => ({ x: (minimapX - offset.x) / scale + worldBounds.x, y: (minimapY - offset.y) / scale + worldBounds.y }), [offset.x, offset.y, scale, worldBounds.x, worldBounds.y]);
    const viewportRect = useMemo(() => {
        const vx = -viewport.x / viewport.k;
        const vy = -viewport.y / viewport.k;
        const p1 = toMinimap(vx, vy);
        const p2 = toMinimap(vx + viewportSize.width / viewport.k, vy + viewportSize.height / viewport.k);
        return { x: p1.x, y: p1.y, w: Math.max(p2.x - p1.x, 4), h: Math.max(p2.y - p1.y, 4) };
    }, [toMinimap, viewport.k, viewport.x, viewport.y, viewportSize.height, viewportSize.width]);
    const updateViewportRect = useCallback((nextViewport: ViewportTransform) => {
        liveViewportRef.current = nextViewport;
        drawMinimap(canvasRef.current, displayNodes, toMinimap, nextViewport, viewportSize, theme);
    }, [displayNodes, theme, toMinimap, viewportSize]);

    useEffect(() => {
        drawMinimap(canvasRef.current, displayNodes, toMinimap, viewport, viewportSize, theme);
    }, [displayNodes, theme, toMinimap, viewport, viewportSize]);
    useEffect(() => updateViewportRect(viewport), [updateViewportRect, viewport]);
    useEffect(() => {
        const canvasContainer = canvasContainerRef?.current;
        if (!canvasContainer) return;
        return subscribeCanvasViewportPreview(canvasContainer, updateViewportRect);
    }, [canvasContainerRef, updateViewportRect]);

    const updateViewportFromEvent = (event: ReactPointerEvent) => {
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const current = liveViewportRef.current;
        const next = { x: viewportSize.width / 2 - world.x * current.k, y: viewportSize.height / 2 - world.y * current.k, k: current.k };
        liveViewportRef.current = next;
        onViewportPreviewChange?.(next);
    };

    return (
        <div className="absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16)+var(--space-10))] left-6 z-[var(--z-panel)] overflow-hidden rounded-lg shadow-2xl backdrop-blur-sm lg:bottom-[calc(var(--canvas-inset-y)+var(--space-12))]" style={{ width, height, background: theme.toolbar.panel }}>
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
                <canvas ref={canvasRef} width={width} height={height} className="pointer-events-none block size-full" aria-label="画布小地图" />
                <div className="pointer-events-none absolute rounded-[var(--r-xs)]" style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h, background: `${theme.node.activeStroke}12`, boxShadow: `inset 0 0 0 1px ${theme.node.activeStroke}66` }} />
            </div>
        </div>
    );
}

function drawMinimap(canvas: HTMLCanvasElement | null, nodes: CanvasNodeData[], toMinimap: (x: number, y: number) => { x: number; y: number }, viewport: ViewportTransform, viewportSize: { width: number; height: number }, theme: (typeof canvasThemes)[keyof typeof canvasThemes]) {
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    for (const node of nodes) {
        const pos = toMinimap(node.position.x, node.position.y);
        const frame = isFrameNode(node);
        const color = node.type === CanvasNodeType.Image ? "#10b981" : node.type === CanvasNodeType.Video ? "#f97316" : node.type === CanvasNodeType.Audio ? "#a855f7" : node.type === CanvasNodeType.Config ? "#60a5fa" : node.type === CanvasNodeType.Skill ? "#818cf8" : frame ? theme.frame.stroke : theme.node.muted;
        const p2 = toMinimap(node.position.x + node.width, node.position.y + node.height);
        const rectWidth = Math.max(p2.x - pos.x, 2);
        const rectHeight = Math.max(p2.y - pos.y, 2);
        context.globalAlpha = frame ? 0.95 : 0.8;
        context.fillStyle = frame && !node.metadata?.frame?.collapsed ? "transparent" : color;
        context.strokeStyle = color;
        context.lineWidth = frame ? 1 : 0;
        if (context.fillStyle !== "transparent") context.fillRect(pos.x, pos.y, rectWidth, rectHeight);
        if (frame) context.strokeRect(pos.x, pos.y, rectWidth, rectHeight);
    }
    const vx = -viewport.x / viewport.k;
    const vy = -viewport.y / viewport.k;
    const p1 = toMinimap(vx, vy);
    const p2 = toMinimap(vx + viewportSize.width / viewport.k, vy + viewportSize.height / viewport.k);
    context.globalAlpha = 1;
    context.strokeStyle = theme.node.activeStroke;
    context.strokeRect(p1.x, p1.y, Math.max(p2.x - p1.x, 4), Math.max(p2.y - p1.y, 4));
}
