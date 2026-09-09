import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { canvasThemes } from "@/lib/canvas-theme";
import { isFrameNode, isNodeHiddenByCollapsedFrame } from "@/lib/canvas/canvas-frame";
import { buildLibTVImagePreviewUrl } from "@/lib/canvas/libtv-import";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ViewportTransform } from "@/types/canvas";
import { isHiddenBatchChild } from "@/lib/canvas/canvas-project-domain";
import { calculateMinimapWorldBounds, minimapScaleForWorldBounds, minimapViewportRect, viewportWorldRect } from "@/lib/canvas/canvas-minimap-geometry";
import { useCanvasMinimapPan } from "./use-canvas-minimap-pan";

const MINIMAP_WIDTH = 240;
const MINIMAP_HEIGHT = 160;
const MINIMAP_IMAGE_PREVIEW_LIMIT = 24;
const MINIMAP_NODE_COLOR = "rgba(120, 120, 120, 0.92)";
const MINIMAP_GROUP_FILL = "rgba(120, 120, 120, 0.28)";
const MINIMAP_MASK_COLOR = "rgba(0, 0, 0, 0.62)";

export function Minimap({ nodes, viewport, viewportSize, canvasContainerRef, onViewportPreviewChange, onViewportChange, onHoverChange, onPanStart, onPanEnd }: { nodes: CanvasNodeData[]; viewport: ViewportTransform; viewportSize: { width: number; height: number }; canvasContainerRef?: RefObject<HTMLDivElement | null>; onViewportPreviewChange?: (viewport: ViewportTransform) => void; onViewportChange: (viewport: ViewportTransform) => void; onHoverChange?: (hovered: boolean) => void; onPanStart?: () => void; onPanEnd?: (pointerInsideMinimap: boolean) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const containerRef = useRef<HTMLDivElement>(null);
    const viewportRectRef = useRef<HTMLDivElement>(null);
    const liveViewportRef = useRef(viewport);
    const [liveViewport, setLiveViewport] = useState(viewport);
    const [isPanning, setIsPanning] = useState(false);
    const width = MINIMAP_WIDTH;
    const height = MINIMAP_HEIGHT;
    const displayNodes = useMemo(() => nodes.filter((node) => !isNodeHiddenByCollapsedFrame(node, nodes) && !isHiddenBatchChild(node, nodes)), [nodes]);
    const showImagePreviews = useMemo(() => displayNodes.filter((node) => node.type === CanvasNodeType.Image && Boolean(getImagePreviewSource(node) || node.metadata?.storageKey)).length <= MINIMAP_IMAGE_PREVIEW_LIMIT, [displayNodes]);

    const nodeBounds = useMemo(() => {
        if (!displayNodes.length) return null;
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

        return { x: minX, y: minY, w: Math.max(maxX - minX, 1), h: Math.max(maxY - minY, 1) };
    }, [displayNodes]);

    const liveViewportBounds = useMemo(() => viewportWorldRect(liveViewport, viewportSize), [liveViewport, viewportSize.height, viewportSize.width]);
    const worldBounds = useMemo(() => calculateMinimapWorldBounds(nodeBounds, liveViewportBounds, 5, { width, height }), [height, liveViewportBounds, nodeBounds, width]);
    const scale = useMemo(() => minimapScaleForWorldBounds(worldBounds, { width, height }), [worldBounds, width, height]);
    const offset = useMemo(() => ({
        x: (width - worldBounds.w * scale) / 2,
        y: (height - worldBounds.h * scale) / 2,
    }), [height, scale, width, worldBounds.h, worldBounds.w]);

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

    const viewportRect = useMemo(() => minimapViewportRect(liveViewportBounds, worldBounds, { width, height }), [height, liveViewportBounds, width, worldBounds]);

    const updateViewportRect = useCallback((nextViewport: ViewportTransform) => {
        liveViewportRef.current = nextViewport;
        setLiveViewport(nextViewport);
        const element = viewportRectRef.current;
        if (!element) return;
        const nextRect = minimapViewportRect(viewportWorldRect(nextViewport, viewportSize), worldBounds, { width, height });
        element.style.left = `${nextRect.x}px`;
        element.style.top = `${nextRect.y}px`;
        element.style.width = `${nextRect.w}px`;
        element.style.height = `${nextRect.h}px`;
    }, [height, viewportSize.height, viewportSize.width, width, worldBounds]);

    const applyPreview = useCallback((nextViewport: ViewportTransform) => {
        liveViewportRef.current = nextViewport;
        updateViewportRect(nextViewport);
        onViewportPreviewChange?.(nextViewport);
    }, [onViewportPreviewChange, updateViewportRect]);

    const handlePanStart = useCallback(() => {
        setIsPanning(true);
        onPanStart?.();
    }, [onPanStart]);

    const handlePanEnd = useCallback((pointerInsideMinimap: boolean) => {
        setIsPanning(false);
        onPanEnd?.(pointerInsideMinimap);
    }, [onPanEnd]);

    useCanvasMinimapPan({
        enabled: true,
        minimapRef: containerRef,
        viewportRef: liveViewportRef,
        getMoveScale: () => Math.max((nodeBounds?.w ?? worldBounds.w) / width, (nodeBounds?.h ?? worldBounds.h) / height),
        onPreview: applyPreview,
        onSettled: onViewportChange,
        onPanStart: handlePanStart,
        onPanEnd: handlePanEnd,
    });

    const handleMapClick = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (containerRef.current?.dataset.canvasMinimapDidPan === "true") {
            delete containerRef.current.dataset.canvasMinimapDidPan;
            return;
        }
        if (event.defaultPrevented) return;
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const current = liveViewportRef.current;
        onViewportChange({
            x: viewportSize.width / 2 - world.x * current.k,
            y: viewportSize.height / 2 - world.y * current.k,
            k: current.k,
        });
    }, [onViewportChange, toWorld, viewportSize.height, viewportSize.width]);

    const handleMapWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const rect = containerRef.current?.getBoundingClientRect();
        if (!rect) return;
        const world = toWorld(event.clientX - rect.left, event.clientY - rect.top);
        const current = liveViewportRef.current;
        const nextScale = Math.min(2, Math.max(0.05, current.k * Math.pow(1.0015, -event.deltaY)));
        const next = {
            x: viewportSize.width / 2 - world.x * nextScale,
            y: viewportSize.height / 2 - world.y * nextScale,
            k: nextScale,
        };
        applyPreview(next);
        onViewportChange(next);
    }, [applyPreview, onViewportChange, toWorld, viewportSize]);

    useEffect(() => {
        if (liveViewportRef.current.x === viewport.x && liveViewportRef.current.y === viewport.y && liveViewportRef.current.k === viewport.k) return;
        liveViewportRef.current = viewport;
        setLiveViewport(viewport);
    }, [viewport.k, viewport.x, viewport.y]);

    useEffect(() => updateViewportRect(liveViewport), [liveViewport, updateViewportRect]);

    useEffect(() => {
        const canvasContainer = canvasContainerRef?.current;
        if (!canvasContainer) return;
        return subscribeCanvasViewportPreview(canvasContainer, updateViewportRect);
    }, [canvasContainerRef, updateViewportRect]);

    return (
        <div data-canvas-no-zoom aria-label="小地图" className="canvas-mini-map absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16)+var(--space-3))] left-6 z-[var(--z-panel)] overflow-hidden rounded-lg shadow-2xl backdrop-blur-sm [isolation:isolate] lg:bottom-[calc(var(--canvas-inset-y)+var(--space-12))]" style={{ width, height, background: theme.toolbar.panel, border: `1px solid ${theme.toolbar.border}`, boxSizing: "border-box", transform: "translateZ(0)" }}>
            <div
                ref={containerRef}
                className={`relative h-full w-full touch-none select-none overflow-hidden ${isPanning ? "cursor-grabbing" : "cursor-grab"}`}
                onMouseEnter={() => onHoverChange?.(true)}
                onMouseLeave={() => onHoverChange?.(false)}
                onClick={handleMapClick}
                onWheel={handleMapWheel}
            >
                {displayNodes.map((node) => {
                    const pos = toMinimap(node.position.x, node.position.y);
                    const frame = isFrameNode(node);
                    const referenceGroup = frame && (node.metadata?.workflowKind === "reference_set" || (node.metadata?.referenceAssetNodeIds?.length ?? 0) > 0);
                    const color = MINIMAP_NODE_COLOR;
                    const imagePreviewSource = showImagePreviews && node.type === CanvasNodeType.Image ? getImagePreviewSource(node) : "";
                    return (
                        <div
                            key={node.id}
                            className="absolute overflow-hidden rounded-[2px]"
                            style={{
                                left: pos.x,
                                top: pos.y,
                                width: Math.max(node.width * scale, 2),
                                height: Math.max(node.height * scale, 2),
                                backgroundColor: frame ? (referenceGroup ? MINIMAP_GROUP_FILL : node.metadata?.frame?.collapsed ? theme.frame.preview : "transparent") : color,
                                border: frame ? `1px solid ${color}` : undefined,
                                borderRadius: frame ? 3 : 2,
                                backgroundClip: "padding-box",
                                opacity: frame ? 0.95 : 0.8,
                                zIndex: frame ? 0 : 1,
                            }}
                        >
                            <div className="absolute inset-0 overflow-hidden rounded-[2px]">
                                {imagePreviewSource || (showImagePreviews && node.type === CanvasNodeType.Image && node.metadata?.storageKey) ? (
                                    <CachedResourceImage
                                        storageKey={node.metadata?.storageKey}
                                        src={imagePreviewSource}
                                        alt=""
                                        loading="lazy"
                                        decoding="async"
                                        draggable={false}
                                        className="size-full object-cover"
                                        fallback={null}
                                    />
                                ) : null}
                            </div>
                        </div>
                    );
                })}
                <div className="pointer-events-none absolute inset-0 z-[2]" aria-hidden="true">
                    <div className="absolute left-0 right-0 top-0" style={{ height: viewportRect.y, background: MINIMAP_MASK_COLOR }} />
                    <div className="absolute bottom-0 left-0 right-0" style={{ top: viewportRect.y + viewportRect.h, background: MINIMAP_MASK_COLOR }} />
                    <div className="absolute left-0" style={{ top: viewportRect.y, width: viewportRect.x, height: viewportRect.h, background: MINIMAP_MASK_COLOR }} />
                    <div className="absolute right-0" style={{ top: viewportRect.y, left: viewportRect.x + viewportRect.w, height: viewportRect.h, background: MINIMAP_MASK_COLOR }} />
                </div>
                    <div ref={viewportRectRef} className="pointer-events-none absolute overflow-hidden rounded-none" style={{ left: viewportRect.x, top: viewportRect.y, width: viewportRect.w, height: viewportRect.h, background: `${theme.node.activeStroke}12`, backgroundClip: "padding-box", transform: "translateZ(0)" }} />
            </div>
        </div>
    );
}

function getImagePreviewSource(node: CanvasNodeData) {
    if (node.type !== CanvasNodeType.Image) return "";
    const content = node.metadata?.content || "";
    return node.metadata?.previewContent || (node.metadata?.importSource?.provider === "libtv" ? buildLibTVImagePreviewUrl(content) : content);
}
