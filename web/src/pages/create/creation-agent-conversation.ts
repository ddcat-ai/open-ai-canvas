import { carryAgentContextUsage, emptyAgentContextUsage, reduceAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import { getAgentRun, getAgentSession, listAgentSessionRuns, type AgentEvent, type AgentRun, type AgentSession } from "@/services/api/agent";
import type { GenerationTask } from "@/services/api/task-center";
import { resolveResourceUrl } from "@/services/api/resources";
import { ApiError, retryApiRead as retryCreationHistoryRead } from "@/services/api/request";
export { retryApiRead as retryCreationHistoryRead } from "@/services/api/request";
import type { CreationAgentPlanItem, CreationAgentQuestion, CreationCommercePlan, CreationConversation, CreationMessage } from "./creation-types";
import { creationImageDownloadBaseName } from "./creation-media-download";

type SessionPage = { session: AgentSession; runs: AgentRun[]; nextRunCursor?: string };
type RunPage = { runs: AgentRun[]; nextRunCursor?: string };
type RunSnapshot = { run: AgentRun };
export type CreationAgentRecoveryClient = {
    getSession: (sessionId: string, signal?: AbortSignal) => Promise<SessionPage>;
    listRuns: (sessionId: string, before: string, signal?: AbortSignal) => Promise<RunPage>;
    getRun: (runId: string, sinceSeq: number, fromStart: boolean, signal?: AbortSignal) => Promise<RunSnapshot>;
};

export const creationAgentRecoveryClient: CreationAgentRecoveryClient = {
    getSession: (sessionId, signal) => getAgentSession(sessionId, signal),
    listRuns: (sessionId, before, signal) => listAgentSessionRuns(sessionId, { before, limit: 100, signal }),
    getRun: (runId, sinceSeq, fromStart, signal) => getAgentRun(runId, signal, { sinceSeq, fromStart, eventLimit: 500 }),
};

const terminal = new Set(["completed", "failed", "cancelled", "rejected"]);
const text = (value: unknown) => (typeof value === "string" ? value : "");
const questionOptions = (value: unknown): CreationAgentQuestion["options"] =>
    Array.isArray(value)
        ? value.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const option = item as Record<string, unknown>;
              const label = text(option.label).trim();
              return label ? [{ label, ...(text(option.detail).trim() ? { detail: text(option.detail).trim() } : {}) }] : [];
          })
        : [];

function creationAgentQuestion(payload: Record<string, unknown>): CreationAgentQuestion | undefined {
    const question = text(payload.question).trim();
    if (!question) return undefined;
    const fields = Array.isArray(payload.fields)
        ? payload.fields.flatMap((item) => {
              if (!item || typeof item !== "object") return [];
              const field = item as Record<string, unknown>;
              const title = text(field.title || field.label).trim();
              return title ? [{ title, required: field.required === true, options: questionOptions(field.options), placeholder: text(field.placeholder).trim() }] : [];
          })
        : [];
    return {
        question,
        kind: payload.kind === "form" || fields.length ? "form" : "choice",
        options: questionOptions(payload.options),
        ...(fields.length ? { fields } : {}),
        allowFreeform: payload.allowFreeform !== false,
        ...(typeof payload.round === "number" ? { round: payload.round } : {}),
        ...(typeof payload.maxRounds === "number" ? { maxRounds: payload.maxRounds } : {}),
    };
}

export function assertCreationAgentSession(session: AgentSession, runs: AgentRun[] = []) {
    if (session.surface !== "creation" || runs.some((run) => run.canvasId || (run.surface && run.surface !== "creation") || (run.sessionId && run.sessionId !== session.id))) {
        throw new Error("此记录不是首页创作会话，请从对应画布继续；首页不会复用画布 Agent 的执行状态");
    }
}

function creationAgentUserAttachments(run: AgentRun): NonNullable<CreationMessage["attachments"]> {
    // 授权列表还包括后台引用的历史素材；只有本轮主动上传的素材才属于用户消息。
    return (run.attachments || [])
        .filter((item) => (item.turnIndex || 0) > 0)
        .map((item) => ({
            id: `resource:${item.resourceId}`,
            storageKey: item.storageKey,
            name: item.name,
            role: item.role,
            type: `${item.kind}/*`,
            url: resolveResourceUrl(item.storageKey),
            previewUrl: "",
            bytes: 0,
        }));
}

export function creationAgentConversationTitle(prompt: string, attachments: Pick<NonNullable<CreationMessage["attachments"]>[number], "name">[] = []) {
    return (prompt.trim() || attachments[0]?.name?.trim() || "Agent 创作").slice(0, 48);
}

