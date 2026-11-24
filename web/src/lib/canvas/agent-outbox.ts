// Agent 输入区的本机发送队列（排队 / 插话）：纯数据与判定，不碰存储、网络和界面。
//
// 运行中发出的消息默认进入队列，本轮正常结束后按顺序各自作为新一轮发送；队列项也可以随时插进当前轮。
// 队列只保存在当前设备（账号隔离的 localforage，见 services/cloud-agent-conversations.ts）。
// 停止、失败、拒绝、Agent 提问、刷新页面后整条队列暂停，必须由用户点「继续发送」恢复：
// 每条排队消息都是一轮新的计费，不能在用户没看着的时候自动续发。

import type { AgentPermissionMode, AgentReasoningMode, AgentRun } from "@/services/api/agent";
import { canvasResourceMentionToken, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { agentPageContextKey, isAgentPageContext, type AgentPageContext } from "@/lib/agent-page-context";

export const AGENT_OUTBOX_MAX_ITEMS = 5;
/** 与后端 validateCloudAgentRequest 的提示词上限一致。 */
export const AGENT_PROMPT_MAX_CHARS = 16000;
/** 与后端 cloudAgentInterjectionMaxRunes 一致。 */
export const AGENT_INTERJECTION_MAX_CHARS = 4000;
export const AGENT_FOCUS_NODE_LIMIT = 8;
/** 运行中连按两次 Esc 的判定窗口。 */
export const AGENT_DOUBLE_ESCAPE_MS = 1500;

/** 入队时的设置快照：按下 Enter 时看到的设置，就是之后发出去的设置。 */
export type AgentRunSettings = {
    model: string;
    permissionMode: AgentPermissionMode;
    reasoningMode: AgentReasoningMode;
    skillIds: string[];
    contextScope: string[];
    maxCredits: string;
    maxGenerationTasks: string;
    maxVideoSeconds: string;
};

export type AgentOutboxItemStatus = "queued" | "editing" | "interjecting" | "dispatching" | "failed";

export type AgentOutboxItem = {
    /** 兼作新一轮的幂等键和插话 messageId 的后缀，重试时不会重复建轮或重复插话。 */
    id: string;
    /** 发给 Agent 的原文，含 @ 引用令牌。 */
    text: string;
    /** 画布操作预填的展示文案；存在时 text 里可能带有用户看不到的指令。 */
    displayText?: string;
    canvasReferenceNodeId?: string;
    requiresVision?: boolean;
    /** 入队时所在画布，空串表示平台级对话。 */
    canvasId: string;
    pageContext?: AgentPageContext;
    /** 入队时的选区快照，最多 8 个。 */
    focusNodeIds: string[];
    focusNodeOmittedCount: number;
    settings: AgentRunSettings;
    status: AgentOutboxItemStatus;
    /** 上一次插话或发送失败的原因；条目仍可再次发送。 */
    error?: string;
    createdAt: string;
};

export type AgentOutboxPauseReason = "stopped" | "failed" | "rejected" | "question" | "conflict" | "reloaded" | "sync" | "user";

export type AgentOutbox = {
    version: 1;
    items: AgentOutboxItem[];
    paused?: { reason: AgentOutboxPauseReason; detail?: string; at: string };
};

export const EMPTY_AGENT_OUTBOX: AgentOutbox = { version: 1, items: [] };

const TERMINAL_STATUSES = new Set<AgentRun["status"]>(["completed", "failed", "cancelled", "rejected"]);
const ITEM_STATUSES = new Set<AgentOutboxItemStatus>(["queued", "editing", "interjecting", "dispatching", "failed"]);
const PAUSE_REASONS = new Set<AgentOutboxPauseReason>(["stopped", "failed", "rejected", "question", "conflict", "reloaded", "sync", "user"]);
const PERMISSION_MODES = new Set<AgentPermissionMode>(["read_only", "request_approval", "auto"]);

type RunState = Pick<AgentRun, "status" | "cleanupPending">;

export function agentRunTerminal(status: AgentRun["status"] | undefined) {
    return Boolean(status && TERMINAL_STATUSES.has(status));
}

/** 运行还能不能收插话，与后端 cloudAgentAcceptsInterjection 一致；收尾中的已停止运行不再接收。 */
export function agentRunAcceptsInterjection(run: RunState | null | undefined) {
    return Boolean(run && (run.status === "running" || run.status === "queued" || run.status === "waiting_approval") && !run.cleanupPending);
}

/** 本轮结束时队列该不该暂停；正常完成且没有提问时返回 null，队列照常续发。 */
export function agentOutboxPauseForRunEnd(status: AgentRun["status"], questionPending: boolean): AgentOutboxPauseReason | null {
    if (status === "cancelled") return "stopped";
    if (status === "failed") return "failed";
    if (status === "rejected") return "rejected";
    if (status === "completed" && questionPending) return "question";
    return null;
}

/** 字数按码点计，与后端 utf8.RuneCountInString 对齐。 */
export function agentTextLength(text: string) {
    return Array.from(text).length;
}

/** 组合键文案：苹果设备「⌘Enter」，其余「Ctrl+Enter」。 */
export function agentModifierShortcut(key: string) {
    const apple = typeof navigator !== "undefined" && /Mac|iPhone|iPad|iPod/u.test(navigator.platform || navigator.userAgent);
    return apple ? `⌘${key}` : `Ctrl+${key}`;
}

/** 队列项在插话接口与时间线里的消息 ID。新一轮的用户气泡同样是 user-<幂等键>。 */
export function agentOutboxMessageId(itemId: string) {
    return `user-${itemId}`;
}

export function agentOutboxFull(outbox: AgentOutbox) {
    return outbox.items.length >= AGENT_OUTBOX_MAX_ITEMS;
}

/** 画布预填的消息正文里可能带着用户看不到的指令，编辑会把它们替换成可见文案，所以不允许编辑。 */
export function agentOutboxItemEditable(item: AgentOutboxItem) {
    if (item.status !== "queued" && item.status !== "failed") return false;
    return !item.displayText || item.displayText === item.text;
}

/**
 * 入队。队列满或 ID 重复时原样返回，调用方据此判断没有入队。
 * ignoreLimit 只给「原本就在对话里的消息」用（撤回、未送达后转下一轮、⌘Enter 插话的暂存），
 * 上限只拦住用户新排的消息，不能因此丢掉已有内容。
 */
export function enqueueAgentOutboxItem(outbox: AgentOutbox, item: AgentOutboxItem, options: { atHead?: boolean; ignoreLimit?: boolean } = {}): AgentOutbox {
    if ((!options.ignoreLimit && agentOutboxFull(outbox)) || outbox.items.some((entry) => entry.id === item.id)) return outbox;
    return { ...outbox, items: options.atHead ? [item, ...outbox.items] : [...outbox.items, item] };
}

export function updateAgentOutboxItem(outbox: AgentOutbox, id: string, patch: Partial<Omit<AgentOutboxItem, "id">>): AgentOutbox {
    let changed = false;
    const items = outbox.items.map((item) => {
        if (item.id !== id) return item;
        changed = true;
        return { ...item, ...patch };
    });
    return changed ? { ...outbox, items } : outbox;
}

export function removeAgentOutboxItem(outbox: AgentOutbox, id: string): AgentOutbox {
    const items = outbox.items.filter((item) => item.id !== id);
    if (items.length === outbox.items.length) return outbox;
    // 队列清空时暂停原因也一起清掉，下一次入队从正常状态开始。
    return items.length ? { ...outbox, items } : EMPTY_AGENT_OUTBOX;
}

export function moveAgentOutboxItemToHead(outbox: AgentOutbox, id: string): AgentOutbox {
    const index = outbox.items.findIndex((item) => item.id === id);
    if (index <= 0) return outbox;
    const item = outbox.items[index];
    return { ...outbox, items: [item, ...outbox.items.slice(0, index), ...outbox.items.slice(index + 1)] };
}

export function pauseAgentOutbox(outbox: AgentOutbox, reason: AgentOutboxPauseReason, detail?: string, at = new Date().toISOString()): AgentOutbox {
    if (!outbox.items.length) return outbox;
    if (outbox.paused?.reason === reason && outbox.paused.detail === detail) return outbox;
    return { ...outbox, paused: { reason, ...(detail ? { detail } : {}), at } };
}

/** 继续发送：解除暂停，并把发送失败的条目恢复为待发送。 */
export function resumeAgentOutbox(outbox: AgentOutbox): AgentOutbox {
    if (!outbox.paused && !outbox.items.some((item) => item.status === "failed")) return outbox;
    return { version: 1, items: outbox.items.map((item) => (item.status === "failed" ? { ...item, status: "queued", error: undefined } : item)) };
}

/** 只解除指定原因的暂停（例如用户回答了 Agent 的提问），其他暂停原因保持。 */
export function clearAgentOutboxPause(outbox: AgentOutbox, reason: AgentOutboxPauseReason): AgentOutbox {
    if (outbox.paused?.reason !== reason) return outbox;
    return { version: 1, items: outbox.items };
}

/** 「在此页面发送」：把条目改绑到当前页面，旧画布的选区不再带上。 */
export function rebindAgentOutboxItem(outbox: AgentOutbox, id: string, canvasId: string, pageContext?: AgentPageContext): AgentOutbox {
    const item = outbox.items.find((entry) => entry.id === id);
    if (!item || (item.canvasId === canvasId && agentPageContextKey(item.pageContext) === agentPageContextKey(pageContext))) return outbox;
    return updateAgentOutboxItem(outbox, id, { canvasId, pageContext, focusNodeIds: [], focusNodeOmittedCount: 0 });
}

/**
 * 从本机读出的队列：进行中的状态都已失效。插话结果未确认的条目保留并提示，
 * 由事件流回放确认（时间线出现同一 messageId 的插话后，reconcileAgentOutbox 会移除它）。
 * 读出的非空队列一律暂停，刷新页面后不自动发起计费。
 */
export function restoreAgentOutbox(stored: AgentOutbox | null, at = new Date().toISOString()): AgentOutbox {
    if (!stored?.items.length) return EMPTY_AGENT_OUTBOX;
    const items = stored.items.map((item) => {
        if (item.status === "queued" || item.status === "failed") return item;
        return { ...item, status: "queued" as const, error: item.status === "interjecting" ? "上次插话结果未确认；如果它已出现在对话里，会自动从队列移出" : item.error };
    });
    return { version: 1, items, paused: stored.paused ?? { reason: "reloaded", at } };
}

/**
 * 去掉已经离开队列的条目：时间线里已有服务端确认过的同一消息（插话事件或新一轮的用户消息），
 * 或待确认提交正持有它。正在插话、发送、编辑的条目由各自流程收尾，这里不动。
 */
export function reconcileAgentOutbox(outbox: AgentOutbox, sentMessageIds: ReadonlySet<string>): AgentOutbox {
    const items = outbox.items.filter((item) => !((item.status === "queued" || item.status === "failed") && sentMessageIds.has(agentOutboxMessageId(item.id))));
    if (items.length === outbox.items.length) return outbox;
    return items.length ? { ...outbox, items } : EMPTY_AGENT_OUTBOX;
}

export type AgentOutboxDispatchContext = {
    /** 历史、提交记录、队列和偏好快照都已读到，账号没有切换。 */
    ready: boolean;
    /** 正在提交新一轮，或有结果待确认的提交。 */
    requestInFlight: boolean;
    run: RunState | null;
    /** 有运行时事件流已连接。 */
    connected: boolean;
    /** 当前画布有别的 Agent 在运行。 */
    canvasBusy: boolean;
    /** 当前页面所在画布，空串表示不在画布。 */
    canvasId: string;
    /** 在画布上时，云端对话已同步。 */
    canvasReady: boolean;
    pageContext?: AgentPageContext;
    /** 「立即发送」：只对这一条忽略暂停。 */
    forceItemId?: string | null;
};

export type AgentOutboxBlocker = "empty" | "paused" | "item_busy" | "not_ready" | "request" | "run_active" | "offline" | "canvas_busy" | "scope_changed";

/** 队首能不能现在作为新一轮发出；返回 null 表示可以。暂停之外的原因都是「等待」，条件恢复后自动继续。 */
export function agentOutboxDispatchBlocker(outbox: AgentOutbox, ctx: AgentOutboxDispatchContext): AgentOutboxBlocker | null {
    const head = outbox.items[0];
    if (!head) return "empty";
    if (outbox.paused && ctx.forceItemId !== head.id) return "paused";
    // 编辑中、插话中都要等它结束，不能跳过，保证发送顺序。
    if (head.status !== "queued") return "item_busy";
    if (!ctx.ready || (ctx.canvasId && !ctx.canvasReady)) return "not_ready";
    if (ctx.requestInFlight) return "request";
    if (ctx.run && (!agentRunTerminal(ctx.run.status) || ctx.run.cleanupPending)) return "run_active";
    if (!ctx.connected) return "offline";
    if (ctx.canvasBusy) return "canvas_busy";
    // 离开了入队时的画布：回到原画布自动继续，或由用户对单条选择「在此页面发送」。
    if (head.canvasId !== ctx.canvasId || agentPageContextKey(head.pageContext) !== agentPageContextKey(ctx.pageContext)) return "scope_changed";
    return null;
}

export type AgentOutboxInterjectContext = {
    run: (RunState & { canvasId?: string; pageContext?: AgentPageContext }) | null;
    connected: boolean;
    stopping: boolean;
    canvasBusy: boolean;
    requestPending: boolean;
};

/** 这一条现在能不能插进当前轮；返回不能的原因，用于按钮提示。 */
export function agentOutboxInterjectBlocker(item: Pick<AgentOutboxItem, "text" | "status" | "requiresVision"> & { canvasId?: string; pageContext?: AgentPageContext }, ctx: AgentOutboxInterjectContext): string | null {
    if (ctx.stopping) return "正在停止本轮";
    if (!agentRunAcceptsInterjection(ctx.run)) return "本轮已结束，可作为下一轮发送";
    // 在画布 B 写的消息不能插进画布 A 正在运行的这一轮，否则会改动另一个画布（#881）。
    if (item.canvasId && ctx.run?.canvasId && item.canvasId !== ctx.run.canvasId) return "这条写在另一个画布上，不能插进原画布正在运行的这一轮；回到原画布插话，或等本轮结束后在此页面发送";
    if (agentPageContextKey(item.pageContext) !== agentPageContextKey(ctx.run?.pageContext)) return "这条消息针对的项目或分镜已变化，请等本轮结束后在当前页面发送";
    if (ctx.canvasBusy) return "画布上有别的 Agent 在运行";
    if (!ctx.connected) return "连接断开，恢复后才能插话";
    if (ctx.requestPending) return "上一条提交结果待确认";
    if (item.status === "editing") return "正在编辑";
    if (item.status !== "queued" && item.status !== "failed") return "正在处理";
    if (item.requiresVision) return "这条需要能看图的模型，只能作为下一轮发送";
    if (agentTextLength(item.text) > AGENT_INTERJECTION_MAX_CHARS) return `超过 ${AGENT_INTERJECTION_MAX_CHARS} 字只能作为下一轮发送`;
    return null;
}

export type AgentComposerSubmitMode = "send" | "queue" | "save";

/**
 * 输入框按 Enter 的意图：运行中、请求还在路上、事件流断开、画布被别的 Agent 占用、云端对话同步中都先排队，
 * 条件满足后自动发出；唯一例外是原样重试待确认的提交（同一正文必须走同一个幂等键）。
 */
export function agentComposerSubmitMode(ctx: { editing: boolean; retryingPending: boolean; pendingExists: boolean; running: boolean; requestInFlight: boolean; canvasBusy: boolean; disconnected: boolean; canvasSyncing: boolean }): AgentComposerSubmitMode {
    if (ctx.editing) return "save";
    if (ctx.retryingPending) return "send";
    if (ctx.running || ctx.requestInFlight || ctx.canvasBusy || ctx.disconnected || ctx.canvasSyncing || ctx.pendingExists) return "queue";
    return "send";
}

export function agentOutboxPauseLabel(paused: NonNullable<AgentOutbox["paused"]>, count: number) {
    switch (paused.reason) {
        case "stopped":
            return "已暂停：你停止了本轮";
        case "failed":
            return "已暂停：上一轮没有完成";
        case "rejected":
            return "已暂停：你拒绝了上一步操作";
        case "question":
            return "已暂停：Agent 在等你回答";
        case "conflict":
            return paused.detail ? `已暂停：${paused.detail}` : "已暂停：消息没有发出去";
        case "reloaded":
            return `已暂停：上次有 ${count} 条排队消息没发出`;
        case "sync":
            return "已暂停：画布还没同步完成";
        case "user":
            return "已暂停自动发送";
    }
}

/** 队列行里的单行预览：@ 引用令牌换成可读标签。 */
export function agentOutboxPreview(text: string, references: readonly CanvasResourceReference[]) {
    let preview = text;
    for (const reference of references) {
        const token = canvasResourceMentionToken(reference);
        if (token && preview.includes(token)) preview = preview.split(token).join(`@${reference.label || reference.title || "引用"}`);
    }
    return preview
        .replace(/@\[[^\]]+\]/gu, "@引用")
        .replace(/\s+/gu, " ")
        .trim();
}

function stringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isRunSettings(value: unknown): value is AgentRunSettings {
    if (!value || typeof value !== "object") return false;
    const settings = value as Partial<AgentRunSettings>;
    return (
        typeof settings.model === "string" &&
        PERMISSION_MODES.has(settings.permissionMode as AgentPermissionMode) &&
        typeof settings.reasoningMode === "string" &&
        stringArray(settings.skillIds) &&
        stringArray(settings.contextScope) &&
        typeof settings.maxCredits === "string" &&
        typeof settings.maxGenerationTasks === "string" &&
        typeof settings.maxVideoSeconds === "string"
    );
}

function isOutboxItem(value: unknown): value is AgentOutboxItem {
    if (!value || typeof value !== "object") return false;
    const item = value as Partial<AgentOutboxItem>;
    return (
        typeof item.id === "string" &&
        item.id.length >= 8 &&
        item.id.length <= 120 &&
        typeof item.text === "string" &&
        typeof item.canvasId === "string" &&
        (item.pageContext === undefined || isAgentPageContext(item.pageContext)) &&
        stringArray(item.focusNodeIds) &&
        typeof item.focusNodeOmittedCount === "number" &&
        isRunSettings(item.settings) &&
        ITEM_STATUSES.has(item.status as AgentOutboxItemStatus) &&
        typeof item.createdAt === "string" &&
        (item.displayText === undefined || typeof item.displayText === "string") &&
        (item.canvasReferenceNodeId === undefined || typeof item.canvasReferenceNodeId === "string") &&
        (item.requiresVision === undefined || typeof item.requiresVision === "boolean") &&
        (item.error === undefined || typeof item.error === "string")
    );
}

/** 校验本机读出的队列；格式不对返回 null，由调用方按损坏处理。 */
export function parseAgentOutbox(value: unknown): AgentOutbox | null {
    if (!value || typeof value !== "object") return null;
    const outbox = value as Partial<AgentOutbox>;
    if (outbox.version !== 1 || !Array.isArray(outbox.items) || !outbox.items.every(isOutboxItem)) return null;
    if (outbox.paused !== undefined && (!outbox.paused || !PAUSE_REASONS.has(outbox.paused.reason) || typeof outbox.paused.at !== "string")) return null;
    return { version: 1, items: outbox.items, ...(outbox.paused ? { paused: outbox.paused } : {}) };
}
