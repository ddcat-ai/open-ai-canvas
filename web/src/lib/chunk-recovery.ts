const RECOVERY_QUERY = "__chunk_recovery";
import { PageResourceError } from "@/lib/module-preload";

export function reloadAfterChunkFailure() {
    const url = new URL(window.location.href);
    url.searchParams.set(RECOVERY_QUERY, String(Date.now()));
    window.location.replace(url.toString());
}

export function reportStartupLoadFailure(error: unknown) {
    console.error("Application startup failed", error);
    window.dispatchEvent(new CustomEvent("starai:startup-load-failure", { detail: { status: error instanceof PageResourceError ? error.status : undefined } }));
}
