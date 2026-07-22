import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { ChevronRight, Image as ImageIcon, List, Music2, Settings2, Video, WandSparkles, X } from "lucide-react";

import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { canvasThemes } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position, type ViewportTransform } from "@/types/canvas";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
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
            className={`absolute z-[70] max-w-[calc(100%_-_24px)] -translate-x-1/2 ${anchor.placement === "above" ? "-translate-y-full" : ""}`}
            style={{ left: anchor.left, top: anchor.top, color: theme.node.text, transformOrigin: anchor.placement === "above" ? "bottom center" : "top center" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <motion.div initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: anchor.placement === "above" ? 8 : -8 }} animate={{ opacity: 1, scale: 1, y: 0 }} transition={aceternityMotion.spring.panel} className="flex items-center gap-2">
                <span className="aceternity-floating-panel shrink-0 rounded-full border px-2.5 py-1.5 text-[10px] font-semibold tabular-nums backdrop-blur-2xl" style={{ background: theme.spatial.elevated, borderColor: theme.spatial.glowStrong, color: theme.accent.primary, boxShadow: `0 14px 36px ${theme.spatial.shadow}` }}>已选 {count}</span>
                <div className="max-w-[min(560px,calc(100vw-90px))]">{children}</div>
            </motion.div>
        </div>
    );
}

export function CanvasNodePanelOverlay({ node, viewport, containerRef, children }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    const initialPosition = getNodePanelPosition(node, viewport, { width: containerRef.current?.clientWidth || 0, height: containerRef.current?.clientHeight || 0 }, 520, 420);

    useLayoutEffect(() => {
        const container = containerRef.current;
        const panel = panelRef.current;
        if (!container || !panel) return;
        const update = (nextViewport: ViewportTransform) => {
            const position = getNodePanelPosition(node, nextViewport, { width: container.clientWidth, height: container.clientHeight }, panel.offsetWidth || 520, panel.offsetHeight || 420);
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
    }, [containerRef, node.height, node.id, node.position.x, node.position.y, node.width, viewport]);

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            className="thin-scrollbar absolute z-[120] max-w-[calc(100%_-_24px)] overflow-y-auto"
            style={{ left: initialPosition.left, top: initialPosition.top, width: 520, maxHeight: "calc(100% - 84px)" }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}

export function CanvasConnectionCreateMenu({ pending, viewport, viewportSize, containerRef, onCreate, onClose }: { pending: PendingConnectionCreate; viewport: ViewportTransform; viewportSize: { width: number; height: number }; containerRef: RefObject<HTMLDivElement | null>; onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio) => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const menuRef = useRef<HTMLDivElement>(null);
    const menuWidth = 248;
    const menuHeight = 332;
    const gap = 12;
    const initialPosition = getConnectionMenuPosition(pending.position, viewport, viewportSize, menuWidth, menuHeight, gap);

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
            className="aceternity-floating-panel absolute z-[120] w-[248px] origin-top-left overflow-hidden rounded-[16px] border p-2 backdrop-blur-2xl"
            data-canvas-no-zoom
            data-connection-create-menu
            style={{ left: initialPosition.left, top: initialPosition.top, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 30px 90px ${theme.spatial.shadow}` }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="absolute inset-x-8 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${theme.toolbar.border}, transparent)` }} />
            <div className="mb-1.5 flex items-center justify-between gap-2 px-1 py-0.5">
                <span className="flex min-w-0 items-center gap-2">
                    <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border opacity-75" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }}><WandSparkles className="size-3.5" /></span>
                    <span className="min-w-0"><span className="block truncate text-[11px] font-semibold">创建下一步</span><span className="mt-0.5 block truncate text-[8px]" style={{ color: theme.node.muted }}>引用当前节点</span></span>
                </span>
                <button type="button" className="grid size-6 shrink-0 place-items-center rounded-full border opacity-55 transition-opacity hover:opacity-100" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} onClick={onClose} aria-label="关闭连线创建菜单"><X className="size-3" /></button>
            </div>
            <div className="grid gap-1">
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<List className="size-4" />} title="文本生成" onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<ImageIcon className="size-4" />} title="图片生成" onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Video className="size-4" />} title="视频生成" onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Music2 className="size-4" />} title="音频参考" onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption motionEnabled={!reducedMotion} icon={<Settings2 className="size-4" />} title="配置节点" onClick={() => onCreate(CanvasNodeType.Config)} />
            </div>
        </SpotlightSurface>
    );
}

export function CanvasAlignmentGuides({ guides, viewport, containerRef, color }: { guides: { vertical: number | null; horizontal: number | null }; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; color: string }) {
    const verticalRef = useRef<HTMLDivElement>(null);
    const horizontalRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const update = (nextViewport: ViewportTransform) => {
            if (verticalRef.current && typeof guides.vertical === "number") verticalRef.current.style.left = `${nextViewport.x + guides.vertical * nextViewport.k}px`;
            if (horizontalRef.current && typeof guides.horizontal === "number") horizontalRef.current.style.top = `${nextViewport.y + guides.horizontal * nextViewport.k}px`;
        };
        update(viewport);
        return subscribeCanvasViewportPreview(container, update);
    }, [containerRef, guides.horizontal, guides.vertical, viewport]);

    return (
        <>
            {typeof guides.vertical === "number" ? <div ref={verticalRef} className="pointer-events-none absolute bottom-0 top-0 z-[55] border-l border-dashed" style={{ left: viewport.x + guides.vertical * viewport.k, borderColor: color }} /> : null}
            {typeof guides.horizontal === "number" ? <div ref={horizontalRef} className="pointer-events-none absolute left-0 right-0 z-[55] border-t border-dashed" style={{ top: viewport.y + guides.horizontal * viewport.k, borderColor: color }} /> : null}
        </>
    );
}

function ConnectionCreateOption({ motionEnabled, icon, title, description, onClick }: { motionEnabled: boolean; icon: ReactNode; title: string; description?: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <motion.button type="button" whileHover={motionEnabled ? { x: 2 } : undefined} whileTap={motionEnabled ? { scale: 0.98 } : undefined} transition={aceternityMotion.spring.dock} className="group flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-[9px] border border-transparent px-2 py-1.5 text-left outline-none hover:border-black/10 hover:bg-black/5 focus-visible:ring-2 dark:hover:border-white/10 dark:hover:bg-white/8" style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted } as CSSProperties} onClick={onClick}>
            <span className="grid size-7 shrink-0 place-items-center rounded-[8px] opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5" style={{ background: theme.toolbar.itemHover }}>{icon}</span>
            <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2 text-[10px] font-semibold leading-4">{title}</span>
                {description ? <span className="mt-0.5 block truncate text-[8px]" style={{ color: theme.node.muted }}>{description}</span> : null}
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

function getNodePanelPosition(node: CanvasNodeData, viewport: ViewportTransform, viewportSize: { width: number; height: number }, panelWidth: number, panelHeight: number) {
    const gap = 10;
    const margin = 12;
    const topBoundary = 72;
    const nodeCenterX = viewport.x + (node.position.x + node.width / 2) * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + node.height) * viewport.k;
    const maxLeft = Math.max(margin, viewportSize.width - panelWidth - margin);
    const left = clamp(nodeCenterX - panelWidth / 2, margin, maxLeft);
    const belowTop = nodeBottom + gap;
    const aboveTop = nodeTop - panelHeight - gap;
    const preferredTop = belowTop + panelHeight <= viewportSize.height - margin ? belowTop : aboveTop;
    return {
        left,
        top: clamp(preferredTop, topBoundary, Math.max(topBoundary, viewportSize.height - panelHeight - margin)),
    };
}
