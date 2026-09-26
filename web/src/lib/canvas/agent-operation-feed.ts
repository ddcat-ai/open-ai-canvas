import { agentToolCategory, agentToolName, agentToolRetryLabel, agentToolStatus, friendlyAgentToolSummary } from "./agent-tool-presentation";
import { agentToolRetry } from "./agent-tool-retry";

/**
 * Agent 的"操作信息"（工具调用记录）在消息流里是一条条 `role === "tool"` 的消息。一轮运行动辄
 * 十几步，逐条铺开会把正文挤出可视区，所以界面上把它们折成一行：默认只报最新一步，点击展开
 * 完整记录（组件见 `canvas-cloud-agent-chat-ui` 的 `AgentOperationFeed`）。
 *
 * 这里只做纯切分与文案，不引入 React 或组件类型：调用方把 `CloudAgentChatMessage[]` 传进来，
 * 结构上满足 `AgentFeedRecord` 即可。
 */

export type AgentFeedRecord = {
    id: string;
    role: string;
    title?: string;
    text: string;
    reasoning?: boolean;
    detail?: unknown;
    planItems?: readonly unknown[];
    question?: unknown;
};

export type AgentFeedSegment<T> =
    | { kind: "operations"; key: string; items: T[] }
    | { kind: "reasoning"; key: string; items: T[] }
    | { kind: "message"; key: string; item: T };

function record(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/**
 * 纯载体消息：计划清单（`plan_updated`）与提问（`user_question`）各带一条没有正文的消息，
 * 内容分别由输入区上方的"本轮待办"条与提问条渲染。它们既不是操作记录，也没有可展示的正文：
 * 实测直接渲染会得到"操作画布 / 操作已完成 / 处理中"这样的空卡片。
 */
export function isAgentCarrierRecord(item: AgentFeedRecord): boolean {
    if (item.role === "user" || item.text || item.title) return false;
    return Boolean(item.planItems?.length) || Boolean(item.question);
}

/** 等用户确认的工具调用（审批卡）必须留在消息流里，不能被折进"操作记录"里藏起来。 */
export function isAgentOperationRecord(item: AgentFeedRecord): boolean {
    return item.role === "tool" && !isAgentCarrierRecord(item) && record(item.detail).status !== "pending";
}

/** 连续推理事件共用一条可展开记录，避免每个 SSE chunk/摘要都变成一行。 */
export function isAgentReasoningRecord(item: AgentFeedRecord): boolean {
    return item.role === "assistant" && item.reasoning === true;
}

/** 折叠行上报的那一步：最新一条操作记录的友好摘要（等待执行时用"准备…"口径）。 */
export function agentOperationLabel(item: AgentFeedRecord): string {
    const name = agentToolName(item.title || "工具执行", item.detail);
    const retry = agentToolRetry(item.detail);
    // 自动纠正分组在卡片里只显示纠正记录，折叠行跟上同一口径，否则会报一个"已完成"的假象。
    if (retry) return `${agentToolRetryLabel(retry)} · ${retry.attempt}/${retry.maxAttempts} 次尝试`;
    return friendlyAgentToolSummary(name, item.text, item.detail, agentToolStatus(name, item.text, item.detail) === "pending");
}

/** 失败/被拒的操作默认展开：错误不该被折进一行里看不见。 */
export function agentOperationFailed(item: AgentFeedRecord): boolean {
    const status = agentToolStatus(agentToolName(item.title || "工具执行", item.detail), item.text, item.detail);
    return status === "failed" || status === "rejected";
}

/** 一条操作记录的类别（折叠行徽标用它）：按工具契约判定，不看文案。 */
export function agentOperationCategory(item: AgentFeedRecord) {
    return agentToolCategory(agentToolName(item.title || "工具执行", item.detail), item.detail);
}

/**
 * 折叠段上报的一句聚合文案。单条语义仍归 `agentOperationLabel`（卡片与折叠行共用，不许改），
 * 这里只回答"这一段到底看没看画面"：
 *
 * 看图片段报「查看了 N 张画面 · 最新《…》」，N 按**真的送出画面的图片**去重计数（复用账本里的
 * 观察与读循环护栏都没有附图，不计数）；其余段沿用最新一步自己的摘要。
 */
export function agentOperationSegmentLabel(items: readonly AgentFeedRecord[]): string {
    const latest = items[items.length - 1];
    if (!latest) return "";
    if (agentOperationCategory(latest) !== "vision") return agentOperationLabel(latest);
    const viewed = new Set<string>();
    let latestTitle = "";
    for (const item of items) {
        if (agentOperationCategory(item) !== "vision") continue;
        const result = record(record(item.detail).result);
        if (result.reuseObservation === true || result.repeat === true) continue;
        if (typeof result.nodeId === "string" && result.nodeId) {
            viewed.add(result.nodeId);
            if (typeof result.title === "string" && result.title) latestTitle = result.title;
        }
        for (const value of Array.isArray(result.batchImages) ? result.batchImages : []) {
            const image = record(value);
            if (typeof image.nodeId !== "string" || !image.nodeId) continue;
            viewed.add(image.nodeId);
            if (typeof image.title === "string" && image.title) latestTitle = image.title;
        }
    }
    if (!viewed.size) return agentOperationLabel(latest);
    return `查看了 ${viewed.size} 张画面${latestTitle ? ` · 最新《${latestTitle}》` : ""}`;
}

/**
 * 把消息流切成「操作段」与「单条消息」：连续的非审批工具记录合成一段，其余消息各自成段。
 *
 * 段 key 取段内第一条消息的 id：运行中后续步骤是**追加**进同一段的，key 保持稳定，
 * 展开状态与滚动位置不会因为新步骤到达而被重置。
 */
export function buildAgentFeedSegments<T extends AgentFeedRecord>(messages: readonly T[]): AgentFeedSegment<T>[] {
    const segments: AgentFeedSegment<T>[] = [];
    for (const item of messages) {
        if (isAgentCarrierRecord(item)) continue;
        if (isAgentReasoningRecord(item)) {
            const last = segments[segments.length - 1];
            if (last?.kind === "reasoning") last.items.push(item);
            else segments.push({ kind: "reasoning", key: item.id, items: [item] });
            continue;
        }
        if (isAgentOperationRecord(item)) {
            const last = segments[segments.length - 1];
            if (last?.kind === "operations") last.items.push(item);
            else segments.push({ kind: "operations", key: item.id, items: [item] });
            continue;
        }
        segments.push({ kind: "message", key: item.id, item });
    }
    return segments;
}
