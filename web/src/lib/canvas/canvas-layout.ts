import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "@/types/canvas";
import { canvasNodeBounds } from "@/lib/canvas/canvas-spatial-index";

export type CanvasLayoutMode = "row" | "column" | "grid";
export type CanvasAlignmentMode = "left" | "centerX" | "right" | "top" | "centerY" | "bottom" | "distributeX" | "distributeY";
export type CanvasLayoutLane = "text" | "image" | "video" | "audio";

const FLOW_COLUMN_GAP = 120;
// 节点标题挂在节点上方约 24px，行距必须大于它，否则上一行底部会压住下一行标题。
const FLOW_ROW_GAP = 48;
const LANE_GAP = 96;
const GRID_NODE_GAP = 48;
const LANE_MAX_COLUMNS = 6;
const BLOCK_GAP = 160;
const OBSTACLE_GAP = 64;
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

type LayoutBlock = { positions: Map<string, Position>; width: number; height: number; anchor: Position };
type LayoutRect = { left: number; top: number; right: number; bottom: number };

function byOriginalPosition(a: CanvasNodeData, b: CanvasNodeData) {
    return a.position.y - b.position.y || a.position.x - b.position.x || a.id.localeCompare(b.id);
}

function layoutOrigin(nodes: CanvasNodeData[]): Position {
    return { x: Math.min(...nodes.map((node) => node.position.x)), y: Math.min(...nodes.map((node) => node.position.y)) };
}

/** 无连线节点：按文本、图片、视频、音频分泳道，泳道内按实际宽高逐行排布，避免统一网格的大片留白。 */
function layoutMediaLaneBlock(nodes: CanvasNodeData[]): LayoutBlock {
    const positions = new Map<string, Position>();
    let top = 0;
    let width = 0;
    LANE_ORDER.forEach((lane) => {
        const laneNodes = nodes.filter((node) => canvasLayoutLane(node) === lane).sort(byOriginalPosition);
        if (!laneNodes.length) return;
        const columns = Math.min(LANE_MAX_COLUMNS, Math.max(1, Math.ceil(Math.sqrt(laneNodes.length))));
        for (let start = 0; start < laneNodes.length; start += columns) {
            const row = laneNodes.slice(start, start + columns);
            let x = 0;
            row.forEach((node) => {
                positions.set(node.id, { x, y: top });
                x += node.width + GRID_NODE_GAP;
            });
            width = Math.max(width, x - GRID_NODE_GAP);
            top += Math.max(...row.map((node) => node.height)) + GRID_NODE_GAP;
        }
        top += LANE_GAP - GRID_NODE_GAP;
    });
    return { positions, width, height: Math.max(0, top - LANE_GAP), anchor: layoutOrigin(nodes) };
}

/**
 * 单个连通分量的分层布局：DFS 断环 → 最长路径分层（依赖从左到右）→ 重心法排序减少交叉 →
 * 子节点纵向对齐到父节点中心。同列节点按顺序向下推开，列宽取本列最宽节点，因此块内不会重叠。
 */
