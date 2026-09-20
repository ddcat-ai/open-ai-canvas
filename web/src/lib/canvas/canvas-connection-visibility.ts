import type { CanvasDisplayConnection } from "@/types/canvas";

export const CANVAS_HIDE_NODE_CONNECTIONS_STORAGE_KEY = "canvas-hide-node-connections";

export function readCanvasHideNodeConnections() {
    if (typeof window === "undefined") return false;
    try {
        return window.localStorage.getItem(CANVAS_HIDE_NODE_CONNECTIONS_STORAGE_KEY) === "true";
    } catch {
        return false;
    }
}

export function persistCanvasHideNodeConnections(value: boolean) {
    try {
        window.localStorage.setItem(CANVAS_HIDE_NODE_CONNECTIONS_STORAGE_KEY, String(value));
    } catch {
        // 浏览器禁用本地存储时保留当前会话内的选择。
    }
}

/**
 * 隐藏模式只保留当前交互焦点的直接连线。
 * 该函数返回同一份结果给 Leafer 视觉层和 SVG 命中层，避免“看不见但仍能点到”的幽灵连线。
 */
export function filterCanvasDisplayConnections(
    connections: CanvasDisplayConnection[],
    options: {
        enabled: boolean;
        hoveredNodeId?: string | null;
        selectedNodeIds?: ReadonlySet<string>;
        activeNodeId?: string | null;
        selectedConnectionId?: string | null;
    },
) {
    if (!options.enabled) return connections;

    const focusedNodeIds = new Set<string>();
    if (options.hoveredNodeId) focusedNodeIds.add(options.hoveredNodeId);
    if (options.activeNodeId) focusedNodeIds.add(options.activeNodeId);
    options.selectedNodeIds?.forEach((nodeId) => focusedNodeIds.add(nodeId));

    return connections.filter(
        ({ connection, from, to }) => connection.id === options.selectedConnectionId || focusedNodeIds.has(connection.fromNodeId) || focusedNodeIds.has(connection.toNodeId) || focusedNodeIds.has(from.id) || focusedNodeIds.has(to.id),
    );
}
