/**
 * Agent 新建的节点与连线在画布上"长出来"：同一批增量按创建顺序错开入场。
 *
 * 标记发生在增量合并进编辑器之前（use-canvas-project-lifecycle 的 Agent 分支），节点第一次
 * 挂载时读取这里的延迟，因此首帧就带着入场动画，不会先闪一下完整节点。画布是按视口渐进挂载的，
 * 屏幕外的节点稍后挂载时只要仍在有效期内也照样入场；过期后不再动画，避免滚回来时重放。
 */

const ENTRANCE_TTL_MS = 4_000;
const NODE_STAGGER_MS = 28;
const CONNECTION_STAGGER_MS = 10;
const MAX_DELAY_MS = 900;
const MAX_ENTRIES = 600;

type Entrance = { at: number; delay: number };

const entrances = new Map<string, Entrance>();

function now() {
    return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function prune(current: number) {
    for (const [key, entrance] of entrances) {
        if (current - entrance.at > ENTRANCE_TTL_MS) entrances.delete(key);
    }
    while (entrances.size > MAX_ENTRIES) {
        const oldest = entrances.keys().next().value;
        if (oldest === undefined) break;
        entrances.delete(oldest);
    }
}

export function markAgentCanvasEntrance(nodeIds: readonly string[], connectionIds: readonly string[]) {
    if (!nodeIds.length && !connectionIds.length) return;
    const current = now();
    prune(current);
    nodeIds.forEach((id, index) => entrances.set(`node:${id}`, { at: current, delay: Math.min(MAX_DELAY_MS, index * NODE_STAGGER_MS) }));
    // 连线在两端节点出现之后再画出来。
    const lead = Math.min(MAX_DELAY_MS, nodeIds.length * NODE_STAGGER_MS) + 160;
    connectionIds.forEach((id, index) => entrances.set(`connection:${id}`, { at: current, delay: Math.min(MAX_DELAY_MS + 400, lead + index * CONNECTION_STAGGER_MS) }));
}

function remainingDelay(key: string): number | null {
    const entrance = entrances.get(key);
    if (!entrance) return null;
    const elapsed = now() - entrance.at;
    if (elapsed > ENTRANCE_TTL_MS) {
        entrances.delete(key);
        return null;
    }
    return Math.max(0, Math.round(entrance.delay - elapsed));
}

/** 节点挂载时调用：返回剩余的入场延迟（毫秒），不是 Agent 刚建的节点时返回 null。 */
export function agentNodeEntranceDelay(nodeId: string): number | null {
    return remainingDelay(`node:${nodeId}`);
}

export function agentConnectionEntranceDelay(connectionId: string): number | null {
    return remainingDelay(`connection:${connectionId}`);
}

export function prefersReducedMotion() {
    return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
