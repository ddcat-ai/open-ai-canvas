import { expect, test } from "bun:test";
import { appendCreationAgentEvent, creationAgentRetryRun, mergeCreationAgentConversation, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import type { AgentEvent, AgentRun, AgentSession } from "../src/services/api/agent";

const at = "2026-10-20T10:00:00Z";
const session: AgentSession = { id: "session", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
const run: AgentRun = { id: "run", sessionId: session.id, surface: "creation", canvasId: "", status: "running", permissionMode: "auto", userPrompt: "生成套图", createdAt: at, updatedAt: at };
const event = (seq: number, type: string, extra: Record<string, unknown> = {}): AgentEvent => ({ eventId: `e${seq}`, runId: run.id, seq, type, payload: { messageId: "follow-up", text: "背景改为蓝色", ...extra }, createdAt: at });

test("首页从真实插话事件恢复用户补充，送达和丢弃不会重复消息或虚构新轮次", () => {
    let current = projectCreationAgentConversation(session, [run]);
    current = appendCreationAgentEvent(current, event(1, "user_interjection"));
    expect(current.messages.find((item) => item.id === "follow-up")?.content).toBe("背景改为蓝色");
    expect(current.messages.find((item) => item.id === "follow-up")?.agentInterjection).toBe("queued");
    current = appendCreationAgentEvent(current, event(2, "user_interjection_delivered"));
    expect(current.messages.find((item) => item.id === "follow-up")?.agentInterjection).toBe("delivered");
    const restored = projectCreationAgentConversation(session, [{ ...run, events: [event(1, "user_interjection"), event(2, "user_interjection_delivered")] }]);
    current = mergeCreationAgentConversation(current, restored);
    expect(current.messages.filter((item) => item.id === "follow-up")).toHaveLength(1);
    expect(current.agentRunId).toBe(run.id);
    const dropped = projectCreationAgentConversation(session, [{ ...run, status: "cancelled", events: [event(1, "user_interjection"), event(2, "user_interjection_dropped", { reason: "用户停止了本轮" })] }]);
    expect(dropped.messages.find((item) => item.id === "follow-up")).toMatchObject({ agentInterjection: "undelivered", error: "用户停止了本轮", content: "背景改为蓝色" });
});

test("插话后的真实新 messageId 按事件顺序续答，工具和媒体仍只归主气泡；恢复与流式一致", () => {
    const events = [
        event(1, "assistant_message", { messageId: "initial", text: "先制作白色背景。" }),
        event(2, "generation_task_created", { taskId: "image", mode: "image", title: "商品图" }),
        event(3, "user_interjection"),
        event(4, "user_interjection_delivered"),
        event(5, "tool_completed", { toolName: "creation_media_read" }),
        event(6, "assistant_delta", { messageId: "follow-up-answer", text: "收到，" }),
        event(7, "assistant_delta", { messageId: "follow-up-answer", text: "改为蓝色背景。" }),
        event(8, "assistant_message", { messageId: "follow-up-answer", text: "收到，改为蓝色背景。" }),
    ];
    let current = projectCreationAgentConversation(session, [run]);
    for (const item of events.slice(0, 7)) current = appendCreationAgentEvent(current, item);
    const continuation = current.messages.find((item) => item.agentContinuation)!;
    expect(continuation?.content).toBe("收到，改为蓝色背景。");
    expect(continuation.agentTextStreaming).toBe(true);
    expect(current.messages.findIndex((item) => item.id === "follow-up")).toBeLessThan(current.messages.indexOf(continuation));
    expect(current.messages.find((item) => item.id === "run:assistant")?.content).toBe("先制作白色背景。");
    current = appendCreationAgentEvent(current, events[7]);
    expect(current.messages.find((item) => item.agentContinuation)?.agentTextStreaming).toBe(false);
    const restored = projectCreationAgentConversation(session, [{ ...run, events }]);
    expect(current.messages).toEqual(restored.messages);
    expect(restored.messages.filter((item) => item.taskIds?.includes("image"))).toHaveLength(1);
    expect(restored.messages.find((item) => item.agentContinuation)?.agentRunId).toBe(run.id);
    expect(
        creationAgentRetryRun(
            restored,
            restored.messages.find((item) => item.agentContinuation)!,
        )?.id,
    ).toBe(run.id);
});

test("插话时仍在输出的旧 messageId 保持原气泡，后续新正文才创建续答", () => {
    const events = [event(1, "assistant_delta", { messageId: "initial", text: "原回答" }), event(2, "user_interjection"), event(3, "assistant_message", { messageId: "initial", text: "原回答完整内容" }), event(4, "user_interjection_delivered")];
    const restored = projectCreationAgentConversation(session, [{ ...run, events, activeMessage: { messageId: "new-answer", text: "新回答" } }]);
    expect(restored.messages.find((item) => item.id === "run:assistant")?.content).toBe("原回答完整内容");
    expect(restored.messages.filter((item) => item.agentContinuation)).toHaveLength(1);
    expect(restored.messages.findIndex((item) => item.id === "follow-up")).toBeLessThan(restored.messages.findIndex((item) => item.agentContinuation));
});
