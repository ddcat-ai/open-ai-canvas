import { applyAgentEvent } from "@/lib/canvas/cloud-agent-events";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { getActiveUserScope } from "@/lib/user-scope";
import { getAgentRun, listAgentConversations, listAgentConversationRuns, type AgentEvent, type AgentRun, type AgentConversationSummary } from "@/services/api/agent";
import { cloudAgentConversationServerId, cloudAgentConversationTitle, type CloudAgentConversation } from "@/services/cloud-agent-conversations";

export type CloudAgentHistoryClient = {
    listConversations: typeof listAgentConversations;
    listRuns: typeof listAgentConversationRuns;
    getRun: typeof getAgentRun;
};
const defaultClient: CloudAgentHistoryClient = { listConversations: listAgentConversations, listRuns: listAgentConversationRuns, getRun: getAgentRun };
const terminal = new Set<AgentRun["status"]>(["completed", "failed", "cancelled", "rejected"]);
type HistoryOptions = { signal?: AbortSignal; scope?: string; client?: CloudAgentHistoryClient };

function checkRequest(options: HistoryOptions, scope: string) {
    options.signal?.throwIfAborted();
    if (getActiveUserScope() !== scope) throw new DOMException("账号已切换，已停止恢复原账号对话", "AbortError");
}

function assertConversation(conversationId: string, runs: AgentRun[]) {
    if (runs.some((run) => run.conversationId !== conversationId)) throw new Error("Agent 对话归属不一致，已停止恢复");
}

function orderRuns(runs: AgentRun[]) {
    const byId = new Map<string, AgentRun>();
    for (const run of runs) {
        const previous = byId.get(run.id);
        if (!previous || (run.revision || 0) >= (previous.revision || 0)) byId.set(run.id, run);
    }
    const ordered: AgentRun[] = [];
    const visiting = new Set<string>();
    const seen = new Set<string>();
    const visit = (run: AgentRun) => {
        if (seen.has(run.id)) return;
        if (visiting.has(run.id)) throw new Error("Agent 对话轮次关系异常，请重新读取历史");
        visiting.add(run.id);
        const parent = run.parentId ? byId.get(run.parentId) : undefined;
        if (parent) visit(parent);
        visiting.delete(run.id);
        seen.add(run.id);
        ordered.push(run);
    };
    [...byId.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).forEach(visit);
    return ordered;
}

/** 历史和实时事件使用同一归约，但历史不会触发预演或再次执行工具。 */
export function projectCloudAgentConversation(conversationId: string, sourceRuns: AgentRun[]): CloudAgentConversation {
    assertConversation(conversationId, sourceRuns);
    const runs = orderRuns(sourceRuns);
    let messages: CloudAgentChatMessage[] = [];
    for (const source of runs) {
        let run: AgentRun | null = source;
        if (source.userPrompt) messages.push({ id: `user-${source.id}`, role: "user", text: source.userPrompt });
        const seen = new Set<number>();
        for (const event of [...(source.events || [])].sort((a, b) => a.seq - b.seq)) {
            if (event.runId !== source.id || !Number.isSafeInteger(event.seq) || event.seq <= 0 || seen.has(event.seq)) continue;
            seen.add(event.seq);
            applyAgentEvent(
                event,
                (update) => {
                    messages = typeof update === "function" ? update(messages) : update;
                },
                (update) => {
                    run = typeof update === "function" ? update(run) : update;
                },
                () => {},
            );
        }
        if (source.activeMessage?.text)
            applyAgentEvent(
                { eventId: `${source.id}:history-message`, runId: source.id, seq: 0, type: "assistant_snapshot", payload: source.activeMessage, createdAt: source.updatedAt },
                (update) => {
                    messages = typeof update === "function" ? update(messages) : update;
                },
                () => {},
                () => {},
            );
        applyAgentEvent(
            { eventId: `${source.id}:history-status`, runId: source.id, seq: 0, type: "run_status", payload: { ...source }, createdAt: source.updatedAt },
            (update) => {
                messages = typeof update === "function" ? update(messages) : update;
            },
            () => {},
            () => {},
        );
        if (terminal.has(source.status)) messages = messages.map((message) => ({ ...message, streaming: false }));
    }
    const run = runs.at(-1) || null;
    const lastEventSeq = (run?.events || []).reduce((seq, event) => (event.runId === run?.id && event.seq > seq ? event.seq : seq), run?.latestSeq || 0);
    return {
        id: conversationId,
        serverConversationId: conversationId,
        runs,
        lastEventSeq,
        title: cloudAgentConversationTitle(messages),
        messages,
        run,
        model: run?.model,
        permissionMode: run?.permissionMode || "request_approval",
        skillIds: run?.skills?.map((skill) => skill.id),
        createdAt: runs[0]?.createdAt || "",
        updatedAt: run?.updatedAt || "",
    };
}

