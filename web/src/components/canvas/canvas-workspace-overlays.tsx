import { motion, useReducedMotion } from "motion/react";
import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { Clapperboard, Image as ImageIcon, List, Music2, Pencil, Table2, Video, Workflow as WorkflowIcon, ArrowRightLeft } from "lucide-react";

import { useCanvasOverlayLayer } from "@/components/canvas/canvas-overlay-layer";
import { canvasThemes } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasOverlayBounds, observeCanvasOverlayBounds, placeCanvasNodePanel, updateCanvasNodePanelBounds } from "@/lib/canvas/canvas-overlay-layout";
import { subscribeCanvasGraphicsViewportPreview, subscribeCanvasNodeDragPreview, subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { CanvasNodeType, type CanvasNodeData, type ConnectionHandle, type Position, type ViewportTransform } from "@/types/canvas";
import { useCanvasNodeResizeMotion } from "./canvas-node-resize-motion";

export type PendingConnectionCreate = {
    connection: ConnectionHandle;
    position: Position;
    quick?: boolean;
    batchSourceNodeIds?: string[];
};

export function CanvasSelectionToolbar({ anchorRef, containerRef, count, children }: { anchorRef: RefObject<HTMLDivElement | null>; containerRef: RefObject<HTMLDivElement | null>; count: number; children: ReactNode }) {
    const theme = canvasThemes[useActiveTheme()];
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
            setAnchor((current) => (current?.left === left && current.top === top && current.placement === placement ? current : { left, top, placement }));
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
            <motion.div
                initial={reducedMotion ? { opacity: 0 } : { opacity: 0, scale: 0.9, y: anchor.placement === "above" ? 8 : -8 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={aceternityMotion.spring.panel}
                className="flex items-center gap-2"
            >
                <span
                    className="aceternity-floating-panel shrink-0 rounded-full border px-2 py-2 text-[var(--fs-tiny)] font-semibold tabular-nums backdrop-blur-2xl"
                    style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.accent.primary }}
                >
                    已选 {count}
                </span>
                <div className="max-w-[min(560px,calc(100vw-90px))]">{children}</div>
            </motion.div>
        </div>
    );
}

export function CanvasNodePanelOverlay({
    node,
    viewport,
    containerRef,
    panelWidth,
    panelHeight = 190,
    dragOffset,
    isDragging = false,
    allowOverflow = false,
    children,
}: {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    panelWidth?: number;
    panelHeight?: number;
    dragOffset?: Position | null;
    isDragging?: boolean;
    allowOverflow?: boolean;
    children: ReactNode;
}) {
    const panelRef = useRef<HTMLDivElement>(null);
    const resizeMotion = useCanvasNodeResizeMotion();
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
        let liveDragOffset = dragOffset;
        let availableBounds = canvasOverlayBounds({ width: container.clientWidth, height: container.clientHeight });
        let measuredHeight = panel.scrollHeight || panelHeight;
        const update = (nextViewport: ViewportTransform) => {
            liveViewport = nextViewport;
            const visualNode = resizeMotion?.resolveNode(node) || node;
            const nextWidth = Math.min(resolveNodePanelWidth(visualNode, nextViewport, panelWidth), Math.max(0, availableBounds.right - availableBounds.left));
            const availableHeight = Math.max(0, availableBounds.bottom - availableBounds.top);
            panel.style.width = `${nextWidth}px`;
            panel.style.maxHeight = `${availableHeight}px`;
            panel.style.overflowY = measuredHeight > availableHeight || !allowOverflow ? "auto" : "visible";
            // 视口预览期间世界层刚写入 transform，读取节点布局会强制浏览器同步
            // layout。节点位置和拖拽偏移已经在这里可用，直接用世界坐标计算浮层位置。
            const position = placeCanvasNodePanel(visualNode, nextViewport, availableBounds, { width: nextWidth, height: measuredHeight }, liveDragOffset);
            panel.style.transform = `translate3d(${position.left}px, ${position.top}px, 0)`;
            updateCanvasNodePanelBounds(container, panel, { left: position.left, top: position.top, right: position.left + nextWidth, bottom: position.top + Math.min(measuredHeight, availableHeight) });
        };
        update(viewport);
        const resizeObserver = new ResizeObserver(() => {
            measuredHeight = panel.scrollHeight || panelHeight;
            update(liveViewport);
        });
        resizeObserver.observe(panel);
        if (panel.firstElementChild) resizeObserver.observe(panel.firstElementChild);
        const stopBounds = observeCanvasOverlayBounds(container, (bounds) => {
            availableBounds = bounds;
            update(liveViewport);
        });
        const unsubscribeViewport = subscribeCanvasGraphicsViewportPreview(container, update);
        const unsubscribeResize = resizeMotion?.subscribeNode(node.id, () => update(liveViewport));
        const unsubscribeDrag = subscribeCanvasNodeDragPreview(container, (preview) => {
            liveDragOffset = preview?.nodeIds.has(node.id) ? { x: preview.x, y: preview.y } : null;
            update(liveViewport);
        });
        return () => {
            resizeObserver.disconnect();
            stopBounds();
            unsubscribeViewport();
            unsubscribeResize?.();
            unsubscribeDrag();
            updateCanvasNodePanelBounds(container, panel, null);
        };
    }, [allowOverflow, containerRef, dragOffset?.x, dragOffset?.y, isDragging, node.height, node.id, node.position.x, node.position.y, node.width, panelHeight, panelWidth, resizeMotion, viewport]);

    return (
        <div
            ref={panelRef}
            data-canvas-no-zoom
            data-canvas-node-panel
            data-popover-anchor-container
            data-canvas-wheel-scroll
            className={`thin-scrollbar absolute max-w-[calc(100%_-_24px)] ${allowOverflow ? "overflow-visible" : "overflow-y-auto"}`}
            style={{ left: 0, top: 0, transform: `translate3d(${initialPosition.left}px, ${initialPosition.top}px, 0)`, width: initialWidth, maxHeight: allowOverflow ? "none" : "calc(100% - 84px)", zIndex }}
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDownCapture={bringToFront}
            onFocusCapture={bringToFront}
            onPointerDown={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
        >
            {children}
        </div>
    );
}

