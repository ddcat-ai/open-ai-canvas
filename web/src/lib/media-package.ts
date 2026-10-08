import { createZip } from "@/lib/zip";
import { getImageBlob } from "@/services/image-storage";
import { getMediaBlob } from "@/services/file-storage";
import type { CanvasExportAsset } from "@/types/canvas-export";

/** UTF-8 percent encoding keeps distinct storage IDs distinct inside an archive. */
export function packageSegment(value: string): string {
    return encodeURIComponent(value).replace(/\./g, "%2E");
}
export function downloadName(value: string): string {
    return value.replace(/[\x00-\x1f\\/:*?"<>|]/g, "_").trim() || "画布";
}

export class MediaPackage {
    private readonly entries = new Map<string, BlobPart>();

    put(path: string, data: BlobPart): void {
        if (this.entries.has(path)) throw new Error(`导出文件路径重复：${path}`);
        this.entries.set(path, data);
    }

    async collect(keys: Iterable<string>, directory: string, imageKeys?: ReadonlySet<string>): Promise<CanvasExportAsset[]> {
        const assets: CanvasExportAsset[] = [];
        for (const storageKey of new Set(keys)) {
            const image = imageKeys ? imageKeys.has(storageKey) : storageKey.startsWith("image:");
            const blob = await (image ? getImageBlob(storageKey) : getMediaBlob(storageKey));
            // Cloud-backed references need not have a local blob and remain in the manifest.
            if (!blob) continue;
            const path = `${directory}/${packageSegment(storageKey)}`;
            this.put(path, blob);
            assets.push({ path, storageKey, mimeType: blob.type || "application/octet-stream", bytes: blob.size });
        }
        return assets;
    }

    async finish(manifestPath: string, manifest: unknown): Promise<Blob> {
        this.put(manifestPath, JSON.stringify(manifest, null, 2));
        return createZip([...this.entries].map(([name, data]) => ({ name, data })));
    }
}

export function referencedStorageKeys(root: unknown): Set<string> {
    const result = new Set<string>();
    const visited = new Set<object>();
    const queue = [root];
    while (queue.length) {
        const item = queue.pop();
        if (item === null || typeof item !== "object" || visited.has(item)) continue;
        visited.add(item);
        for (const [name, child] of Object.entries(item)) {
            if (name === "storageKey" && typeof child === "string" && child.includes(":")) result.add(child);
            else if (child && typeof child === "object") queue.push(child);
        }
    }
    return result;
}
