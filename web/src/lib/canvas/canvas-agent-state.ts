import type { CanvasNodeData } from "@/types/canvas";

// Agent 创作状态机：以画布真实节点为唯一事实来源，聚合“进行中 / 已完成 / 失败”
// 三类生成任务生命周期，保证：
// 1. 已完成或进行中的任务不会被重复提交（除非显式 retry）；
// 2. 页面刷新后可由真实节点重新派生状态，并与本地持久化记录对账；
// 3. 所有状态转换都经过显式规则校验，非法转换可被识别而不是静默覆盖。

export const AGENT_STATE_VERSION = 1 as const;

// 任务生命周期：只暴露用户可理解的三态。
export type AgentTaskLifecycle = "pending" | "completed" | "failed";

// 创作阶段（轻量，用于让 Agent 知道当前推进到哪一步，不做复杂工作流引擎）。
export type AgentCreationPhase = "idle" | "planning" | "generating" | "review";

export type AgentTaskMode = "text" | "image" | "video" | "audio";

export type AgentTaskRecord = {
    nodeId: string;
    lifecycle: AgentTaskLifecycle;
    mode?: AgentTaskMode;
    taskId?: string;
    // 该记录最近一次变化时间（毫秒），用于对账时判断新旧。
    updatedAt: number;
};

export type CanvasAgentState = {
    version: typeof AGENT_STATE_VERSION;
    phase: AgentCreationPhase;
    // key 为 nodeId，一个节点同一时刻只跟踪一条最新任务。
    tasks: Record<string, AgentTaskRecord>;
    updatedAt: number;
};

export type SubmitDecision =
    | { submit: true }
    | { submit: false; reason: "pending" | "completed" | "failed-needs-retry" | "no-target" };

export type TaskTransitionResult =
    | { ok: true; state: CanvasAgentState; changed: boolean }
    | { ok: false; reason: string };

const ACTIVE_STATUSES = new Set(["queued", "pending", "running", "processing", "submitting", "accepted"]);
const SUCCESS_STATUSES = new Set(["succeeded", "completed", "success"]);
const FAILED_STATUSES = new Set(["failed", "error", "cancelled", "canceled"]);

function now(): number {
    return Date.now();
}

export function createEmptyAgentState(phase: AgentCreationPhase = "idle", at: number = now()): CanvasAgentState {
    return { version: AGENT_STATE_VERSION, phase, tasks: {}, updatedAt: at };
}

function normalizeMode(value: unknown): AgentTaskMode | undefined {
    return value === "text" || value === "image" || value === "video" || value === "audio" ? value : undefined;
}

function nodeMetadata(node: Pick<CanvasNodeData, "metadata"> | undefined | null): Record<string, unknown> {
    return (node?.metadata || {}) as Record<string, unknown>;
}

// 判断节点资源是否已物化（成功且有可引用产物）。
export function nodeResourceReady(metadata: Record<string, unknown>): boolean {
    return metadata.status === "success"
        && Boolean(metadata.storageKey || metadata.primaryImageId || metadata.resourceId || metadata.primaryVideoId || metadata.primaryAudioId);
}

// 从单个画布节点派生任务生命周期；返回 null 表示该节点没有可跟踪的生成任务。
export function classifyNodeTask(node: Pick<CanvasNodeData, "id" | "metadata">, at: number = now()): AgentTaskRecord | null {
    const metadata = nodeMetadata(node);
    const continuation = (metadata.agentGenerationContinuation || {}) as Record<string, unknown>;
    const taskId = typeof metadata.taskId === "string" && metadata.taskId
        ? metadata.taskId
        : typeof continuation.taskId === "string" ? continuation.taskId : "";
    const rawStatuses = [metadata.taskStatus, metadata.taskOfficialStatus, continuation.status]
        .map((value) => String(value || "").toLowerCase())
        .filter(Boolean);

    // continuation 明确失败优先判失败。
    if (continuation.status === "failed" || rawStatuses.some((s) => FAILED_STATUSES.has(s))) {
        return { nodeId: node.id, lifecycle: "failed", ...(taskId ? { taskId } : {}), mode: normalizeMode(metadata.generationMode), updatedAt: at };
    }
    const isActive = rawStatuses.some((s) => ACTIVE_STATUSES.has(s)) || continuation.status === "pending";
    const isSuccess = rawStatuses.some((s) => SUCCESS_STATUSES.has(s));
    if (isActive) {
        return { nodeId: node.id, lifecycle: "pending", ...(taskId ? { taskId } : {}), mode: normalizeMode(metadata.generationMode), updatedAt: at };
    }
    if (isSuccess || nodeResourceReady(metadata)) {
        // provider 成功但资源尚未物化时仍视为进行中（等待 consume），避免重复提交。
        const lifecycle: AgentTaskLifecycle = isSuccess && !nodeResourceReady(metadata) && metadata.status !== "success" ? "pending" : "completed";
        return { nodeId: node.id, lifecycle, ...(taskId ? { taskId } : {}), mode: normalizeMode(metadata.generationMode), updatedAt: at };
    }
    return null;
}

