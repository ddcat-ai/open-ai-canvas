export type AgentContextUsage = {
    runId: string;
    reading: Record<string, unknown> | null;
    readingSeq: number;
    readingStale: boolean;
    compactionPending: Record<string, unknown> | null;
    compactionSeq: number;
    compactionId: string | null;
    lastCompaction: Record<string, unknown> | null;
    compactionError: string | null;
};

export type AgentContextUsageEvent = {
    runId: string;
    seq?: number;
    type: string;
    payload?: Record<string, unknown>;
};

/** What the ring is telling the user. Compaction, not the raw window, is the decision. */
export type AgentContextPhase = "idle" | "unknown" | "ok" | "watch" | "compress" | "compacting" | "stale";

export type AgentContextBreakdownItem = {
    key: string;
    label: string;
    tokens: number;
    bytes?: number;
    unit: "tokens" | "bytes";
};

export type AgentContextUsageView = {
    phase: AgentContextPhase;
    /** Share of the model context window, 0–1 when the window is known. */
    ratio?: number;
    /** Compaction threshold as a share of the model context window. */
    compactRatio?: number;
    /** Ring fill against the full context window. */
    ring: number;
    label: string;
    detail: string;
    inputTokens?: number;
    remainingTokens?: number;
    usableTokens?: number;
    compactAtTokens?: number;
    contextWindowTokens?: number;
    protocolBytes?: number;
    tokenSource?: "pi";
    breakdown: AgentContextBreakdownItem[];
    lastCompaction: Record<string, unknown> | null;
    compactionError?: string;
};

export function emptyAgentContextUsage(runId: string): AgentContextUsage {
    return { runId, reading: null, readingSeq: 0, readingStale: false, compactionPending: null, compactionSeq: 0, compactionId: null, lastCompaction: null, compactionError: null };
}

function eventSequence(event: AgentContextUsageEvent): number | undefined {
    return typeof event.seq === "number" && Number.isFinite(event.seq) && event.seq > 0 ? event.seq : undefined;
}

