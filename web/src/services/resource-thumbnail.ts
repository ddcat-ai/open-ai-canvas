import { createBrowserImageThumbnail } from "@/lib/browser-image-thumbnail";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceIdFromStorageKey, uploadResourceThumbnail } from "@/services/api/resources";

const scheduled = new Set<string>();
let queue: Promise<void> = Promise.resolve();

export function scheduleBrowserResourceThumbnail(storageKey: string, blob: Blob) {
    if (!resourceIdFromStorageKey(storageKey) || !blob.type.startsWith("image/") || typeof createImageBitmap !== "function" || typeof document === "undefined") return;
    const scope = getActiveUserScope();
    const key = `${scope}:${storageKey}`;
    if (scheduled.has(key)) return;
    scheduled.add(key);
    queue = queue
        .then(async () => {
            if (scope !== getActiveUserScope()) return;
            const thumbnail = await createBrowserImageThumbnail(blob);
            if (scope !== getActiveUserScope()) return;
            await uploadResourceThumbnail(storageKey, thumbnail.blob);
        })
        .catch((error) => {
            scheduled.delete(key);
            console.warn("浏览器缩略图未保存，继续使用原图", { resourceId: resourceIdFromStorageKey(storageKey), error });
        });
}
