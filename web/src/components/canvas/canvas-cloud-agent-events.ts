// 画布 Agent 事件流的归约：把后端推送的 AgentEvent 逐条合并进面板的消息列表。
//
// 事件可能重复（断线重连会重放最近一段）也可能乱序到达，因此所有写入都按事件 ID
// 或工具调用 ID 去重合并（appendUniqueMessage / upsertTextMessage / upsertMediaToolTrace），
// 而不是简单追加。这里只处理数据，不涉及渲染。

import type { AgentEvent, AgentRun } from "@/services/api/agent";
import type { Dispatch, SetStateAction } from "react";
import type { CloudAgentChatMessage, CloudAgentPlanItem } from "./canvas-cloud-agent-chat-ui";
import { AGENT_APPROVAL_SUPERSEDED_BY_NODE } from "@/lib/canvas/agent-media-approval";
import { agentToolRetry, mergeAgentToolRetry } from "@/lib/canvas/agent-tool-retry";
import { agentErrorPresentation } from "@/lib/canvas/agent-error-presentation";

/** 待用户处理的 Agent 审批（面板状态与事件归约共用）。 */
export type ApprovalState = { approvalId: string; detail: Record<string, unknown>; reason: string };

export function positiveNumber(value: string) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : undefined;
}

function compactionMessageID(event: AgentEvent, payload: Record<string, unknown>) {
    const compactionID = typeof payload.compactionId === "string" ? payload.compactionId.trim() : "";
    const eventKey = event.eventId || (Number.isFinite(event.seq) ? `seq-${event.seq}` : "event");
    return compactionID ? `compaction-${event.runId}-${compactionID}` : `compaction-${event.runId}-${eventKey}`;
}

function compactTokenLabel(value: unknown) {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return "";
    if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
    if (value >= 1_000) return `${Math.round(value / 100) / 10}K`;
    return Math.round(value).toLocaleString("zh-CN");
}

function compactionCompletedText(payload: Record<string, unknown>) {
    const before = compactTokenLabel(payload.tokensBefore);
    const after = compactTokenLabel(payload.estimatedTokensAfter);
    return before && after ? `上下文压缩完成（${before} → ${after} Token）` : "上下文压缩完成";
}

