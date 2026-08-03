import React, { useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { STORYBOARD_HEADER_HEIGHT, STORYBOARD_ROW_HEIGHT, storyboardTableHeight } from "@/components/canvas/canvas-script-node";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position } from "@/types/canvas";

export const ConnectionPath = React.memo(function ConnectionPath({
    connection,
    from,
    to,
    fromScrollTop = 0,
    toScrollTop = 0,
    active,
    visualMode = "full",
    onSelect,
    onContextMenu,
}: {
    connection: CanvasConnection;
    from: CanvasNodeData;
    to: CanvasNodeData;
    fromScrollTop?: number;
    toScrollTop?: number;
    active: boolean;
    visualMode?: "full" | "hover-only";
    onSelect: () => void;
    onContextMenu?: (event: ReactMouseEvent<SVGPathElement>) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const { pathD, startX, startY, endX, endY } = canvasConnectionPath(connection, from, to, fromScrollTop, toScrollTop);
    const emphasized = active || hovered;
    const showVisual = visualMode === "full" || hovered;
    const gradientId = `canvas-flow-${connection.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    return (
        <g>
            <defs>
                <linearGradient id={gradientId} gradientUnits="userSpaceOnUse" x1={startX} y1={startY} x2={endX} y2={endY}>
                    <stop offset="0%" stopColor={theme.node.muted} stopOpacity={emphasized ? 0.18 : 0.12} />
                    <stop offset="48%" stopColor={theme.accent.primary} stopOpacity={emphasized ? 0.58 : 0.35} />
                    <stop offset="100%" stopColor={theme.accent.primary} stopOpacity={emphasized ? 0.34 : 0.2} />
                </linearGradient>
            </defs>
            <path
                data-connection-id={connection.id}
                d={pathD}
                stroke="transparent"
                strokeWidth="16"
                vectorEffect="non-scaling-stroke"
                fill="none"
                style={{ cursor: "pointer", pointerEvents: "stroke" }}
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                onClick={(event) => {
                    event.stopPropagation();
                    onSelect();
                }}
                onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onContextMenu?.(event);
                }}
            />
            {showVisual ? <path
                d={pathD}
                stroke={emphasized ? theme.accent.primary : theme.node.muted}
                strokeWidth={emphasized ? 1.6 : 1}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={emphasized ? 0.52 : 0.24}
                fill="none"
                strokeLinecap="round"
                style={{ pointerEvents: "none" }}
            /> : null}
            {showVisual ? <path
                className="canvas-connection-flow"
                d={pathD}
                stroke={`url(#${gradientId})`}
                strokeWidth={emphasized ? 1.8 : 1.2}
                vectorEffect="non-scaling-stroke"
                strokeOpacity={emphasized ? 1 : 0.4}
                strokeDasharray={emphasized ? "12 18" : "8 22"}
                fill="none"
                strokeLinecap="round"
                style={{
                    filter: emphasized ? `drop-shadow(0 0 3px ${theme.accent.primary}35)` : "none",
                    pointerEvents: "none",
                    animationDuration: emphasized ? "0.9s" : "1.5s",
                }}
            /> : null}
        </g>
    );
}, (previous, next) => previous.connection === next.connection && previous.from === next.from && previous.to === next.to && previous.active === next.active && previous.visualMode === next.visualMode && previous.fromScrollTop === next.fromScrollTop && previous.toScrollTop === next.toScrollTop);

export function canvasConnectionPath(connection: CanvasConnection, from: CanvasNodeData, to: CanvasNodeData, fromScrollTop = 0, toScrollTop = 0) {
    const startX = from.position.x + from.width;
    const startY = connectionHandleY(from, connection.fromHandleId, fromScrollTop, connection.fromAnchorRatio);
    const endX = to.position.x;
    const endY = connectionHandleY(to, connection.toHandleId, toScrollTop, connection.toAnchorRatio);
    const dx = Math.abs(endX - startX);
    const curvature = Math.max(dx * 0.5, 50);
    return { pathD: `M ${startX} ${startY} C ${startX + curvature} ${startY}, ${endX - curvature} ${endY}, ${endX} ${endY}`, startX, startY, endX, endY };
}

export function activeConnectionPath(node: CanvasNodeData | undefined, handle: ConnectionHandle, mouseWorld: Position, target?: CanvasNodeData, nodeScrollTop = 0, targetAnchorRatio?: number) {
    if (!node) return "";
    const startX = handle.handleType === "source" ? node.position.x + node.width : mouseWorld.x;
    const startY = handle.handleType === "source" ? connectionHandleY(node, handle.handleId, nodeScrollTop, handle.anchorRatio) : mouseWorld.y;
    const endX = handle.handleType === "source" ? mouseWorld.x : node.position.x;
    const endY = handle.handleType === "source" ? mouseWorld.y : connectionHandleY(node, handle.handleId, nodeScrollTop, handle.anchorRatio);
    const snappedStartX = handle.handleType === "target" && target ? target.position.x + target.width : startX;
    const snappedStartY = handle.handleType === "target" && target ? connectionHandleY(target, undefined, 0, targetAnchorRatio) : startY;
    const snappedEndX = handle.handleType === "source" && target ? target.position.x : endX;
    const snappedEndY = handle.handleType === "source" && target ? connectionHandleY(target, undefined, 0, targetAnchorRatio) : endY;
    const distance = Math.abs(snappedEndX - snappedStartX);
    return `M ${snappedStartX} ${snappedStartY} C ${snappedStartX + distance * 0.5} ${snappedStartY}, ${snappedEndX - distance * 0.5} ${snappedEndY}, ${snappedEndX} ${snappedEndY}`;
}

export function connectionHandleY(node: CanvasNodeData, handleId?: string, scrollTop = 0, anchorRatio?: number) {
    if (handleId === "storyboard:context") return node.position.y + node.height - (node.metadata?.storyboardComposerHeight || 104) / 2;
    if (!handleId?.startsWith("row:")) return node.position.y + node.height * normalizedAnchorRatio(anchorRatio);
    const rowId = handleId.slice(4);
    const index = (node.metadata?.storyboard?.rows || []).findIndex((row) => row.id === rowId);
    if (index < 0) return node.position.y + node.height / 2;
    const tableHeight = storyboardTableHeight(node.height, node.metadata?.storyboardComposerHeight);
    const localY = Math.min(Math.max(index * STORYBOARD_ROW_HEIGHT + STORYBOARD_ROW_HEIGHT / 2 - scrollTop, 4), tableHeight - 4);
    return node.position.y + STORYBOARD_HEADER_HEIGHT + localY;
}

function normalizedAnchorRatio(value?: number) {
    if (typeof value !== "number" || !Number.isFinite(value)) return 0.5;
    return Math.min(0.94, Math.max(0.06, value));
}