async function restoreRun(run: AgentRun, client: CloudAgentHistoryClient, options: HistoryOptions, scope: string) {
    const prefix = [...new Map((run.events || []).filter((event) => event.runId === run.id && Number.isSafeInteger(event.seq) && event.seq > 0).map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
    const events: AgentEvent[] = prefix.every((event, index) => event.seq === index + 1) ? prefix : [];
    let seq = events.at(-1)?.seq || 0;
    let snapshot = run;
    if (seq > 0 && seq === run.eventCount && !run.eventsTruncated) return { ...run, events };
    do {
        checkRequest(options, scope);
        const { run: next } = await client.getRun(run.id, options.signal, { sinceSeq: seq, fromStart: seq === 0, eventLimit: 500 });
        checkRequest(options, scope);
        if (next.id !== run.id || next.conversationId !== run.conversationId) throw new Error("Agent 轮次归属不一致，已停止恢复");
        const page = [...new Map((next.events || []).filter((event) => event.runId === run.id && Number.isSafeInteger(event.seq) && event.seq > seq).map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
        if (page.some((event, index) => event.seq !== seq + index + 1) || (!page.length && seq < (next.eventCount || 0))) throw new Error("Agent 历史事件未完整返回，请重试读取");
        snapshot = next;
        events.push(...page);
        if (!page.length) break;
        seq = page.at(-1)!.seq;
    } while (seq < (snapshot.eventCount || 0));
    return { ...snapshot, events, latestSeq: seq, eventsTruncated: false };
}

export async function loadCloudAgentConversation(conversationId: string, options: HistoryOptions & { existing?: CloudAgentConversation } = {}): Promise<CloudAgentConversation> {
    if (!conversationId.trim()) throw new Error("缺少 Agent 对话 ID");
    const scope = options.scope || getActiveUserScope();
    const client = options.client || defaultClient;
    const runs: AgentRun[] = [];
    const cursors = new Set<string>();
    let after: string | undefined;
    do {
        checkRequest(options, scope);
        const page = await client.listRuns(conversationId, { after, limit: 100, signal: options.signal });
        checkRequest(options, scope);
        assertConversation(conversationId, page.items);
        runs.push(...page.items);
        after = page.nextCursor;
        if (after && cursors.has(after)) throw new Error("Agent 历史分页未前进，请重新读取对话");
        if (after) cursors.add(after);
    } while (after);
    const ordered = orderRuns(runs);
    const restored = new Array<AgentRun>(ordered.length);
    let index = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, ordered.length) }, async () => {
            while (index < ordered.length) {
                const current = index++;
                restored[current] = await restoreRun(ordered[current], client, options, scope);
            }
        }),
    );
    checkRequest(options, scope);
    const remote = projectCloudAgentConversation(conversationId, restored);
    return options.existing ? mergeCloudAgentConversation(options.existing, remote) : remote;
}