export function applyAgentEvent(
    event: AgentEvent,
    setMessages: Dispatch<SetStateAction<CloudAgentChatMessage[]>>,
    setRun: Dispatch<SetStateAction<AgentRun | null>>,
    setApproval: Dispatch<SetStateAction<ApprovalState | null>>,
    setPrompt?: Dispatch<SetStateAction<string>>,
) {
    const payload = event.payload || {};
    const text = String(payload.text || payload.summary || payload.message || "");
    if (event.type === "run_status") {
        const snapshotApproval = payload.approval && typeof payload.approval === "object" ? (payload.approval as AgentRun["approval"]) : undefined;
        const nextStatus = String(payload.status || "") as AgentRun["status"];
        const terminal = ["completed", "failed", "cancelled", "rejected"].includes(nextStatus);
        setRun((current) =>
            current
                ? {
                      ...current,
                      status: nextStatus || current.status,
                      updatedAt: event.createdAt,
                      revision: Number(payload.revision || 0),
                      cleanupPending: Boolean(payload.cleanupPending),
                      failureMessage: String(payload.failureMessage || ""),
                      skills: payload.skills as AgentRun["skills"],
                      spentCredits: Number(payload.spentCredits || 0),
                      step: Number(payload.step || 0),
                      approval: snapshotApproval,
                  }
                : current,
        );
        if (terminal) {
            setMessages((current) => current.map((message) => (message.id === `plan-${event.runId}` && message.planItems?.length ? { ...message, planTerminal: true, streaming: false } : message)));
        }
        if (nextStatus === "failed") {
            setMessages((current) => upsertRunFailure(current, event, String(payload.failureMessage || "")));
        }
        if (snapshotApproval && !snapshotApproval.decision && snapshotApproval.approvalId) {
            setApproval((current) => ({ approvalId: snapshotApproval.approvalId, detail: snapshotApproval, reason: current?.approvalId === snapshotApproval.approvalId ? current.reason : snapshotApproval.reason || "" }));
        } else {
            setApproval(null);
        }
        return;
    }
    if (event.type === "approval_decided") {
        setApproval(null);
        if (payload.decision === AGENT_APPROVAL_SUPERSEDED_BY_NODE) {
            setMessages((current) =>
                appendUniqueMessage(current, {
                    id: event.eventId,
                    role: "system",
                    text: text || "你已在画布节点上直接提交了生成，本次审批已自动关闭；Agent 不会重复提交或扣费。",
                }),
            );
            return;
        }
        if (payload.decision === "reject") {
            setMessages((current) =>
                appendUniqueMessage(current, {
                    id: event.eventId,
                    role: "system",
                    text: text || "已拒绝本次操作，未写入画布。你可以告诉 Agent 修改方向后重新申请。",
                }),
            );
        }
        return;
    }
    if (event.type === "progress_summary") {
        setMessages((current) => appendUniqueMessage(current, { id: event.eventId, role: "system", text: text || "Agent 正在整理执行计划" }));
        return;
    }
    if (event.type === "assistant_delta") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || "assistant"), text, true));
        return;
    }
    if (event.type === "reasoning_delta" || event.type === "reasoning_message") {
        const id = String(payload.messageId || `${event.runId}:reasoning`);
        setMessages((current) => upsertTextMessage(current, id, text, event.type === "reasoning_delta").map((item) => (item.id === id ? { ...item, reasoning: true } : item)));
        return;
    }
    if (event.type === "plan_updated" && Array.isArray(payload.items)) {
        const id = `plan-${event.runId}`;
        const planItems = payload.items as CloudAgentPlanItem[];
        setMessages((current) => {
            const index = current.findIndex((entry) => entry.id === id);
            const message: CloudAgentChatMessage = { id, role: "tool", text: "", planItems };
            if (index < 0) return [...current, message];
            const next = [...current];
            next[index] = message;
            return next;
        });
        return;
    }
    if (event.type === "user_interjection") {
        if (!text) return;
        setMessages((current) => appendUniqueMessage(current, { id: String(payload.messageId || event.eventId), role: "user", text, interjection: "sent" }));
        return;
    }
    if (event.type === "user_interjection_dropped") {
        const messageId = String(payload.messageId || event.eventId);
        const reason = String(payload.reason || "本轮已结束");
        setMessages((current) => {
            const marked = current.map((item) => (item.id === messageId ? { ...item, interjection: "undelivered" as const } : item));
            return appendUniqueMessage(marked, { id: `interjection-dropped-${messageId}`, role: "system", text: `${reason}，这条插话没有送到模型。需要的话重新发一次，它会作为新一轮。` });
        });
        setPrompt?.((current) => (current.trim() ? current : text));
        return;
    }
    if (event.type === "context_compaction_requested") {
        const id = compactionMessageID(event, payload);
        const compactionId = typeof payload.compactionId === "string" ? payload.compactionId : undefined;
        setMessages((current) =>
            appendUniqueMessage(current, {
                id,
                role: "system",
                text: "正在整理上下文",
                compaction: { status: "pending", compactionId, reason: String(payload.reason || "") },
            }),
        );
        return;
    }
    if (event.type === "context_compacted") {
        const explicitId = typeof payload.compactionId === "string" && payload.compactionId.trim() ? `compaction-${event.runId}-${payload.compactionId}` : undefined;
        const fallbackId = compactionMessageID(event, payload);
        const tokensBefore = typeof payload.tokensBefore === "number" ? payload.tokensBefore : undefined;
        const estimatedTokensAfter = typeof payload.estimatedTokensAfter === "number" ? payload.estimatedTokensAfter : undefined;
        const compaction = { status: "completed" as const, compactionId: typeof payload.compactionId === "string" ? payload.compactionId : undefined, tokensBefore, estimatedTokensAfter, reason: String(payload.reason || "") };
        setMessages((current) => {
            const existing = explicitId
                ? current.findIndex((item) => item.id === explicitId)
                : ([...current]
                      .map((item, index) => ({ item, index }))
                      .reverse()
                      .find(({ item }) => item.compaction?.status === "pending")?.index ?? -1);
            const id = existing >= 0 ? current[existing]?.id || fallbackId : fallbackId;
            if (existing >= 0) {
                const next = [...current];
                next[existing] = { ...next[existing], text: compactionCompletedText(payload), compaction };
                return next;
            }
            return appendUniqueMessage(current, { id, role: "system", text: compactionCompletedText(payload), compaction });
        });
        return;
    }
    if (event.type === "context_compaction_failed") {
        const explicitId = typeof payload.compactionId === "string" && payload.compactionId.trim() ? `compaction-${event.runId}-${payload.compactionId}` : undefined;
        const fallbackId = compactionMessageID(event, payload);
        const aborted = payload.cancelled === true || payload.aborted === true;
        const errorText = String(payload.errorMessage || payload.text || "上下文压缩失败");
        setMessages((current) => {
            const existing = explicitId
                ? current.findIndex((item) => item.id === explicitId)
                : ([...current]
                      .map((item, index) => ({ item, index }))
                      .reverse()
                      .find(({ item }) => item.compaction?.status === "pending")?.index ?? -1);
            const id = existing >= 0 ? current[existing]?.id || fallbackId : fallbackId;
            const compaction = { status: aborted ? ("aborted" as const) : ("failed" as const), compactionId: typeof payload.compactionId === "string" ? payload.compactionId : undefined, reason: String(payload.reason || ""), errorMessage: errorText };
            if (existing >= 0) {
                const next = [...current];
                next[existing] = { ...next[existing], text: errorText, errorSeverity: "warning", compaction };
                return next;
            }
            return appendUniqueMessage(current, { id, role: "system", text: errorText, errorSeverity: "warning", compaction });
        });
        return;
    }
    if (event.type === "user_question") {
        const options = Array.isArray(payload.options)
            ? (payload.options as Array<{ label?: unknown; detail?: unknown }>).map((option) => ({ label: String(option?.label || "").trim(), detail: option?.detail === undefined ? undefined : String(option.detail) })).filter((option) => option.label)
            : [];
        const fields = Array.isArray(payload.fields)
            ? (payload.fields as Array<Record<string, unknown>>)
                  .map((field) => ({
                      id: String(field.id || "").trim(),
                      title: String(field.title || field.label || "").trim(),
                      type: ["single_select", "segmented", "text", "textarea", "model_picker"].includes(String(field.type)) ? (String(field.type) as "single_select" | "segmented" | "text" | "textarea" | "model_picker") : "single_select",
                      options: Array.isArray(field.options)
                          ? (field.options as Array<Record<string, unknown>>)
                                .map((option) => ({
                                    id: option.id === undefined ? undefined : String(option.id),
                                    label: String(option.label || "").trim(),
                                    detail: option.detail === undefined ? undefined : String(option.detail),
                                    recommended: option.recommended === true,
                                }))
                                .filter((option) => option.label)
                          : undefined,
                      defaultValue: field.defaultValue === undefined ? undefined : String(field.defaultValue),
                      required: field.required === true,
                      allowCustom: field.allowCustom === true,
                      placeholder: field.placeholder === undefined ? undefined : String(field.placeholder),
                  }))
                  .filter((field) => field.id && field.title)
            : [];
        const question = String(payload.question || "").trim();
        const isForm = fields.length > 0 || payload.kind === "form";
        if (!question || (!isForm && options.length < 2)) return;
        const id = `question-${event.runId}:${event.seq ?? event.eventId}`;
        setMessages((current) =>
            appendUniqueMessage(current, {
                id,
                role: "assistant",
                text: "",
                question: {
                    question,
                    options,
                    fields: isForm ? fields : undefined,
                    kind: isForm ? "form" : "choice",
                    questionId: payload.questionId === undefined ? id : String(payload.questionId),
                    allowFreeform: payload.allowFreeform !== false,
                    round: Number.isFinite(Number(payload.round)) ? Number(payload.round) : undefined,
                    maxRounds: Number.isFinite(Number(payload.maxRounds)) ? Number(payload.maxRounds) : undefined,
                },
            }),
        );
        return;
    }
    if (event.type === "assistant_message") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "assistant_snapshot") {
        setMessages((current) => upsertTextMessage(current, String(payload.messageId || event.eventId), text, false));
        return;
    }
    if (event.type === "approval_requested") {
        const approvalId = String(payload.approvalId || "");
        setApproval((current) => ({ approvalId, detail: payload, reason: current?.approvalId === approvalId ? current.reason : "" }));
        return;
    }
    if (event.type === "canvas_updated" && Array.isArray(payload.actions)) {
        if (payload.operation === "generate_media_submit" || payload.operation === "generate_media_complete") return;
        const { canvasPatch: _patch, ...detail } = payload;
        const id = payload.callId ? `canvas-${event.runId}-${payload.callId}` : event.eventId;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: String(payload.text || "画布操作已完成"), detail: { ...detail, eventType: event.type } }));
        return;
    }
    if (event.type.startsWith("tool_") && agentToolRetry(payload)) {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: String(payload.toolName || "工具执行"), text, detail: { ...payload, eventType: event.type } };
        setMessages((current) => mergeAgentToolRetry(current, message));
        if (event.type === "tool_failed") return;
    }
    if (event.type === "tool_completed" && payload.toolName === "director_preview") {
        const result = payload.result && typeof payload.result === "object" ? (payload.result as Record<string, unknown>) : {};
        window.dispatchEvent(
            new CustomEvent("director:preview-requested", {
                detail: {
                    sceneId: String(result.sceneId || ""),
                    shotId: String(result.shotId || ""),
                    duration: Number(result.duration || 0),
                    fps: Number(result.fps || 0),
                    previewRequestId: String(result.previewRequestId || payload.callId || ""),
                },
            }),
        );
        setMessages((current) =>
            appendUniqueMessage(current, {
                id: event.eventId,
                role: "tool",
                title: "director_preview",
                text: text || "已请求导演台生成白模预演",
                detail: { ...payload, eventType: event.type },
            }),
        );
        return;
    }
    if (event.type === "tool_completed" && payload.toolName === "canvas_apply_ops" && payload.callId) {
        const id = `canvas-${event.runId}-${payload.callId}`;
        setMessages((current) => appendUniqueMessage(current, { id, role: "tool", title: "canvas_apply_ops", text: text || "画布操作已完成", detail: { ...payload, eventType: event.type } }));
        return;
    }
    if (event.type === "generation_task_created") {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: "generate_media", text: text || event.type, detail: { ...payload, eventType: event.type } };
        setMessages((current) => upsertMediaToolTrace(current, message));
        return;
    }
    if (event.type.startsWith("tool_")) {
        const message: CloudAgentChatMessage = { id: event.eventId, role: "tool", title: String(payload.toolName || payload.title || "工具执行"), text: text || event.type, detail: { ...payload, eventType: event.type } };
        if (payload.toolName === "generate_media") {
            setMessages((current) => upsertMediaToolTrace(current, message));
        } else {
            setMessages((current) => appendUniqueMessage(current, message));
        }
        return;
    }
    if (event.type === "run_failed" || event.type === "error") setMessages((current) => upsertRunFailure(current, event, text));
}

