import type { AgentCreationContextEntry } from "@/services/api/agent";
import type { CreationConversation } from "./creation-types";

export function creationAgentDirectContext(conversation?: Pick<CreationConversation, "messages">) {
    const messages = (conversation?.messages || []).filter((item) => !item.agentRunId && item.mode && item.mode !== "agent").slice(-20);
    const entries: AgentCreationContextEntry[] = [];
    const taskIds = new Set<string>();
    const resourceIds = new Set<string>();
    let remaining = 12000;
    for (const item of [...messages].reverse()) {
        const content = item.role === "user" || (item.mode === "text" && item.status === "done") ? item.content.trim().slice(0, Math.min(2000, remaining)) : "";
        remaining -= content.length;
        const ids = (item.taskIds || []).filter((id) => {
            if (taskIds.has(id) || taskIds.size >= 32) return false;
            taskIds.add(id);
            return true;
        });
        const resources = (item.attachments || []).flatMap((attachment) => {
            const key = attachment.storageKey || "";
            if (!/^resource:[\w-]+$/.test(key) || !/^(image|video|audio)\//.test(attachment.type)) return [];
            const id = key.slice("resource:".length);
            if (resourceIds.has(id) || resourceIds.size >= 32) return [];
            resourceIds.add(id);
            return [id];
        });
        if (content || ids.length || resources.length)
            entries.unshift({ role: item.role, mode: item.mode as "image" | "video" | "text", ...(content ? { content } : {}), ...(ids.length ? { taskIds: ids } : {}), ...(resources.length ? { resourceIds: resources } : {}) });
    }
    return { entries };
}
