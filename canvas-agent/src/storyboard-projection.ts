import { nextCanvasX } from "./tools.js";
import type { CanvasNode, CanvasSnapshot } from "./types.js";

export type StoryboardShotInput = {
    shotId: string;
    title: string;
    description?: string;
    position?: number;
};

export type StoryboardProjectionOp =
    | { type: "add_node"; nodeType: "text"; title: string; position: { x: number; y: number }; width: number; height: number; metadata: Record<string, unknown> }
    | { type: "update_node"; id: string; patch: { title: string }; metadata: Record<string, unknown> };

export type StoryboardProjectionResult = {
    ops: StoryboardProjectionOp[];
    createdCount: number;
    updatedNodeIds: string[];
    preExistingNodeIds: string[];
    duplicateShotMappings: Array<{ shotId: string; canonicalNodeId: string; duplicateNodeIds: string[] }>;
};

const STORYBOARD_NODE_WIDTH = 340;
const STORYBOARD_NODE_HEIGHT = 240;
const STORYBOARD_NODE_GAP = 40;
const STORYBOARD_PLACEMENT_CLEARANCE = 20;

type Rect = { x: number; y: number; width: number; height: number };

/**
 * 检测两个矩形是否重叠（含间距）。
 */
function rectsOverlap(a: Rect, b: Rect, clearance = STORYBOARD_PLACEMENT_CLEARANCE): boolean {
    return !(
        a.x + a.width + clearance <= b.x ||
        a.x >= b.x + b.width + clearance ||
        a.y + a.height + clearance <= b.y ||
        a.y >= b.y + b.height + clearance
    );
}

/**
 * 为新分镜节点寻找不与已有节点重叠的位置。
 * 算法：从首选位置开始，若重叠则分别尝试向下和向右移动，选择移动距离更短的方向。
 * 确定性：给定相同障碍节点和首选位置，结果唯一。
 *
 * 参考 web/src/lib/canvas/canvas-generation-layout.ts 的 findAvailableGenerationGroupPosition。
 */
function findFreeStoryboardPosition(
    obstacles: Rect[],
    preferred: { x: number; y: number },
    size: { width: number; height: number },
): { x: number; y: number } {
    const maxAttempts = obstacles.length + 1;
    // 尝试向下
    const down = { ...preferred };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const collisions = obstacles.filter((obs) => rectsOverlap({ ...down, ...size }, obs));
        if (collisions.length === 0) break;
        down.y = Math.max(...collisions.map((obs) => obs.y + obs.height + STORYBOARD_PLACEMENT_CLEARANCE));
    }
    // 尝试向右
    const right = { ...preferred };
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const collisions = obstacles.filter((obs) => rectsOverlap({ ...right, ...size }, obs));
        if (collisions.length === 0) break;
        right.x = Math.max(...collisions.map((obs) => obs.x + obs.width + STORYBOARD_PLACEMENT_CLEARANCE));
    }
    // 选择移动距离更短的方向
    const downDistance = down.y - preferred.y;
    const rightDistance = right.x - preferred.x;
    return downDistance <= rightDistance ? down : right;
}

/**
 * 幂等分镜投影reconciliation：按 metadata.shotId 匹配已有节点。
 * - 无匹配 → add_node，自动布局
 * - 恰好一个匹配 → update_node，保留位置
 * - 多个匹配 → 选择规范节点（按id排序第一个）更新，报告重复
 *
 * 纯函数，可独立测试。不直接应用ops，只返回ops和元数据。
 */
