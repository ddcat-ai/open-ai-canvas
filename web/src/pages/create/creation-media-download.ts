import { createZip, readZip } from "@/lib/zip";
import { downloadImageResourceArchive, resourceIdFromStorageKey } from "@/services/api/resources";
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
    const shortName = scenes.find(([pattern]) => pattern.test(scene))?.[1]
        || safeDownloadName(scene.replace(/(?:展示|说明|介绍|商品|产品|核心|示意)/g, "").replace(/图$/, "").replace(/\s+/g, "")).slice(0, 12)
        || "图片";
    return `${String(sequence).padStart(2, "0")}_${shortName}${output ? `_${output}` : ""}`;
}

export function creationImagesZipName(item: Pick<CreationMessage, "id" | "agentRunId" | "taskIds">) {
    return `${safeDownloadName(item.agentRunId || item.taskIds?.[0] || item.id)}.zip`;
}

export function creationImageDownloadName(image: CreationImageDownload, blob: Blob) {
    const mime = blob.type.split(";", 1)[0].toLowerCase();
    const extensions: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
    const urlExtension = image.url.split(/[?#]/, 1)[0].match(/\.(png|jpe?g|webp|gif|avif)$/i)?.[1]?.toLowerCase();
    return `${safeDownloadName(image.name)}.${extensions[mime] || (urlExtension === "jpeg" ? "jpg" : urlExtension) || "png"}`;
}

export async function readCreationDownloadImage(image: CreationImageDownload): Promise<Blob> {
    let blob: Blob | null = null;
    const resourceId = resourceIdFromStorageKey(image.storageKey);
    if (resourceId) {
        const entries = await readZip(await downloadImageResourceArchive([{ resourceId, name: image.name }]));
        const [name, data] = [...entries][0];
        const types: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif" };
        blob = new Blob([data], { type: types[name.split(".").pop() || ""] });
    } else if (image.storageKey) {
        blob = await getImageBlob(image.storageKey);
    }
    if (!blob) {
        const response = await fetch(image.url, { credentials: "same-origin", mode: "cors" });
        if (!response.ok) throw new Error(`图片下载失败（${response.status}）`);
        blob = await response.blob();
    }
    if (!blob.size || blob.type && !blob.type.startsWith("image/") && blob.type !== "application/octet-stream") throw new Error("下载内容不是有效图片，请重试");
    return blob;
}

export async function createCreationImagesZip(images: CreationImageDownload[], readImage = readCreationDownloadImage) {
    if (!images.length) throw new Error("没有可下载的图片");
    if (readImage === readCreationDownloadImage && images.every((image) => resourceIdFromStorageKey(image.storageKey))) {
        return downloadImageResourceArchive(images.map((image) => ({ resourceId: resourceIdFromStorageKey(image.storageKey), name: safeDownloadName(image.name) })));
    }
    const files = await Promise.all(images.map(async (image) => {
        const data = await readImage(image);
        return { name: creationImageDownloadName(image, data), data };
    }));
    return createZip(files);
}

export async function downloadCreationImage(image: CreationImageDownload) {
    const blob = await readCreationDownloadImage(image);
    saveAs(blob, creationImageDownloadName(image, blob));
}

function safeDownloadName(value: string) {
    return value.trim().replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").replace(/^\.+|[. ]+$/g, "");
}
