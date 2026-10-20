import type { AgentEvent, AgentRun } from "@/services/api/agent";
import { ApiError } from "@/services/api/request";
import type { CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage } from "./creation-types";

const accepting = new Set(["queued", "running", "waiting_approval"]);
const receiptTypes = new Set(["user_interjection", "user_interjection_delivered", "user_interjection_dropped"]);

export function creationAgentInterjectionRun(conversation: CreationConversation) {
    const run = conversation.agentRuns?.find((item) => item.id === conversation.agentRunId);
    return run && !run.cleanupPending && run.surface === "creation" && !run.canvasId && run.sessionId === conversation.agentSessionId && accepting.has(run.status) ? run : undefined;
}

export function pendingCreationAgentInterjection(conversation: CreationConversation) {
    return conversation.messages.find((item) => item.role === "user" && item.agentInterjection === "pending" && item.agentRunId);
}

export function upsertCreationAgentInterjection(conversation: CreationConversation, message: CreationMessage): CreationConversation {
    const previous = conversation.messages.find((item) => item.id === message.id);
    // SSE may deliver the canonical conclusion before the HTTP acknowledgement.
    if (previous && (previous.agentInterjection === "delivered" || previous.agentInterjection === "undelivered") && (message.agentInterjection === "pending" || message.agentInterjection === "queued")) return conversation;
    return { ...conversation, messages: previous ? conversation.messages.map((item) => (item.id === message.id ? message : item)) : [...conversation.messages, message] };
}

type InterjectionClient = {
    read: (runId: string, after: number) => Promise<AgentRun>;
    send: (runId: string, input: { text: string; messageId: string }) => Promise<{ accepted: boolean; pending: number }>;
    save: (message: CreationMessage, run: AgentRun) => Promise<void>;
    observe?: (run: AgentRun) => void;
    accepted?: () => void;
    assertCurrent: () => void;
    createId: () => string;
};

// This operation deliberately has no create-run or approval capability.
export async function submitCreationAgentInterjection(
    input: {
        conversation: CreationConversation;
        text?: string;
        attachments?: CreationAttachment[];
        messageId?: string;
    },
    client: InterjectionClient,
) {
    const conversation = input.conversation;
    const pending = input.messageId ? conversation.messages.find((item) => item.id === input.messageId && item.agentInterjection && item.agentRunId) : pendingCreationAgentInterjection(conversation);
    if (input.messageId && !pending) throw new Error("未找到原补充说明，请重新同步会话");
    if (!input.messageId && input.attachments?.length) throw new Error("运行中的补充说明只支持文字；附件已保留，请等待本轮结束或停止后发送");
    const text = input.messageId ? pending!.content : (input.text || "").trim();
    if (!text || Array.from(text).length > 4000 || text.includes("\0")) throw new Error("补充说明须为 1–4000 字的有效文字");
    if (pending && text !== pending.content) throw new Error("原补充说明的回执待确认，请先查询原消息；当前草稿已保留");
    const runId = pending?.agentRunId || conversation.agentRunId;
    if (!runId || !conversation.agentSessionId) throw new Error("没有可接收补充说明的原轮次");
    const read = async () => {
        const events: AgentEvent[] = [];
        let after = 0;
        for (;;) {
            client.assertCurrent();
            const run = await client.read(runId, after);
            client.assertCurrent();
            if (run.id !== runId || run.surface !== "creation" || run.canvasId || run.sessionId !== conversation.agentSessionId) throw new Error("此轮次不属于当前首页会话");
            const page = [...new Map((run.events || []).filter((event) => event.runId === runId && event.seq > after).map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
            if (page.some((event, index) => event.seq !== after + index + 1) || (!page.length && after < (run.eventCount || 0))) throw new Error("原补充说明的事件尚未完整同步，请稍后查询");
            events.push(...page);
            after = events.at(-1)?.seq || 0;
            if (after >= (run.eventCount || 0)) {
                const complete = { ...run, events };
                client.observe?.(complete);
                return complete;
            }
        }
    };
    let run = await read();
    let message: CreationMessage = pending || { id: client.createId(), role: "user", mode: "agent", content: text, createdAt: new Date().toISOString(), agentRunId: runId, agentInterjection: "pending" };
    const save = async (next: CreationMessage) => {
        client.assertCurrent();
        await client.save(next, run);
        client.assertCurrent();
        message = next;
        return { message, run };
    };
    const reconcile = () => {
        const event = run.events?.filter((item) => receiptTypes.has(item.type) && item.payload?.messageId === message.id).at(-1);
        if (event)
            return {
                ...message,
                agentInterjection: event.type === "user_interjection_dropped" ? ("undelivered" as const) : event.type === "user_interjection_delivered" ? ("delivered" as const) : ("queued" as const),
                error: event.type === "user_interjection_dropped" ? String(event.payload.reason || "本轮已结束，补充说明未送达") : undefined,
            };
        if (!accepting.has(run.status) || run.cleanupPending) return { ...message, agentInterjection: "undelivered" as const, error: "本轮已结束或正在清理，补充说明未送达；可编辑后由你重新发送" };
    };
    const receipt = reconcile();
    if (receipt) {
        if (!pending && receipt.agentInterjection === "undelivered") throw new Error(receipt.error);
        if (receipt.agentInterjection !== "undelivered") client.accepted?.();
        return save(receipt);
    }
    // Freeze the identity before sending; unknown results always reuse this ID.
    await save({ ...message, agentInterjection: "pending", error: undefined });
    try {
        client.assertCurrent();
        const response = await client.send(runId, { text: message.content, messageId: message.id });
        client.assertCurrent();
        if (!response.accepted) throw new Error("补充说明回执待确认，请查询原消息");
        client.accepted?.();
    } catch (error) {
        client.assertCurrent();
        try {
            run = await read();
        } catch {
            client.assertCurrent();
            throw error;
        }
        const recovered = reconcile();
        if (recovered) {
            if (recovered.agentInterjection !== "undelivered") client.accepted?.();
            return save(recovered);
        }
        if (error instanceof ApiError && [400, 401, 403, 404, 413, 422, 429].includes(error.status || 0)) {
            return save({ ...message, agentInterjection: "undelivered", error: error.message });
        }
        throw error;
    }
    return save({ ...message, agentInterjection: "queued", error: undefined });
}
