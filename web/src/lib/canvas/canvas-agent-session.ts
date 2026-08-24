import { agentSessionFailureMessage, createAgentSession, queryAgentSession, type AgentSessionDetail, type CreateSessionInput } from "@/services/api/task-center";
import { t } from "@/i18n";

const CINEMATIC_SESSION_POLL_INTERVAL_MS = 2000;
const CINEMATIC_SESSION_MAX_POLLS = 120;

type CinematicSessionWaitOptions = {
    signal?: AbortSignal;
};

type CreateCinematicSessionOptions = CinematicSessionWaitOptions & {
    onCreated?: (detail: AgentSessionDetail) => void;
};

export async function createCinematicAgentSession(input: CreateSessionInput, options: CreateCinematicSessionOptions = {}) {
    const created = await createAgentSession(input);
    throwIfAborted(options.signal);
    options.onCreated?.(created);
    return waitForCinematicAgentSession(created, options);
}

export async function resumeCinematicAgentSession(id: string, options: CinematicSessionWaitOptions = {}) {
    throwIfAborted(options.signal);
    const detail = await queryAgentSession(id);
    return waitForCinematicAgentSession(detail, options);
}

export function cinematicAgentSessionOpsJson(detail: AgentSessionDetail) {
    if (detail.session.status !== "completed") throw new Error(t("canvas:the-film-agent-backend-session-has-not-finished-yet"));
    if (!detail.session.canvasOpsJson) throw new Error(t("canvas:the-film-agent-backend-returned-no-canvas-operations"));
    return detail.session.canvasOpsJson;
}

export function isAgentSessionPollingAbort(error: unknown) {
    return error instanceof Error && error.name === "AbortError";
}

async function waitForCinematicAgentSession(initialDetail: AgentSessionDetail, options: CinematicSessionWaitOptions) {
    let detail = initialDetail;
    for (let attempt = 0; attempt < CINEMATIC_SESSION_MAX_POLLS; attempt += 1) {
        throwIfAborted(options.signal);
        if (detail.session.status === "completed") return detail;
        if (detail.session.status === "failed") throw new Error(agentSessionFailureMessage(detail));
        await abortableDelay(CINEMATIC_SESSION_POLL_INTERVAL_MS, options.signal);
        detail = await queryAgentSession(initialDetail.session.id);
    }
    throw new Error(t("canvas:the-film-agent-backend-session-timed-out"));
}

function abortableDelay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        throwIfAborted(signal);
        const finish = () => {
            signal?.removeEventListener("abort", abort);
            resolve();
        };
        const abort = () => {
            window.clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = window.setTimeout(finish, ms);
        signal?.addEventListener("abort", abort, { once: true });
    });
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
