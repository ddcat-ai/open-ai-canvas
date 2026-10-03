import { carryAgentContextUsage, emptyAgentContextUsage, reduceAgentContextUsage } from "@/lib/canvas/agent-context-usage";
import { getAgentRun, getAgentSession, listAgentSessionRuns, type AgentEvent, type AgentRun, type AgentSession } from "@/services/api/agent";
import type { GenerationTask } from "@/services/api/task-center";
import { resolveResourceUrl } from "@/services/api/resources";
import type { CreationAgentPlanItem, CreationAgentQuestion, CreationCommercePlan, CreationConversation, CreationMessage } from "./creation-types";
import { creationImageDownloadBaseName } from "./creation-media-download";

type SessionPage = { session: AgentSession; runs: AgentRun[]; nextRunCursor?: string };
type RunPage = { runs: AgentRun[]; nextRunCursor?: string };
type RunSnapshot = { run: AgentRun };
export type CreationAgentRecoveryClient = {
    getSession: (sessionId: string) => Promise<SessionPage>;
    listRuns: (sessionId: string, before: string) => Promise<RunPage>;
    getRun: (runId: string, sinceSeq: number, fromStart: boolean) => Promise<RunSnapshot>;
};

export const creationAgentRecoveryClient: CreationAgentRecoveryClient = {
    getSession: (sessionId) => getAgentSession(sessionId),
    listRuns: (sessionId, before) => listAgentSessionRuns(sessionId, { before, limit: 100 }),
    getRun: (runId, sinceSeq, fromStart) => getAgentRun(runId, undefined, { sinceSeq, fromStart, eventLimit: 500 }),
};

const terminal = new Set(["completed", "failed", "cancelled", "rejected"]);
const text = (value: unknown) => typeof value === "string" ? value : "";
const questionOptions = (value: unknown): CreationAgentQuestion["options"] => Array.isArray(value) ? value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const option = item as Record<string, unknown>;
    const label = text(option.label).trim();
    return label ? [{ label, ...(text(option.detail).trim() ? { detail: text(option.detail).trim() } : {}) }] : [];
}) : [];

function creationAgentQuestion(payload: Record<string, unknown>): CreationAgentQuestion | undefined {
    const question = text(payload.question).trim();
    if (!question) return undefined;
    const fields = Array.isArray(payload.fields) ? payload.fields.flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const field = item as Record<string, unknown>;
        const title = text(field.title || field.label).trim();
        return title ? [{ title, required: field.required === true, options: questionOptions(field.options), placeholder: text(field.placeholder).trim() }] : [];
    }) : [];
    return { question, kind: payload.kind === "form" || fields.length ? "form" : "choice", options: questionOptions(payload.options), ...(fields.length ? { fields } : {}), allowFreeform: payload.allowFreeform !== false,
        ...(typeof payload.round === "number" ? { round: payload.round } : {}), ...(typeof payload.maxRounds === "number" ? { maxRounds: payload.maxRounds } : {}) };
}

