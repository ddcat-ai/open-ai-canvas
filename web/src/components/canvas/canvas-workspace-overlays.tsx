import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronRight, Clapperboard, Image as ImageIcon, List, Music2, Pencil, Video, WandSparkles, X } from "lucide-react";

import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { useCanvasOverlayLayer } from "@/components/canvas/canvas-overlay-layer";
import { canvasThemes } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position, type ViewportTransform } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
    quick?: boolean;
    batchSourceNodeIds?: string[];
};

export function CanvasSelectionToolbar({ anchorRef, containerRef, count, children }: { anchorRef: RefObject<HTMLDivElement | null>; containerRef: RefObject<HTMLDivElement | null>; count: number; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const toolbarRef = useRef<HTMLDivElement>(null);
    const [anchor, setAnchor] = useState<{ left: number; top: number; placement: "above" | "below" } | null>(null);

    useLayoutEffect(() => {
        const element = anchorRef.current;
        const container = containerRef.current;
        if (!element || !container) {
            setAnchor(null);
            return;
        }

        const update = () => {
            const bounds = element.getBoundingClientRect();
            const containerBounds = container.getBoundingClientRect();
            const toolbarWidth = toolbarRef.current?.offsetWidth || 320;
            const toolbarHeight = toolbarRef.current?.offsetHeight || 38;
            const halfWidth = Math.min(toolbarWidth / 2, Math.max(0, containerBounds.width / 2 - 12));
            const center = bounds.left - containerBounds.left + bounds.width / 2;
            const left = Math.min(Math.max(center, 12 + halfWidth), Math.max(12 + halfWidth, containerBounds.width - 12 - halfWidth));
            const boundsTop = bounds.top - containerBounds.top;
            const boundsBottom = bounds.bottom - containerBounds.top;
            const placement = boundsTop - toolbarHeight - 8 >= 68 ? "above" : "below";
            const top = placement === "above" ? boundsTop - 8 : Math.min(boundsBottom + 8, containerBounds.height - toolbarHeight - 12);
            if (toolbarRef.current) {
                toolbarRef.current.style.left = `${left}px`;
                toolbarRef.current.style.top = `${top}px`;
                toolbarRef.current.classList.toggle("-translate-y-full", placement === "above");
                return;
            }
            setAnchor((current) => current?.left === left && current.top === top && current.placement === placement ? current : { left, top, placement });
        };

        update();
        const resizeObserver = new ResizeObserver(update);
        resizeObserver.observe(element);
        resizeObserver.observe(container);
        if (toolbarRef.current) resizeObserver.observe(toolbarRef.current);
        const viewportLayer = element.parentElement;
        const mutationObserver = new MutationObserver(update);
        if (viewportLayer) mutationObserver.observe(viewportLayer, { attributes: true, attributeFilter: ["style"] });
        const unsubscribeViewport = subscribeCanvasViewportPreview(container, update);
        window.addEventListener("resize", update);
        return () => {
            resizeObserver.disconnect();
            mutationObserver.disconnect();
            unsubscribeViewport();
            window.removeEventListener("resize", update);
        };
    }, [anchorRef, containerRef, count]);

    if (!anchor) return null;
    return (
        <div
            ref={toolbarRef}
            data-canvas-no-zoom
            className={`absolute z-[var(--z-panel-floating)] max-w-[calc(100%_-_24px)] -translate-x-1/2 ${anchor.placement === "above" ? "-translate-y-full" : ""}`}
            style={{ left: anchor.left, top: anchor.top, color: theme.node.text, transformOrigin: anchor.placement === "above" ? "bottom center" : "top center" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <motion.div initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: anchor.placement === "above" ? 8 : -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={aceternityMotion.spring.panel} className="flex items-center gap-2">
                <span className="aceternity-floating-panel shrink-0 rounded-full border px-2.5 py-1.5 text-[var(--fs-tiny)] font-semibold tabular-nums backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.accent.primary }}>已选 {count}</span>
                <div className="max-w-[min(560px,calc(100vw-90px))]">{children}</div>
            </motion.div>
        </div>
    );
}

type NodePanelPlacement = "above" | "below";

// 拖动时保留当前上下方向，并允许短暂越过安全边界，避免面板在临界位置反复翻转。
const NODE_PANEL_PLACEMENT_BUFFER = 32;

export function CanvasNodePanelOverlay({ node, viewport, containerRef, panelWidth, panelHeight = 190, dragOffset, isDragging = false, children }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; panelWidth?: number; panelHeight?: number; dragOffset?: Position | null; isDragging?: boolean; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const placementRef = useRef<NodePanelPlacement | null>(null);
    const { bringToFront, zIndex } = useCanvasOverlayLayer(`node-panel:${node.id}`, "var(--z-modal-overlay)");
    const initialWidth = resolveNodePanelWidth(node, viewport, panelWidth);
    const initialPosition = getNodePanelPosition(node, viewport, { width: containerRef.current?.clientWidth || 0, height: containerRef.current?.clientHeight || 0 }, initialWidth, panelHeight, dragOffset);

    useLayoutEffect(() => {
        bringToFront();
    }, [bringToFront]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const panel = panelRef.current;
        if (!container || !panel) return;
        const update = (nextViewport: ViewportTransform) => {
            const nextWidth = resolveNodePanelWidth(node, nextViewport, panelWidth);
            const nextHeight = panel.offsetHeight || panelHeight;
            panel.style.width = `${nextWidth}px`;
            panel.style.removeProperty("height");
            const position = getNodePanelPosition(
                node,
                nextViewport,
                { width: container.clientWidth, height: container.clientHeight },
                nextWidth,
                nextHeight,
                dragOffset,
                isDragging ? placementRef.current : null,
                isDragging ? NODE_PANEL_PLACEMENT_BUFFER : 0,
            );
            if (isDragging && placementRef.current && placementRef.current !== position.placement) {
                panel.classList.remove("canvas-node-panel-placement-change");
                // 强制重排后重新加 class，确保每次上下翻转都能重新播放虚化动画。
                void panel.offsetWidth;
                panel.classList.add("canvas-node-panel-placement-change");
            }
            placementRef.current = isDragging ? position.placement : null;
            panel.style.left = `${position.left}px`;
            panel.style.top = `${position.top}px`;
        };
        update(viewport);
        const resizeObserver = new ResizeObserver(() => update(viewport));
        resizeObserver.observe(container);
        resizeObserver.observe(panel);
        const unsubscribeViewport = subscribeCanvasViewportPreview(container, update);
        return () => {
            resizeObserver.disconnect();
            unsubscribeViewport();
        };
    }, [containerRef, dragOffset?.x, dragOffset?.y, isDragging, node.height, node.id, node.position.x, node.position.y, node.width, panelHeight, panelWidth, viewport]);

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="thin-scrollbar absolute max-w-[calc(100%_-_24px)] overflow-y-auto"
            style={{ left: initialPosition.left, top: initialPosition.top, width: initialWidth, maxHeight: "calc(100% - 84px)", zIndex }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDownCapture={bringToFront}
            onFocusCapture={bringToFront}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}

function resolveNodePanelWidth(node: CanvasNodeData, viewport: ViewportTransform, requestedWidth?: number) {
    if (requestedWidth) return requestedWidth;
    return clamp(Math.round(node.width * viewport.k * 1.5), 680, 920);
}

export function CanvasConnectionCreateMenu({ pending, viewport, viewportSize, containerRef, canCreateDrawing, getDisabledReason, onCreate, onClose }: { pending: PendingConnectionCreate; viewport: ViewportTransform; viewportSize: { width: number; height: number }; containerRef: RefObject<HTMLDivElement | null>; canCreateDrawing: boolean; getDisabledReason: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing) => string; onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const menuRef = useRef<HTMLDivElement>(null);
    const { bringToFront, zIndex } = useCanvasOverlayLayer("connection-create-menu", "var(--z-modal-overlay)");
    const menuWidth = 248;
    const menuHeight = canCreateDrawing ? 420 : 376;
    const gap = 12;
    const initialPosition = getConnectionMenuPosition(pending.position, viewport, viewportSize, menuWidth, menuHeight, gap);

    useLayoutEffect(() => {
        bringToFront();
    }, [bringToFront]);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const menu = menuRef.current;
        if (!container || !menu) return;
        const update = (nextViewport: ViewportTransform) => {
            const containerBounds = container.getBoundingClientRect();
            const position = getConnectionMenuPosition(pending.position, nextViewport, { width: containerBounds.width, height: containerBounds.height }, menu.offsetWidth || menuWidth, menu.offsetHeight || menuHeight, gap);
            menu.style.left = `${position.left}px`;
            menu.style.top = `${position.top}px`;
        };
        update(viewport);
        return subscribeCanvasViewportPreview(container, update);
    }, [containerRef, pending.position, viewport, viewportSize.height, viewportSize.width]);

    return (
        <SpotlightSurface
            spotlightColor={theme.toolbar.itemHover}
            ref={menuRef}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.97, rotateX: 2 }}
            animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
            className="aceternity-floating-panel absolute w-[248px] origin-top-left overflow-hidden rounded-[var(--r-2xl)] border p-2 backdrop-blur-2xl"
            data-canvas-no-zoom
            data-connection-create-menu
            style={{ left: initialPosition.left, top: initialPosition.top, zIndex, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDownCapture={bringToFront}
            onFocusCapture={bringToFront}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1 py-0.5">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[var(--dock-item-radius)] border opacity-75" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}><WandSparkles className="size-3.5" /></span>
                    <span className="min-w-0"><span className="block truncate text-[var(--fs-label)] font-semibold">创建下一步</span><span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>{pending.batchSourceNodeIds?.length ? `引用已选 ${pending.batchSourceNodeIds.length} 个节点` : "引用当前节点"}</span></span>
                </span>
                <button type="button" className="grid size-6 shrink-0 place-items-center rounded-full border opacity-55 transition-opacity hover:opacity-100" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} onClick={onClose} aria-label="关闭连线创建菜单"><X className="size-3" /></button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<List className="size-4" />} title="文本生成" disabledReason={getDisabledReason(CanvasNodeType.Text)} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Clapperboard className="size-4" />} title="分镜脚本" disabledReason={getDisabledReason(CanvasNodeType.Script)} onClick={() => onCreate(CanvasNodeType.Script)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<ImageIcon className="size-4" />} title="图片生成" disabledReason={getDisabledReason(CanvasNodeType.Image)} onClick={() => onCreate(CanvasNodeType.Image)} />
                {canCreateDrawing ? <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Pencil className="size-4" />} title="绘图" disabledReason={getDisabledReason(CanvasNodeType.Drawing)} onClick={() => onCreate(CanvasNodeType.Drawing)} /> : null}
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Video className="size-4" />} title="视频生成" disabledReason={getDisabledReason(CanvasNodeType.Video)} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Music2 className="size-4" />} title="音频参考" disabledReason={getDisabledReason(CanvasNodeType.Audio)} onClick={() => onCreate(CanvasNodeType.Audio)} />
            </div>
        </SpotlightSurface>
    );
}

