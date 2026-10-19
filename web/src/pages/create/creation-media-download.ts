import { createZip } from "@/lib/zip";
import { getResourceBlob, resourceIdFromStorageKey } from "@/services/api/resources";
import { getImageBlob } from "@/services/image-storage";
import { saveAs } from "file-saver";
import type { CreationMessage } from "./creation-types";

export type CreationImageDownload = { url: string; storageKey?: string; name: string };

export function creationImageDownloadBaseName(scene: string, sequence: number, output?: number) {
    const scenes: Array<[RegExp, string]> = [
        [/规格.*步骤|步骤.*规格/, "规格步骤"],
        [/主图|白底|hero/i, "主图"],
        [/成分|配方|ingredient/i, "成分"],
        [/场景|生活|lifestyle|scene/i, "场景"],
        [/细节|特写|detail/i, "细节"],
        [/对比|comparison/i, "对比"],
        [/规格|尺寸|specification/i, "规格"],
        [/步骤|使用|how.?to|instruction/i, "使用步骤"],
        [/卖点|功效|benefit|feature/i, "卖点"],
    ];
    const shortName =
        scenes.find(([pattern]) => pattern.test(scene))?.[1] ||
        safeDownloadName(
            scene
                .replace(/(?:展示|说明|介绍|商品|产品|核心|示意)/g, "")
                .replace(/图$/, "")
                .replace(/\s+/g, ""),
        ).slice(0, 12) ||
        "图片";
    return `${String(sequence).padStart(2, "0")}_${shortName}${output ? `_${output}` : ""}`;
}

export function creationImagesZipName(item: Pick<CreationMessage, "id" | "agentRunId" | "taskIds">) {
    return `${safeDownloadName(item.agentRunId || item.taskIds?.[0] || item.id)}.zip`;
}

export function creationImageDownloadName(image: CreationImageDownload, blob: Blob) {
    const mime = blob.type.split(";", 1)[0].toLowerCase();
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    const urlExtension = image.url
        .split(/[?#]/, 1)[0]
        .match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[1]
        ?.toLowerCase();
    return `${safeDownloadName(image.name)}.${extensions[mime] || (urlExtension === "jpeg" ? "jpg" : urlExtension) || "png"}`;
}

export async function readCreationDownloadImage(image: CreationImageDownload, signal?: AbortSignal): Promise<Blob> {
    let blob: Blob | null;
    if (image.storageKey && resourceIdFromStorageKey(image.storageKey)) blob = await getResourceBlob(image.storageKey, { signal, variant: "original" });
    else if (image.storageKey) blob = await getImageBlob(image.storageKey);
    else {
        if (!image.url.trim()) throw new Error(`${image.name}：图片资源不存在`);
        let response: Response;
        try {
            response = await fetch(image.url, { mode: "cors", credentials: "same-origin", signal });
        } catch (error) {
            if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) throw error;
            throw new Error(`${image.name}：浏览器无法读取图片，可能被 CORS 或网络阻止`, { cause: error });
        }
        if (!response.ok) throw new Error(`${image.name}：下载失败（${response.status}）`);
        blob = await response.blob();
    }
    if (!blob?.size) throw new Error(`${image.name}：图片内容为空或本地文件已丢失`);
    if (blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") throw new Error("下载内容不是有效图片，请重试");
    return blob;
}

export async function createCreationImagesZip(images: CreationImageDownload[], readImage = readCreationDownloadImage) {
    if (!images.length) throw new Error("没有可下载的图片");
    const files: Array<{ name: string; data: Blob }> = new Array(images.length);
    const controller = new AbortController();
    let next = 0;
    let totalBytes = 0;
    try {
        await Promise.all(
            Array.from({ length: Math.min(4, images.length) }, async () => {
                while (next < images.length && !controller.signal.aborted) {
                    const index = next++;
                    const data = await readImage(images[index], controller.signal);
                    totalBytes += data.size;
                    if (totalBytes > 512 * 1024 * 1024) throw new Error("原文件总量超过浏览器 512MB 打包限制，请分批下载");
                    files[index] = { name: creationImageDownloadName(images[index], data), data };
                }
            }),
        );
    } catch (error) {
        controller.abort();
        throw error;
    }
    return createZip(files);
}

export async function downloadCreationImage(image: CreationImageDownload) {
    const blob = await readCreationDownloadImage(image);
    saveAs(blob, creationImageDownloadName(image, blob));
}

function safeDownloadName(value: string) {
    return value
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/^\.+|[. ]+$/g, "");
}