export function projectCreationAgentConversation(session: AgentSession, unsortedRuns: AgentRun[]): CreationConversation {
    assertCreationAgentSession(session, unsortedRuns);
    const runs = [...unsortedRuns].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt) || left.id.localeCompare(right.id));
    const messages: CreationMessage[] = [];
    let agentApproval: CreationConversation["agentApproval"];
    let agentPlanItems: CreationConversation["agentPlanItems"];
    let agentCommercePlan: CreationConversation["agentCommercePlan"];
    let agentContextUsage = emptyAgentContextUsage("");
    let previousTextModel = "";
    for (const run of runs) {
        agentApproval = undefined;
        agentPlanItems = undefined;
        agentCommercePlan = undefined;
        agentContextUsage = previousTextModel && previousTextModel === run.model ? carryAgentContextUsage(agentContextUsage, run.id) : emptyAgentContextUsage(run.id);
        previousTextModel = run.model || "";
        const attachments = creationAgentUserAttachments(run);
        if ((run.userPrompt || attachments.length) && !run.retry) messages.push({ id: `user-${run.id}`, role: "user", mode: "agent", content: run.userPrompt || "", createdAt: run.createdAt, model: run.model, attachments });
        const replyIndex = messages.length;
        const imageBatches = new Map<string, number>();
        const parts = new Map<string, { content: string; complete: boolean; continuation: boolean; createdAt: string }>();
        let hasInterjection = false;
        const setPart = (id: string, content: string, complete: boolean, createdAt: string) => {
            const previous = parts.get(id);
            const part = { content, complete, continuation: previous?.continuation ?? hasInterjection, createdAt: previous?.createdAt || createdAt };
            parts.set(id, part);
            if (part.continuation && !previous) messages.push({ id: `${run.id}:assistant:${id}`, role: "assistant", mode: "agent", content: "", createdAt: part.createdAt, agentRunId: run.id, agentContinuation: true });
        };
        let agentQuestion: CreationAgentQuestion | undefined;
        let agentActivity: string | undefined;
        const events = [...(run.events || [])].filter((event) => event.runId === run.id && event.seq > 0).sort((a, b) => a.seq - b.seq);
        const seen = new Set<number>();
        for (const event of events) {
            if (seen.has(event.seq)) continue;
            seen.add(event.seq);
            const payload = event.payload || {};
            if (typeof payload.imageBatchId === "string" && typeof payload.imageBatchTotal === "number" && Number.isInteger(payload.imageBatchTotal) && payload.imageBatchTotal > 0 && payload.imageBatchTotal <= 20)
                imageBatches.set(payload.imageBatchId, payload.imageBatchTotal);
            if (event.type === "assistant_message" || event.type === "assistant_snapshot" || event.type === "assistant_delta") {
                const id = text(payload.messageId) || "assistant";
                const content = text(payload.text || payload.summary || payload.message);
                setPart(id, event.type === "assistant_delta" ? `${parts.get(id)?.content || ""}${content}` : content, event.type === "assistant_message", event.createdAt);
                agentActivity = undefined;
            } else if (["user_interjection", "user_interjection_delivered", "user_interjection_dropped"].includes(event.type)) {
                const id = text(payload.messageId);
                if (!id) continue;
                hasInterjection = true;
                const previous = messages.find((item) => item.id === id && item.agentRunId === run.id);
                const message: CreationMessage = {
                    ...previous,
                    id,
                    role: "user",
                    mode: "agent",
                    agentRunId: run.id,
                    content: text(payload.text) || previous?.content || "",
                    createdAt: previous?.createdAt || event.createdAt,
                    agentInterjection: event.type === "user_interjection_dropped" ? "undelivered" : event.type === "user_interjection_delivered" ? "delivered" : "queued",
                    error: event.type === "user_interjection_dropped" ? text(payload.reason) || "本轮已结束，补充说明未送达" : undefined,
                };
                if (previous) messages[messages.indexOf(previous)] = message;
                else messages.push(message);
            } else if (event.type === "generation_task_created") {
                const taskId = text(payload.taskId);
                if (!taskId) continue;
                const mode = payload.mode === "video" ? "video" : "image";
                if (!messages.some((item) => item.id === `task-${taskId}`))
                    messages.push({
                        id: `task-${taskId}`,
                        role: "assistant",
                        mode,
                        content: text(payload.title) || "媒体生成任务",
                        createdAt: event.createdAt,
                        status: "pending",
                        taskIds: [taskId],
                        agentRunId: run.id,
                        commerceItemId: text(payload.commerceItemId) || undefined,
                        ...(imageBatches.has(text(payload.imageBatchId)) ? { batchId: text(payload.imageBatchId), batchTotal: imageBatches.get(text(payload.imageBatchId)) } : {}),
                    });
            } else if (event.type === "plan_updated" && payload.inherited !== true && Array.isArray(payload.items)) {
                agentActivity = "创作计划已更新";
                agentPlanItems = payload.items.filter((item): item is CreationAgentPlanItem => Boolean(item && typeof item === "object" && "id" in item && "title" in item && "status" in item));
                if (payload.plan && typeof payload.plan === "object" && !Array.isArray(payload.plan)) {
                    agentCommercePlan = {
                        ...(payload.plan as CreationCommercePlan),
                        planHash: text(payload.planHash),
                        references: Array.isArray(payload.references) ? (payload.references as CreationCommercePlan["references"]) : [],
                        skills: Array.isArray(payload.skills) ? (payload.skills as CreationCommercePlan["skills"]) : [],
                        ...(typeof payload.estimatedCredits === "number" ? { estimatedCredits: payload.estimatedCredits, estimateStatus: "quoted" as const } : { estimateStatus: "unavailable" as const }),
                        ...(typeof payload.maxCredits === "number" ? { maxCredits: payload.maxCredits } : {}),
                    };
                }
            } else if (event.type === "approval_requested") {
                const approvalId = text(payload.approvalId);
                if (approvalId)
                    agentApproval = {
                        approvalId,
                        call: { id: text(payload.callId), function: { name: text(payload.toolName), arguments: text(payload.arguments) } },
                        preview: payload.preview as NonNullable<CreationConversation["agentApproval"]>["preview"],
                    };
            } else if (event.type === "approval_decided") {
                if (agentApproval?.approvalId === payload.approvalId) agentApproval = undefined;
            } else if (event.type === "user_question") {
                agentQuestion = creationAgentQuestion(payload);
            } else if (event.type === "tool_completed") {
                const labels: Record<string, string> = { creation_media_read: "已查询创作素材", skill_read_file: "已读取创作技能", model_list: "已查询可用模型" };
                agentActivity = labels[text(payload.toolName)];
            } else if (event.type === "tool_failed") {
                agentActivity = undefined;
            }
            agentContextUsage = reduceAgentContextUsage(agentContextUsage, event);
        }
        if (run.activeMessage) {
            const id = run.activeMessage.messageId || "assistant";
            const previous = parts.get(id);
            // Snapshots can be ahead of replayed deltas. A persisted final message wins.
            if (!previous || (!previous.complete && run.activeMessage.text.length > previous.content.length)) setPart(id, run.activeMessage.text, false, run.updatedAt);
        }
        for (const [id, part] of parts)
            if (part.continuation) {
                const index = messages.findIndex((item) => item.id === `${run.id}:assistant:${id}`);
                const streaming = run.status === "running" && !part.complete && Boolean(part.content);
                messages[index] = { ...messages[index], content: part.content, model: run.model, status: streaming ? "streaming" : "done", agentTextStreaming: streaming };
            }
        const content = [...parts.values()]
            .filter((part) => !part.continuation)
            .map((part) => part.content)
            .filter(Boolean)
            .join("\n\n");
        const latestPart = [...parts.values()].at(-1);
        const agentTextStreaming = run.status === "running" && !agentQuestion && Boolean(latestPart?.content && !latestPart.complete && !latestPart.continuation);
        if (terminal.has(run.status)) agentActivity = undefined;
        else if (agentQuestion) agentActivity = "等待你回复";
        else if (run.status === "waiting_approval") agentActivity = "等待你确认";
        const hasStructuredOutput = Boolean(agentCommercePlan || agentPlanItems?.length || messages.length > replyIndex);
        if (content || agentQuestion || hasStructuredOutput || !terminal.has(run.status) || run.status === "failed" || run.status === "cancelled") {
            messages.splice(replyIndex, 0, {
                id: `${run.id}:assistant`,
                role: "assistant",
                mode: "agent",
                content,
                createdAt: run.createdAt,
                model: run.model,
                agentRunId: run.id,
                agentPlanItems,
                commercePlan: agentCommercePlan,
                agentQuestion,
                agentTextStreaming,
                agentActivity,
                ...(imageBatches.size ? { batchTotal: [...imageBatches.values()].reduce((total, count) => total + count, 0) } : {}),
                status: run.status === "failed" ? "error" : run.status === "cancelled" || run.status === "rejected" ? "cancelled" : terminal.has(run.status) ? "done" : "streaming",
                ...(run.failureMessage ? { error: run.failureMessage } : {}),
            });
        }
        agentContextUsage = reduceAgentContextUsage(agentContextUsage, { runId: run.id, type: "run_status", payload: { status: run.status } });
        if (terminal.has(run.status)) agentApproval = undefined;
        else if (run.approval && !run.approval.decision) agentApproval = run.approval;
    }
    const latest = runs.at(-1);
    const firstUser = messages.find((message) => message.role === "user");
    return {
        id: session.id,
        agentSessionId: session.id,
        agentRunId: latest?.id,
        agentRuns: runs,
        title: session.title || creationAgentConversationTitle(firstUser?.content || "", firstUser?.attachments).slice(0, 24),
        updatedAt: session.updatedAt,
        messages,
        agentApproval,
        agentPlanItems,
        agentCommercePlan,
        agentContextUsage,
    };
}

