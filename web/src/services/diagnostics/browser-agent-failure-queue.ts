import type { BrowserAgentFailure } from "@/services/agent/browser-agent-protocol";

export type BrowserAgentFailureEvent = {
    eventId: string;
    runId?: string;
    stepId?: string;
    code: BrowserAgentFailure["code"];
    phase: BrowserAgentFailure["phase"];
    epoch?: number;
    httpStatus?: number;
    buildCommit: string;
    occurredAt: string;
    frames: Array<{ file: string; line: number; column: number }>;
};

const codes = new Set(["worker_load_failed", "worker_crashed", "worker_message_failed", "worker_unhandled", "runtime_request_failed", "runtime_protocol_mismatch"]);
const phases = new Set(["startup", "claim", "state", "step", "heartbeat", "worker"]);
const identifier = (value: unknown, max: number) => typeof value === "string" && value.length <= max && /^[a-zA-Z0-9:_-]+$/.test(value);

// Rebuild persisted metadata so corrupt storage cannot upload arbitrary fields.
export function restoreFailureQueue(raw: string | null) {
    try {
        const values: unknown = JSON.parse(raw || "[]");
        if (!Array.isArray(values)) return [];
        const events: BrowserAgentFailureEvent[] = [];
        for (const value of values.slice(-200)) {
            if (!value || typeof value !== "object") continue;
            const event = value as BrowserAgentFailureEvent;
            if (!identifier(event.eventId, 96) || !codes.has(event.code) || !phases.has(event.phase) || !/^(unknown|dev|[a-fA-F0-9]{7,64})$/.test(event.buildCommit) || typeof event.occurredAt !== "string" || !Number.isFinite(Date.parse(event.occurredAt)))
                continue;
            if ((event.runId !== undefined && !identifier(event.runId, 80)) || (event.stepId !== undefined && !identifier(event.stepId, 160))) continue;
            if ((event.epoch !== undefined && (!Number.isSafeInteger(event.epoch) || event.epoch < 0)) || (event.httpStatus !== undefined && (!Number.isInteger(event.httpStatus) || event.httpStatus < 0 || event.httpStatus > 599))) continue;
            events.push({
                eventId: event.eventId,
                runId: event.runId,
                stepId: event.stepId,
                code: event.code,
                phase: event.phase,
                epoch: event.epoch,
                httpStatus: event.httpStatus,
                buildCommit: event.buildCommit,
                occurredAt: event.occurredAt,
                frames: [],
            });
        }
        return acknowledgedFailureQueue(events, []);
    } catch {
        return [];
    }
}

export function acknowledgedFailureQueue(queue: BrowserAgentFailureEvent[], accepted: string[], now = Date.now(), attempted: string[] = []) {
    const ids = new Set(accepted);
    const remaining = queue.filter((event) => !ids.has(event.eventId) && Date.parse(event.occurredAt) >= now - 86_400_000 && Date.parse(event.occurredAt) <= now + 300_000).slice(-200);
    const sent = new Set(attempted);
    return [...remaining.filter((event) => !sent.has(event.eventId)), ...remaining.filter((event) => sent.has(event.eventId))];
}