export function reconcileStoryboardShots(
    state: CanvasSnapshot | null,
    shots: StoryboardShotInput[],
    options?: { x?: number; direction?: "column" | "row" },
): StoryboardProjectionResult {
    const direction = options?.direction === "row" ? "row" : "column";
    const sortedShots = [...shots].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    const existingNodes = state?.nodes || [];
    const ops: StoryboardProjectionOp[] = [];
    const updatedNodeIds: string[] = [];
    const preExistingNodeIds: string[] = [];
    const duplicateShotMappings: Array<{ shotId: string; canonicalNodeId: string; duplicateNodeIds: string[] }> = [];

    let newShotIndex = 0;
    const baseX = Number(options?.x ?? nextCanvasX(state));
    // 已有节点全部作为碰撞障碍（不移动已有节点，只为新节点找空位）
    const existingObstacles: Rect[] = existingNodes.map((node) => ({
        x: node.position.x,
        y: node.position.y,
        width: node.width,
        height: node.height,
    }));
    // 新放置的节点也作为后续新节点的碰撞障碍，保证新节点之间不重叠
    const placedNewObstacles: Rect[] = [];

    for (let shotIndex = 0; shotIndex < sortedShots.length; shotIndex++) {
        const shot = sortedShots[shotIndex];
        const matching = existingNodes.filter((node: CanvasNode) => node.metadata?.shotId === shot.shotId);

        if (matching.length === 0) {
            // 新投影 → 首选位置 + 碰撞避免
            const preferredX = direction === "row" ? baseX + newShotIndex * (STORYBOARD_NODE_WIDTH + STORYBOARD_NODE_GAP) : baseX;
            const preferredY = direction === "row" ? 0 : newShotIndex * (STORYBOARD_NODE_HEIGHT + STORYBOARD_NODE_GAP);
            const allObstacles = [...existingObstacles, ...placedNewObstacles];
            const position = findFreeStoryboardPosition(
                allObstacles,
                { x: preferredX, y: preferredY },
                { width: STORYBOARD_NODE_WIDTH, height: STORYBOARD_NODE_HEIGHT },
            );
            // 记录新节点位置为后续障碍
            placedNewObstacles.push({ x: position.x, y: position.y, width: STORYBOARD_NODE_WIDTH, height: STORYBOARD_NODE_HEIGHT });
            ops.push({
                type: "add_node",
                nodeType: "text",
                title: shot.title,
                position,
                width: STORYBOARD_NODE_WIDTH,
                height: STORYBOARD_NODE_HEIGHT,
                metadata: {
                    shotId: shot.shotId,
                    shotIndex: shot.position ?? shotIndex,
                    content: shot.description || "",
                    workflowKind: "storyboard",
                },
            });
            newShotIndex++;
        } else {
            // 已有投影 → 选择规范节点，更新语义内容，保留位置
            const sorted = [...matching].sort((a, b) => a.id.localeCompare(b.id));
            const canonical = sorted[0];
            preExistingNodeIds.push(canonical.id);
            updatedNodeIds.push(canonical.id);
            if (sorted.length > 1) {
                duplicateShotMappings.push({
                    shotId: shot.shotId,
                    canonicalNodeId: canonical.id,
                    duplicateNodeIds: sorted.slice(1).map((n) => n.id),
                });
            }
            ops.push({
                type: "update_node",
                id: canonical.id,
                patch: { title: shot.title },
                metadata: {
                    ...(canonical.metadata || {}),
                    shotId: shot.shotId,
                    shotIndex: shot.position ?? shotIndex,
                    content: shot.description || "",
                    workflowKind: "storyboard",
                },
            });
        }
    }

    return {
        ops,
        createdCount: newShotIndex,
        updatedNodeIds,
        preExistingNodeIds,
        duplicateShotMappings,
    };
}

/**
 * 从应用ops后的快照中识别新创建的分镜投影节点。
 */
export function identifyCreatedStoryboardNodes(
    resultNodes: Array<{ id: string; metadata?: Record<string, unknown> }>,
    requestedShotIds: Set<string>,
    preExistingNodeIds: string[],
): string[] {
    return resultNodes
        .filter((n) => n.metadata?.shotId && requestedShotIds.has(n.metadata.shotId as string))
        .filter((n) => !preExistingNodeIds.includes(n.id))
        .map((n) => n.id);
}