export async function restoreCreationAgentConversation(sessionId: string, client: CreationAgentRecoveryClient, signal?: AbortSignal): Promise<CreationConversation> {
    signal?.throwIfAborted();
    const first = await retryCreationHistoryRead(() => client.getSession(sessionId, signal), signal);
    signal?.throwIfAborted();
    assertCreationAgentSession(first.session, first.runs);
    const runs = [...first.runs];
    const seen = new Set(runs.map((run) => run.id));
    const cursors = new Set<string>();
    let cursor = first.nextRunCursor;
    while (cursor && !cursors.has(cursor)) {
        cursors.add(cursor);
        const page = await retryCreationHistoryRead(() => client.listRuns(sessionId, cursor!, signal), signal);
        signal?.throwIfAborted();
        for (const run of page.runs)
            if (!seen.has(run.id)) {
                seen.add(run.id);
                runs.push(run);
            }
        cursor = page.nextRunCursor;
    }
    const restoreRun = async (run: AgentRun) => {
        const prefix = [...new Map((run.events || []).filter((event) => event.runId === run.id && Number.isSafeInteger(event.seq) && event.seq > 0).map((event) => [event.seq, event])).values()].sort((left, right) => left.seq - right.seq);
        const events: AgentEvent[] = prefix.every((event, index) => event.seq === index + 1) ? prefix : [];
        let seq = events.at(-1)?.seq || 0;
        let snapshot = run;
        if (Number.isSafeInteger(run.eventCount) && run.eventCount === seq) return { ...run, events };
        do {
            signal?.throwIfAborted();
            const response = await retryCreationHistoryRead(async () => {
                const { run: next } = await client.getRun(run.id, seq, seq === 0, signal);
                const page = [...new Map((next.events || []).filter((event) => event.runId === run.id && event.seq > seq).map((event) => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq);
                if (page.some((event, index) => event.seq !== seq + index + 1) || (!page.length && seq < (next.eventCount || 0))) {
                    throw new ApiError("历史事件未完整返回，请重试加载", { retryable: true });
                }
                return { run: next, page };
            }, signal);
            snapshot = response.run;
            const page = response.page;
            if (!page.length) break;
            events.push(...page);
            seq = page.at(-1)!.seq;
        } while (seq < (snapshot.eventCount || 0));
        return { ...snapshot, events };
    };
    const fullRuns = new Array<AgentRun>(runs.length);
    let nextRun = 0;
    let failed = false;
    await Promise.all(
        Array.from({ length: Math.min(4, runs.length) }, async () => {
            while (!failed && nextRun < runs.length) {
                const index = nextRun++;
                try {
                    fullRuns[index] = await restoreRun(runs[index]);
                } catch (error) {
                    failed = true;
                    throw error;
                }
            }
        }),
    );
    return projectCreationAgentConversation(first.session, fullRuns);
}

// Only server event identities establish a missing delivery. A plan may
// legitimately have unsubmitted items after rejection, cancellation or approval.
export function creationAgentHistoryGapKey(conversation?: CreationConversation): string {
    if (!conversation?.agentSessionId) return "";
    const messages = new Set(conversation.messages.map((message) => message.id));
    for (const run of conversation.agentRuns || []) {
        const events = [...new Map((run.events || []).filter((event) => event.runId === run.id && Number.isSafeInteger(event.seq) && event.seq > 0).map((event) => [event.seq, event])).values()].sort((left, right) => left.seq - right.seq);
        let expected = 1;
        for (const event of events) {
            if (event.seq !== expected) return `${run.id}:seq:${expected}`;
            expected++;
        }
        if (terminal.has(run.status) && (run.eventCount || 0) >= expected) return `${run.id}:seq:${expected}`;
        const created = new Set(
            events
                .filter((event) => event.type === "generation_task_created")
                .map((event) => text(event.payload?.taskId))
                .filter(Boolean),
        );
        for (const event of events) {
            const taskId = text(event.payload?.taskId);
            if (event.type === "generation_task_completed" && taskId && !created.has(taskId)) return `${run.id}:task:${taskId}`;
        }
        for (const taskId of created) if (!messages.has(`task-${taskId}`)) return `${run.id}:message:${taskId}`;
    }
    return "";
}

export async function recoverCreationAgentHistory(current: () => CreationConversation | undefined, client: CreationAgentRecoveryClient, signal?: AbortSignal): Promise<CreationConversation | undefined> {
    const initial = current();
    if (!initial?.agentSessionId || !creationAgentHistoryGapKey(initial)) return;
    const restored = await restoreCreationAgentConversation(initial.agentSessionId, client, signal);
    signal?.throwIfAborted();
    // Read again after I/O: a new direct message/Agent turn must survive, while
    // switching the selected conversation or account invalidates this response.
    const latest = current();
    if (!latest || latest.id !== initial.id || latest.agentSessionId !== initial.agentSessionId) return;
    return mergeCreationAgentConversation(latest, restored);
}

// A shared creation session can contain direct image/video messages. Only stable
// message/task identities establish which Agent run owns a failed delivery.
export function creationAgentRetryRun(conversation: CreationConversation, message: CreationMessage): AgentRun | undefined {
    const runs = conversation.agentRuns || [];
    if (message.agentRunId) return runs.find((run) => run.id === message.agentRunId);
    const taskIds = new Set(message.taskIds || []);
    if (message.id.startsWith("task-")) taskIds.add(message.id.slice(5));
    const matches = runs.filter(
        (run) =>
            message.id === `${run.id}:assistant` ||
            message.id === `error-${run.id}` ||
            Boolean(message.agentIdempotencyKey && run.idempotencyKey === message.agentIdempotencyKey) ||
            (run.events || []).some((event) => event.runId === run.id && event.type === "generation_task_created" && taskIds.has(text(event.payload?.taskId))),
    );
    return matches.length === 1 ? matches[0] : undefined;
}

function mergeCreationAgentAttachments(local: CreationMessage["attachments"], remote: CreationMessage["attachments"]): CreationMessage["attachments"] {
    if (!remote) return local;
    return remote.map((attachment) => {
        const previous = local?.find((item) => item.storageKey === attachment.storageKey);
        return previous
            ? {
                  ...previous,
                  ...attachment,
                  id: previous.id,
                  storageKey: attachment.storageKey || previous.storageKey || "",
                  type: previous.type || attachment.type,
                  url: previous.url || attachment.url || "",
                  previewUrl: previous.previewUrl || attachment.previewUrl,
                  bytes: previous.bytes || attachment.bytes || 0,
              }
            : attachment;
    });
}

function confirmedCreationAgentSubmissions(current: CreationConversation, incoming: CreationConversation) {
    const pending = new Map<string, CreationMessage>();
    for (const message of current.messages) {
        if (message.mode !== "agent" || !message.clientOperationId || !message.agentIdempotencyKey) continue;
        if (!pending.has(message.agentIdempotencyKey) || message.role === "user") pending.set(message.agentIdempotencyKey, message);
    }
    return new Map(
        (incoming.agentRuns || []).flatMap((run) => {
            const submitted = run.idempotencyKey ? pending.get(run.idempotencyKey) : undefined;
            return submitted ? [[run.id, submitted] as const] : [];
        }),
    );
}

export function mergeCreationAgentConversation(current: CreationConversation, incoming: CreationConversation): CreationConversation {
    if (!incoming.agentSessionId || (current.agentSessionId && current.agentSessionId !== incoming.agentSessionId)) throw new Error("首页创作会话归属不一致，已保留原会话");
    const runs = new Map((current.agentRuns || []).map((run) => [run.id, run]));
    for (const run of incoming.agentRuns || []) {
        const previous = runs.get(run.id);
        if (previous === run) continue;
        if (!previous) {
            runs.set(run.id, run);
            continue;
        }
        const previousRevision = previous.revision || 0;
        const revision = run.revision || 0;
        const stale = previousRevision > revision || (previousRevision === revision && Date.parse(previous.updatedAt) > Date.parse(run.updatedAt)) || (terminal.has(previous.status) && !terminal.has(run.status));
        const events = new Map([...(previous.events || []), ...(run.events || [])].map((event) => [event.seq, event]));
        runs.set(run.id, { ...(stale ? previous : run), events: [...events.values()].sort((left, right) => left.seq - right.seq) });
    }
    // 恢复图片缓存会更新本地 updatedAt；历史排序只使用真实会话、轮次和消息时间。
    const updatedAt = [...runs.values()]
        .map((run) => run.updatedAt)
        .concat(current.messages.map((message) => message.createdAt))
        .reduce((latest, at) => (Date.parse(at) > Date.parse(latest) ? at : latest), incoming.updatedAt);
    const session: AgentSession = { id: incoming.agentSessionId, title: incoming.title, surface: "creation", status: "active", revision: 0, createdAt: incoming.updatedAt, updatedAt };
    const projected = projectCreationAgentConversation(session, [...runs.values()]);
    const ordinary = new Map(current.messages.map((message) => [message.id, message]));
    for (const message of incoming.messages) {
        if (!message.mode || message.mode === "agent" || message.agentRunId) continue;
        const previous = ordinary.get(message.id);
        const taskIds = [...new Set([...(previous?.taskIds || []), ...(message.taskIds || [])])];
        ordinary.set(message.id, previous ? { ...message, ...previous, ...(taskIds.length ? { taskIds, submissionPending: undefined } : {}) } : message);
    }
    return mergeProjectedCreationAgentConversation({ ...current, historySourceId: incoming.historySourceId || current.historySourceId, messages: [...ordinary.values()] }, projected, current.agentRuns || []);
}

function mergeProjectedCreationAgentConversation(current: CreationConversation, projected: CreationConversation, previousRuns: AgentRun[]): CreationConversation {
    const previousAgentIds = new Set<string>();
    const runIds = new Set(previousRuns.map((run) => run.id));
    for (const run of previousRuns) {
        previousAgentIds.add(`user-${run.id}`);
        previousAgentIds.add(`${run.id}:assistant`);
        previousAgentIds.add(`error-${run.id}`);
        for (const event of run.events || []) {
            if (event.type === "generation_task_created" && text(event.payload?.taskId)) previousAgentIds.add(`task-${text(event.payload?.taskId)}`);
        }
    }
    for (const message of current.messages) {
        if (message.role === "assistant" && message.mode === "agent" && (runIds.has(message.agentRunId || "") || previousRuns.some((run) => message.id.startsWith(`${run.id}:`)))) previousAgentIds.add(message.id);
    }
    const previousById = new Map(current.messages.map((message) => [message.id, message]));
    const confirmed = confirmedCreationAgentSubmissions(current, projected);
    const confirmedOperations = new Set([...confirmed.values()].map((message) => message.clientOperationId));
    const messages = projected.messages.map((message) => {
        const previous = previousById.get(message.id);
        const submitted = message.role === "user" ? confirmed.get(message.id.slice("user-".length)) : undefined;
        if (submitted) return { ...previous, ...message, attachments: mergeCreationAgentAttachments(submitted.attachments, message.attachments), references: submitted.references };
        if (!previous) return message;
        return {
            ...previous,
            ...message,
            attachments: mergeCreationAgentAttachments(previous.attachments, message.attachments),
            ...(previous.taskIds?.length && previous.status !== "pending" ? { status: previous.status, resultUrls: previous.resultUrls, resultStorageKeys: previous.resultStorageKeys, error: previous.error } : {}),
        };
    });
    const replacements = new Map(messages.map((message) => [message.id, message]));
    const merged = current.messages.flatMap((message) => {
        if (message.clientOperationId && confirmedOperations.has(message.clientOperationId)) return [];
        const replacement = replacements.get(message.id);
        replacements.delete(message.id);
        return replacement ? [replacement] : previousAgentIds.has(message.id) ? [] : [message];
    });
    merged.push(...replacements.values());
    return { ...current, ...projected, id: current.id, messages: merged.sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt)) };
}

