import { expect, test } from "bun:test";
import { projectCreationAgentConversation } from "@/pages/create/creation-agent-conversation";
import type { AgentRun, AgentSession } from "@/services/api/agent";
import { presentAgentContextUsage } from "@/lib/canvas/agent-context-usage";

const session = { id: "creation-session", surface: "creation", title: "测试", updatedAt: "2026-10-03T02:00:00Z" } as AgentSession;
const run = (id: string, date: string, model: string, events: AgentRun["events"] = []) => ({
    id, sessionId: session.id, surface: "creation", createdAt: date, updatedAt: date,
    status: "completed", userPrompt: "日本站商品套图", model, events,
} as AgentRun);

test("creation refresh retains last valid reading across turns, then replaces it without adding usage", () => {
    const first = run("first", "2026-10-03T01:00:00Z", "text-a", [{ runId: "first", seq: 1, type: "context_pressure", createdAt: "2026-10-03T01:00:01Z", payload: {
        modelLimitConfigured: true, contextWindowTokens: 100_000, estimatedInputTokens: 32_000, pressureRatio: .32,
    } }] as AgentRun["events"]);
    const second = run("second", "2026-10-03T02:00:00Z", "text-a");
    const awaiting = projectCreationAgentConversation(session, [first, second]).agentContextUsage!;
    expect(awaiting.runId).toBe("second");
    expect(presentAgentContextUsage(awaiting).inputTokens).toBe(32_000);
    expect(presentAgentContextUsage(awaiting).label).toBe("上轮读数");
    const fresh = { ...second, events: [{ runId: "second", seq: 1, type: "context_pressure", createdAt: "2026-10-03T02:00:01Z", payload: {
        modelLimitConfigured: true, contextWindowTokens: 100_000, estimatedInputTokens: 28_000, pressureRatio: .28,
    } }] } as AgentRun;
    expect(presentAgentContextUsage(projectCreationAgentConversation(session, [first, fresh]).agentContextUsage!).inputTokens).toBe(28_000);
    const changed = projectCreationAgentConversation(session, [first, { ...second, model: "text-b" }]).agentContextUsage!;
    expect(changed.reading).toBeNull();
});
