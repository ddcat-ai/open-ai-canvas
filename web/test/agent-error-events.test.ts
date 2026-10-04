import { expect, test } from "bun:test";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { applyAgentEvent } from "@/components/canvas/canvas-cloud-agent-events";
import { buildAgentFeedSegments } from "@/lib/canvas/agent-operation-feed";
import type { AgentEvent } from "@/services/api/agent";

const failureMessage = "Agent 执行中断，请重新发送消息；如反复出现，请把诊断号 ag-test-run 反馈给管理员";
const event = (type: string, payload: AgentEvent["payload"] = {}, runId = "ag-test-run"): AgentEvent => ({
    eventId: `${runId}:${type}`,
    runId,
    seq: 1,
    type,
    payload,
    createdAt: "2026-10-03T00:00:00Z",
});
const failed = event("run_failed", { error: "internal runner error" });
const status = event("run_status", { status: "failed", failureMessage });

function reduceEvents(events: AgentEvent[], initial: CloudAgentChatMessage[] = []) {
    let messages = initial;
    for (const item of events) {
        applyAgentEvent(
            item,
            (update) => {
                messages = typeof update === "function" ? update(messages) : update;
            },
            () => {},
            () => {},
        );
    }
    return messages;
}

test("failure event and terminal snapshot update a single error with the public reason", () => {
    const messages = reduceEvents([failed, status]);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: "terminal-ag-test-run", role: "error", text: failureMessage, errorSeverity: "error" });
    expect(JSON.stringify(messages)).not.toContain("internal runner error");
});

test("reversed delivery, interleaved messages and replay retain the detailed failure", () => {
    const assistant = event("assistant_message", { messageId: "answer", text: "已有执行结果" });
    const messages = reduceEvents([status, assistant, failed, status, failed]);
    expect(messages.map((item) => item.role)).toEqual(["error", "assistant"]);
    expect(messages[0].text).toBe(failureMessage);
});

test("separate failed runs are not deduplicated by identical text", () => {
    const messages = reduceEvents([event("run_failed", { text: "配额不足" }, "run-1"), event("run_failed", { text: "配额不足" }, "run-2")]);
    expect(messages).toHaveLength(2);
    expect(messages[0].id).not.toBe(messages[1].id);
});

test("a failed snapshot without a reason still appears but never replaces a specific reason", () => {
    const emptyStatus = event("run_status", { status: "failed" });
    expect(reduceEvents([emptyStatus])).toHaveLength(1);
    const specific = event("run_failed", { text: "模型额度不足" });
    expect(reduceEvents([emptyStatus, specific, emptyStatus])[0].text).toBe("模型额度不足");
});

test("replaying a cached failure replaces its event row instead of preserving duplicates", () => {
    const initial: CloudAgentChatMessage[] = [
        { id: failed.eventId, role: "error", title: "Agent 执行失败", text: "Agent 执行失败" },
        { id: "terminal-ag-test-run", role: "error", title: "Agent 执行失败", text: failureMessage },
        { id: "sync-error", role: "error", title: "画布同步冲突", text: "请重新打开画布" },
    ];
    const messages = reduceEvents([failed, status], initial);
    expect(messages).toHaveLength(2);
    expect(messages[0].text).toBe(failureMessage);
    expect(messages[1]).toBe(initial[2]);
    expect(initial).toHaveLength(3);
});

test("error events share the run failure identity without hiding tool failures", () => {
    const tool = event("tool_failed", { toolName: "canvas_get_state", text: "读取失败" });
    const messages = reduceEvents([event("error", { message: "暂时无法执行" }), tool, failed, status]);
    expect(messages.filter((item) => item.role === "error")).toHaveLength(1);
    expect(messages.filter((item) => item.role === "tool")).toHaveLength(1);
});

test("completed, cancelled and rejected runs do not create a failure card", () => {
    expect(reduceEvents(["completed", "cancelled", "rejected"].map((state) => event("run_status", { status: state })))).toEqual([]);
});

test("cached conversations fold only the event rows with a matching terminal run", () => {
    const initial: CloudAgentChatMessage[] = [
        { id: "ag-first:9", role: "error", text: "Agent 执行失败" },
        { id: "tool", role: "tool", text: "已有执行记录" },
        { id: "terminal-ag-first", role: "error", text: "模型调用失败" },
        { id: "ag-second:2", role: "error", text: "模型调用失败" },
        { id: "terminal-ag-third", role: "error", text: "模型调用失败" },
        { id: "stream-error-ag-first", role: "error", text: "事件流已断开" },
    ];
    const segments = buildAgentFeedSegments(initial);
    expect(segments.map((item) => item.key)).toEqual(["tool", "terminal-ag-first", "ag-second:2", "terminal-ag-third", "stream-error-ag-first"]);
    expect(initial).toHaveLength(6);
});