export function assertCreationAgentSession(session: AgentSession, runs: AgentRun[] = []) {
    if (session.surface !== "creation" || runs.some((run) => run.canvasId || run.surface && run.surface !== "creation" || run.sessionId && run.sessionId !== session.id)) {
        throw new Error("此记录不是首页创作会话，请从对应画布继续；首页不会复用画布 Agent 的执行状态");
    }
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
        agentContextUsage = previousTextModel && previousTextModel === run.model
            ? carryAgentContextUsage(agentContextUsage, run.id)
            : emptyAgentContextUsage(run.id);
        previousTextModel = run.model || "";
        if (run.userPrompt) messages.push({ id: `user-${run.id}`, role: "user", mode: "agent", content: run.userPrompt, createdAt: run.createdAt, model: run.model,
            ...(run.attachments?.length ? { attachments: run.attachments.map((item) => ({ id: `resource:${item.resourceId}`, storageKey: item.storageKey, name: item.name, role: item.role, type: `${item.kind}/*`, url: resolveResourceUrl(item.storageKey), previewUrl: "", bytes: 0 })) } : {}),
        });
        const replyIndex = messages.length;
        const parts = new Map<string, { content: string; complete: boolean }>();
        let agentQuestion: CreationAgentQuestion | undefined;
        const events = [...(run.events || [])].filter((event) => event.runId === run.id && event.seq > 0).sort((a, b) => a.seq - b.seq);
        const seen = new Set<number>();
        for (const event of events) {
            if (seen.has(event.seq)) continue;
            seen.add(event.seq);
            const payload = event.payload || {};
            if (event.type === "assistant_message" || event.type === "assistant_snapshot" || event.type === "assistant_delta") {
                const id = text(payload.messageId) || "assistant";
                const content = text(payload.text || payload.summary || payload.message);
                parts.set(id, { content: event.type === "assistant_delta" ? `${parts.get(id)?.content || ""}${content}` : content, complete: event.type === "assistant_message" });
            } else if (event.type === "generation_task_created") {
                const taskId = text(payload.taskId);
                if (!taskId) continue;
                const mode = payload.mode === "video" ? "video" : "image";
                if (!messages.some((item) => item.id === `task-${taskId}`)) messages.push({ id: `task-${taskId}`, role: "assistant", mode, content: text(payload.title) || "媒体生成任务", createdAt: event.createdAt, status: "pending", taskIds: [taskId], agentRunId: run.id, commerceItemId: text(payload.commerceItemId) || undefined });
            } else if (event.type === "plan_updated" && payload.inherited !== true && Array.isArray(payload.items)) {
                agentPlanItems = payload.items.filter((item): item is CreationAgentPlanItem => Boolean(item && typeof item === "object" && "id" in item && "title" in item && "status" in item));
                if (payload.plan && typeof payload.plan === "object" && !Array.isArray(payload.plan)) {
                    agentCommercePlan = { ...payload.plan as CreationCommercePlan,
                        planHash: text(payload.planHash),
                        references: Array.isArray(payload.references) ? payload.references as CreationCommercePlan["references"] : [],
                        skills: Array.isArray(payload.skills) ? payload.skills as CreationCommercePlan["skills"] : [],
                        ...(typeof payload.estimatedCredits === "number" ? { estimatedCredits: payload.estimatedCredits, estimateStatus: "quoted" as const } : { estimateStatus: "unavailable" as const }),
                        ...(typeof payload.maxCredits === "number" ? { maxCredits: payload.maxCredits } : {}),
                    };
                }
            } else if (event.type === "approval_requested") {
                const approvalId = text(payload.approvalId);
                if (approvalId) agentApproval = { approvalId, call: { id: text(payload.callId), function: { name: text(payload.toolName), arguments: text(payload.arguments) } }, preview: payload.preview as NonNullable<CreationConversation["agentApproval"]>["preview"] };
            } else if (event.type === "approval_decided") {
                if (agentApproval?.approvalId === payload.approvalId) agentApproval = undefined;
            } else if (event.type === "user_question") {
                agentQuestion = creationAgentQuestion(payload);
            }
            agentContextUsage = reduceAgentContextUsage(agentContextUsage, event);
        }
        if (run.activeMessage) {
            const id = run.activeMessage.messageId || "assistant";
            const previous = parts.get(id);
            // Snapshots can be ahead of replayed deltas. A persisted final message wins.
            if (!previous || !previous.complete && run.activeMessage.text.length > previous.content.length) parts.set(id, { content: run.activeMessage.text, complete: false });
        }
        const content = [...parts.values()].map((part) => part.content).filter(Boolean).join("\n\n");
        if (content || agentQuestion || !terminal.has(run.status) || run.status === "failed") {
            messages.splice(replyIndex, 0, { id: `${run.id}:assistant`, role: "assistant", mode: "agent", content, createdAt: run.createdAt, model: run.model,
                agentRunId: run.id, commercePlan: agentCommercePlan, agentQuestion,
                status: run.status === "failed" ? "error" : run.status === "cancelled" || run.status === "rejected" ? "cancelled" : terminal.has(run.status) ? "done" : "streaming",
                ...(run.failureMessage ? { error: run.failureMessage } : {}),
            });
        }
        agentContextUsage = reduceAgentContextUsage(agentContextUsage, { runId: run.id, type: "run_status", payload: { status: run.status } });
        if (run.approval && !run.approval.decision) agentApproval = run.approval;
    }
    const latest = runs.at(-1);
    return { id: session.id, agentSessionId: session.id, agentRunId: latest?.id, agentRuns: runs, title: session.title || runs[0]?.userPrompt?.slice(0, 24) || "Agent 创作", updatedAt: session.updatedAt, messages, agentApproval, agentPlanItems, agentCommercePlan, agentContextUsage };
}