function layoutGraphBlock(nodes: CanvasNodeData[], edges: Array<[string, string]>): LayoutBlock {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const ordered = [...nodes].sort(byOriginalPosition);
    const outbound = new Map(nodes.map((node) => [node.id, [] as string[]]));
    edges.forEach(([from, to]) => outbound.get(from)!.push(to));

    const dagOut = new Map(nodes.map((node) => [node.id, [] as string[]]));
    const dagIn = new Map(nodes.map((node) => [node.id, [] as string[]]));
    const state = new Map<string, 1 | 2>();
    const visit = (id: string) => {
        state.set(id, 1);
        for (const target of outbound.get(id)!) {
            if (state.get(target) === 1) continue; // 回边：只断开这一条，环上其他依赖仍保留方向
            dagOut.get(id)!.push(target);
            dagIn.get(target)!.push(id);
            if (!state.has(target)) visit(target);
        }
        state.set(id, 2);
    };
    ordered
        .filter((node) => !edges.some(([, to]) => to === node.id))
        .forEach((node) => {
            if (!state.has(node.id)) visit(node.id);
        });
    ordered.forEach((node) => {
        if (!state.has(node.id)) visit(node.id);
    });

    const layerById = new Map<string, number>();
    const pending = new Map(nodes.map((node) => [node.id, dagIn.get(node.id)!.length]));
    const queue = ordered.filter((node) => !pending.get(node.id)).map((node) => node.id);
    queue.forEach((id) => layerById.set(id, 0));
    while (queue.length) {
        const id = queue.shift()!;
        for (const target of dagOut.get(id)!) {
            layerById.set(target, Math.max(layerById.get(target) ?? 0, layerById.get(id)! + 1));
            pending.set(target, pending.get(target)! - 1);
            if (!pending.get(target)) queue.push(target);
        }
    }

    const layerCount = Math.max(...layerById.values()) + 1;
    const layers: string[][] = Array.from({ length: layerCount }, () => []);
    ordered.forEach((node) => layers[layerById.get(node.id) ?? 0]!.push(node.id));

    const indexInLayer = new Map<string, number>();
    const reindex = (layer: string[]) => layer.forEach((id, index) => indexInLayer.set(id, index));
    layers.forEach(reindex);
    const sortByBarycenter = (layer: string[], neighbors: Map<string, string[]>) => {
        const score = new Map(
            layer.map((id) => {
                const linked = neighbors.get(id)!;
                return [id, linked.length ? linked.reduce((sum, other) => sum + indexInLayer.get(other)!, 0) / linked.length : indexInLayer.get(id)!];
            }),
        );
        layer.sort((a, b) => score.get(a)! - score.get(b)! || indexInLayer.get(a)! - indexInLayer.get(b)!);
        reindex(layer);
    };
    for (let sweep = 0; sweep < 4; sweep += 1) {
        for (let layer = 1; layer < layerCount; layer += 1) sortByBarycenter(layers[layer]!, dagIn);
        for (let layer = layerCount - 2; layer >= 0; layer -= 1) sortByBarycenter(layers[layer]!, dagOut);
    }

    const positions = new Map<string, Position>();
    let columnX = 0;
    layers.forEach((layer) => {
        let previousBottom = Number.NEGATIVE_INFINITY;
        layer.forEach((id) => {
            const node = byId.get(id)!;
            const parents = dagIn.get(id)!.filter((parent) => positions.has(parent));
            const desiredTop = parents.length ? parents.reduce((sum, parent) => sum + positions.get(parent)!.y + byId.get(parent)!.height / 2, 0) / parents.length - node.height / 2 : Number.isFinite(previousBottom) ? previousBottom + FLOW_ROW_GAP : 0;
            const y = Math.max(desiredTop, previousBottom + FLOW_ROW_GAP);
            positions.set(id, { x: columnX, y });
            previousBottom = y + node.height;
        });
        columnX += Math.max(...layer.map((id) => byId.get(id)!.width)) + FLOW_COLUMN_GAP;
    });

    const minY = Math.min(...[...positions.values()].map((position) => position.y));
    let height = 0;
    positions.forEach((position, id) => {
        position.y -= minY;
        height = Math.max(height, position.y + byId.get(id)!.height);
    });
    return { positions, width: columnX - FLOW_COLUMN_GAP, height, anchor: layoutOrigin(nodes) };
}

function rectsOverlap(a: LayoutRect, b: LayoutRect, gap: number) {
    return a.left < b.right + gap && b.left < a.right + gap && a.top < b.bottom + gap && b.top < a.bottom + gap;
}

