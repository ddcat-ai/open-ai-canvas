import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { ChevronDown, ChevronRight, Video } from "lucide-react";

import { CometCard } from "@/components/ui/aceternity/comet-card";
import { FRAME_HEADER_HEIGHT, FRAME_PADDING } from "@/lib/canvas/canvas-frame";
import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData, type Position } from "@/types/canvas";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";

export const CanvasFrameNode = React.memo(function CanvasFrameNode({
    data,
    dragOffset,
    childNodes,
    scale,
    isSelected,
    isDropTarget,
    onMouseDown,
    onResize,
    onToggleCollapsed,
    onTitleChange,
    onContextMenu,
    readOnly = false,
    onHoverStart,
    onHoverEnd,
}: {
    data: CanvasNodeData;
    dragOffset?: Position;
    childNodes: CanvasNodeData[];
    scale: number;
    isSelected: boolean;
    isDropTarget: boolean;
    onMouseDown: (event: ReactMouseEvent, nodeId: string) => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onToggleCollapsed: (nodeId: string) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    readOnly?: boolean;
    onHoverStart?: (nodeId: string) => void;
    onHoverEnd?: (nodeId: string) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const collapsed = Boolean(data.metadata?.frame?.collapsed);
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(data.title);
    const resizeRef = useRef({
        active: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        nodeId: data.id,
        scale,
        childBounds: null as { left: number; top: number; right: number; bottom: number } | null,
        onResize,
    });

    useEffect(() => setTitle(data.title), [data.title]);

    const commitTitle = () => {
        const next = title.trim() || "未命名背板";
        setTitle(next);
        setEditing(false);
        onTitleChange(data.id, next);
    };

    const childBounds = useMemo(() => {
        if (!childNodes.length) return null;
        const left = Math.min(...childNodes.map((node) => node.position.x));
        const top = Math.min(...childNodes.map((node) => node.position.y));
        const right = Math.max(...childNodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...childNodes.map((node) => node.position.y + node.height));
        return { left, top, right, bottom };
    }, [childNodes]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            const state = resizeRef.current;
            if (!state.active) return;
            const dx = (event.clientX - state.startX) / state.scale;
            const dy = (event.clientY - state.startY) / state.scale;
            const fromLeft = state.corner.includes("left");
            const fromTop = state.corner.includes("top");
            const startRight = state.startLeft + state.startWidth;
            const startBottom = state.startTop + state.startHeight;
            let left = fromLeft ? Math.min(state.startLeft + dx, startRight - 360) : state.startLeft;
            let top = fromTop ? Math.min(state.startTop + dy, startBottom - 240) : state.startTop;
            let right = fromLeft ? startRight : Math.max(state.startLeft + 360, startRight + dx);
            let bottom = fromTop ? startBottom : Math.max(state.startTop + 240, startBottom + dy);

            if (state.childBounds) {
                if (fromLeft) left = Math.min(left, state.childBounds.left - FRAME_PADDING);
                else right = Math.max(right, state.childBounds.right + FRAME_PADDING);
                if (fromTop) top = Math.min(top, state.childBounds.top - FRAME_HEADER_HEIGHT - FRAME_PADDING);
                else bottom = Math.max(bottom, state.childBounds.bottom + FRAME_PADDING);
            }
            state.onResize(state.nodeId, right - left, bottom - top, { x: left, y: top });
        },
        [],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.active = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    useEffect(
        () => () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        },
        [handleResizeMove, handleResizeUp],
    );

    const startResize = (event: ReactMouseEvent, corner: ResizeCorner) => {
        event.preventDefault();
        event.stopPropagation();
        resizeRef.current = {
            active: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            nodeId: data.id,
            scale,
            childBounds,
            onResize,
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    const active = isSelected || isDropTarget;

    return (
        <div
            data-node-id={data.id}
            className={`absolute z-0 select-none ${dragOffset ? "cursor-grabbing" : "cursor-default"}`}
            style={{ transform: `translate(${data.position.x + (dragOffset?.x || 0)}px, ${data.position.y + (dragOffset?.y || 0)}px)`, width: data.width, height: data.height, contain: "layout style" }}
            onMouseDown={(event) => onMouseDown(event, data.id)}
            onDoubleClick={(event) => {
                if (!collapsed || (event.target instanceof Element && event.target.closest("button,input"))) return;
                event.stopPropagation();
                onToggleCollapsed(data.id);
            }}
            onContextMenu={(event) => onContextMenu(event, data.id)}
            onMouseEnter={() => onHoverStart?.(data.id)}
            onMouseLeave={() => onHoverEnd?.(data.id)}
        >
            <CometCard
                containerClassName="h-full w-full"
                className="canvas-frame-shell overflow-hidden rounded-[14px] border"
                rotateDepth={2.4}
                translateDepth={2}
                disabled={Boolean(dragOffset) || !collapsed || editing || scale < 0.32}
                glare={collapsed}
                style={{
                    background: active ? theme.frame.activeFill : theme.frame.fill,
                    borderColor: active ? theme.frame.activeStroke : theme.frame.stroke,
                    borderWidth: 1 / Math.max(scale, 0.05),
                    boxShadow: isSelected ? `0 0 0 ${1 / Math.max(scale, 0.05)}px ${theme.frame.activeStroke}33, 0 24px 72px ${theme.spatial.shadow}` : `0 18px 54px ${theme.spatial.shadow}`,
                    transition: "background-color 120ms ease-out, border-color 120ms ease-out",
                }}
            >
                <div className="pointer-events-auto absolute inset-x-0 top-0 z-10 flex items-center gap-1.5 px-1.5" style={{ height: FRAME_HEADER_HEIGHT, color: theme.node.text }}>
                    <button
                        type="button"
                        className="grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10"
                        style={{ outlineColor: theme.frame.activeStroke }}
                        aria-label={collapsed ? "展开背板" : "折叠背板"}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onToggleCollapsed(data.id);
                        }}
                    >
                        {collapsed ? <ChevronRight className="size-4" /> : <ChevronDown className="size-4" />}
                    </button>
                    {editing ? (
                        <input
                            autoFocus
                            className="h-7 min-w-0 flex-1 rounded border bg-transparent px-1.5 text-sm font-semibold outline-none"
                            style={{ borderColor: theme.frame.activeStroke, color: theme.node.text }}
                            value={title}
                            onChange={(event) => setTitle(event.target.value)}
                            onBlur={commitTitle}
                            onMouseDown={(event) => event.stopPropagation()}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") commitTitle();
                                if (event.key === "Escape") {
                                    setTitle(data.title);
                                    setEditing(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="min-w-0 truncate text-left text-sm font-semibold"
                            title={data.title}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                if (readOnly) return;
                                setEditing(true);
                            }}
                        >
                            {data.title}
                        </button>
                    )}
                    <span className="ml-auto shrink-0 pr-1 text-[11px] tabular-nums" style={{ color: theme.node.muted }}>
                        {childNodes.length}
                    </span>
                </div>

                {collapsed ? <FramePreview nodes={childNodes} frame={data} theme={theme} /> : null}
            </CometCard>
            {!readOnly && !collapsed && isSelected && !data.metadata?.locked ? (
                <>
                    <ResizeHandle corner="top-left" scale={scale} theme={theme} onMouseDown={startResize} />
                    <ResizeHandle corner="top-right" scale={scale} theme={theme} onMouseDown={startResize} />
                    <ResizeHandle corner="bottom-left" scale={scale} theme={theme} onMouseDown={startResize} />
                    <ResizeHandle corner="bottom-right" scale={scale} theme={theme} onMouseDown={startResize} />
                </>
            ) : null}
        </div>
    );
});

