import type { AgentCreationContextEntry } from "@/services/api/agent";
import type { CreationConversation } from "./creation-types";

export function creationAgentDirectContext(conversation?: Pick<CreationConversation, "messages" | "agentRuns" | "agentRunId">) {
    const latestRun = conversation?.agentRuns?.find((run) => run.id === conversation.agentRunId) || conversation?.agentRuns?.at(-1);
    const imported = new Set(latestRun?.creationContextMessageIds || []);
    const messages = (conversation?.messages || []).filter((item) => !item.agentRunId && item.mode && item.mode !== "agent" && !imported.has(item.id));
    const entries: AgentCreationContextEntry[] = [];
    for (const item of messages) {
        const content = item.role === "user" || (item.mode === "text" && item.status === "done") ? item.content.trim() : "";
        const ids = [...new Set(item.taskIds || [])];
        const resources = [
            ...new Set(
                (item.attachments || []).flatMap((attachment) => {
                    const key = attachment.storageKey || "";
                    if (!/^resource:[\w-]+$/.test(key) || !/^(image|video|audio)\//.test(attachment.type)) return [];
                    return [key.slice("resource:".length)];
                }),
            ),
        ];
        if (content || ids.length || resources.length)
            entries.push({ messageId: item.id, role: item.role, mode: item.mode as "image" | "video" | "text", ...(content ? { content } : {}), ...(ids.length ? { taskIds: ids } : {}), ...(resources.length ? { resourceIds: resources } : {}) });
    }
    return { entries };
}