export function beginCreationAgentSubmission(
    conversation: CreationConversation,
    submission: { id: string; prompt: string; createdAt: string; attachments?: CreationMessage["attachments"]; references?: CreationMessage["references"]; model?: string; silent?: boolean },
): CreationConversation {
    if (conversation.messages.some((message) => message.clientOperationId === submission.id && message.agentIdempotencyKey)) {
        return { ...conversation, messages: conversation.messages.map((message) => (message.clientOperationId === submission.id && message.role === "assistant" ? { ...message, status: "streaming", error: undefined } : message)) };
    }
    const common = { mode: "agent" as const, createdAt: submission.createdAt, clientOperationId: submission.id };
    return {
        ...conversation,
        updatedAt: submission.createdAt,
        title: conversation.title === "新创作" ? creationAgentConversationTitle(submission.prompt, submission.attachments).slice(0, 24) : conversation.title,
        messages: [
            ...conversation.messages.filter((message) => message.clientOperationId !== submission.id),
            ...(submission.silent ? [] : [{ ...common, id: `user-${submission.id}`, role: "user" as const, content: submission.prompt, attachments: submission.attachments, references: submission.references }]),
            { ...common, id: `${submission.id}:assistant`, role: "assistant", content: "", status: "streaming", model: submission.model },
        ],
    };
}

