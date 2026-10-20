import { getCreationHistory, saveCreationHistory, type CreationHistory, type CreationHistoryInput } from "@/services/api/creation-history";
import { createAgentSession } from "@/services/api/agent";
import { getActiveUserScope } from "@/lib/user-scope";
import { resolveResourceUrl } from "@/services/api/resources";
import { canvasResourceMentionToken } from "@/lib/canvas/canvas-resource-references";
import type { CreationAttachment } from "./creation-assets";
import type { CreationConversation, CreationMessage, CreationSettings } from "./creation-types";
import { creationAgentRecoveryClient, mergeCreationAgentConversation, restoreCreationAgentConversation } from "./creation-agent-conversation";

export const creationConversationPath = (conversation: Pick<CreationConversation, "id" | "agentSessionId">) => `/c/${encodeURIComponent(conversation.agentSessionId || conversation.id)}`;

export function creationHistoryInput(conversation: CreationConversation, title?: string): CreationHistoryInput {
    return {
        sourceConversationId: conversation.historySourceId || conversation.id,
        ...(title === undefined ? {} : { title }),
        messages: conversation.messages.flatMap((message) => {
            if (!message.mode || message.mode === "agent" || message.agentRunId) return [];
            const attachments =
                message.role === "user"
                    ? (message.attachments || []).filter((attachment) => attachment.storageKey?.startsWith("resource:")).map(({ id, storageKey, name, type, role }) => ({ id, storageKey: storageKey!, name, type, ...(role ? { role } : {}) }))
                    : [];
            const references =
                message.role === "user"
                    ? (message.references || []).map((reference) => ({
                          id: reference.id,
                          kind: reference.kind,
                          label: reference.label,
                          mentionToken: canvasResourceMentionToken(reference),
                          ...(reference.attachmentId ? { attachmentId: reference.attachmentId } : {}),
                      }))
                    : [];
            return [
                {
                    id: message.id,
                    role: message.role,
                    mode: message.mode,
                    content: message.role === "user" ? message.content : "",
                    createdAt: message.createdAt,
                    ...(message.model ? { model: message.model } : {}),
                    ...(message.settings ? { settings: message.settings } : {}),
                    ...(attachments.length ? { attachments } : {}),
                    ...(references.length ? { references } : {}),
                    ...(message.taskIds?.length ? { taskIds: message.taskIds } : {}),
                    ...(message.clientOperationId ? { clientOperationId: message.clientOperationId } : {}),
                },
            ];
        }),
    };
}

export function mergeCreationStoredHistory(agent: CreationConversation, history: CreationHistory): CreationConversation {
    const messages: CreationMessage[] = history.messages.map((message) => ({
        ...message,
        settings: message.settings as CreationSettings | undefined,
        references: message.references?.map((reference) => ({ ...reference, nodeId: reference.attachmentId || reference.id, title: reference.label, active: false })),
        attachments: message.attachments?.map((attachment) => ({ ...attachment, url: resolveResourceUrl(attachment.storageKey), previewUrl: "", bytes: 0 })) as CreationAttachment[] | undefined,
        ...(message.role === "assistant"
            ? {
                  status: "pending" as const,
                  ...(message.taskIds?.length ? { taskStatePending: true } : { submissionPending: Boolean(message.clientOperationId) }),
              }
            : {}),
    }));
    const merged = mergeCreationAgentConversation({ ...agent, messages, agentRuns: [] }, agent);
    return { ...merged, historySourceId: history.sourceConversationId || agent.id };
}

export async function restoreCreationConversation(sessionId: string, signal?: AbortSignal) {
    const [agent, history] = await Promise.all([restoreCreationAgentConversation(sessionId, creationAgentRecoveryClient, signal), getCreationHistory(sessionId, signal)]);
    signal?.throwIfAborted();
    return mergeCreationStoredHistory(agent, history);
}

// Serialize only writes to the same conversation. Opening a long history must
// not delay a new conversation's submission behind unrelated uploads.
export function createCreationHistoryWriter(client = { createAgentSession, saveCreationHistory, getActiveUserScope }) {
    const writes = new Map<string, Promise<string>>();
    const saved = new Map<string, string>();
    return (conversation: CreationConversation, scope: string, title?: string) => {
        const key = `${scope}:${conversation.agentSessionId || conversation.id}`;
        const input = creationHistoryInput(conversation, title);
        const fingerprint = JSON.stringify(input);
        const previous = writes.get(key) || Promise.resolve("");
        const write = previous
            .catch(() => "")
            .then(async (knownId) => {
                if (scope !== client.getActiveUserScope()) throw new Error("账号已切换，原会话未继续同步");
                const sessionId = conversation.agentSessionId || knownId || (await client.createAgentSession({ id: conversation.id, surface: "creation", title: conversation.title })).session.id;
                if (scope !== client.getActiveUserScope()) throw new Error("账号已切换，原会话未继续同步");
                if (saved.get(key) !== fingerprint) {
                    await client.saveCreationHistory(sessionId, input);
                    saved.set(key, fingerprint);
                }
                return sessionId;
            });
        writes.set(key, write);
        return write;
    };
}