// 从真实画布节点重建整份状态（刷新恢复的事实来源）。
export function deriveAgentStateFromNodes(nodes: readonly Pick<CanvasNodeData, "id" | "metadata">[], phase: AgentCreationPhase = "generating", at: number = now()): CanvasAgentState {
    const tasks: Record<string, AgentTaskRecord> = {};
    for (const node of nodes) {
        const record = classifyNodeTask(node, at);
        if (record) tasks[node.id] = record;
    }
    const hasPending = Object.values(tasks).some((task) => task.lifecycle === "pending");
    const resolvedPhase: AgentCreationPhase = phase === "idle" ? (Object.keys(tasks).length ? "generating" : "idle") : phase;
    return {
        version: AGENT_STATE_VERSION,
        phase: hasPending && resolvedPhase === "review" ? "generating" : resolvedPhase,
        tasks,
        updatedAt: at,
    };
}

// 合法状态转换表。retry 表示用户/Agent 显式要求重新生成。
export function canTransition(from: AgentTaskLifecycle | undefined, to: AgentTaskLifecycle, retry: boolean): boolean {
    // 无记录时允许落到任意生命周期：刷新后由真实节点派生时可能直接得到终态。
    if (from === undefined) return to === "pending" || to === "completed" || to === "failed";
    if (from === to) return true; // 幂等
    if (from === "pending") return to === "completed" || to === "failed";
    if (from === "completed") return retry && to === "pending";
    if (from === "failed") return retry && to === "pending";
    return false;
}

function updateTask(
    state: CanvasAgentState,
    nodeId: string,
    next: AgentTaskLifecycle,
    options: { retry?: boolean; taskId?: string; mode?: AgentTaskMode; at?: number } = {},
): TaskTransitionResult {
    if (!nodeId) return { ok: false, reason: "缺少 nodeId" };
    const previous = state.tasks[nodeId]?.lifecycle;
    if (!canTransition(previous, next, Boolean(options.retry))) {
        return { ok: false, reason: `非法状态转换：${previous || "无"} -> ${next}${options.retry ? "（retry）" : ""}` };
    }
    const at = options.at ?? now();
    const existing = state.tasks[nodeId];
    // 幂等：目标态与当前一致且没有新 taskId，则不产生变化。
    if (existing && existing.lifecycle === next && (!options.taskId || existing.taskId === options.taskId)) {
        return { ok: true, state, changed: false };
    }
    const record: AgentTaskRecord = {
        nodeId,
        lifecycle: next,
        mode: options.mode ?? existing?.mode,
        taskId: options.taskId ?? existing?.taskId,
        updatedAt: at,
    };
    return {
        ok: true,
        changed: true,
        state: { ...state, tasks: { ...state.tasks, [nodeId]: record }, updatedAt: at },
    };
}

export function markTaskSubmitted(state: CanvasAgentState, nodeId: string, meta: { taskId?: string; mode?: AgentTaskMode; retry?: boolean; at?: number } = {}): TaskTransitionResult {
    return updateTask(state, nodeId, "pending", meta);
}

export function markTaskCompleted(state: CanvasAgentState, nodeId: string, meta: { taskId?: string; at?: number } = {}): TaskTransitionResult {
    return updateTask(state, nodeId, "completed", meta);
}

export function markTaskFailed(state: CanvasAgentState, nodeId: string, meta: { taskId?: string; at?: number } = {}): TaskTransitionResult {
    return updateTask(state, nodeId, "failed", meta);
}

export function setCreationPhase(state: CanvasAgentState, phase: AgentCreationPhase, at: number = now()): CanvasAgentState {
    if (state.phase === phase) return state;
    return { ...state, phase, updatedAt: at };
}

