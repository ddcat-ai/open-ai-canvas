import { expect, test } from "bun:test";
import { projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import type { AgentEvent, AgentRun, AgentSession } from "../src/services/api/agent";

const at = "2026-10-20T10:00:00Z";
const session: AgentSession = { id: "session", surface: "creation", status: "active", revision: 1, createdAt: at, updatedAt: at };
const run: AgentRun = { id: "run", sessionId: session.id, surface: "creation", canvasId: "", status: "running", permissionMode: "auto", userPrompt: "请处理素材", createdAt: at, updatedAt: at };
const event = (seq: number, type: string, payload: Record<string, unknown>): AgentEvent => ({ eventId: `e${seq}`, runId: run.id, seq, type, payload, createdAt: at });
const project = (events: AgentEvent[], overrides: Partial<AgentRun> = {}) => projectCreationAgentConversation(session, [{ ...run, events, ...overrides }]).messages.find((message) => message.id === "run:assistant")!;

test("正文增量与 Agent 运行状态分开，收到最终正文后即停止文字流", () => {
    const delta = event(1, "assistant_delta", { messageId: "reply", text: "已确认构图" });
    expect(project([delta]).agentTextStreaming).toBe(true);
    const final = event(2, "assistant_message", { messageId: "reply", text: "已确认构图，开始生成。" });
    const waiting = project([delta, final, event(3, "generation_task_created", { taskId: "image", mode: "image" })]);
    expect(waiting.content).toBe("已确认构图，开始生成。");
    expect(waiting.status).toBe("streaming");
    expect(waiting.agentTextStreaming).toBe(false);
    expect(project([delta, final, event(4, "assistant_delta", { messageId: "summary", text: "图片已生成" })]).agentTextStreaming).toBe(true);
});

test("恢复中的活动正文仍是流式，最终事件和终态不被旧快照重新打开", () => {
    const activeMessage = { messageId: "reply", text: "目前已确认" };
    expect(project([], { activeMessage }).agentTextStreaming).toBe(true);
    expect(project([event(1, "assistant_message", { messageId: "reply", text: "已完成。" })], { activeMessage }).agentTextStreaming).toBe(false);
    for (const status of ["completed", "failed", "cancelled", "waiting_approval"] as const) {
        expect(project([event(1, "assistant_delta", { messageId: "reply", text: "进行中" })], { status }).agentTextStreaming).toBe(false);
    }
});

test("只使用实际工具结果的固定活动标签，内部思考与工具正文不进入可见回复", () => {
    const events = [event(1, "reasoning_delta", { text: "私有推理细节" }), event(2, "tool_completed", { toolName: "creation_media_read", text: "私有素材路径与完整工具 JSON" })];
    const message = project(events);
    expect(message.content).toBe("");
    expect(message.reasoning).toBeUndefined();
    expect(message.agentTextStreaming).toBe(false);
    expect(message.agentActivity).toBe("已查询创作素材");
    expect(project([...events, event(3, "assistant_message", { text: "素材已处理。" })], { status: "completed" }).agentActivity).toBeUndefined();
    expect(project([event(1, "tool_failed", { toolName: "creation_media_read", text: "私有错误" })]).agentActivity).toBeUndefined();
});

test("审批与用户提问显示等待确认，不显示处理中的假进度", () => {
    const approval = project([event(1, "approval_requested", { approvalId: "approve", toolName: "generate_media" })], { status: "waiting_approval" });
    expect(approval.agentActivity).toBe("等待你确认");
    expect(approval.agentTextStreaming).toBe(false);
    const question = project([event(1, "user_question", { question: "需要哪种风格？", options: [] })]);
    expect(question.agentActivity).toBe("等待你回复");
});