function resolveNodePanelWidth(node: CanvasNodeData, viewport: ViewportTransform, requestedWidth?: number) {
    if (requestedWidth) return requestedWidth;
    return clamp(Math.round(node.width * viewport.k * 1.5), node.type === CanvasNodeType.Config ? 680 : 720, 920);
}

type ConnectionCreateNodeType = CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.BatchTable | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion;

const CONNECTION_CREATE_OPTIONS: Array<{ type: ConnectionCreateNodeType; title: string; description: string; icon: ReactNode }> = [
    { type: CanvasNodeType.Text, title: "文本生成", description: "引用当前内容，生成或改写文本", icon: <List /> },
    { type: CanvasNodeType.Script, title: "分镜脚本", description: "根据剧情拆解镜头，编排分镜脚本", icon: <Clapperboard /> },
    { type: CanvasNodeType.BatchTable, title: "批量创作表", description: "汇总多张图片，批量执行换装或创意生图", icon: <Table2 /> },
    { type: CanvasNodeType.Image, title: "图片生成", description: "结合提示词和参考图，生成新的画面", icon: <ImageIcon /> },
    { type: CanvasNodeType.Config, title: "生成配置", description: "选择模型，或使用已启用的工作流插件", icon: <WorkflowIcon /> },
    { type: CanvasNodeType.Drawing, title: "绘图", description: "以参考图片为底图，自由绘制和标注", icon: <Pencil /> },
    { type: CanvasNodeType.Video, title: "视频生成", description: "结合提示词与参考素材，生成动态视频", icon: <Video /> },
    { type: CanvasNodeType.Audio, title: "音频参考", description: "连接文本或角色卡，创建音频生成节点", icon: <Music2 /> },
    { type: CanvasNodeType.MediaConversion, title: "转换", description: "本地处理图片或视频", icon: <ArrowRightLeft /> },
];