export function bindCreationAgentSubmission(conversation: CreationConversation, submissionId: string, sessionId: string, key: string): CreationConversation {
    if (conversation.agentSessionId && conversation.agentSessionId !== sessionId) throw new Error("首页创作会话归属不一致，已保留原会话");
    return { ...conversation, agentSessionId: sessionId, messages: conversation.messages.map((message) => (message.clientOperationId === submissionId ? { ...message, agentIdempotencyKey: key, agentSubmissionRejected: undefined } : message)) };
}

export function settleCreationAgentSubmission(current: CreationConversation, incoming: CreationConversation, submissionId: string): CreationConversation {
    const submitted = current.messages.find((message) => message.clientOperationId === submissionId && message.role === "user");
    const merged = mergeCreationAgentConversation({ ...current, messages: current.messages.filter((message) => message.clientOperationId !== submissionId) }, incoming);
    return {
        ...merged,
        messages: merged.messages.map((message) =>
            submitted && message.id === `user-${incoming.agentRunId}` ? { ...message, attachments: mergeCreationAgentAttachments(submitted.attachments, message.attachments), references: submitted.references } : message,
        ),
    };
}

export function failCreationAgentSubmission(conversation: CreationConversation, submissionId: string, error: string, rejectedKey?: string): CreationConversation {
    return {
        ...conversation,
        messages: conversation.messages.map((message) => {
            if (message.clientOperationId !== submissionId) return message;
            const failed = message.role === "assistant" ? { ...message, status: "error" as const, error } : message;
            // A definite admission rejection has no run to recover. Keep the
            // draft/error visible, but let the next submit replace these bubbles.
            return rejectedKey && message.agentIdempotencyKey === rejectedKey ? { ...failed, agentIdempotencyKey: undefined, agentSubmissionRejected: true } : failed;
        }),
    };
}

