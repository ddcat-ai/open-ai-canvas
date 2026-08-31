import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";

export type CanvasLayoutMode = "row" | "column" | "grid";
export type CanvasAlignmentMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY";
export type CanvasLayoutLane = "text" | "image" | "video" | "audio";

const FLOW_COLUMN_GAP = 120;
const LANE_GAP = 96;
const LANE_NODE_GAP = 36;
const GRID_NODE_GAP = 32;
const LANE_ORDER: CanvasLayoutLane[] = ["text", "image", "video", "audio"];

export function layoutCanvasNodes(nodes: CanvasNodeData[], mode: CanvasLayoutMode) {
    const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
    const left = Math.min(...sorted.map((node) => node.position.x));
    const top = Math.min(...sorted.map((node) => node.position.y));
    const gap = 32;
    const result = new Map<string, Position>();

    if (mode === "row") {
        let x = left;
        sorted.forEach((node) => {
            result.set(node.id, { x, y: top });
            x += node.width + gap;
        });
        return result;
    }

    if (mode === "column") {
        let y = top;
        sorted.forEach((node) => {
            result.set(node.id, { x: left, y });
            y += node.height + gap;
        });
        return result;
    }

    const columns = Math.ceil(Math.sqrt(sorted.length));
    const cellWidth = Math.max(...sorted.map((node) => node.width)) + gap;
    const cellHeight = Math.max(...sorted.map((node) => node.height)) + gap;
    sorted.forEach((node, index) => result.set(node.id, { x: left + (index % columns) * cellWidth, y: top + Math.floor(index / columns) * cellHeight }));
    return result;
}

export function layoutCanvasFlow(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    if (!nodes.length) return new Map<string, Position>();
    const selectedIds = new Set(nodes.map((node) => node.id));
    const inbound = new Map(nodes.map((node) => [node.id, 0]));
    const outbound = new Map(nodes.map((node) => [node.id, [] as string[]]));

    connections.forEach((connection) => {
        if (!selectedIds.has(connection.fromNodeId) || !selectedIds.has(connection.toNodeId)) return;
        inbound.set(connection.toNodeId, (inbound.get(connection.toNodeId) || 0) + 1);
        outbound.get(connection.fromNodeId)?.push(connection.toNodeId);
    });

    // Kahn 拓扑分层让依赖方向保持从左到右；环形连接留在第一层，避免布局死循环。
    const queue = nodes.filter((node) => !inbound.get(node.id)).map((node) => node.id);
    const layerById = new Map<string, number>();
    queue.forEach((id) => layerById.set(id, 0));
    while (queue.length) {
        const id = queue.shift()!;
        const layer = layerById.get(id) || 0;
        outbound.get(id)?.forEach((target) => {
            layerById.set(target, Math.max(layerById.get(target) || 0, layer + 1));
            inbound.set(target, (inbound.get(target) || 1) - 1);
            if (!inbound.get(target)) queue.push(target);
        });
    }
    nodes.forEach((node) => {
        if (!layerById.has(node.id)) layerById.set(node.id, 0);
    });

    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const result = new Map<string, Position>();
    const layers = [...new Set(layerById.values())].sort((a, b) => a - b);
    const layerX = new Map<number, number>();
    let x = left;
    layers.forEach((layer) => {
        const layerNodes = nodes.filter((node) => layerById.get(node.id) === layer);
        layerX.set(layer, x);
        x += Math.max(...layerNodes.map((node) => node.width)) + FLOW_COLUMN_GAP;
    });

    let laneTop = top;
    LANE_ORDER.forEach((lane) => {
        const laneNodes = nodes.filter((node) => canvasLayoutLane(node) === lane);
        if (!laneNodes.length) return;
        const stacks = new Map<number, CanvasNodeData[]>();
        laneNodes.forEach((node) => {
            const layer = layerById.get(node.id) || 0;
            stacks.set(layer, [...(stacks.get(layer) || []), node]);
        });
        let laneHeight = 0;
        stacks.forEach((stack) => {
            const height = stack.reduce((sum, node) => sum + node.height, 0) + Math.max(0, stack.length - 1) * LANE_NODE_GAP;
            laneHeight = Math.max(laneHeight, height);
        });
        stacks.forEach((stack, layer) => {
            let y = laneTop;
            stack.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x).forEach((node) => {
                result.set(node.id, { x: layerX.get(layer) || left, y });
                y += node.height + LANE_NODE_GAP;
            });
        });
        laneTop += laneHeight + LANE_GAP;
    });
    return result;
}

