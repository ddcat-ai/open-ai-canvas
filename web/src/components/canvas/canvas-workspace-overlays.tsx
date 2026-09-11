import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Clapperboard, Image as ImageIcon, List, Music2, Pencil, Video, WandSparkles, Workflow as WorkflowIcon } from "lucide-react";

import { useCanvasOverlayLayer } from "@/components/canvas/canvas-overlay-layer";
import { canvasThemes } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
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

export function CanvasNodePanelOverlay({ node, viewport, containerRef, panelWidth, panelHeight = 190, dragOffset, isDragging = false, allowOverflow = false, children }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; panelWidth?: number; panelHeight?: number; dragOffset?: Position | null; isDragging?: boolean; allowOverflow?: boolean; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
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
        let liveViewport = viewport;
        let viewportSize = { width: container.clientWidth, height: container.clientHeight };
        const update = (nextViewport: ViewportTransform) => {
            liveViewport = nextViewport;
            const nextWidth = resolveNodePanelWidth(node, nextViewport, panelWidth);
            panel.style.width = `${nextWidth}px`;
            const position = getNodePanelPosition(
                node,
                nextViewport,
                viewportSize,
                nextWidth,
                panelHeight,
                dragOffset,
            );
            panel.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
        };
        update(viewport);
        const resizeObserver = new ResizeObserver(() => {
            viewportSize = { width: container.clientWidth, height: container.clientHeight };
            update(liveViewport);
        });
        resizeObserver.observe(container);
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, update);
        return () => {
            resizeObserver.disconnect();
            unsubscribeViewport();
        };
    }, [containerRef, dragOffset?.x, dragOffset?.y, isDragging, node.height, node.id, node.position.x, node.position.y, node.width, panelHeight, panelWidth, viewport]);

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            data-canvas-node-panel
            className={`thin-scrollbar absolute max-w-[calc(100%_-_24px)] ${allowOverflow ? "overflow-visible" : "overflow-y-auto"}`}
            style={{ left: 0, top: 0, transform: `translate3d(${initialPosition.left}px, ${initialPosition.top}px, 0)`, width: initialWidth, maxHeight: allowOverflow ? "none" : "calc(100% - 84px)", zIndex }}
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

export function CanvasConnectionCreateMenu({ pending, viewport, viewportSize, containerRef, canCreateDrawing, getDisabledReason, onCreate, onClose }: { pending: PendingConnectionCreate; viewport: ViewportTransform; viewportSize: { width: number; height: number }; containerRef: RefObject<HTMLDivElement | null>; canCreateDrawing: boolean; getDisabledReason: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion, provider?: "runninghub" | "comfyui") => string; onCreate: (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion, provider?: "runninghub" | "comfyui") => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const menuRef = useRef<HTMLDivElement>(null);
    const [activeOption, setActiveOption] = useState<string | null>(null);
    const lastPointerRef = useRef<Position | null>(null);
    const { bringToFront, zIndex } = useCanvasOverlayLayer("connection-create-menu", "var(--z-modal-overlay)");
    const menuWidth = Math.min(288, viewportSize.width - 24);
    const menuHeight = canCreateDrawing ? 404 : 360;
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
        <motion.div
            ref={menuRef}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: aceternityMotion.duration.instant, ease: aceternityMotion.easing.enter }}
            className="thin-scrollbar absolute origin-top-left overflow-x-hidden overflow-y-auto rounded-[var(--r-2xl)] border p-2"
            data-canvas-no-zoom
            data-connection-create-menu
            aria-label="创建下一步"
            onKeyDown={(event) => {
                if (event.key === "Escape") {
                    event.stopPropagation();
                    onClose();
                }
            }}
            style={{ width: menuWidth, maxHeight: Math.max(120, viewportSize.height - 84), left: initialPosition.left, top: initialPosition.top, zIndex, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDownCapture={bringToFront}
            onFocusCapture={(event) => {
                bringToFront();
                if (event.target.matches(":focus-visible")) setActiveOption(event.target.closest<HTMLElement>("[data-create-option]")?.dataset.createOption || null);
            }}
            onBlurCapture={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget)) setActiveOption(null);
            }}
            onPointerMove={(event) => {
                if (event.pointerType === "touch") return;
                const previous = lastPointerRef.current;
                // Layout changes can retarget a stationary pointer; only real movement selects a new row.
                if (previous?.x === event.clientX && previous.y === event.clientY) return;
                lastPointerRef.current = { x: event.clientX, y: event.clientY };
                const option = (event.target as Element).closest<HTMLElement>("[data-create-option]")?.dataset.createOption;
                if (option) setActiveOption(option);
            }}
            onPointerLeave={() => {
                lastPointerRef.current = null;
                setActiveOption(null);
            }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="grid min-w-0 grid-cols-1 gap-1">
                <ConnectionCreateOption expanded={activeOption === "文本生成"} motionEnabled={!reducedMotion} icon={<List className="size-4" />} title="文本生成" description="引用当前内容，生成或改写文本" disabledReason={getDisabledReason(CanvasNodeType.Text)} onClick={() => onCreate(CanvasNodeType.Text)} />
                <ConnectionCreateOption expanded={activeOption === "分镜脚本"} motionEnabled={!reducedMotion} icon={<Clapperboard className="size-4" />} title="分镜脚本" description="根据剧情拆解镜头，编排分镜脚本" disabledReason={getDisabledReason(CanvasNodeType.Script)} onClick={() => onCreate(CanvasNodeType.Script)} />
                <ConnectionCreateOption expanded={activeOption === "图片生成"} motionEnabled={!reducedMotion} icon={<ImageIcon className="size-4" />} title="图片生成" description="结合提示词和参考图，生成新的画面" disabledReason={getDisabledReason(CanvasNodeType.Image)} onClick={() => onCreate(CanvasNodeType.Image)} />
                <ConnectionCreateOption expanded={activeOption === "生成配置"} motionEnabled={!reducedMotion} icon={<WorkflowIcon className="size-4" />} title="生成配置" description="选择模型，或使用已启用的工作流插件" disabledReason={getDisabledReason(CanvasNodeType.Config)} onClick={() => onCreate(CanvasNodeType.Config)} />
                {canCreateDrawing ? <ConnectionCreateOption expanded={activeOption === "绘图"} motionEnabled={!reducedMotion} icon={<Pencil className="size-4" />} title="绘图" description="以参考图片为底图，自由绘制和标注" disabledReason={getDisabledReason(CanvasNodeType.Drawing)} onClick={() => onCreate(CanvasNodeType.Drawing)} /> : null}
                <ConnectionCreateOption expanded={activeOption === "视频生成"} motionEnabled={!reducedMotion} icon={<Video className="size-4" />} title="视频生成" description="结合提示词与参考素材，生成动态视频" disabledReason={getDisabledReason(CanvasNodeType.Video)} onClick={() => onCreate(CanvasNodeType.Video)} />
                <ConnectionCreateOption expanded={activeOption === "音频参考"} motionEnabled={!reducedMotion} icon={<Music2 className="size-4" />} title="音频参考" description="连接文本或角色卡，创建音频生成节点" disabledReason={getDisabledReason(CanvasNodeType.Audio)} onClick={() => onCreate(CanvasNodeType.Audio)} />
                <ConnectionCreateOption expanded={activeOption === "转换"} motionEnabled={!reducedMotion} icon={<WandSparkles className="size-4" />} title="转换" description="本地处理图片或视频" disabledReason={getDisabledReason(CanvasNodeType.MediaConversion)} onClick={() => onCreate(CanvasNodeType.MediaConversion)} />
            </div>
        </motion.div>
    );
}

