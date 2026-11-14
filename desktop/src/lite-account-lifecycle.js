// Account changes must immediately cut access to the old backend, including
// streams. Slow startup and shutdown are serialized so a stale startup cannot
// publish its backend after another login or logout.
function createLiteAccountLifecycle({ invalidate, prepare, publish }) {
    let revision = 0;
    let queue = Promise.resolve();
    let active = null;
    let pendingAbort = null;

    function change(user) {
        const currentRevision = ++revision;
        pendingAbort?.abort();
        invalidate();
        const run = async () => {
            if (active) {
                const previous = active;
                await previous.stop();
                if (active === previous) active = null;
            }
            if (!user || revision !== currentRevision) return false;
            const controller = new AbortController();
            pendingAbort = controller;
            let candidate;
            let stopAttempted = false;
            try {
                candidate = await prepare(user, controller.signal);
                // Retain even a superseded candidate until its resources have
                // actually stopped; otherwise a failed stop can leak an account.
                active = candidate;
                // A candidate can expose startup separately so it is tracked
                // before it creates processes or other long-lived resources.
                if (revision === currentRevision && !controller.signal.aborted && candidate.start) {
                    await candidate.start(controller.signal);
                }
                if (revision !== currentRevision || controller.signal.aborted) {
                    stopAttempted = true;
                    await candidate.stop();
                    if (active === candidate) active = null;
                    return false;
                }
                // Publication must be synchronous: an asynchronous publisher could
                // expose a stale account after a newer change has invalidated it.
                const published = publish(candidate, user);
                if (published && typeof published.then === "function") {
                    throw new Error("Account publication must be synchronous");
                }
                if (revision !== currentRevision || controller.signal.aborted) {
                    stopAttempted = true;
                    await candidate.stop();
                    if (active === candidate) active = null;
                    return false;
                }
                return true;
            } catch (error) {
                if (candidate && !stopAttempted) {
                    await candidate.stop();
                    if (active === candidate) active = null;
                }
                if (revision !== currentRevision || controller.signal.aborted) return false;
                throw error;
            } finally {
                if (pendingAbort === controller) pendingAbort = null;
            }
        };
        const result = queue.then(run, run);
        queue = result.catch(() => {});
        return result;
    }

    return { activate: (user) => change(user), deactivate: () => change(null) };
}

module.exports = { createLiteAccountLifecycle };