function ConnectionCreateOption({ motionEnabled, icon, title, description, disabledReason, onClick }: { motionEnabled: boolean; icon: ReactNode; title: string; description?: string; disabledReason?: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <motion.button type="button" disabled={Boolean(disabledReason)} title={disabledReason} whileHover={motionEnabled && !disabledReason ? { x: 2 } : undefined} whileTap={motionEnabled && !disabledReason ? { scale: 0.98 } : undefined} transition={aceternityMotion.spring.dock} className="group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[var(--dock-item-radius)] border border-transparent px-2 py-1.5 text-left outline-none hover:border-black/10 hover:bg-black/5 focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:border-white/10 dark:hover:bg-white/8" style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties} onClick={onClick}>
            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5" style={{ background: theme.toolbar.itemHover }}>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[var(--fs-tiny)] font-semibold leading-4">{title}</span>
                {disabledReason || description ? <span className="mt-0.5 block truncate text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>{disabledReason || description}</span> : null}
            </span>
            <ChevronRight className="size-3.5 shrink-0 opacity-35 transition-transform group-hover:translate-x-0.5" />
        </motion.button>
    );
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}

function getConnectionMenuPosition(position: Position, viewport: ViewportTransform, viewportSize: { width: number; height: number }, menuWidth: number, menuHeight: number, gap: number) {
    const screenX = viewport.x + position.x * viewport.k;
    const screenY = viewport.y + position.y * viewport.k;
    return {
        left: clamp(screenX, gap, Math.max(gap, viewportSize.width - menuWidth - gap)),
        top: clamp(screenY, 72, Math.max(72, viewportSize.height - menuHeight - gap)),
    };
}