function ConnectionCreateOption({ expanded, motionEnabled, icon, title, description, disabledReason, onClick }: { expanded: boolean; motionEnabled: boolean; icon: ReactNode; title: string; description: string; disabledReason?: string; onClick: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <button type="button" aria-disabled={Boolean(disabledReason)} aria-label={title} aria-description={disabledReason || description} data-create-option={title} data-expanded={expanded} data-motion={motionEnabled ? "enabled" : "reduced"} className="canvas-connection-create-option group flex min-h-10 w-full cursor-pointer items-start gap-2 rounded-[var(--dock-item-radius)] px-2 py-1.5 text-left outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40" style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted, background: expanded ? theme.toolbar.itemHover : undefined } as CSSProperties} onClick={() => { if (!disabledReason) onClick(); }}>
            <span className="grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] opacity-65 transition-opacity group-hover:opacity-100 [&_svg]:size-3.5" style={{ background: theme.toolbar.itemHover }}>{icon}</span>
            <span className="min-w-0 flex-1 pt-1.5">
                <span className="flex items-center gap-2 text-[var(--fs-tiny)] font-semibold leading-4">{title}</span>
                <span aria-hidden="true" className="canvas-connection-create-description" style={{ color: theme.node.muted }}><span className="min-h-0 overflow-hidden"><span className="block pt-1 whitespace-normal break-words text-[var(--fs-micro)] leading-relaxed">{disabledReason || description}</span></span></span>
            </span>
        </button>
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

export function getNodePanelPosition(node: CanvasNodeData, viewport: ViewportTransform, viewportSize: { width: number; height: number }, panelWidth: number, _panelHeight: number, dragOffset?: Position | null) {
    const gap = 10;
    const margin = 12;
    const offsetX = dragOffset?.x || 0;
    const offsetY = dragOffset?.y || 0;
    const nodeCenterX = viewport.x + (node.position.x + offsetX + node.width / 2) * viewport.k;
    const nodeBottom = viewport.y + (node.position.y + offsetY + node.height) * viewport.k;
    const maxLeft = Math.max(margin, viewportSize.width - panelWidth - margin);
    const left = clamp(nodeCenterX - panelWidth / 2, margin, maxLeft);
    return {
        left,
        top: nodeBottom + gap,
        placement: "below" as const,
    };
}
