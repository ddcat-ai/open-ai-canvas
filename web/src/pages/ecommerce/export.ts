import { saveAs } from "file-saver";

import { createZip } from "@/lib/zip";
import { getResourceBlob, resolveResourceUrl, resourceFileUrl } from "@/services/api/resources";
import { apiBaseURL } from "@/services/api/request";
import { createClientUUID } from "@/lib/client-id";
import { getActiveUserScope } from "@/lib/user-scope";
import { useAssetStore } from "@/stores/use-asset-store";
import { loadAssetsForUse } from "@/services/user-data-sync";
import type { EcommercePlanImage } from "@/services/api/ecommerce";
import { ecommerceOutputSize } from "./output-size";

export type EcommerceExportItem = { image: EcommercePlanImage; assetId: string; index: number; resourceId?: string };
export type EcommerceDownload = { blob: Blob; fileName: string };

function deliverDownload(blob: Blob, fileName: string): EcommerceDownload {
    saveAs(blob, fileName);
    return { blob, fileName };
}

/** Browser downloads start in the click handler; large ZIPs stream from storage. */
export function startEcommerceDownload(items: EcommerceExportItem[]): boolean {
    if (!items.length || items.some((item) => !item.resourceId)) return false;
    if (items.length > 1) {
        const owner = getActiveUserScope();
        const frame = document.createElement("iframe");
        frame.name = `commerce-download-${createClientUUID()}`;
        frame.hidden = true;
        frame.title = "图片 ZIP 下载";
        frame.onload = () => {
            try {
                const raw = frame.contentDocument?.body?.textContent;
                if (!raw) return;
                const failure = JSON.parse(raw) as { code?: number; msg?: string };
                if (failure.code && owner === getActiveUserScope()) window.dispatchEvent(new CustomEvent("commerce-download-error", { detail: { owner, message: failure.msg || "下载未完成，请重试" } }));
                frame.remove();
            } catch {
                /* Attachment responses are handled by the browser download manager. */
            }
        };
        document.body.append(frame);
        const form = document.createElement("form");
        form.method = "post";
        form.action = `${String(apiBaseURL).replace(/\/+$/, "")}/ecommerce/download`;
        form.hidden = true;
        form.target = frame.name;
        for (const item of items) {
            const field = document.createElement("input");
            field.type = "hidden";
            field.name = "resourceId";
            field.value = item.resourceId!;
            form.append(field);
        }
        document.body.append(form);
        form.submit();
        form.remove();
        return true;
    }
    const url = `${resourceFileUrl(items[0].resourceId!)}?download=1`;
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    return true;
}

async function imageBlob(assetId: string): Promise<Blob> {
    if (!useAssetStore.getState().assets.some((item) => item.id === assetId)) await loadAssetsForUse([assetId]);
    const asset = useAssetStore.getState().assets.find((item) => item.id === assetId && item.kind === "image");
    if (!asset || asset.kind !== "image") throw new Error("图片尚未保存到资产库，请稍后重试");
    if (asset.data.storageKey) {
        const stored = await getResourceBlob(asset.data.storageKey, "ecommerce-export");
        if (stored) return stored;
    }
    const url = asset.data.storageKey ? resolveResourceUrl(asset.data.storageKey) : asset.data.dataUrl;
    if (!url) throw new Error("图片资源地址不可用");
    const response = await fetch(url, { credentials: "include" });
    if (!response.ok) throw new Error(`读取图片失败（${response.status}）`);
    return response.blob();
}

async function composedImageBlob(item: EcommerceExportItem): Promise<Blob> {
    const original = await imageBlob(item.assetId);
    const bitmap = await createImageBitmap(original);
    try {
        const target = ecommerceOutputSize(item.image.ratio, bitmap.width, bitmap.height);
        if (target.width === bitmap.width && target.height === bitmap.height) return original;
        const canvas = document.createElement("canvas");
        canvas.width = target.width;
        canvas.height = target.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建文字排版画布");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        const photoHeight = canvas.height;
        const scale = Math.min(canvas.width / bitmap.width, photoHeight / bitmap.height);
        const width = bitmap.width * scale;
        const height = bitmap.height * scale;
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, (canvas.width - width) / 2, (photoHeight - height) / 2, width, height);
        return await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("文字图层导出失败"))), "image/png"));
    } finally {
        bitmap.close();
    }
}

const safeName = (value: string) => value.replace(/[\\/:*?"<>|\x00-\x1f]/g, "-").slice(0, 64) || "商品";
const imageExtension = (blob: Blob) => (blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png");

export async function downloadEcommerceImage(item: EcommerceExportItem) {
    const blob = await composedImageBlob(item);
    return deliverDownload(blob, `${String(item.index + 1).padStart(2, "0")}-${safeName(item.image.imageType)}.${imageExtension(blob)}`);
}

export async function exportEcommerceZip(projectName: string, items: EcommerceExportItem[]) {
    if (!items.length) throw new Error("请先选择已完成的图片");
    const files = await Promise.all(
        items.map(async (item) => {
            const data = await composedImageBlob(item);
            return { name: `${safeName(item.image.imageType)}/${String(item.index + 1).padStart(2, "0")}.${imageExtension(data)}`, data };
        }),
    );
    files.push({
        name: "策划信息.json",
        data: new Blob(
            [
                JSON.stringify(
                    items.map(({ image, index }) => ({ order: index + 1, type: image.imageType, prompt: image.prompt, copy: image.copy, model: image.imageModel, taskId: image.taskId })),
                    null,
                    2,
                ),
            ],
            { type: "application/json" },
        ),
    });
    return deliverDownload(await createZip(files), `${safeName(projectName)}-电商图片.zip`);
}

export async function exportEcommerceLongImage(projectName: string, items: EcommerceExportItem[]) {
    if (!items.length) throw new Error("请先选择已完成的图片");
    const bitmaps = await Promise.all(items.map(async (item) => createImageBitmap(await composedImageBlob(item))));
    try {
        const width = Math.max(...bitmaps.map((image) => image.width));
        const height = bitmaps.reduce((sum, image) => sum + Math.round((image.height * width) / image.width), 0);
        if (width > 16384 || height > 32767 || width * height > 180_000_000) throw new Error("长图超出浏览器可靠尺寸，请使用 ZIP 分段导出");
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法创建长图画布");
        let y = 0;
        for (const bitmap of bitmaps) {
            const scaledHeight = Math.round((bitmap.height * width) / bitmap.width);
            context.drawImage(bitmap, 0, y, width, scaledHeight);
            y += scaledHeight;
        }
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("长图编码失败"))), "image/png"));
        return deliverDownload(blob, `${safeName(projectName)}-详情长图.png`);
    } finally {
        bitmaps.forEach((bitmap) => bitmap.close());
    }
}
