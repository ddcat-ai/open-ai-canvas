import {
    getResourceAccess,
    resolveResourceAccessURL,
    resourceIdFromStorageKey,
    type ResourceAccessVariant,
} from "@/services/api/resources";

export type BrowserMediaDownload = {
    fileName: string;
    storageKey?: string;
    url?: string;
    variant?: ResourceAccessVariant;
};

/**
 * Hand a media download directly to the browser.
 *
 * Remote resources use the OSS/CDN download access contract so the object
 * store sends the bytes and Content-Disposition header. This function must
 * not fetch the payload or materialize a Blob: doing so wastes browser memory
 * and can accidentally turn the platform into a media relay.
 */
export async function downloadBrowserMedia({ fileName, storageKey, url, variant = "original" }: BrowserMediaDownload) {
    const normalizedStorageKey = storageKey?.trim();
    const normalizedUrl = url?.trim();
    const href = normalizedStorageKey && resourceIdFromStorageKey(normalizedStorageKey)
        ? resolveResourceAccessURL((await getResourceAccess(normalizedStorageKey, "download", variant, fileName)).url)
        : normalizedUrl;
    if (!href) throw new Error("媒体资源不存在");

    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = fileName;
    anchor.rel = "noopener noreferrer";
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
}