export async function restoreCreationAgentConversation(sessionId: string, client: CreationAgentRecoveryClient): Promise<CreationConversation> {
    const first = await client.getSession(sessionId);
    assertCreationAgentSession(first.session, first.runs);
    const runs = [...first.runs];
    const seen = new Set(runs.map((run) => run.id));
    const cursors = new Set<string>();
    let cursor = first.nextRunCursor;
    while (cursor && !cursors.has(cursor)) {
        cursors.add(cursor);
        const page = await client.listRuns(sessionId, cursor);
        for (const run of page.runs) if (!seen.has(run.id)) { seen.add(run.id); runs.push(run); }
        cursor = page.nextRunCursor;
    }
    const fullRuns = await Promise.all(runs.map(async (run) => {
        const events: AgentEvent[] = [];
        let seq = 0;
        let snapshot = run;
        do {
            const response = await client.getRun(run.id, seq, seq === 0);
            snapshot = response.run;
            const page = (snapshot.events || []).filter((event) => event.runId === run.id && event.seq > seq).sort((a, b) => a.seq - b.seq);
            if (!page.length) break;
            events.push(...page);
            seq = page.at(-1)!.seq;
        } while (seq < (snapshot.eventCount || 0));
        return { ...snapshot, events };
    }));
    return projectCreationAgentConversation(first.session, fullRuns);
}

function mergeCreationAgentAttachments(local: CreationMessage["attachments"], remote: CreationMessage["attachments"]): CreationMessage["attachments"] {
    if (!remote) return local;
    return remote.map((attachment) => {
        const previous = local?.find((item) => item.storageKey === attachment.storageKey);
        return previous ? { ...previous, ...attachment, id: previous.id, storageKey: attachment.storageKey || previous.storageKey || "", type: previous.type || attachment.type, url: previous.url || attachment.url || "", previewUrl: previous.previewUrl || attachment.previewUrl, bytes: previous.bytes || attachment.bytes || 0 } : attachment;
    });
}

function confirmedCreationAgentSubmissions(current: CreationConversation, incoming: CreationConversation) {
    const pending = new Map(current.messages.filter((message) => message.role === "user" && message.mode === "agent" && message.clientOperationId && message.agentIdempotencyKey).map((message) => [message.agentIdempotencyKey!, message]));
    return new Map((incoming.agentRuns || []).flatMap((run) => {
        const submitted = run.idempotencyKey ? pending.get(run.idempotencyKey) : undefined;
        return submitted ? [[run.id, submitted] as const] : [];
    }));
}

