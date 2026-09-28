export type AgentContextUsage = {
    runId: string;
    reading: Record<string, unknown> | null;
    readingSeq: number;
    readingStale: boolean;
    compactionPending: Record<string, unknown> | null;
    lastCompaction: Record<string, unknown> | null;
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
    /** Share of the input budget, 0–1 when the model window is known. */
    ratio?: number;
    /** Where semantic compaction starts, as a share of the same input budget. */
    compactRatio?: number;
    /** Ring fill. 1 means "at or past the compaction line", not "window is full". */
    ring: number;
    label: string;
    detail: string;
    inputTokens?: number;
    remainingTokens?: number;
    usableTokens?: number;
    compactAtTokens?: number;
    contextWindowTokens?: number;
    protocolBytes?: number;
    tokenSource?: "provider" | "estimate";
    estimate: boolean;
    breakdown: AgentContextBreakdownItem[];
    lastCompaction: Record<string, unknown> | null;
};

export function emptyAgentContextUsage(runId: string): AgentContextUsage {
    return { runId, reading: null, readingSeq: 0, readingStale: false, compactionPending: null, lastCompaction: null };
}

/** Reduces durable Agent events without mixing readings from different runs. */
export function reduceAgentContextUsage(current: AgentContextUsage, event: AgentContextUsageEvent): AgentContextUsage {
    const scoped = current.runId === event.runId ? current : emptyAgentContextUsage(event.runId);
    const payload = event.payload && typeof event.payload === "object" ? event.payload : {};
    if (event.type === "context_pressure") {
        return { ...scoped, reading: payload, readingSeq: event.seq || 0, readingStale: false, compactionPending: null };
    }
    if (event.type === "context_compaction_requested") {
        return { ...scoped, compactionPending: payload };
    }
    if (event.type === "context_compacted") {
        return { ...scoped, readingStale: Boolean(scoped.reading), compactionPending: null, lastCompaction: payload };
    }
    return scoped;
}

export function finiteContextNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/** Returns a ratio only when the backend has a trustworthy configured model budget. */
export function contextPressureRatio(reading: Record<string, unknown> | null): number | undefined {
    if (!reading || reading.modelLimitConfigured !== true) return undefined;
    const usable = finiteContextNumber(reading.usableInputTokens);
    if (!usable || usable <= 0) return undefined;
    const ratio = reading.tokenSource === "provider"
        ? finiteContextNumber(reading.projectedPressureRatio)
        : finiteContextNumber(reading.pressureRatio);
    return ratio;
}

export function contextInputTokens(reading: Record<string, unknown> | null): number | undefined {
    if (!reading) return undefined;
    if (reading.tokenSource === "provider") {
        return finiteContextNumber(reading.projectedNextInputTokens) ?? finiteContextNumber(reading.estimatedInputTokens);
    }
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
 * The ring fills against compactAtTokens (85% of the input budget): full means
 * the next model call is about to pause and compact, not that the window is 100% used.
 */
export function presentAgentContextUsage(usage: AgentContextUsage): AgentContextUsageView {
    const reading = usage.reading;
    const inputTokens = contextInputTokens(reading);
    const usableTokens = finiteContextNumber(reading?.usableInputTokens);
    const compactAtTokens = finiteContextNumber(reading?.compactAtTokens);
    const contextWindowTokens = finiteContextNumber(reading?.contextWindowTokens);
    const ratio = contextPressureRatio(reading);
    const compactRatio = usableTokens && compactAtTokens ? Math.min(1, compactAtTokens / usableTokens) : undefined;
    const tokenSource = reading?.tokenSource === "provider" ? "provider" : reading ? "estimate" : undefined;
    const estimate = tokenSource !== "provider";
    const remainingTokens = usableTokens !== undefined && inputTokens !== undefined
        ? Math.max(0, usableTokens - inputTokens)
        : undefined;
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
        estimate,
        breakdown: contextBreakdown(reading),
        lastCompaction: usage.lastCompaction,
    };
    if (usage.compactionPending) {
        const basis = usage.compactionPending.basis === "bytes" ? "消息体积已到兜底线" : "已到上下文压缩线";
        return { ...base, phase: "compacting", ring: 1, label: "压缩中", detail: `${basis}，正在把较早对话收成检查点，最近两轮原样保留。` };
    }
    if (!reading) return base;
    if (usage.readingStale) {
        return { ...base, phase: "stale", ring: ratio === undefined ? 0 : Math.min(1, ratio / (compactRatio || 0.85)), label: "刚压缩", detail: "上一份读数是压缩前的；下一次模型调用会给出压缩后的占用。" };
    }
    if (ratio === undefined || usableTokens === undefined || usableTokens <= 0) {
        const measured = inputTokens === undefined ? "窗口未知" : `约 ${formatContextTokens(inputTokens)} Token`;
        return { ...base, phase: "unknown", label: measured, detail: "这个模型没有配置可确认的上下文窗口，不能给出占用百分比；对话过长时仍会按条数和体积压缩。" };
    }
    const line = compactRatio && compactRatio > 0 ? compactRatio : 0.85;
    const ring = Math.max(0, Math.min(1, ratio / line));
    const percent = Math.round(ratio * 100);
    const source = estimate ? "本地估算" : "模型实测校准";
    if (ratio >= line) {
        return { ...base, phase: "compress", ring: 1, label: `${percent}%`, detail: `已到压缩线（输入预算的 ${Math.round(line * 100)}%）。下一次调用前会暂停，把历史收成检查点后再继续。当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}）。` };
    }
    if (ring >= 0.72) {
        return { ...base, phase: "watch", ring, label: `${percent}%`, detail: `接近压缩。当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}），到 ${formatContextTokens(compactAtTokens)} 时开始压缩。` };
    }
    return { ...base, phase: "ok", ring, label: `${percent}%`, detail: `当前 ${formatContextTokens(inputTokens)} / ${formatContextTokens(usableTokens)}（${source}）。满格表示到达压缩线，不是窗口已经 100% 用完。` };
}