function prepareCachedCreationAgentConversation(conversation: CreationConversation): CreationConversation {
    const userAttachments = new Map((conversation.agentRuns || []).map((run) => [`user-${run.id}`, creationAgentUserAttachments(run)]));
    const titles = new Map<string, string>(
        (conversation.agentRuns || []).flatMap((run) =>
            (run.events || []).flatMap((event) => {
                const taskId = text(event.payload?.taskId);
                return event.runId === run.id && event.type === "generation_task_created" && taskId ? [[`task-${taskId}`, text(event.payload?.title) || "媒体生成任务"] as const] : [];
            }),
        ),
    );
    return {
        ...conversation,
        messages: conversation.messages.map((message) => {
            if (message.role === "user" && userAttachments.has(message.id)) return { ...message, attachments: mergeCreationAgentAttachments(message.attachments, userAttachments.get(message.id)) };
            if (!message.agentRunId || !message.id.startsWith("task-") || (message.mode !== "image" && message.mode !== "video")) return message;
            // 场景标题来自创建事件；旧缓存可能被批次进度覆盖。失败状态等待原任务复核，不阻塞已成功素材。
            return { ...message, content: titles.get(message.id) || message.content, taskStatePending: Boolean(message.taskIds?.length && (message.status === "error" || (message.status === "pending" && message.error))) };
        }),
    };
}

