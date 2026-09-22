import { expect, test } from "bun:test";
import { agentToolRetry, mergeAgentToolRetry } from "@/lib/canvas/agent-tool-retry";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";

function attempt(id: string, count: number, status = "retrying", group = "run:repair:call"): CloudAgentChatMessage {
    return { id, role: "tool", title: "canvas_apply_ops", text: "缺少操作类型", detail: { eventType: status === "recovered" ? "tool_completed" : "tool_failed", retry: { groupId: group, attempt: count, maxAttempts: 3, status } } };
}

test("retry attempts merge across unrelated reads without mutating previous state", () => {
    const first = mergeAgentToolRetry([], attempt("1", 1));
    const messages = [...first, { id: "read", role: "tool" as const, text: "读取画布" }];
    const merged = mergeAgentToolRetry(messages, attempt("2", 2));
    expect(merged).toHaveLength(2);
    expect((merged[0].detail as any).retryAttempts).toHaveLength(2);
    expect((first[0].detail as any).retryAttempts).toHaveLength(1);
    expect(mergeAgentToolRetry(merged, attempt("2", 2))).toEqual(merged);
});

test("recovery survives replay and subsequent runs get their own groups", () => {
    let messages = mergeAgentToolRetry([], attempt("1", 1));
    messages = mergeAgentToolRetry(messages, attempt("done", 1, "recovered"));
    messages = mergeAgentToolRetry(messages, attempt("1", 1));
    expect(agentToolRetry(messages[0].detail)?.status).toBe("recovered");
    expect((messages[0].detail as any).retryAttempts).toHaveLength(1);
    expect(mergeAgentToolRetry(messages, attempt("next", 1, "retrying", "other:repair:call"))).toHaveLength(2);
});

test("exhaustion is preserved and legacy failures are not hidden", () => {
    let messages = mergeAgentToolRetry([], attempt("1", 1));
    messages = mergeAgentToolRetry(messages, attempt("3", 3, "exhausted"));
    messages = mergeAgentToolRetry(messages, attempt("same-attempt-replay", 3));
    messages = mergeAgentToolRetry(messages, attempt("2", 2));
    expect(agentToolRetry(messages[0].detail)?.status).toBe("exhausted");
    const legacy: CloudAgentChatMessage = { id: "old", role: "tool", text: "失败", detail: { eventType: "tool_failed" } };
    expect(mergeAgentToolRetry(messages, legacy)).toBe(messages);
    expect(agentToolRetry({ retry: { groupId: "x", attempt: 4, maxAttempts: 3, status: "retrying" } })).toBeUndefined();
});
