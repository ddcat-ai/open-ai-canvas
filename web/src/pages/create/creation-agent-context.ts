import type { AgentCreationContextEntry } from "@/services/api/agent";
import { projectCreationAgentMediaBatches } from "./creation-agent-conversation";
import type { CreationConversation, CreationMessage } from "./creation-types";

function latestVisibleMediaResult(messages: CreationMessage[]) {
    const messageIds = new Set(messages.map((item) => item.id));
    const tasksByRun = new Map<string, CreationMessage[]>();
    for (const item of messages) {
        if (!item.id.startsWith("task-") || !item.agentRunId) continue;
        const tasks = tasksByRun.get(item.agentRunId) || [];
        tasks.push(item);
        tasksByRun.set(item.agentRunId, tasks);
    }
    // 与页面共用批次投影：任务完成时间或隐藏任务消息的位置不改变可见卡片顺序。
    for (let index = messages.length - 1; index >= 0; index--) {
        const item = messages[index];
        if (item.role !== "assistant" || (item.id.startsWith("task-") && item.agentRunId && messageIds.has(`${item.agentRunId}:assistant`))) continue;
        const results = item.mode === "agent" && !item.agentContinuation && item.agentRunId ? projectCreationAgentMediaBatches(item, tasksByRun.get(item.agentRunId) || []) : [item];
        const latest = results.findLast((result) => (result.mode === "image" || result.mode === "video") && result.taskIds?.length && (result.resultUrls?.some(Boolean) || result.resultStorageKeys?.some(Boolean)));
        if (latest) return { messageId: latest.id, taskIds: [...new Set(latest.taskIds)] };
    }
}

export function creationAgentDirectContext(conversation?: Pick<CreationConversation, "messages" | "agentRuns" | "agentRunId">) {
    const latestRun = conversation?.agentRuns?.find((run) => run.id === conversation.agentRunId) || conversation?.agentRuns?.at(-1);
    const imported = new Set(latestRun?.creationContextMessageIds || []);
    const messages = (conversation?.messages || []).filter((item) => !item.agentRunId && item.mode && item.mode !== "agent" && !imported.has(item.id));
    const entries: AgentCreationContextEntry[] = [];
    const latestVisibleResult = latestVisibleMediaResult(conversation?.messages || []);
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
    return { entries, latestVisibleResult };
}