export function mergeCreationConversationHistory(local: CreationConversation[], remote: CreationConversation[], preferredId?: string, recoverPendingSubmissions = true) {
    const remaining = new Map(remote.map((conversation) => [conversation.agentSessionId || conversation.id, conversation]));
    const confirmedSubmissions: Array<{ conversationId: string; key: string }> = [];
    const conversations = local.map((cached) => {
        const conversation = recoverPendingSubmissions ? prepareCachedCreationAgentConversation(cached) : cached;
        const key = conversation.agentSessionId || conversation.id;
        const restored = remaining.get(key);
        remaining.delete(key);
        if (restored) for (const submitted of confirmedCreationAgentSubmissions(conversation, restored).values()) confirmedSubmissions.push({ conversationId: conversation.id, key: submitted.agentIdempotencyKey! });
        const recovered = recoverPendingSubmissions
            ? {
                  ...conversation,
                  messages: conversation.messages.map((message) =>
                      message.role === "assistant" && message.mode === "agent" && message.clientOperationId?.startsWith("agent-submission-") && message.status === "streaming"
                          ? { ...message, status: "error" as const, error: "请求结果待确认，请先核对历史运行记录，或使用原提示词和设置重试" }
                          : message,
                  ),
              }
            : conversation;
        return restored ? mergeCreationAgentConversation(recovered, restored) : recovered;
    });
    conversations.push(...remaining.values());
    const preferred = conversations.find((conversation) => conversation.id === preferredId || conversation.agentSessionId === preferredId);
    return { conversations, activeId: preferred?.id || conversations[0]?.id || "", confirmedSubmissions };
}

export function applyCreationAgentTaskState(conversation: CreationConversation, task: Pick<GenerationTask, "id" | "status" | "resultJson" | "previewUrl" | "error">): CreationConversation {
    const id = `task-${task.id}`;
    if (!conversation.messages.some((message) => message.id === id)) return conversation;
    let urls: string[] = task.previewUrl ? [task.previewUrl] : [];
    let keys: string[] = [];
    if (task.status === "succeeded" && task.resultJson) {
        try {
            const result = JSON.parse(task.resultJson) as { images?: Array<{ dataUrl?: string; storageKey?: string }>; video?: { dataUrl?: string; storageKey?: string } };
            const media = [...(result.images || []), ...(result.video ? [result.video] : [])];
            urls = [...new Set([...urls, ...media.map((item) => item.dataUrl || "").filter(Boolean)])];
            keys = [...new Set(media.map((item) => item.storageKey || "").filter(Boolean))];
        } catch {
            /* 后端任务的结果错误由任务卡呈现，不伪造成功素材。 */
        }
    }
    return {
        ...conversation,
        messages: conversation.messages.map((message) =>
            message.id !== id
                ? message
                : {
                      ...message,
                      status:
                          task.status === "succeeded" ? (urls.length || keys.length ? ("done" as const) : ("error" as const)) : task.status === "failed" ? ("error" as const) : task.status === "cancelled" ? ("cancelled" as const) : ("pending" as const),
                      taskStatePending: undefined,
                      generationErrorCode: undefined,
                      ...(urls.length ? { resultUrls: urls } : {}),
                      ...(keys.length ? { resultStorageKeys: keys } : {}),
                      error: task.status === "failed" || (task.status === "succeeded" && !urls.length && !keys.length) ? task.error || "任务已结束，但生成结果暂时无法读取" : undefined,
                  },
        ),
    };
}

/** 重试属于原交付项；保留成品，否则显示该项最新一次尝试。 */
export function creationAgentLatestMediaTasks(tasks: CreationMessage[]): CreationMessage[] {
    const latest = new Map<string, CreationMessage>();
    for (const source of tasks) {
        const task: CreationMessage = source.taskStatePending ? { ...source, status: "pending", error: undefined } : source;
        const key = task.commerceItemId ? `${task.agentRunId}:${task.mode}:${task.commerceItemId}` : task.id;
        const previous = latest.get(key);
        if (previous?.status !== "done" || task.status === "done") latest.set(key, task);
    }
    return [...latest.values()];
}

