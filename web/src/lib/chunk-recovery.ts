const RECOVERY_QUERY = "__chunk_recovery";
const RECOVERY_KEY = "canvas:chunk-recovery";
let recovering = false;

export function installChunkRecovery() {
    window.addEventListener("vite:preloadError", handlePreloadError);
}

export function markChunkRecoverySucceeded() {
    // An entry module loading says nothing about lazy routes. Keep the guard for
    // the tab's lifetime; the URL also protects browsers with disabled storage.
}

/** Explicit user retry is allowed even after the automatic recovery was used. */
export function reloadAfterChunkFailure() {
    navigateToFreshEntry();
}

export function tryRecoverChunkFailure() {
    if (recovering) return true;
    const url = new URL(window.location.href);
    if (url.searchParams.has(RECOVERY_QUERY)) return false;
    try {
        if (sessionStorage.getItem(RECOVERY_KEY) === "1") return false;
        sessionStorage.setItem(RECOVERY_KEY, "1");
    } catch {
        // The query marker survives the reload when session storage is denied.
    }
    recovering = true;
    navigateToFreshEntry();
    return true;
}

function navigateToFreshEntry() {
    const url = new URL(window.location.href);
    url.searchParams.set(RECOVERY_QUERY, String(Date.now()));
    window.location.replace(url.toString());
}

function handlePreloadError(event: Event) {
    // On the second failure let Vite throw to the route error boundary.
    if (tryRecoverChunkFailure()) event.preventDefault();
}