function getNodePanelPosition(node: CanvasNodeData, viewport: ViewportTransform, viewportSize: { width: number; height: number }, panelWidth: number, panelHeight: number, dragOffset?: Position | null, lockedPlacement?: NodePanelPlacement | null, placementBuffer = 0) {
    const gap = 10;
    const margin = 12;
    const topBoundary = 72;
    const offsetX = dragOffset?.x || 0;
    const offsetY = dragOffset?.y || 0;
    const nodeCenterX = viewport.x + (node.position.x + offsetX + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + (node.position.y + offsetY) * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + offsetY + node.height) * viewport.k;
    const maxLeft = Math.max(margin, viewportSize.width - panelWidth - margin);
    const left = clamp(nodeCenterX - panelWidth / 2, margin, maxLeft);
    const belowTop = nodeBottom + gap;
    const aboveTop = nodeTop - panelHeight - gap;
    const canFitBelow = belowTop + panelHeight <= viewportSize.height - margin;
    const canFitAbove = aboveTop >= topBoundary;
    let placement: NodePanelPlacement;
    if (lockedPlacement === "below") {
        placement = !canFitBelow && belowTop + panelHeight > viewportSize.height - margin + placementBuffer && canFitAbove ? "above" : "below";
    } else if (lockedPlacement === "above") {
        placement = !canFitAbove && aboveTop < topBoundary - placementBuffer && canFitBelow ? "below" : "above";
    } else {
        placement = canFitBelow ? "below" : "above";
    }
    const preferredTop = placement === "below" ? belowTop : aboveTop;
    return {
        left,
        top: clamp(preferredTop, topBoundary, Math.max(topBoundary, viewportSize.height - panelHeight - margin)),
        placement,
    };
}