function upsertRunFailure(current: CloudAgentChatMessage[], event: AgentEvent, text: string) {
    const id = `terminal-${event.runId}`;
    const message: CloudAgentChatMessage = { id, role: "error", ...agentErrorPresentation(text), errorSeverity: "error" };
    // 失败事件和终态快照描述的是同一次失败；重放时同时收敛已缓存的事件行。
    const next = current.filter((item) => item.role !== "error" || item.id !== event.eventId || item.id === id);
    const index = next.findIndex((item) => item.id === id);
    if (index < 0) return [...next, message];
    const previous = next[index];
    const hasDetails = message.text !== message.title;
    const hadDetails = previous.text !== previous.title;
    // 快照的公开原因优先；乱序到达的通用通知不能覆盖更完整的说明。
    if (!hasDetails || (event.type !== "run_status" && hadDetails)) return next;
    next[index] = message;
    return next;
}

export function toolDetailRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function toolDetailNodeIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.nodeId, toolDetailRecord(payload.result).nodeId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    if (Array.isArray(payload.actions)) {
        for (const action of payload.actions) {
            const nodeId = toolDetailRecord(action).nodeId;
            if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
        }
    }
    if (typeof payload.arguments === "string") {
        try {
            const args = toolDetailRecord(JSON.parse(payload.arguments));
            if (Array.isArray(args.ops)) {
                for (const op of args.ops) {
                    const nodeId = toolDetailRecord(op).id;
                    if (typeof nodeId === "string" && nodeId) ids.add(nodeId);
                }
            }
        } catch {
            // Tool arguments are diagnostic data; a malformed value must not break the event feed.
        }
    }
    return ids;
}

