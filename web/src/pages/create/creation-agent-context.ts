import type { AgentCreationContextEntry } from "@/services/api/agent";
import type { CreationConversation } from "./creation-types";

export function creationAgentDirectContext(conversation?: Pick<CreationConversation, "messages">) {
    const messages = (conversation?.messages || []).filter((item) => !item.agentRunId && item.mode && item.mode !== "agent").slice(-20);
    const entries: AgentCreationContextEntry[] = [];
    const taskIds = new Set<string>();
    let remaining = 12000;
    for (const item of [...messages].reverse()) {
        const content = item.role === "user" || (item.mode === "text" && item.status === "done") ? item.content.trim().slice(0, Math.min(2000, remaining)) : "";
        remaining -= content.length;
        const ids = (item.taskIds || []).filter((id) => {
            if (taskIds.has(id) || taskIds.size >= 32) return false;
            taskIds.add(id);
            return true;
        });
        if (content || ids.length) entries.unshift({ role: item.role, mode: item.mode as "image" | "video" | "text", ...(content ? { content } : {}), ...(ids.length ? { taskIds: ids } : {}) });
    }
    const references = new Map<string, NonNullable<(typeof messages)[number]["attachments"]>[number]>();
    for (const item of [...messages].reverse()) {
        for (const attachment of item.attachments || []) {
            const key = attachment.storageKey || "";
            if (references.size < 16 && /^resource:[\w-]+$/.test(key) && /^(image|video|audio)\//.test(attachment.type) && !references.has(key)) references.set(key, attachment);
        }
    }
    return { entries, attachments: [...references.values()].reverse() };
}
