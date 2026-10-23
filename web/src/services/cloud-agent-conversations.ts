import { localForageStorageForScope } from "@/lib/localforage-storage";
import { markdownPlainText } from "@/lib/markdown-plain-text";
import { getActiveUserScope } from "@/lib/user-scope";
import type { AgentPermissionMode, AgentRun } from "@/services/api/agent";

export type CloudAgentMessagePresentation = {
    displayText?: string;
    canvasReferenceNodeId?: string;
};

export type CloudAgentConversationMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    streaming?: boolean;
    reasoning?: boolean;
    planItems?: Array<{ id: string; title: string; status: "pending" | "doing" | "done" }>;
    planTerminal?: boolean;
    question?: { question: string; options: Array<{ label: string; detail?: string }>; allowFreeform?: boolean };
    meta?: string;
    detail?: unknown;
    attachments?: Array<{ id: string; name: string; url: string }>;
    interjection?: "sent" | "undelivered";
};

export type CloudAgentConversation = {
    id: string;
    serverConversationId?: string;
    runs?: AgentRun[];
    lastEventSeq?: number;
    /** 未发送草稿和主动选中的会话只属于本机，不由云端覆盖。 */
    draft?: string;
    localNewCanvasId?: string;
    localSelectedCanvasId?: string;
    title: string;
    messages: CloudAgentConversationMessage[];
    run: AgentRun | null;
    model?: string;
    permissionMode: AgentPermissionMode;
    skillIds?: string[];
    createdAt: string;
    updatedAt: string;
};

type CloudAgentConversationDocument = {
    version: 1;
    activeId: string | null;
    conversations: CloudAgentConversation[];
};

export type CloudAgentPendingSubmission = CloudAgentMessagePresentation & {
    fingerprint: string;
    key: string;
    request?: import("@/services/api/agent").CreateAgentRunInput;
    parentRunId?: string;
    messageId?: string;
};

const CLOUD_AGENT_CONVERSATIONS_KEY = "cloud-agent-conversations-v2";

// 平台只有一个 Agent：对话按账号保存，不再按画布分桶。每轮绑定哪个画布由发送时所在页面决定。
export async function loadCloudAgentConversations(scope = getActiveUserScope()): Promise<CloudAgentConversationDocument> {
    const value = await localForageStorageForScope(scope).getItem(storageKey());
    if (!value) return emptyDocument();

    let parsed: unknown;
    try {
        parsed = JSON.parse(value);
    } catch {
        throw new Error("Agent 对话历史已损坏");
    }
    if (!isConversationDocument(parsed)) throw new Error("Agent 对话历史格式无效");
    return parsed;
}

const documentWrites = new Map<string, Promise<unknown>>();
export async function saveCloudAgentConversations(activeId: string | null, conversations: CloudAgentConversation[], scope = getActiveUserScope()) {
    // 流式标记只属于内存中的观察状态。若网络在最后一个 delta 后断开，
    // 也不能让下次恢复把思考卡片误判为仍在实时展开。
    const persistedConversations = conversations.map((conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) => ({ ...message, streaming: false })),
    }));
    const document: CloudAgentConversationDocument = { version: 1, activeId, conversations: persistedConversations };
    const write = (documentWrites.get(scope) || Promise.resolve()).catch(() => undefined).then(() => localForageStorageForScope(scope).setItem(storageKey(), JSON.stringify(document)));
    documentWrites.set(scope, write);
    try { await write; } finally { if (documentWrites.get(scope) === write) documentWrites.delete(scope); }
}

// Keep the retry key outside the chat snapshot. If the response is lost, a
// page refresh can safely repeat the same request without creating another
// billed Agent turn.
export async function loadCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return null;
    const value = await localForageStorageForScope(scope).getItem(pendingStorageKey(conversationId));
    if (value === null || value === undefined) return null;
    // A corrupt recovery record is not proof that the previous POST never ran.
    // Fail closed rather than discarding its identity and risking another charge.
    try {
        const parsed = JSON.parse(value) as Partial<CloudAgentPendingSubmission> | null;
        if (!parsed || typeof parsed.fingerprint !== "string" || typeof parsed.key !== "string" || parsed.key.length < 8) throw new Error("invalid identity");
        if (parsed.request !== undefined && (!parsed.request || parsed.request.idempotencyKey !== parsed.key || typeof parsed.request.canvasId !== "string" || typeof parsed.request.prompt !== "string")) throw new Error("invalid request");
        if (parsed.parentRunId !== undefined && typeof parsed.parentRunId !== "string") throw new Error("invalid parent");
        if (parsed.messageId !== undefined && typeof parsed.messageId !== "string") throw new Error("invalid message");
        return { fingerprint: parsed.fingerprint, key: parsed.key, request: parsed.request, parentRunId: parsed.parentRunId, messageId: parsed.messageId, displayText: parsed.displayText, canvasReferenceNodeId: parsed.canvasReferenceNodeId } satisfies CloudAgentPendingSubmission;
    } catch {
        throw new Error("待确认请求记录损坏，已暂停本对话发送；请先在任务中心核对原运行，不要直接重复生成");
    }
}

export async function saveCloudAgentPendingSubmission(conversationId: string, pending: CloudAgentPendingSubmission, scope = getActiveUserScope()) {
    if (!conversationId) throw new Error("缺少 Agent 对话范围，无法保存幂等提交");
    await localForageStorageForScope(scope).setItem(pendingStorageKey(conversationId), JSON.stringify(pending));
}

export async function clearCloudAgentPendingSubmission(conversationId: string, scope = getActiveUserScope()) {
    if (!conversationId) return;
    await localForageStorageForScope(scope).removeItem(pendingStorageKey(conversationId));
}

export function cloudAgentConversationServerId(conversation: CloudAgentConversation) {
    return conversation.serverConversationId || conversation.run?.conversationId;
}

export function cloudAgentPendingMatchesRun(pending: CloudAgentPendingSubmission | null, run: AgentRun | null) {
    return Boolean(pending?.key && run?.idempotencyKey && pending.key === run.idempotencyKey);
}

export function cloudAgentConversationTitle(messages: CloudAgentConversationMessage[]) {
    const firstPrompt = displayConversationTitle(messages.find((message) => message.role === "user")?.text || "");
    return firstPrompt.length > 28 ? `${firstPrompt.slice(0, 28)}...` : firstPrompt;
}

function displayConversationTitle(value: string) {
    return markdownPlainText(value.replace(/@\[skill:[^\]]+\]/gu, "技能包")) || "新对话";
}

function storageKey() {
    return `${CLOUD_AGENT_CONVERSATIONS_KEY}:global`;
}

function pendingStorageKey(conversationId: string) {
    return `${CLOUD_AGENT_CONVERSATIONS_KEY}:pending:${encodeURIComponent(conversationId)}`;
}

function emptyDocument(): CloudAgentConversationDocument {
    return { version: 1, activeId: null, conversations: [] };
}

function isConversationDocument(value: unknown): value is CloudAgentConversationDocument {
    if (!value || typeof value !== "object") return false;
    const document = value as Partial<CloudAgentConversationDocument>;
    if (document.version !== 1 || !Array.isArray(document.conversations)) return false;
    return document.conversations.every((conversation) => {
        if (!conversation || typeof conversation !== "object") return false;
        const candidate = conversation as Partial<CloudAgentConversation>;
        return typeof candidate.id === "string"
            && typeof candidate.title === "string"
            && Array.isArray(candidate.messages)
            && typeof candidate.createdAt === "string"
            && typeof candidate.updatedAt === "string"
            && ["read_only", "auto", "request_approval"].includes(candidate.permissionMode || "");
    });
}
