import { assertCurrentUserSession, captureUserSession } from "@/lib/user-scope";
import { localForageStorageForScope } from "@/lib/localforage-storage";
import { http } from "@/services/api/request";
import type { BrowserAgentFailure } from "@/services/agent/browser-agent-protocol";
import { recordDiagnosticEvent } from "./client-diagnostics";
import { acknowledgedFailureQueue, restoreFailureQueue, type BrowserAgentFailureEvent } from "./browser-agent-failure-queue";

const queueKey = "browser-agent-failures-v1";
let receiver: ((failure: BrowserAgentFailure) => void) | undefined;

export function recordBrowserAgentFailure(failure: BrowserAgentFailure) {
    recordDiagnosticEvent({ level: "error", category: "runtime", code: failure.code, message: `Browser Agent ${failure.phase} failed`, httpStatus: failure.httpStatus });
    receiver?.(failure);
}

export function startBrowserAgentFailureUpload() {
    const session = captureUserSession();
    const storage = localForageStorageForScope(session.scope);
    const controller = new AbortController();
    let queue: BrowserAgentFailureEvent[] = [];
    let stopped = false;
    let uploading = false;
    let retryAt = 0;
    let attempts = 0;
    let lastStored = "";
    let serial = Promise.resolve()
        .then(async () => {
            const raw = await storage.getItem(queueKey);
            assertCurrentUserSession(session);
            queue = restoreFailureQueue(raw);
        })
        .catch(() => {});
    const persist = async () => {
        assertCurrentUserSession(session);
        const raw = JSON.stringify(queue);
        if (raw !== lastStored) {
            await storage.setItem(queueKey, raw);
            lastStored = raw;
        }
    };
    const receive = (failure: BrowserAgentFailure) => {
        if (stopped) return;
        const commit = String(import.meta.env.VITE_BUILD_COMMIT || "unknown");
        const event: BrowserAgentFailureEvent = {
            eventId: `event-${crypto.randomUUID()}`,
            runId: failure.runId,
            stepId: failure.stepId,
            code: failure.code,
            phase: failure.phase,
            epoch: failure.epoch,
            httpStatus: failure.httpStatus,
            buildCommit: /^(unknown|dev|[a-fA-F0-9]{7,64})$/.test(commit) ? commit : "unknown",
            occurredAt: new Date().toISOString(),
            frames: [],
        };
        serial = serial
            .then(async () => {
                if (stopped) return;
                assertCurrentUserSession(session);
                queue = acknowledgedFailureQueue([...queue, event], []);
                await persist();
            })
            .catch(() => {});
        void serial.then(flush);
    };
    const flush = async () => {
        if (stopped || uploading || Date.now() < retryAt || !queue.length) return;
        uploading = true;
        try {
            assertCurrentUserSession(session);
            const events = acknowledgedFailureQueue(queue, []).slice(0, 20);
            if (!events.length) {
                serial = serial
                    .then(async () => {
                        queue = acknowledgedFailureQueue(queue, []);
                        await persist();
                    })
                    .catch(() => {});
                await serial;
                return;
            }
            const result = await http.post<{ acceptedEventIds: string[] }>("/agent/client-failures", { events }, { signal: controller.signal, timeout: 10_000 });
            assertCurrentUserSession(session);
            serial = serial
                .then(async () => {
                    if (stopped) return;
                    assertCurrentUserSession(session);
                    queue = acknowledgedFailureQueue(
                        queue,
                        result.acceptedEventIds,
                        Date.now(),
                        events.map((event) => event.eventId),
                    );
                    await persist();
                })
                .catch(() => {});
            await serial;
            attempts = 0;
            retryAt = Date.now() + 5_000;
        } catch {
            // Upload failures are intentionally excluded from automatic reporting.
            retryAt = Date.now() + Math.min(300_000, 5_000 * 2 ** Math.min(attempts++, 6));
        } finally {
            uploading = false;
        }
    };
    receiver = receive;
    const timer = setInterval(() => {
        void serial.then(flush);
    }, 5_000);
    const onOnline = () => {
        retryAt = 0;
        void serial.then(flush);
    };
    window.addEventListener("online", onOnline);
    const stop = () => {
        stopped = true;
        controller.abort();
        clearInterval(timer);
        window.removeEventListener("online", onOnline);
        session.signal.removeEventListener("abort", stop);
        if (receiver === receive) receiver = undefined;
    };
    session.signal.addEventListener("abort", stop, { once: true });
    void serial.then(flush);
    return stop;
}
