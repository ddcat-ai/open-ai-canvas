import { afterEach, expect, test } from "bun:test";
import { creationAgentRunsToStop, stopCreationAgentRuns } from "../src/pages/create/creation-agent-cancel";
import { applyCreationAgentTaskState, mergeCreationAgentConversation, projectCreationAgentConversation } from "../src/pages/create/creation-agent-conversation";
import { ApiError, apiClient } from "../src/services/api/request";
import type { AgentRun, AgentSession } from "../src/services/api/agent";

const adapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = adapter;
});
const at = "2026-10-16T00:00:00Z";
const session: AgentSession = { id: "creation", surface: "creation", title: "主图", status: "active", revision: 1, createdAt: at, updatedAt: at };
const run: AgentRun = { id: "run", sessionId: session.id, surface: "creation", canvasId: "", status: "running", permissionMode: "request_approval", userPrompt: "原需求", revision: 1, createdAt: at, updatedAt: at };

test("停止必须先由服务端确认，保留原会话与已输出内容，晚到运行事件不能恢复生成状态", async () => {
    let conversation = projectCreationAgentConversation(session, [{ ...run, events: [{ runId: run.id, eventId: "text", seq: 1, type: "assistant_delta", payload: { text: "已完成的文字" }, createdAt: at }] }]);
    const calls: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        calls.push(`${config.method} ${config.url}`);
        const data = config.method === "post" ? { accepted: true } : { run: { ...run, revision: 2, status: "cancelled", cleanupPending: false } };
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data } };
    };
    await stopCreationAgentRuns(conversation, (stopped) => {
        conversation = mergeCreationAgentConversation(conversation, projectCreationAgentConversation(session, [stopped]));
    });
    expect(calls).toEqual(["post /agent/runs/run/cancel", "get /agent/runs/run"]);
    expect(conversation.agentSessionId).toBe(session.id);
    expect(conversation.messages.find((message) => message.role === "assistant")).toMatchObject({ status: "cancelled", content: "已完成的文字" });
    conversation = mergeCreationAgentConversation(conversation, projectCreationAgentConversation(session, [run]));
    expect(creationAgentRunsToStop(conversation)).toEqual([]);
});

test("Agent 结束后图片继续生成；停止编排后成品仍交付原会话", () => {
    const conversation = projectCreationAgentConversation(session, [{ ...run, status: "completed", events: [{ runId: run.id, eventId: "image", seq: 1, type: "generation_task_created", payload: { taskId: "image" }, createdAt: at }] }]);
    expect(creationAgentRunsToStop(conversation)).toEqual([]);
    conversation.agentRuns![0].status = "cancelled";
    expect(creationAgentRunsToStop(conversation)).toEqual([]);
    conversation.agentRuns![0].cleanupPending = true;
    expect(creationAgentRunsToStop(conversation)).toEqual([run.id]);
    const delivered = applyCreationAgentTaskState(conversation, { id: "image", status: "succeeded", resultJson: '{"images":[{"storageKey":"resource:finished"}]}' });
    expect(delivered.messages.find((message) => message.id === "task-image")).toMatchObject({ status: "done", resultStorageKeys: ["resource:finished"] });
});

test("取消失败保留运行状态，不将断网伪装成已停止", async () => {
    const conversation = projectCreationAgentConversation(session, [run]);
    let writes = 0;
    let requests = 0;
    apiClient.defaults.adapter = async () => {
        requests++;
        throw new ApiError("停止服务不可用", { status: 503 });
    };
    await expect(
        stopCreationAgentRuns(conversation, () => {
            writes++;
        }),
    ).rejects.toThrow("停止服务不可用");
    expect(writes).toBe(0);
    expect(requests).toBe(1);
    expect(creationAgentRunsToStop(conversation)).toEqual([run.id]);
});

test("停止待审批轮次移除失效审批，空回复也保留已停止记录", () => {
    const stopped = projectCreationAgentConversation(session, [{ ...run, status: "cancelled", approval: { approvalId: "old", call: { id: "call", function: { name: "generate_image", arguments: "{}" } } } }]);
    expect(stopped.agentApproval).toBeUndefined();
    expect(stopped.messages.at(-1)?.status).toBe("cancelled");
});