export function toolDetailTaskIds(detail: unknown): Set<string> {
    const payload = toolDetailRecord(detail);
    const ids = new Set<string>();
    for (const value of [payload.taskId, toolDetailRecord(payload.result).taskId]) {
        if (typeof value === "string" && value) ids.add(value);
    }
    return ids;
}

export function mergeToolDetails(previous: unknown, next: unknown): Record<string, unknown> {
    const previousDetail = toolDetailRecord(previous);
    const nextDetail = toolDetailRecord(next);
    return {
        ...previousDetail,
        ...nextDetail,
        actions: Array.isArray(nextDetail.actions) ? nextDetail.actions : previousDetail.actions,
        arguments: nextDetail.arguments || previousDetail.arguments,
    };
}

export function upsertMediaToolTrace(current: CloudAgentChatMessage[], message: CloudAgentChatMessage): CloudAgentChatMessage[] {
    const nextNodeIds = toolDetailNodeIds(message.detail);
    const nextTaskIds = toolDetailTaskIds(message.detail);
    const index = current.findIndex((item) => {
        if (item.role !== "tool") return false;
        const itemToolName = item.title || "";
        if (itemToolName !== "canvas_apply_ops" && itemToolName !== "generate_media") return false;
        const itemNodeIds = toolDetailNodeIds(item.detail);
        const itemTaskIds = toolDetailTaskIds(item.detail);
        return [...nextNodeIds].some((id) => itemNodeIds.has(id)) || [...nextTaskIds].some((id) => itemTaskIds.has(id));
    });
    if (index < 0) return appendUniqueMessage(current, message);
    const next = [...current];
    const previous = next[index];
    next[index] = {
        ...previous,
        ...message,
        id: previous.id,
        detail: mergeToolDetails(previous.detail, message.detail),
    };
    return next;
}

