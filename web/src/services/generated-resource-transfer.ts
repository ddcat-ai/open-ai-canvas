import { getActiveUserScope } from "@/lib/user-scope";
import { beginGeneratedResourceUpload, completeGeneratedResourceUpload, getResourceAccess, invalidateResourceAccess, putBrowserUpload, requestGeneratedResourceFallback } from "@/services/api/resources";
import { scheduleBrowserResourceThumbnail } from "@/services/resource-thumbnail";

const scheduled = new Set<string>();
const queue: Array<() => Promise<void>> = [];
let active = 0;

function runQueue() {
    while (active < 4 && queue.length) {
        const job = queue.shift()!;
        active++;
        void job().finally(() => {
            active--;
            runQueue();
        });
    }
}

export function scheduleGeneratedResourceTransfer(id: string, sourceURL: string) {
    const scope = getActiveUserScope();
    const key = `${scope}:${id}`;
    if (scope === "guest" || scheduled.has(key)) return;
    scheduled.add(key);
    queue.push(async () => {
        if (scope !== getActiveUserScope()) {
            scheduled.delete(key);
            return;
        }
        try {
            await persistGeneratedResourceInBrowser(id, sourceURL, scope);
        } catch {
            // No failure text or temporary URL enters a conversation. The durable server outbox owns recovery.
        }
        void observeSavedResource(id, scope).finally(() => scheduled.delete(key));
    });
    runQueue();
}

export async function persistGeneratedResourceInBrowser(id: string, sourceURL: string, scope = getActiveUserScope()) {
    const signal = AbortSignal.timeout(90_000);
    const current = () => {
        if (scope !== getActiveUserScope()) throw new DOMException("账号已切换", "AbortError");
    };
    let uploadID = "";
    try {
        current();
        // Display may have cached a non-CORS response; fetch fresh bytes for browser processing.
        const response = await fetch(sourceURL, { mode: "cors", cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer", signal });
        if (!response.ok) throw new Error("上游图片读取失败");
        const blob = await response.blob();
        current();
        const bitmap = await createImageBitmap(blob);
        const width = bitmap.width,
            height = bitmap.height;
        bitmap.close();
        current();
        const direct = await beginGeneratedResourceUpload(id, blob, width, height, signal);
        current();
        if (direct.resource) {
            scheduleBrowserResourceThumbnail(`resource:${id}`, blob);
            await invalidateResourceAccess(`resource:${id}`);
            return direct.resource;
        }
        if (!direct.upload) {
            if (direct.fallbackReason !== "resource_transfer_in_progress") await requestGeneratedResourceFallback(id);
            return;
        }
        uploadID = direct.upload.id;
        try {
            await putBrowserUpload(direct.upload, blob, signal);
        } catch {
            /* Verify before requesting server fallback. */
        }
        current();
        const resource = await completeGeneratedResourceUpload(id, uploadID, signal);
        current();
        scheduleBrowserResourceThumbnail(`resource:${id}`, blob);
        await invalidateResourceAccess(`resource:${id}`);
        return resource;
    } catch (error) {
        if (scope === getActiveUserScope()) await requestGeneratedResourceFallback(id, uploadID).catch(() => undefined);
        throw error;
    }
}

async function observeSavedResource(id: string, scope: string) {
    // The server also saves when the page closes. This polling only refreshes the currently visible transport.
    for (let attempt = 0; attempt < 24 && scope === getActiveUserScope(); attempt++) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(5_000 * 2 ** Math.floor(attempt / 4), 60_000)));
        if (scope !== getActiveUserScope()) return;
        try {
            const access = await getResourceAccess(`resource:${id}`, "display", "original", "", { forceRefresh: true });
            if (scope !== getActiveUserScope()) return;
            if (access.delivery !== "upstream") {
                await invalidateResourceAccess(`resource:${id}`);
                return;
            }
        } catch {
            /* Retry the access query; never regenerate an image. */
        }
    }
}
