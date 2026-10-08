import { describe, expect, it } from "bun:test";
import { contextInputTokens, contextPressureRatio, emptyAgentContextUsage, presentAgentContextUsage, reduceAgentContextUsage } from "@/lib/canvas/agent-context-usage";

const event = (runId: string, type: string, payload: Record<string, unknown>, seq = 1) => ({ runId, type, payload, seq });

describe("Agent context usage events", () => {
    it("uses only Pi SDK readings and never reads projected/provider fields", () => {
        const state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", {
            modelLimitConfigured: true,
            contextWindowTokens: 128_000,
            estimatedInputTokens: 48_000,
            pressureRatio: 0.6,
            tokenSource: "provider",
        }));
        expect(state.reading).toBeNull();
        expect(contextInputTokens({ tokenSource: "provider", estimatedInputTokens: 48_000, projectedNextInputTokens: 99_000 })).toBeUndefined();
        expect(contextPressureRatio({ tokenSource: "provider", contextWindowTokens: 128_000, projectedPressureRatio: 0.6 })).toBeUndefined();

        const piReading = {
            modelLimitConfigured: true,
            contextWindowTokens: 128_000,
            estimatedInputTokens: 48_000,
            pressureRatio: 0.6,
            tokenSource: "pi",
            projectedNextInputTokens: 99_000,
            projectedPressureRatio: 0.99,
        };
        expect(contextInputTokens(piReading)).toBe(48_000);
        expect(contextPressureRatio(piReading)).toBe(0.6);
    });

    it("does not invent percentages when the model window is unknown", () => {
        const state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", {
            estimatedInputTokens: 12_000,
            modelLimitConfigured: false,
            tokenSource: "pi",
        }));
        expect(contextInputTokens(state.reading)).toBe(12_000);
        expect(contextPressureRatio(state.reading)).toBeUndefined();
    });

    it("marks pre-compaction readings stale until a fresh pressure event arrives", () => {
        let state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", { tokenSource: "pi", pressureRatio: 0.8, modelLimitConfigured: true, usableInputTokens: 100, contextWindowTokens: 100 }, 2));
        state = reduceAgentContextUsage(state, event("run-1", "context_compaction_requested", { basis: "tokens" }, 3));
        expect(state.compactionPending).toEqual({ basis: "tokens" });
        state = reduceAgentContextUsage(state, event("run-1", "context_compacted", { mode: "checkpoint", resume: true }, 4));
        expect(state.readingStale).toBe(true);
        expect(state.compactionPending).toBeNull();
        expect(state.lastCompaction).toEqual({ mode: "checkpoint", resume: true });
        state = reduceAgentContextUsage(state, event("run-1", "context_pressure", { tokenSource: "pi", pressureRatio: 0.25, modelLimitConfigured: true, usableInputTokens: 100, contextWindowTokens: 100 }, 5));
        expect(state.readingStale).toBe(false);
        expect(contextPressureRatio(state.reading)).toBe(0.25);
    });

    it("fills the ring against the model context window and keeps the compaction line as a marker", () => {
        const state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", {
            modelLimitConfigured: true,
            tokenSource: "pi",
            usableInputTokens: 100_000,
            compactAtTokens: 85_000,
            contextWindowTokens: 128_000,
            estimatedInputTokens: 42_500,
            pressureRatio: 0.425,
            breakdown: { buckets: [
                { key: "system", label: "系统提示（含画布摘要）", tokens: 8_000, scaledTokens: 9_000, bytes: 12_000 },
                { key: "tools", tokens: 4_000, scaledTokens: 4_500, bytes: 18_000 },
                { key: "messages", tokens: 20_000, scaledTokens: 22_000, bytes: 228_000 },
            ], envelopeBytes: 558 },
        }));
        const view = presentAgentContextUsage(state);
        expect(view.phase).toBe("ok");
        expect(view.ring).toBeCloseTo(0.425, 5);
        expect(view.label).toBe("43%");
        expect(view.inputTokens).toBe(42_500);
        expect(view.remainingTokens).toBe(85_500);
        expect(view.protocolBytes).toBe(558);
        expect(view.breakdown.map((item) => item.label)).toEqual(["系统提示（含画布摘要）", "工具 schema", "会话消息（含工具结果）"]);
        expect(view.breakdown[0]?.tokens).toBe(9_000);
        expect(view.breakdown[0]?.bytes).toBe(12_000);
    });

    it("treats the compaction line as full and surfaces compacting before a stale reading", () => {
        let state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", {
            modelLimitConfigured: true,
            usableInputTokens: 100,
            contextWindowTokens: 100,
            compactAtTokens: 85,
            estimatedInputTokens: 90,
            pressureRatio: 0.9,
            tokenSource: "pi",
        }));
        expect(presentAgentContextUsage(state).phase).toBe("compress");
        expect(presentAgentContextUsage(state).ring).toBe(0.9);
        state = reduceAgentContextUsage(state, event("run-1", "context_compaction_requested", { basis: "tokens" }, 2));
        expect(presentAgentContextUsage(state).phase).toBe("compacting");
        state = reduceAgentContextUsage(state, event("run-1", "context_compacted", { mode: "fallback", resume: true }, 3));
        expect(presentAgentContextUsage(state).phase).toBe("stale");
    });

    it("does not draw a ring when the window is unknown or unread", () => {
        expect(presentAgentContextUsage(emptyAgentContextUsage("")).phase).toBe("idle");
        const state = reduceAgentContextUsage(emptyAgentContextUsage("run-1"), event("run-1", "context_pressure", {
            estimatedInputTokens: 12_000,
            modelLimitConfigured: false,
            tokenSource: "pi",
        }));
        const view = presentAgentContextUsage(state);
        expect(view.phase).toBe("unknown");
        expect(view.ratio).toBeUndefined();
        expect(view.ring).toBe(0);
    });

    it("isolates usage across runs", () => {
        const state = reduceAgentContextUsage({
            ...emptyAgentContextUsage("run-1"),
            reading: { estimatedInputTokens: 300 },
            lastCompaction: { mode: "checkpoint" },
        }, event("run-2", "assistant_message", {}));
        expect(state.runId).toBe("run-2");
        expect(state.reading).toBeNull();
        expect(state.lastCompaction).toBeNull();
    });
});