export function appendUniqueMessage(current: CloudAgentChatMessage[], message: CloudAgentChatMessage) {
    return current.some((item) => item.id === message.id) ? current : [...current, message];
}

export function upsertTextMessage(current: CloudAgentChatMessage[], id: string, text: string, append: boolean): CloudAgentChatMessage[] {
    const index = current.findIndex((item) => item.id === id);
    if (index < 0) return [...current, { id, role: "assistant" as const, text, streaming: append }];
    if (!append && current[index].text === text && !current[index].streaming) return current;
    const next = [...current];
    next[index] = { ...next[index], text: append ? `${next[index].text}${text}` : text, streaming: append };
    return next;
}

export function appendAgentError(current: CloudAgentChatMessage[], id: string, cause: unknown, fallback?: string, options?: { severity?: CloudAgentChatMessage["errorSeverity"] }) {
    const message = agentErrorPresentation(cause, fallback);
    const last = current.at(-1);
    if (last?.role === "error" && last.title === message.title && last.text === message.text) return current;
    return appendUniqueMessage(current, { id, role: "error", ...message, ...(options?.severity ? { errorSeverity: options.severity } : {}) });
}

export function isNotFoundError(cause: unknown) {
    if (!cause || typeof cause !== "object") return false;
    const status = "status" in cause ? (cause as { status?: unknown }).status : undefined;
    return status === 404 || (cause instanceof Error && /\(404\)/u.test(cause.message));
}
