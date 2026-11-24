import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { createClientUUID } from "@/lib/client-id";
import { listBrowserAgentRuns, requestBrowserAgentStep } from "@/services/api/browser-agent";
import { recordBrowserAgentFailure } from "@/services/diagnostics/browser-agent-failures";
import type { BrowserAgentFailureCode, BrowserAgentWorkerMessage } from "./browser-agent-protocol";

// App/user scoped: closing a panel must not terminate orchestration.
export function startBrowserAgentHost() {
    const session = captureUserSession();
    if (!session.userId) {
        return () => {};
    }
    const controller = new AbortController();
    const owner = `browser-${createClientUUID()}`;
    const active = new Set<string>();
    let worker: Worker | undefined;
    let stopped = false;
    let discoveryRunning = false;
    const incompatible = new Set<string>();
    let restartAfter = 0;
    let lastDiscoveryFailure = 0;
    let timer: ReturnType<typeof setInterval>;
    const stop = () => {
        if (stopped) return;
        stopped = true;
        controller.abort();
        worker?.terminate();
        clearInterval(timer);
        session.signal.removeEventListener("abort", stop);
    };
    const startWorker = () => {
        try {
            worker = new Worker(new URL("./browser-agent.worker.ts", import.meta.url), { type: "module" });
        } catch {
            restartAfter = Date.now() + 30_000;
            recordBrowserAgentFailure({ type: "failure", code: "worker_load_failed", phase: "startup" });
            return false;
        }
        const currentWorker = worker;
        const crashed = () => {
            if (worker !== currentWorker) return;
            worker?.terminate();
            worker = undefined;
            active.clear();
            restartAfter = Date.now() + 30_000;
        };
        const failWorker = (code: BrowserAgentFailureCode) => {
            if (stopped || worker !== currentWorker) return;
            try {
                assertCurrentUserSession(session);
            } catch {
                stop();
                return;
            }
            recordBrowserAgentFailure({ type: "failure", code, phase: "worker" });
            crashed();
        };
        worker.onerror = () => failWorker("worker_crashed");
        worker.onmessageerror = () => failWorker("worker_message_failed");
        worker.onmessage = (event: MessageEvent<BrowserAgentWorkerMessage>) => {
            if (stopped || worker !== currentWorker) return;
            try {
                assertCurrentUserSession(session);
            } catch {
                stop();
                return;
            }
            const message = event.data;
            if (message.type === "finished") {
                active.delete(message.runId);
                return;
            }
            if (message.type === "failure") {
                if (message.code === "runtime_protocol_mismatch" && message.runId) incompatible.add(message.runId);
                recordBrowserAgentFailure(message);
                return;
            }
            const requestingWorker = worker;
            void requestBrowserAgentStep(message, controller.signal)
                .then((state) => {
                    assertCurrentUserSession(session);
                    if (!stopped && worker === requestingWorker) worker?.postMessage({ type: "reply", id: message.id, state });
                })
                .catch((cause: { status?: number; reason?: string }) => {
                    if (!stopped && worker === requestingWorker) worker?.postMessage({ type: "reply", id: message.id, error: { status: cause.status, reason: cause.reason } });
                });
        };
        return true;
    };
    const discover = async () => {
        if (stopped || discoveryRunning) return;
        discoveryRunning = true;
        try {
            assertCurrentUserSession(session);
            const ids = await listBrowserAgentRuns(controller.signal);
            assertCurrentUserSession(session);
            for (const runId of ids) {
                if (stopped || active.has(runId) || incompatible.has(runId) || Date.now() < restartAfter) continue;
                if (!worker && !startWorker()) break;
                active.add(runId);
                worker?.postMessage({ type: "start", runId, owner });
            }
        } catch (cause) {
            if (!controller.signal.aborted && (cause as { status?: number }).status !== 403 && Date.now() - lastDiscoveryFailure >= 30_000) {
                lastDiscoveryFailure = Date.now();
                recordBrowserAgentFailure({ type: "failure", code: "runtime_request_failed", phase: "startup", httpStatus: (cause as { status?: number }).status });
            }
        } finally {
            discoveryRunning = false;
        }
    };
    timer = setInterval(() => void discover(), 3_000);
    session.signal.addEventListener("abort", stop, { once: true });
    void discover();
    return stop;
}