function FramePreview({ nodes, frame, theme }: { nodes: CanvasNodeData[]; frame: CanvasNodeData; theme: CanvasTheme }) {
    const layout = useMemo(() => {
        if (!nodes.length) return [];
        const previewNodes = nodes.slice(0, 24);
        const left = Math.min(...previewNodes.map((node) => node.position.x));
        const top = Math.min(...previewNodes.map((node) => node.position.y));
        const right = Math.max(...previewNodes.map((node) => node.position.x + node.width));
        const bottom = Math.max(...previewNodes.map((node) => node.position.y + node.height));
        const width = Math.max(right - left, 1);
        const height = Math.max(bottom - top, 1);
        const previewWidth = Math.max(frame.width - 16, 1);
        const previewHeight = Math.max(frame.height - FRAME_HEADER_HEIGHT - 8, 1);
        const scale = Math.min(previewWidth / width, previewHeight / height);
        const offsetX = (previewWidth - width * scale) / 2;
        const offsetY = (previewHeight - height * scale) / 2;
        return previewNodes.map((node) => ({
            node,
            left: offsetX + (node.position.x - left) * scale,
            top: offsetY + (node.position.y - top) * scale,
            width: Math.max(node.width * scale, 12),
            height: Math.max(node.height * scale, 10),
        }));
    }, [frame.height, frame.width, nodes]);

    return (
        <div className="pointer-events-none absolute inset-x-2 bottom-2 overflow-hidden rounded-md" style={{ top: FRAME_HEADER_HEIGHT, background: theme.frame.preview }}>
            {layout.length ? (
                layout.map(({ node, ...style }) => (
                    <div key={node.id} className="absolute overflow-hidden rounded-[3px] border" style={{ ...style, background: theme.node.fill, borderColor: theme.node.stroke }}>
                        {node.type === CanvasNodeType.Image && node.metadata?.content ? <img src={node.metadata.content} alt="" className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} /> : null}
                        {node.type === CanvasNodeType.Video && node.metadata?.content ? <video src={node.metadata.content} className="h-full w-full object-cover" muted playsInline preload="metadata" /> : null}
                        {node.type === CanvasNodeType.Video && !node.metadata?.content ? <Video className="m-auto size-4 h-full opacity-40" /> : null}
                        {node.type === CanvasNodeType.Text ? <div className="line-clamp-3 p-1 text-[7px] leading-[9px]" style={{ color: theme.node.text }}>{node.metadata?.content || node.title}</div> : null}
                        {node.type === CanvasNodeType.Script ? <div className="p-1 text-[7px] leading-[9px]" style={{ color: theme.node.text }}>分镜脚本 · {node.metadata?.storyboard?.rows.length || 0} 镜</div> : null}
                    </div>
                ))
            ) : (
                <div className="grid h-full place-items-center text-[11px]" style={{ color: theme.node.faint }}>空背板</div>
            )}
        </div>
    );
}

function ResizeHandle({ corner, scale, theme, onMouseDown }: { corner: ResizeCorner; scale: number; theme: CanvasTheme; onMouseDown: (event: ReactMouseEvent, corner: ResizeCorner) => void }) {
    const inverseScale = 1 / Math.max(scale, 0.05);
    const size = 14 * inverseScale;
    const offset = -size / 2;
    const fromTop = corner.includes("top");
    const fromLeft = corner.includes("left");
    const cursor = corner === "top-left" || corner === "bottom-right" ? "nwse-resize" : "nesw-resize";

    return (
        <button
            type="button"
            aria-label="调整背板尺寸"
            className="pointer-events-auto absolute z-20 rounded-sm shadow-sm"
            style={{
                top: fromTop ? offset : undefined,
                bottom: fromTop ? undefined : offset,
                left: fromLeft ? offset : undefined,
                right: fromLeft ? undefined : offset,
                width: size,
                height: size,
                cursor,
                background: theme.frame.activeStroke,
                border: `${2 * inverseScale}px solid ${theme.canvas.background}`,
            }}
            onMouseDown={(event) => onMouseDown(event, corner)}
        />
    );
}