export function mergeCreationAgentConversation(current: CreationConversation, incoming: CreationConversation): CreationConversation {
    if (!incoming.agentSessionId || current.agentSessionId && current.agentSessionId !== incoming.agentSessionId) throw new Error("首页创作会话归属不一致，已保留原会话");
    const runs = new Map((current.agentRuns || []).map((run) => [run.id, run]));
    for (const run of incoming.agentRuns || []) {
        const previous = runs.get(run.id);
        if (!previous) { runs.set(run.id, run); continue; }
        const stale = (previous.revision || 0) > (run.revision || 0) || Date.parse(previous.updatedAt) > Date.parse(run.updatedAt) || terminal.has(previous.status) && !terminal.has(run.status);
        const events = new Map([...(previous.events || []), ...(run.events || [])].map((event) => [event.seq, event]));
        runs.set(run.id, { ...(stale ? previous : run), events: [...events.values()].sort((left, right) => left.seq - right.seq) });
    }
    const session: AgentSession = { id: incoming.agentSessionId, title: incoming.title, surface: "creation", status: "active", revision: 0, createdAt: incoming.updatedAt, updatedAt: Date.parse(current.updatedAt) > Date.parse(incoming.updatedAt) ? current.updatedAt : incoming.updatedAt };
    const projected = projectCreationAgentConversation(session, [...runs.values()]);
    const previousAgentIds = current.agentSessionId ? new Set(projectCreationAgentConversation({ ...session, id: current.agentSessionId }, current.agentRuns || []).messages.map((message) => message.id)) : new Set<string>();
    for (const message of current.messages) {
        if (message.role === "assistant" && message.mode === "agent" && (current.agentRuns || []).some((run) => message.id.startsWith(`${run.id}:`) || message.id === `error-${run.id}`)) previousAgentIds.add(message.id);
    }
    const previousById = new Map(current.messages.map((message) => [message.id, message]));
    const confirmed = confirmedCreationAgentSubmissions(current, incoming);
    const confirmedOperations = new Set([...confirmed.values()].map((message) => message.clientOperationId));
    const messages = projected.messages.map((message) => {
        const previous = previousById.get(message.id);
        const submitted = message.role === "user" ? confirmed.get(message.id.slice("user-".length)) : undefined;
        if (submitted) return { ...previous, ...message, attachments: mergeCreationAgentAttachments(submitted.attachments, message.attachments), references: submitted.references };
        if (!previous) return message;
        return { ...previous, ...message, attachments: mergeCreationAgentAttachments(previous.attachments, message.attachments), ...(previous.taskIds?.length && previous.status !== "pending" ? { status: previous.status, resultUrls: previous.resultUrls, resultStorageKeys: previous.resultStorageKeys, error: previous.error } : {}) };
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

export function beginCreationAgentSubmission(conversation: CreationConversation, submission: { id: string; prompt: string; createdAt: string; attachments?: CreationMessage["attachments"]; references?: CreationMessage["references"]; model?: string }): CreationConversation {
    if (conversation.messages.some((message) => message.clientOperationId === submission.id && message.agentIdempotencyKey)) {
        return { ...conversation, messages: conversation.messages.map((message) => message.clientOperationId === submission.id && message.role === "assistant" ? { ...message, status: "streaming", error: undefined } : message) };
    }
    const common = { mode: "agent" as const, createdAt: submission.createdAt, clientOperationId: submission.id };
    return { ...conversation, updatedAt: submission.createdAt, title: conversation.title === "新创作" ? submission.prompt.slice(0, 24) : conversation.title, messages: [
        ...conversation.messages.filter((message) => message.clientOperationId !== submission.id),
        { ...common, id: `user-${submission.id}`, role: "user", content: submission.prompt, attachments: submission.attachments, references: submission.references },
        { ...common, id: `${submission.id}:assistant`, role: "assistant", content: "", status: "streaming", model: submission.model },
    ] };
}

export function bindCreationAgentSubmission(conversation: CreationConversation, submissionId: string, sessionId: string, key: string): CreationConversation {
    if (conversation.agentSessionId && conversation.agentSessionId !== sessionId) throw new Error("首页创作会话归属不一致，已保留原会话");
    return { ...conversation, agentSessionId: sessionId, messages: conversation.messages.map((message) => message.clientOperationId === submissionId ? { ...message, agentIdempotencyKey: key } : message) };
}

export function settleCreationAgentSubmission(current: CreationConversation, incoming: CreationConversation, submissionId: string): CreationConversation {
    const submitted = current.messages.find((message) => message.clientOperationId === submissionId && message.role === "user");
    const merged = mergeCreationAgentConversation({ ...current, messages: current.messages.filter((message) => message.clientOperationId !== submissionId) }, incoming);
    return { ...merged, messages: merged.messages.map((message) => submitted && message.id === `user-${incoming.agentRunId}` ? { ...message, attachments: mergeCreationAgentAttachments(submitted.attachments, message.attachments), references: submitted.references } : message) };
}

export function failCreationAgentSubmission(conversation: CreationConversation, submissionId: string, error: string): CreationConversation {
    return { ...conversation, messages: conversation.messages.map((message) => message.clientOperationId === submissionId && message.role === "assistant" ? { ...message, status: "error", error } : message) };
}

export function mergeCreationConversationHistory(local: CreationConversation[], remote: CreationConversation[], preferredId?: string) {
    const remaining = new Map(remote.map((conversation) => [conversation.agentSessionId || conversation.id, conversation]));
    const confirmedSubmissions: Array<{ conversationId: string; key: string }> = [];
    const conversations = local.map((conversation) => {
        const key = conversation.agentSessionId || conversation.id;
        const restored = remaining.get(key);
        remaining.delete(key);
        if (restored) for (const submitted of confirmedCreationAgentSubmissions(conversation, restored).values()) confirmedSubmissions.push({ conversationId: conversation.id, key: submitted.agentIdempotencyKey! });
        const recovered = { ...conversation, messages: conversation.messages.map((message) => message.role === "assistant" && message.mode === "agent" && message.clientOperationId?.startsWith("agent-submission-") && message.status === "streaming"
            ? { ...message, status: "error" as const, error: "请求结果待确认，请先核对历史运行记录，或使用原提示词和设置重试" }
            : message) };
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
        } catch { /* 后端任务的结果错误由任务卡呈现，不伪造成功素材。 */ }
    }
    return { ...conversation, messages: conversation.messages.map((message) => message.id !== id ? message : {
        ...message,
        status: task.status === "succeeded" ? urls.length || keys.length ? "done" as const : "error" as const : task.status === "failed" ? "error" as const : task.status === "cancelled" ? "cancelled" as const : "pending" as const,
        ...(urls.length ? { resultUrls: urls } : {}),
        ...(keys.length ? { resultStorageKeys: keys } : {}),
        ...(task.status === "failed" || task.status === "succeeded" && !urls.length && !keys.length ? { error: task.error || "任务已结束，但生成结果暂时无法读取" } : {}),
    }) };
}

/** 重试属于原交付项；保留成品，否则显示该项最新一次尝试。 */
export function creationAgentLatestMediaTasks(tasks: CreationMessage[]): CreationMessage[] {
    const latest = new Map<string, CreationMessage>();
    for (const task of tasks) {
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
        const index = planImages.findIndex((item) => item.id === task.commerceItemId || item.title && item.title === task.content);
        return index >= 0 ? index : imageTasks.indexOf(task);
    };
    const images = [...imageTasks].sort((a, b) => ordinal(a) - ordinal(b));
    if (!images.length) return current;
    const total = Math.max(images.length, reply.commercePlan?.items.filter((item) => item.type === "image").length || 0);
    const succeeded = images.filter((task) => task.status === "done");
    const ended = images.filter((task) => task.status === "done" || task.status === "error" || task.status === "cancelled");
    const runEnded = reply.status === "done" || reply.status === "error" || reply.status === "cancelled";
    const recovering = !runEnded && images.some((task) => task.status === "error");
    const finished = !recovering && ended.length === images.length && (images.length >= total || runEnded);
    const failedCount = images.filter((task) => task.status === "error" || task.status === "cancelled").length + (runEnded ? total - images.length : 0);
    const cancelled = finished && !succeeded.length && images.every((task) => task.status === "cancelled");
    const seenResults = new Set<string>();
    const results = succeeded.flatMap((task) => {
        const count = Math.max(task.resultUrls?.length || 0, task.resultStorageKeys?.length || 0);
        return Array.from({ length: count }, (_, index) => ({
            url: task.resultUrls?.[index] || "", storageKey: task.resultStorageKeys?.[index] || "",
            name: creationImageDownloadBaseName(task.content, ordinal(task) + 1, count > 1 ? index + 1 : undefined),
        }));
    }).filter((result) => {
        const identity = result.storageKey || result.url;
        if (!identity || seenResults.has(identity)) return false;
        seenResults.add(identity);
        return true;
    });
    const batch: CreationMessage = {
        ...images[0], id: `task-batch-${reply.agentRunId}-image`, batchId: `${reply.agentRunId}:image`,
        taskIds: [...new Set(images.flatMap((task) => task.taskIds || []))],
        status: !finished ? "pending" : succeeded.length ? "done" : cancelled ? "cancelled" : "error",
        content: !finished ? `正在生成图片（${succeeded.length}/${total}）` : cancelled ? "已停止" : succeeded.length ? `${succeeded.length} 张图片已生成` : "生成失败",
        batchTotal: total, batchCompletedCount: succeeded.length, batchFailedCount: failedCount,
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
    const updated: AgentRun = event.type === "run_status" ? {
        ...run,
        status: typeof payload.status === "string" ? payload.status as AgentRun["status"] : run.status,
        failureMessage: text(payload.failureMessage) || run.failureMessage,
        approval: payload.approval && typeof payload.approval === "object" ? payload.approval as AgentRun["approval"] : undefined,
        updatedAt: event.createdAt,
    } : { ...run, events: event.seq > 0 ? [...(run.events || []), event] : run.events,
        ...(event.seq === 0 && (event.type === "assistant_message" || event.type === "assistant_snapshot") ? { activeMessage: { messageId: text(payload.messageId) || "assistant", text: text(payload.text) } } : {}),
        updatedAt: event.createdAt };
    const nextRuns = [...runs];
    nextRuns[index] = updated;
    const projected = projectCreationAgentConversation({ id: conversation.agentSessionId || conversation.id, title: conversation.title, surface: "creation", status: "active", revision: 0, createdAt: runs[0]?.createdAt || conversation.updatedAt, updatedAt: event.createdAt }, nextRuns);
    return mergeCreationAgentConversation(conversation, projected);
}
