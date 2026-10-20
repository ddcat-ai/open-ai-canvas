import { expect, test } from "bun:test";
import { appendCreationAgentEvent, applyCreationAgentTaskState, projectCreationAgentConversation, restoreCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import type { AgentEvent, AgentRun, AgentSession } from "../src/services/api/agent";

const at = "2026-10-20T01:00:00Z";
const session = { id: "session", title: "连续创作", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at } as AgentSession;
const event = (runId: string, seq: number, type: string, payload: Record<string, unknown>): AgentEvent => ({ eventId: `${runId}:${seq}`, runId, seq, type, payload, createdAt: at });
const run = (id: string, events: AgentEvent[], extra: Partial<AgentRun> = {}): AgentRun => ({
    id,
    sessionId: session.id,
    surface: "creation",
    canvasId: "",
    userPrompt: id,
    status: "running",
    permissionMode: "auto",
    createdAt: at,
    updatedAt: at,
    events,
    ...extra,
});

test("当前轮次流式更新不重读旧轮次事件，保留历史消息对象与已恢复成品", () => {
    const older = run("a-old", [event("a-old", 1, "assistant_message", { text: "历史回复" })], { status: "completed" });
    const active = run("b-current", [event("b-current", 1, "generation_task_created", { taskId: "image", mode: "image" })]);
    const initial = applyCreationAgentTaskState(projectCreationAgentConversation(session, [older, active]), { id: "image", status: "succeeded", resultJson: JSON.stringify({ images: [{ storageKey: "resource:result" }] }) });
    const oldMessage = initial.messages.find((message) => message.id === "a-old:assistant");
    const oldEvents = older.events;
    let oldReads = 0;
    Object.defineProperty(older, "events", {
        configurable: true,
        get() {
            oldReads++;
            return oldEvents;
        },
    });
    const next = appendCreationAgentEvent(initial, event(active.id, 2, "assistant_delta", { text: "新回复" }));
    expect(next.messages.find((message) => message.id === "b-current:assistant")?.content).toBe("新回复");
    expect(next.messages.find((message) => message.id === "task-image")).toMatchObject({ status: "done", resultStorageKeys: ["resource:result"] });
    expect(next.messages.find((message) => message.id === "a-old:assistant")).toBe(oldMessage);
    expect(oldReads).toBe(0);
});

test("流式上下文读数延续同模型历史，并与完整事件投影一致", () => {
    const older = run("a-old", [event("a-old", 1, "context_pressure", { estimatedInputTokens: 3000 })], { model: "model", status: "completed" });
    const active = run("b-current", [], { model: "model" });
    let streamed = projectCreationAgentConversation(session, [older, active]);
    for (const item of [
        event(active.id, 1, "assistant_delta", { text: "继续" }),
        event(active.id, 2, "context_pressure", { estimatedInputTokens: 4000 }),
        event(active.id, 3, "context_compaction_requested", { compactionId: "compact" }),
        event(active.id, 4, "context_compacted", { compactionId: "compact" }),
    ]) {
        streamed = appendCreationAgentEvent(streamed, item);
        expect(streamed.agentContextUsage).toEqual(projectCreationAgentConversation(session, streamed.agentRuns!).agentContextUsage);
    }
});

test("旧轮次迟到事件与乱序补页仍使用完整恢复，重复事件保持原对象", () => {
    const older = run("a-old", [], { status: "completed" });
    const active = run("b-current", [event("b-current", 2, "assistant_delta", { text: "后" })]);
    const initial = projectCreationAgentConversation(session, [older, active]);
    const repaired = appendCreationAgentEvent(initial, event(active.id, 1, "assistant_delta", { text: "前" }));
    expect(repaired.messages.find((message) => message.id === "b-current:assistant")?.content).toBe("前后");
    expect(appendCreationAgentEvent(repaired, event(active.id, 1, "assistant_delta", { text: "重复" }))).toBe(repaired);
    const withHistory = appendCreationAgentEvent(repaired, event(older.id, 1, "assistant_message", { text: "迟到历史" }));
    expect(withHistory.agentRunId).toBe(active.id);
    expect(withHistory.messages.find((message) => message.id === "a-old:assistant")?.content).toBe("迟到历史");
});

test("服务端已返回完整事件快照时恢复不再次下载同一轮次", async () => {
    const complete = run("complete", [event("complete", 1, "assistant_message", { text: "完成" })], { status: "completed", eventCount: 1 });
    let queries = 0;
    const restored = await restoreCreationAgentConversation(session.id, {
        getSession: async () => ({ session, runs: [complete] }),
        listRuns: async () => ({ runs: [] }),
        getRun: async () => {
            queries++;
            return { run: complete };
        },
    });
    expect(restored.messages.at(-1)?.content).toBe("完成");
    expect(queries).toBe(0);
});

test("恢复已有连续事件前缀只拉取后续事件，缺口前缀则从头复核", async () => {
    for (const prefix of [[1, 2], [2]]) {
        const initial = run(
            "partial",
            prefix.map((seq) => event("partial", seq, "assistant_delta", { text: `${seq}` })),
            { eventCount: 4 },
        );
        const cursors: number[] = [];
        const restored = await restoreCreationAgentConversation(session.id, {
            getSession: async () => ({ session, runs: [initial] }),
            listRuns: async () => ({ runs: [] }),
            getRun: async (_id, sinceSeq) => {
                cursors.push(sinceSeq);
                return { run: { ...initial, events: [1, 2, 3, 4].filter((seq) => seq > sinceSeq).map((seq) => event(initial.id, seq, "assistant_delta", { text: `${seq}` })) } };
            },
        });
        expect(restored.messages.at(-1)?.content).toBe("1234");
        expect(cursors).toEqual([prefix[0] === 1 ? 2 : 0]);
    }
});

test("长会话恢复限制并发但不省略任何轮次", async () => {
    const runs = Array.from({ length: 12 }, (_, index) => run(`run-${index}`, []));
    let active = 0,
        peak = 0,
        queries = 0;
    const restored = await restoreCreationAgentConversation(session.id, {
        getSession: async () => ({ session, runs }),
        listRuns: async () => ({ runs: [] }),
        getRun: async (id) => {
            active++;
            queries++;
            peak = Math.max(peak, active);
            await new Promise((resolve) => setTimeout(resolve, 1));
            active--;
            return { run: run(id, [event(id, 1, "assistant_message", { text: id })], { status: "completed", eventCount: 1 }) };
        },
    });
    expect(queries).toBe(12);
    expect(restored.agentRuns).toHaveLength(12);
    expect(peak).toBeLessThanOrEqual(4);
});
