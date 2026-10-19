export function thumbnailDimensions(width: number, height: number, maxSize = 400) {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(maxSize) || maxSize <= 0) throw new Error("图片尺寸无效，无法生成缩略图");
    const scale = Math.min(1, maxSize / Math.max(width, height));
    return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** 仅处理浏览器已经持有的字节，避免生成缩略图时再拉一次远端原图。 */
export async function createBrowserImageThumbnail(blob: Blob) {
    const bitmap = await createImageBitmap(blob);
    try {
        const size = thumbnailDimensions(bitmap.width, bitmap.height);
        const canvas = document.createElement("canvas");
        canvas.width = size.width;
        canvas.height = size.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("浏览器无法生成图片缩略图");
        context.drawImage(bitmap, 0, 0, size.width, size.height);
        const mimeType = blob.type === "image/jpeg" ? "image/jpeg" : "image/png";
        const thumbnail = await new Promise<Blob>((resolve, reject) => canvas.toBlob((result) => (result?.size ? resolve(result) : reject(new Error("缩略图编码失败"))), mimeType, 0.8));
        return { blob: thumbnail, ...size };
    } finally {
        bitmap.close();
    }
}