export function CanvasConnectionCreateMenu({
    pending,
    viewport,
    viewportSize,
    containerRef,
    canCreateDrawing,
    getDisabledReason,
    onCreate,
    onClose,
}: {
    pending: PendingConnectionCreate;
    viewport: ViewportTransform;
    viewportSize: { width: number; height: number };
    containerRef: RefObject<HTMLDivElement | null>;
    canCreateDrawing: boolean;
    getDisabledReason: (
        type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.BatchTable | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion,
        provider?: "runninghub",
    ) => string;
    onCreate: (
        type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Script | CanvasNodeType.BatchTable | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Drawing | CanvasNodeType.Config | CanvasNodeType.MediaConversion,
        provider?: "runninghub",
    ) => void;
    onClose: () => void;
}) {
    const theme = canvasThemes[useActiveTheme()];
    const reducedMotion = useReducedMotion();
    const menuRef = useRef<HTMLDivElement>(null);
    const [activeOption, setActiveOption] = useState<string | null>(null);
    const lastPointerRef = useRef<Position | null>(null);
    const { bringToFront, zIndex } = useCanvasOverlayLayer("connection-create-menu", "var(--z-modal-overlay)");
    const options = CONNECTION_CREATE_OPTIONS.filter((option) => canCreateDrawing || option.type !== CanvasNodeType.Drawing);
    const active = options.find((option) => option.title === activeOption);
    const activeDisabledReason = active ? getDisabledReason(active.type) : "";
    const menuWidth = Math.min(288, viewportSize.width - 24);
    // 行高 40 + 间距 2，加列表内边距与底部 52px 说明区；只用于首帧定位，随后按实际高度修正。
    const menuHeight = options.length * 42 + 14 + 52;
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
            const position = getConnectionMenuPosition(pending.position, nextViewport, { width: container.clientWidth, height: container.clientHeight }, menu.offsetWidth || menuWidth, menu.offsetHeight || menuHeight, gap);
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
            className="absolute flex origin-top-left flex-col overflow-hidden rounded-[var(--r-2xl)] border"
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
            {/* 行高固定，说明统一放在底部说明区：悬停只换高亮和说明文字，列表不移动。 */}
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-2">
                <div className="grid min-w-0 grid-cols-1 gap-0.5">
                    {options.map((option) => (
                        <ConnectionCreateOption
                            key={option.type}
                            active={activeOption === option.title}
                            icon={option.icon}
                            title={option.title}
                            description={option.description}
                            disabledReason={getDisabledReason(option.type)}
                            onClick={() => onCreate(option.type)}
                        />
                    ))}
                </div>
            </div>
            <div className="canvas-connection-create-detail" aria-hidden="true" data-motion={reducedMotion ? "reduced" : "enabled"} style={{ borderColor: theme.toolbar.border, color: theme.node.muted }}>
                <p key={active ? `${active.title}:${activeDisabledReason}` : "idle"} className="canvas-connection-create-detail-text">
                    {active && activeDisabledReason ? <span style={{ color: theme.node.text }}>暂不可用 · </span> : null}
                    {active ? activeDisabledReason || active.description : "选择节点类型，新节点会自动连接当前内容"}
                </p>
            </div>
        </motion.div>
    );
}

function ConnectionCreateOption({ active, icon, title, description, disabledReason, onClick }: { active: boolean; icon: ReactNode; title: string; description: string; disabledReason?: string; onClick: () => void }) {
    const theme = canvasThemes[useActiveTheme()];
    return (
        <button
            type="button"
            aria-disabled={Boolean(disabledReason)}
            aria-label={title}
            aria-description={disabledReason || description}
            data-create-option={title}
            data-active={active}
            className="canvas-connection-create-option group flex h-10 w-full shrink-0 cursor-pointer items-center gap-2.5 rounded-[var(--dock-item-radius)] px-2 text-left outline-none focus-visible:ring-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            style={{ color: theme.node.text, "--tw-ring-color": theme.node.muted, background: active ? theme.toolbar.itemHover : undefined } as CSSProperties}
            onClick={() => {
                if (!disabledReason) onClick();
            }}
        >
            <span className="canvas-connection-create-icon grid size-7 shrink-0 place-items-center rounded-[var(--r-md)] [&_svg]:size-3.5" style={{ background: theme.toolbar.itemHover }}>
                {icon}
            </span>
            <span className="min-w-0 flex-1 truncate text-[var(--fs-tiny)] font-semibold leading-4">{title}</span>
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

export function getNodePanelPosition(node: CanvasNodeData, viewport: ViewportTransform, viewportSize: { width: number; height: number }, panelWidth: number, panelHeight: number, dragOffset?: Position | null) {
    return placeCanvasNodePanel(node, viewport, canvasOverlayBounds(viewportSize), { width: panelWidth, height: panelHeight }, dragOffset);
}