/** 把各布局块按行装箱到原选区左上角；与固定节点（锁定、框架、选区外节点）冲突时向右或向下避让。 */
function packLayoutBlocks(blocks: LayoutBlock[], origin: Position, obstacles: LayoutRect[]) {
    const result = new Map<string, Position>();
    const totalArea = blocks.reduce((sum, block) => sum + (block.width + BLOCK_GAP) * (block.height + BLOCK_GAP), 0);
    const rowWidth = Math.max(...blocks.map((block) => block.width), Math.sqrt(totalArea) * 1.6);
    const rowRight = origin.x + rowWidth;
    const placed = obstacles.map((rect) => ({ rect, gap: OBSTACLE_GAP }));
    let x = origin.x;
    let y = origin.y;
    let rowBottom = origin.y;

    blocks.forEach((block) => {
        if (x > origin.x && x + block.width > rowRight) {
            x = origin.x;
            y = rowBottom + BLOCK_GAP;
        }
        for (let guard = 0; guard < 10_000; guard += 1) {
            const rect = { left: x, top: y, right: x + block.width, bottom: y + block.height };
            const hit = placed.find((item) => rectsOverlap(rect, item.rect, item.gap));
            if (!hit) break;
            const nextX = hit.rect.right + hit.gap;
            if (nextX + block.width <= rowRight) {
                x = nextX;
            } else {
                x = origin.x;
                y = hit.rect.bottom + hit.gap;
            }
        }
        block.positions.forEach((position, id) => result.set(id, { x: x + position.x, y: y + position.y }));
        placed.push({ rect: { left: x, top: y, right: x + block.width, bottom: y + block.height }, gap: BLOCK_GAP });
        rowBottom = Math.max(rowBottom, y + block.height);
        x += block.width + BLOCK_GAP;
    });
    return result;
}

function layoutCanvasGraph(nodes: CanvasNodeData[], connections: CanvasConnection[], obstacles: LayoutRect[]) {
    if (!nodes.length) return new Map<string, Position>();
    const ids = new Set(nodes.map((node) => node.id));
    const edgeKeys = new Set<string>();
    const edges: Array<[string, string]> = [];
    connections.forEach(({ fromNodeId, toNodeId }) => {
        const key = `${fromNodeId}\u0000${toNodeId}`;
        if (fromNodeId === toNodeId || !ids.has(fromNodeId) || !ids.has(toNodeId) || edgeKeys.has(key)) return;
        edgeKeys.add(key);
        edges.push([fromNodeId, toNodeId]);
    });

    const parent = new Map(nodes.map((node) => [node.id, node.id]));
    const find = (id: string): string => {
        let root = id;
        while (parent.get(root) !== root) root = parent.get(root)!;
        parent.set(id, root);
        return root;
    };
    edges.forEach(([from, to]) => parent.set(find(from), find(to)));

    const components = new Map<string, CanvasNodeData[]>();
    nodes.forEach((node) => {
        const root = find(node.id);
        components.set(root, [...(components.get(root) || []), node]);
    });
    const graphBlocks: LayoutBlock[] = [];
    const looseNodes: CanvasNodeData[] = [];
    components.forEach((members) => {
        if (members.length === 1) {
            looseNodes.push(members[0]!);
            return;
        }
        const memberIds = new Set(members.map((node) => node.id));
        graphBlocks.push(
            layoutGraphBlock(
                members,
                edges.filter(([from]) => memberIds.has(from)),
            ),
        );
    });
    graphBlocks.sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x);
    const blocks = looseNodes.length ? [...graphBlocks, layoutMediaLaneBlock(looseNodes)] : graphBlocks;
    return packLayoutBlocks(blocks, layoutOrigin(nodes), obstacles);
}

/** 按连线整理：有连线的连通分量分层排布，孤立节点按媒体泳道收拢。 */
export function layoutCanvasFlow(nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return layoutCanvasGraph(nodes, connections, []);
}

export function layoutCanvasNodesByMediaType(nodes: CanvasNodeData[]) {
    if (!nodes.length) return new Map<string, Position>();
    return packLayoutBlocks([layoutMediaLaneBlock(nodes)], layoutOrigin(nodes), []);
}