/** 只聚合展示；原任务消息继续承担状态恢复、素材归属和单项重试。 */
export function projectCreationAgentMediaBatches(reply: CreationMessage, tasks: CreationMessage[]): CreationMessage[] {
    const current = creationAgentLatestMediaTasks(tasks.filter((task) => task.agentRunId === reply.agentRunId));
    const imageTasks = current.filter((task) => task.mode === "image");
    const planImages = reply.commercePlan?.items.filter((item) => item.type === "image") || [];
    const ordinal = (task: CreationMessage) => {
        const index = planImages.findIndex((item) => item.id === task.commerceItemId || (item.title && item.title === task.content));
        return index >= 0 ? index : imageTasks.indexOf(task);
    };
    const images = [...imageTasks].sort((a, b) => ordinal(a) - ordinal(b));
    if (!images.length) return current;
    const declaredBatches = new Map(images.filter((task) => task.batchId && task.batchTotal).map((task) => [task.batchId!, task.batchTotal!]));
    const declaredTotal = [...declaredBatches.values()].reduce((total, count) => total + count, 0) + images.filter((task) => !task.batchId).length;
    const total = Math.max(images.length, declaredTotal, reply.batchTotal || 0, planImages.length);
    const succeeded = images.filter((task) => task.status === "done");
    const ended = images.filter((task) => task.status === "done" || task.status === "error" || task.status === "cancelled");
    const runEnded = reply.status === "done" || reply.status === "error" || reply.status === "cancelled";
    const recovering = !runEnded && images.some((task) => task.status === "error");
    const finished = !recovering && ended.length === images.length && (images.length >= total || runEnded);
    const failedCount = images.filter((task) => task.status === "error" || task.status === "cancelled").length + (runEnded ? total - images.length : 0);
    const cancelled = finished && !succeeded.length && images.every((task) => task.status === "cancelled");
    const seenResults = new Set<string>();
    const results = succeeded
        .flatMap((task) => {
            const count = Math.max(task.resultUrls?.length || 0, task.resultStorageKeys?.length || 0);
            return Array.from({ length: count }, (_, index) => ({
                url: task.resultUrls?.[index] || "",
                storageKey: task.resultStorageKeys?.[index] || "",
                name: creationImageDownloadBaseName(task.content, ordinal(task) + 1, count > 1 ? index + 1 : undefined),
            }));
        })
        .filter((result) => {
            const identity = result.storageKey || result.url;
            if (!identity || seenResults.has(identity)) return false;
            seenResults.add(identity);
            return true;
        });
    const batch: CreationMessage = {
        ...images[0],
        id: `task-batch-${reply.agentRunId}-image`,
        batchId: `${reply.agentRunId}:image`,
        taskIds: [...new Set(images.flatMap((task) => task.taskIds || []))],
        status: !finished ? "pending" : succeeded.length ? "done" : cancelled ? "cancelled" : "error",
        taskStatePending: images.some((task) => task.taskStatePending),
        content: !finished ? `正在生成图片（${succeeded.length}/${total}）` : cancelled ? "已停止" : succeeded.length ? `${succeeded.length} 张图片已生成` : "生成失败",
        batchTotal: total,
        batchCompletedCount: succeeded.length,
        batchFailedCount: failedCount,
        resultUrls: results.map((result) => result.url),
        resultStorageKeys: results.some((result) => result.storageKey) ? results.map((result) => result.storageKey) : [],
        resultDownloadNames: results.map((result) => result.name),
        error: finished ? images.find((task) => task.status === "error")?.error : undefined,
    };
    let included = false;
    return current.flatMap((task) => {
        if (task.mode !== "image") return [task];
        if (included) return [];
        included = true;
        return [batch];
    });
}

export function appendCreationAgentEvent(conversation: CreationConversation, event: AgentEvent): CreationConversation {
    const runs = conversation.agentRuns || [];
    const index = runs.findIndex((run) => run.id === event.runId);
    if (index < 0) return conversation;
    const run = runs[index];
    const exists = event.seq > 0 && run.events?.some((item) => item.seq === event.seq);
    if (exists) return conversation;
    const payload = event.payload || {};
    const updated: AgentRun =
        event.type === "run_status"
            ? {
                  ...run,
                  status: typeof payload.status === "string" ? (payload.status as AgentRun["status"]) : run.status,
                  ...(typeof payload.revision === "number" ? { revision: payload.revision } : {}),
                  ...(typeof payload.eventCount === "number" && Number.isSafeInteger(payload.eventCount) && payload.eventCount >= 0 ? { eventCount: payload.eventCount } : {}),
                  ...(typeof payload.cleanupPending === "boolean" ? { cleanupPending: payload.cleanupPending } : {}),
                  failureMessage: text(payload.failureMessage) || run.failureMessage,
                  approval: payload.approval && typeof payload.approval === "object" ? (payload.approval as AgentRun["approval"]) : undefined,
                  updatedAt: event.createdAt,
              }
            : {
                  ...run,
                  events: event.seq > 0 ? [...(run.events || []), event] : run.events,
                  ...(event.seq === 0 && (event.type === "assistant_message" || event.type === "assistant_snapshot") ? { activeMessage: { messageId: text(payload.messageId) || "assistant", text: text(payload.text) } } : {}),
                  updatedAt: event.createdAt,
              };
    const nextRuns = [...runs];
    nextRuns[index] = updated;
    if ((run.revision || 0) > (updated.revision || 0) || (terminal.has(run.status) && !terminal.has(updated.status))) return conversation;
    // 迟到的旧轮次和乱序补页走完整合并；实时当前轮次不再反复投影已经完成的历史。
    if (conversation.agentRunId !== run.id || conversation.agentContextUsage?.runId !== run.id || (event.seq > 0 && (run.events || []).some((item) => item.seq > event.seq))) {
        return mergeCreationAgentConversation(conversation, { ...conversation, agentSessionId: conversation.agentSessionId || conversation.id, agentRuns: [updated], updatedAt: event.createdAt });
    }
    const projected = projectCreationAgentConversation({ id: conversation.agentSessionId || conversation.id, title: conversation.title, surface: "creation", status: "active", revision: 0, createdAt: run.createdAt, updatedAt: event.createdAt }, [updated]);
    projected.agentRuns = nextRuns;
    projected.agentContextUsage = reduceAgentContextUsage(reduceAgentContextUsage(conversation.agentContextUsage || emptyAgentContextUsage(run.id), event), { runId: run.id, type: "run_status", payload: { status: updated.status } });
    return mergeProjectedCreationAgentConversation(conversation, projected, [run]);
}