function payloadString(payload: Record<string, unknown>, key: string): string | undefined {
    const value = payload[key];
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Reduces durable Agent events without mixing readings from different runs. */
export function reduceAgentContextUsage(current: AgentContextUsage, event: AgentContextUsageEvent): AgentContextUsage {
    const scoped = current.runId === event.runId ? current : emptyAgentContextUsage(event.runId);
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (event.type === "context_pressure") {
        // Pi SDK is the only supported context-usage source. Ignore legacy Go/provider
        // readings instead of letting them overwrite a valid Pi session reading.
        if (payload.tokenSource !== "pi") return scoped;
        const seq = eventSequence(event);
        // A reading without a durable sequence cannot be ordered against a
        // reconnect replay. Never let it move the ring backwards.
        if (seq === undefined || seq <= scoped.readingSeq) return scoped;
        return { ...scoped, reading: payload, readingSeq: seq, readingStale: false, compactionError: null };
    }
    if (event.type === "context_compaction_requested") {
        const seq = eventSequence(event);
        if (seq === undefined || seq <= scoped.compactionSeq) return scoped;
        return { ...scoped, compactionPending: payload, compactionSeq: seq, compactionId: payloadString(payload, "compactionId") ?? null, compactionError: null };
    }
    if (event.type === "context_compacted") {
        const seq = eventSequence(event);
        if (seq === undefined || seq <= scoped.compactionSeq) return scoped;
        const compactionId = payloadString(payload, "compactionId");
        if (scoped.compactionId && compactionId && scoped.compactionId !== compactionId) return scoped;
        return { ...scoped, readingStale: Boolean(scoped.reading), compactionPending: null, compactionSeq: seq, compactionId: compactionId ?? scoped.compactionId, lastCompaction: payload, compactionError: null };
    }
    if (event.type === "context_compaction_failed") {
        const seq = eventSequence(event);
        if (seq === undefined || seq <= scoped.compactionSeq) return scoped;
        const compactionId = payloadString(payload, "compactionId");
        if (scoped.compactionId && compactionId && scoped.compactionId !== compactionId) return scoped;
        const aborted = payload.cancelled === true || payload.aborted === true;
        const message = typeof payload.errorMessage === "string" ? payload.errorMessage : aborted ? "上下文压缩已取消，原有对话历史已保留" : "上下文压缩失败，原有对话历史已保留";
        return { ...scoped, compactionPending: null, compactionSeq: seq, compactionId: compactionId ?? scoped.compactionId, compactionError: message };
    }
    return scoped;
}

export function finiteContextNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Returns a ratio only when the backend has a trustworthy configured model budget. */
export function contextPressureRatio(reading: Record<string, unknown> | null): number | undefined {
    if (!reading || reading.tokenSource !== "pi" || reading.modelLimitConfigured !== true) return undefined;
    const contextWindow = finiteContextNumber(reading.contextWindowTokens);
    if (!contextWindow || contextWindow <= 0) return undefined;
    return finiteContextNumber(reading.pressureRatio);
}

export function contextInputTokens(reading: Record<string, unknown> | null): number | undefined {
    if (!reading || reading.tokenSource !== "pi") return undefined;
    return finiteContextNumber(reading.estimatedInputTokens);
}

const BREAKDOWN_LABELS: Record<string, string> = {
    system: "系统提示（含画布摘要）",
    tools: "工具 schema",
    messages: "会话消息（含工具结果）",
};

function contextBreakdown(reading: Record<string, unknown> | null): AgentContextBreakdownItem[] {
    const breakdown = reading?.breakdown;
    if (!breakdown || typeof breakdown !== "object") return [];
    const buckets = (breakdown as { buckets?: unknown }).buckets;
    if (!Array.isArray(buckets)) return [];
    return buckets.flatMap((bucket) => {
        if (!bucket || typeof bucket !== "object") return [];
        const item = bucket as { key?: unknown; label?: unknown; scaledTokens?: unknown; tokens?: unknown; bytes?: unknown };
        const key = typeof item.key === "string" ? item.key : "";
        const tokens = finiteContextNumber(item.scaledTokens) ?? finiteContextNumber(item.tokens);
        if (!key || tokens === undefined) return [];
        const label = BREAKDOWN_LABELS[key] || (typeof item.label === "string" ? item.label : key);
        const bytes = finiteContextNumber(item.bytes);
        return [{ key, label, tokens, bytes, unit: "tokens" as const }];
    });
}

function contextProtocolBytes(reading: Record<string, unknown> | null): number | undefined {
    if (!reading?.breakdown || typeof reading.breakdown !== "object") return undefined;
    return finiteContextNumber((reading.breakdown as { envelopeBytes?: unknown }).envelopeBytes);
}

function formatContextTokens(tokens: number | undefined): string {
    if (tokens === undefined) return "—";
    if (tokens >= 1_000_000) return `${Math.round(tokens / 100_000) / 10}M`;
    if (tokens >= 1_000) return `${Math.round(tokens / 100) / 10}K`;
    return Math.round(tokens).toLocaleString("zh-CN");
}

/**
 * One view of the compaction mechanism.
 * All visual scales use the model context window; the marker shows the shared 80% compaction line.
 */
export function presentAgentContextUsage(usage: AgentContextUsage): AgentContextUsageView {
    const reading = usage.reading?.tokenSource === "pi" ? usage.reading : null;
    const inputTokens = contextInputTokens(reading);
    const contextWindowTokens = finiteContextNumber(reading?.contextWindowTokens);
    const usableTokens = contextWindowTokens;
    const compactAtTokens = finiteContextNumber(reading?.compactAtTokens);
    const ratio = contextPressureRatio(reading);
    const compactRatio = usableTokens && compactAtTokens ? Math.min(1, compactAtTokens / usableTokens) : undefined;
    const tokenSource = reading ? "pi" : undefined;
    const remainingTokens = usableTokens !== undefined && inputTokens !== undefined ? Math.max(0, usableTokens - inputTokens) : undefined;
    const base: AgentContextUsageView = {
        phase: "idle",
        ratio,
        compactRatio,
        ring: 0,
        label: "未测量",
        detail: "发出下一条消息后，这里显示下一次请求离压缩还有多远。",
        inputTokens,
        remainingTokens,
        usableTokens,
        compactAtTokens,
        contextWindowTokens,
        protocolBytes: contextProtocolBytes(reading),
        tokenSource,
        breakdown: contextBreakdown(reading),
        lastCompaction: usage.lastCompaction,
        compactionError: usage.compactionError ?? undefined,
    };
    if (usage.compactionPending) {
        const basis = usage.compactionPending.basis === "bytes" ? "消息体积已到兜底线" : "已到上下文压缩线";
        return { ...base, phase: "compacting", ring: 1, label: "压缩中", detail: `${basis}，正在把较早对话收成检查点，最近两轮原样保留。` };
    }
    if (!reading) return base;
    if (usage.readingStale) {
        return { ...base, phase: "stale", ring: ratio === undefined ? 0 : Math.min(1, ratio), label: "刚压缩", detail: "上一份读数是压缩前的；下一次模型调用会给出压缩后的占用。" };
    }
    if (ratio === undefined || usableTokens === undefined || usableTokens <= 0) {
        const measured = inputTokens === undefined ? "窗口未知" : `约 ${formatContextTokens(inputTokens)} Token`;
        return { ...base, phase: "unknown", label: measured, detail: "这个模型没有配置可确认的上下文窗口，不能给出占用百分比；对话过长时仍会按条数和体积压缩。" };
    }
    const line = compactRatio && compactRatio > 0 ? compactRatio : 0.8;
    const ring = Math.max(0, Math.min(1, ratio));
    const percent = Math.round(ratio * 100);
    const source = "Pi 会话估算";
    if (ratio >= line) {
        return {
            ...base,
            phase: "compress",
            ring,
            label: `${percent}%`,
            detail: `已到压缩线（模型窗口的 ${Math.round(line * 100)}%）。下一次调用前会暂停，把历史收成检查点后再继续。当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}）。`,
        };
    }
    if (ring >= 0.72) {
        return { ...base, phase: "watch", ring, label: `${percent}%`, detail: `接近压缩。当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}），到 ${formatContextTokens(compactAtTokens)} 时开始压缩。` };
    }
    return { ...base, phase: "ok", ring, label: `${percent}%`, detail: `当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}）。标记线为自动压缩阈值。` };
}