/**
 * 自动整理：`obstacles` 是不参与整理但仍可见的节点，结果会绕开它们。
 * 输入中锁定节点和框架同样保持原位并视为障碍。
 */
export function layoutCanvasAuto(nodes: CanvasNodeData[], connections: CanvasConnection[], obstacles: CanvasNodeData[] = []) {
    const candidates = nodes.filter((node) => !node.metadata?.locked && node.type !== CanvasNodeType.Frame);
    if (candidates.length < 2) return new Map<string, Position>();
    const fixed = [...obstacles, ...nodes.filter((node) => !candidates.includes(node))];
    return layoutCanvasGraph(candidates, connections, fixed.map(canvasNodeBounds));
}

export const CANVAS_SPREAD_SCALE = 1.4;
export const CANVAS_SPREAD_MIN_GAP = 56;

/**
 * 保持选区里节点的相对占位，只把彼此间距拉开。
 * 先按选区左上角等比展开，再把仍然过近的盒子沿原有主方向推开，最后把整组钉回原来的左上角。
 */
export function spreadCanvasNodes(nodes: CanvasNodeData[], options?: { scale?: number; minGap?: number }) {
    const result = new Map<string, Position>();
    if (nodes.length < 2) return result;

    const scale = options?.scale ?? CANVAS_SPREAD_SCALE;
    const minGap = options?.minGap ?? CANVAS_SPREAD_MIN_GAP;
    const originX = Math.min(...nodes.map((node) => node.position.x));
    const originY = Math.min(...nodes.map((node) => node.position.y));
    const items = nodes.map((node) => ({
        id: node.id,
        width: node.width,
        height: node.height,
        x: originX + (node.position.x - originX) * scale,
        y: originY + (node.position.y - originY) * scale,
    }));

    for (let pass = 0; pass < 12; pass++) {
        let moved = false;
        for (let i = 0; i < items.length; i++) {
            for (let j = i + 1; j < items.length; j++) {
                const first = items[i]!;
                const second = items[j]!;
                const overlapX = Math.min(first.x + first.width + minGap, second.x + second.width + minGap) - Math.max(first.x, second.x);
                const overlapY = Math.min(first.y + first.height + minGap, second.y + second.height + minGap) - Math.max(first.y, second.y);
                if (overlapX <= 0 || overlapY <= 0) continue;

                const centerDx = first.x + first.width / 2 - (second.x + second.width / 2);
                const centerDy = first.y + first.height / 2 - (second.y + second.height / 2);
                if (Math.abs(centerDx) >= Math.abs(centerDy)) {
                    const direction = centerDx === 0 ? (first.id < second.id ? 1 : -1) : centerDx > 0 ? 1 : -1;
                    const push = overlapX / 2;
                    first.x += direction * push;
                    second.x -= direction * push;
                } else {
                    const direction = centerDy === 0 ? (first.id < second.id ? 1 : -1) : centerDy > 0 ? 1 : -1;
                    const push = overlapY / 2;
                    first.y += direction * push;
                    second.y -= direction * push;
                }
                moved = true;
            }
        }
        if (!moved) break;
    }

    const nextOriginX = Math.min(...items.map((item) => item.x));
    const nextOriginY = Math.min(...items.map((item) => item.y));
    const deltaX = originX - nextOriginX;
    const deltaY = originY - nextOriginY;
    items.forEach((item) => result.set(item.id, { x: item.x + deltaX, y: item.y + deltaY }));
    return result;
}

export function canvasLayoutLane(node: CanvasNodeData): CanvasLayoutLane {
    if (node.type === CanvasNodeType.Video) return "video";
    if (node.type === CanvasNodeType.Audio) return "audio";
    if (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Panorama || node.type === CanvasNodeType.ColorGrade) return "image";
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
