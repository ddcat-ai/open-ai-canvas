import { driveBrowserAgent } from "./browser-agent-loop";
import type { BrowserAgentReply, BrowserAgentRPC, BrowserAgentState, BrowserAgentWorkerMessage } from "./browser-agent-protocol";

const scope = self as unknown as DedicatedWorkerGlobalScope;
const runs = new Set<string>();
let requestId = 0;
const pending = new Map<number, { resolve: (state: BrowserAgentState) => void; reject: (error: unknown) => void; timer: ReturnType<typeof setTimeout> }>();
const send = (message: BrowserAgentWorkerMessage) => scope.postMessage(message);

scope.onmessage = (event: MessageEvent<BrowserAgentReply | { type: "start"; runId: string; owner: string }>) => {
    const message = event.data;
    if (message.type === "reply") {
        const request = pending.get(message.id);
        if (!request) return;
        pending.delete(message.id);
        clearTimeout(request.timer);
        if (message.error || !message.state) request.reject(message.error || {});
        else request.resolve(message.state);
        return;
    }
    if (message.type !== "start" || runs.has(message.runId)) return;
    runs.add(message.runId);
    const controller = new AbortController();
    void driveBrowserAgent(
        {
            request: (method, epoch, stepId) =>
                new Promise<BrowserAgentState>((resolve, reject) => {
                    const id = ++requestId;
                    const timer = setTimeout(() => {
                        pending.delete(id);
                        reject({ status: 0 });
                    }, 30_000);
                    pending.set(id, { resolve, reject, timer });
                    const request: BrowserAgentRPC = { type: "rpc", id, runId: message.runId, owner: message.owner, method, epoch, stepId };
                    send(request);
                }),
            wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
            failure: (method, error, epoch, stepId) =>
                send({ type: "failure", code: error.reason === "browser_protocol_mismatch" ? "runtime_protocol_mismatch" : "runtime_request_failed", phase: method, runId: message.runId, epoch, stepId, httpStatus: error.status }),
        },
        controller.signal,
    )
        .catch(() => {
            send({ type: "failure", code: "worker_unhandled", phase: "worker", runId: message.runId });
        })
        .finally(() => {
            runs.delete(message.runId);
            send({ type: "finished", runId: message.runId });
        });
};
scope.addEventListener("unhandledrejection", () => send({ type: "failure", code: "worker_unhandled", phase: "worker" }));