export function mergeCloudAgentConversation(local: CloudAgentConversation, remote: CloudAgentConversation): CloudAgentConversation {
    const identity = cloudAgentConversationServerId(local);
    // 旧浏览器缓存没有 conversationId 时，只能通过同一个已确认 run ID 认领，不能按文本或本地 ID 猜测。
    if (identity ? identity !== cloudAgentConversationServerId(remote) : !local.run || !remote.runs?.some((run) => run.id === local.run?.id)) throw new Error("Agent 对话归属不一致，已保留原本地对话");
    const byId = new Map(local.messages.map((message) => [message.id, message]));
    const submittedUserIds = new Map((remote.runs || []).filter((run) => run.idempotencyKey).map((run) => [`user-${run.id}`, `user-${run.idempotencyKey}`]));
    const consumed = new Set<string>();
    const messages = remote.messages.map((message) => {
        const submittedId = message.role === "user" ? submittedUserIds.get(message.id) : undefined;
        const cached = byId.get(message.id) || (submittedId ? byId.get(submittedId) : undefined);
        if (!cached) return message;
        consumed.add(cached.id);
        return message.role === "user" ? { ...message, ...cached, id: message.id } : { ...cached, ...message };
    });
    messages.push(...local.messages.filter((message) => !consumed.has(message.id) && !remote.messages.some((entry) => entry.id === message.id)));
    const newerLocalRun =
        local.run && remote.run?.id === local.run.id && ((local.run.revision || 0) > (remote.run.revision || 0) || (local.lastEventSeq || 0) > (remote.lastEventSeq || 0) || (terminal.has(local.run.status) && !terminal.has(remote.run.status)));
    return {
        ...local,
        ...remote,
        id: local.id,
        messages,
        ...(newerLocalRun ? { run: local.run, messages: local.messages, lastEventSeq: Math.max(local.lastEventSeq || 0, remote.lastEventSeq || 0) } : {}),
        draft: local.draft,
        localNewCanvasId: local.localNewCanvasId,
        localSelectedCanvasId: local.localSelectedCanvasId,
        permissionMode: local.permissionMode,
        model: local.model || remote.model,
        skillIds: local.skillIds || remote.skillIds,
    };
}

export function mergeCloudAgentConversations(local: CloudAgentConversation[], remote: CloudAgentConversation[]) {
    const remaining = new Map(remote.map((conversation) => [cloudAgentConversationServerId(conversation), conversation]));
    const conversations = local.map((conversation) => {
        const key = cloudAgentConversationServerId(conversation);
        const restored = key ? remaining.get(key) : [...remaining.values()].find((entry) => conversation.run && entry.runs?.some((run) => run.id === conversation.run?.id));
        if (!restored) return conversation;
        remaining.delete(cloudAgentConversationServerId(restored));
        return mergeCloudAgentConversation(conversation, restored);
    });
    return [...conversations, ...remaining.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function unchanged(summary: AgentConversationSummary, cached: CloudAgentConversation | undefined) {
    const run = cached?.run;
    return run?.id === summary.latestRunId && (run.revision || 0) === summary.revision && run.status === summary.status && Boolean(run.cleanupPending) === Boolean(summary.cleanupPending);
}

export async function refreshCloudAgentConversations(options: HistoryOptions & { canvasId?: string; existing?: CloudAgentConversation[]; observedConversationIds?: string[] } = {}): Promise<CloudAgentConversation[]> {
    const scope = options.scope || getActiveUserScope();
    const client = options.client || defaultClient;
    const summaries: AgentConversationSummary[] = [];
    const cursors = new Set<string>();
    let before: string | undefined;
    if (options.canvasId)
        do {
            checkRequest(options, scope);
            const page = await client.listConversations({ canvasId: options.canvasId, before, limit: 100, signal: options.signal });
            checkRequest(options, scope);
            summaries.push(...page.items);
            before = page.nextCursor;
            if (before && cursors.has(before)) throw new Error("Agent 对话目录分页未前进");
            if (before) cursors.add(before);
        } while (before);
    const byId = new Map(summaries.map((summary) => [summary.id, summary]));
    const ids = [...new Set([...byId.keys(), ...(options.observedConversationIds || [])])];
    const conversations = new Array<CloudAgentConversation>(ids.length);
    let index = 0;
    await Promise.all(
        Array.from({ length: Math.min(4, ids.length) }, async () => {
            while (index < ids.length) {
                const current = index++;
                const id = ids[current];
                const cached = options.existing?.find((conversation) => cloudAgentConversationServerId(conversation) === id);
                const summary = byId.get(id);
                conversations[current] = summary && unchanged(summary, cached) ? cached! : await loadCloudAgentConversation(id, { ...options, scope, client, existing: cached });
            }
        }),
    );
    checkRequest(options, scope);
    return conversations;
}
