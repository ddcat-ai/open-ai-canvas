import { getResourceBlob, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import { getActiveUserScope } from "@/lib/user-scope";

import type { TryOnFaceRead } from "./tryon-plan";

/**
 * 换脸参考只保留五官：按读图 Agent 给出的框在浏览器里裁图并上传。
 * 图片模型拿到整张大头照时会把参考人的头发、头顶一起画上去（光头参考尤其明显），裁掉后只剩五官可借。
 * 上边不外扩，避免把发际线带回来；任何一张失败都退回原图，不阻断出图。
 */
export async function cropFaceReferences(faceIds: string[], boxes: TryOnFaceRead["boxes"], scope: string): Promise<string[]> {
    return Promise.all(faceIds.map((id, index) => cropOne(id, boxes[index], scope).catch(() => "")));
}

async function cropOne(resourceId: string, box: TryOnFaceRead["boxes"][number], scope: string) {
    if (!box) return "";
    const blob = await getResourceBlob(resourceStorageKey(resourceId), "browser-process");
    if (!blob) return "";
    const bitmap = await createImageBitmap(blob);
    try {
        const [x0, y0, x1, y1] = box.map((value) => value / 1000);
        const padX = (x1 - x0) * 0.06;
        const left = Math.max(0, Math.floor((x0 - padX) * bitmap.width));
        const right = Math.min(bitmap.width, Math.ceil((x1 + padX) * bitmap.width));
        const top = Math.max(0, Math.floor(y0 * bitmap.height));
        const bottom = Math.min(bitmap.height, Math.ceil((y1 + (y1 - y0) * 0.04) * bitmap.height));
        const width = right - left;
        const height = bottom - top;
        // 框小于 48px 时五官已经看不清，裁出来反而更差。
        if (width < 48 || height < 48) return "";
        const scale = Math.min(1024 / Math.max(width, height), Math.max(1, 512 / Math.max(width, height)));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(width * scale);
        canvas.height = Math.round(height * scale);
        const context = canvas.getContext("2d");
        if (!context) return "";
        context.imageSmoothingQuality = "high";
        context.drawImage(bitmap, left, top, width, height, 0, 0, canvas.width, canvas.height);
        const output = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
        if (!output) return "";
        if (getActiveUserScope() !== scope) throw new DOMException("账号已切换", "AbortError");
        const resource = await uploadResourceFile(output, "image", {
            expectedUserId: scope,
            fileName: "face-crop.jpg",
            width: canvas.width,
            height: canvas.height,
            idempotencyKey: `tryon-face-crop:${resourceId}:${box.join(",")}`,
        });
        return resource.id;
    } finally {
        bitmap.close();
    }
}