export function layoutCanvasNodesByMediaType(nodes: CanvasNodeData[]) {
    if (!nodes.length) return new Map<string, Position>();
    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const result = new Map<string, Position>();
    let laneTop = top;

    LANE_ORDER.forEach((lane) => {
        const laneNodes = nodes.filter((node) => canvasLayoutLane(node) === lane).sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
        if (!laneNodes.length) return;
        const columns = Math.min(4, Math.max(1, Math.ceil(Math.sqrt(laneNodes.length))));
        const cellWidth = Math.max(...laneNodes.map((node) => node.width)) + GRID_NODE_GAP;
        const cellHeight = Math.max(...laneNodes.map((node) => node.height)) + GRID_NODE_GAP;
        laneNodes.forEach((node, index) => {
            result.set(node.id, {
                x: left + (index % columns) * cellWidth,
                y: laneTop + Math.floor(index / columns) * cellHeight,
            });
        });
        laneTop += Math.ceil(laneNodes.length / columns) * cellHeight - GRID_NODE_GAP + LANE_GAP;
    });
    return result;
}

export function layoutCanvasAuto(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const candidates = nodes.filter((node) => !node.metadata?.locked && node.type !== CanvasNodeType.Frame);
    if (candidates.length < 2) return new Map<string, Position>();
    const candidateIds = new Set(candidates.map((node) => node.id));
    const hasConnections = connections.some((connection) => candidateIds.has(connection.fromNodeId) && candidateIds.has(connection.toNodeId));
    return hasConnections ? layoutCanvasFlow(candidates, connections) : layoutCanvasNodesByMediaType(candidates);
}

export function canvasLayoutLane(node: CanvasNodeData): CanvasLayoutLane {
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.Compare || node.type === CanvasNodeType.ColorGrade) return "image";
    return "text";
}

export function alignCanvasNodes(nodes: CanvasNodeData[], mode: CanvasAlignmentMode) {
    const result = new Map<string, Position>();
    if (nodes.length < 2) return result;
    const left = Math.min(...nodes.map((node) => node.position.x));
    const top = Math.min(...nodes.map((node) => node.position.y));
    const right = Math.max(...nodes.map((node) => node.position.x + node.width));
    const bottom = Math.max(...nodes.map((node) => node.position.y + node.height));
    const centerX = (left + right) / 2;
    const centerY = (top + bottom) / 2;

    if (mode === "distributeX") {
        const sorted = [...nodes].sort((a, b) => a.position.x - b.position.x);
        const totalWidth = sorted.reduce((sum, node) => sum + node.width, 0);
        const gap = (right - left - totalWidth) / Math.max(1, sorted.length - 1);
        let x = left;
        sorted.forEach((node) => {
            result.set(node.id, { x, y: node.position.y });
            x += node.width + gap;
        });
        return result;
    }

    if (mode === "distributeY") {
        const sorted = [...nodes].sort((a, b) => a.position.y - b.position.y);
        const totalHeight = sorted.reduce((sum, node) => sum + node.height, 0);
        const gap = (bottom - top - totalHeight) / Math.max(1, sorted.length - 1);
        let y = top;
        sorted.forEach((node) => {
            result.set(node.id, { x: node.position.x, y });
            y += node.height + gap;
        });
        return result;
    }

    nodes.forEach((node) => {
        const x = mode === "left" ? left : mode === "centerX" ? centerX - node.width / 2 : mode === "right" ? right - node.width : node.position.x;
        const y = mode === "top" ? top : mode === "centerY" ? centerY - node.height / 2 : mode === "bottom" ? bottom - node.height : node.position.y;
        result.set(node.id, { x, y });
    });
    return result;
}

export function nextCanvasVersionLabel(rootId: string, nodes: CanvasNodeData[]) {
    const labels = nodes
        .filter((node) => (node.metadata?.versionOfNodeId || node.id) === rootId)
        .map((node) => node.metadata?.versionLabel)
        .filter((label): label is string => Boolean(label));
    if (!labels.length) return "B";
    const highest = Math.max(...labels.map((label) => label.charCodeAt(0)), "A".charCodeAt(0));
    return String.fromCharCode(Math.min("Z".charCodeAt(0), highest + 1));
}