// 是否应当提交生成：进行中 / 已完成 的任务默认不重复提交；失败任务必须显式 retry。
export function shouldSubmitGeneration(
    state: CanvasAgentState,
    nodeId: string | undefined,
    options: { retry?: boolean; target?: Pick<CanvasNodeData, "id" | "metadata"> | null } = {},
): SubmitDecision {
    if (!nodeId) return { submit: false, reason: "no-target" };
    // 真实节点优先：即使内存状态丢失，节点上仍挂着活跃任务也要挡住。
    const fromNode = options.target ? classifyNodeTask(options.target) : null;
    const record = state.tasks[nodeId];
    const lifecycle = fromNode?.lifecycle || record?.lifecycle;
    if (options.retry) return { submit: true };
    if (lifecycle === "pending") return { submit: false, reason: "pending" };
    if (lifecycle === "completed") return { submit: false, reason: "completed" };
    if (lifecycle === "failed") return { submit: false, reason: "failed-needs-retry" };
    return { submit: true };
}

// 过滤一批待提交的生成操作，返回应提交与应跳过清单。
export function filterGenerationOps<TOp extends { nodeId: string; retry?: boolean }>(
    state: CanvasAgentState,
    ops: readonly TOp[],
    nodeById: ReadonlyMap<string, Pick<CanvasNodeData, "id" | "metadata">> = new Map(),
): { toSubmit: TOp[]; skipped: Array<{ op: TOp; reason: Exclude<SubmitDecision, { submit: true }>["reason"] }> } {
    const toSubmit: TOp[] = [];
    const skipped: Array<{ op: TOp; reason: Exclude<SubmitDecision, { submit: true }>["reason"] }> = [];
    for (const op of ops) {
        const decision = shouldSubmitGeneration(state, op.nodeId, { retry: op.retry, target: nodeById.get(op.nodeId) });
        if (decision.submit) toSubmit.push(op);
        else skipped.push({ op, reason: decision.reason });
    }
    return { toSubmit, skipped };
}

export function agentTaskSummary(state: CanvasAgentState): { pending: number; completed: number; failed: number; total: number } {
    const summary = { pending: 0, completed: 0, failed: 0, total: 0 };
    for (const task of Object.values(state.tasks)) {
        summary[task.lifecycle] += 1;
        summary.total += 1;
    }
    return summary;
}

// 刷新后对账：以真实节点派生状态为准，持久化记录仅补充 mode / taskId 等节点上缺失的细节。
export function reconcileAgentState(derived: CanvasAgentState, persisted?: CanvasAgentState | null, at: number = now()): CanvasAgentState {
    if (!persisted || persisted.version !== AGENT_STATE_VERSION) return derived;
    const tasks: Record<string, AgentTaskRecord> = {};
    for (const [nodeId, derivedRecord] of Object.entries(derived.tasks)) {
        const stored = persisted.tasks[nodeId];
        tasks[nodeId] = {
            ...derivedRecord,
            mode: derivedRecord.mode ?? stored?.mode,
            taskId: derivedRecord.taskId ?? stored?.taskId,
        };
    }
    return { ...derived, tasks, phase: derived.phase === "idle" && persisted.phase !== "idle" && Object.keys(tasks).length ? persisted.phase : derived.phase, updatedAt: at };
}

// ---- 本地持久化（按项目隔离，版本化，损坏可自愈）----

function storageKey(projectId: string): string {
    return `canvas-agent-state:${projectId}`;
}

export type AgentStateStorage = { getItem(key: string): string | null; setItem(key: string, value: string): void };

export function saveAgentState(projectId: string, state: CanvasAgentState, storage?: AgentStateStorage | null): boolean {
    if (!projectId || !storage) return false;
    try {
        storage.setItem(storageKey(projectId), JSON.stringify(state));
        return true;
    } catch {
        return false;
    }
}

export function loadAgentState(projectId: string, storage?: AgentStateStorage | null): CanvasAgentState | null {
    if (!projectId || !storage) return null;
    try {
        const raw = storage.getItem(storageKey(projectId));
        if (!raw) return null;
        const parsed = JSON.parse(raw) as CanvasAgentState;
        if (parsed.version !== AGENT_STATE_VERSION || !parsed.tasks || typeof parsed.tasks !== "object") return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearAgentState(projectId: string, storage?: AgentStateStorage | null): void {
    if (!projectId || !storage) return;
    try {
        storage.setItem(storageKey(projectId), "");
    } catch {
        // 忽略清理失败
    }
}

export function browserAgentStateStorage(): AgentStateStorage | undefined {
    return typeof window === "undefined" ? undefined : window.localStorage;
}
