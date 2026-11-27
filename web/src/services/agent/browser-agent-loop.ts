import { BROWSER_AGENT_PROTOCOL, type BrowserAgentMethod, type BrowserAgentState } from "./browser-agent-protocol";

export type BrowserAgentLoopIO = {
    request: (method: BrowserAgentMethod, epoch: number, stepId?: string) => Promise<BrowserAgentState>;
    wait: (ms: number) => Promise<void>;
    failure: (method: BrowserAgentMethod, error: { status?: number; reason?: string }, epoch: number, stepId?: string) => void;
};

// The server supplies the only authorized next action; local state never proves execution.
export async function driveBrowserAgent(io: BrowserAgentLoopIO, signal: AbortSignal) {
    let state: BrowserAgentState | undefined;
    let renewedAt = 0;
    let failures = 0;
    while (!signal.aborted) {
        let method: BrowserAgentMethod = "claim";
        let stepId: string | undefined;
        try {
            if (state && Date.now() - renewedAt >= 10_000) method = "heartbeat";
            else if (state) {
                if (state.nextAction.kind === "done") return;
                stepId = state.nextAction.stepId;
                method = stepId ? "step" : "state";
            }
            state = await io.request(method, state?.epoch || 0, stepId);
            if (state.runtimeProtocolVersion !== BROWSER_AGENT_PROTOCOL || state.checkpointVersion !== 1) {
                io.failure(method, { reason: "browser_protocol_mismatch" }, state.epoch, stepId);
                return;
            }
            if (method === "claim" || method === "heartbeat") renewedAt = Date.now();
            failures = 0;
            if (state.nextAction.kind === "done") return;
            await io.wait(state.nextAction.kind === "wait_task" ? 750 : state.nextAction.stepId ? 20 : 2_000);
        } catch (cause) {
            if (signal.aborted) return;
            const error = cause as { status?: number; reason?: string };
            if (error.status !== 409 || error.reason === "browser_protocol_mismatch") io.failure(method, error, state?.epoch || 0, stepId);
            if (error.status === 401 || error.status === 403 || error.status === 404 || error.reason === "browser_protocol_mismatch") return;
            // A lost response is reconciled from state after reclaiming, never with a new step ID.
            state = undefined;
            await io.wait(Math.min(30_000, 1_000 * 2 ** Math.min(failures++, 5)));
        }
    }
}
