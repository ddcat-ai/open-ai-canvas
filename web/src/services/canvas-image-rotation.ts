import { currentImageRotation, nextImageQuarterTurns, type CanvasImageRotation, type ImageQuarterTurns, type ImageRotationDirection, type RotationImage } from "@/lib/canvas/canvas-image-rotation";
import { getImageBlob, uploadImage, type UploadedImage } from "@/services/image-storage";
import { getActiveUserScope } from "@/lib/user-scope";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import type { CanvasNodeData } from "@/types/canvas";

const MAX_ROTATION_PIXELS = 64_000_000;

async function readOriginalBlob(image: RotationImage) {
    const stored = image.storageKey ? await getImageBlob(image.storageKey) : null;
    if (stored) return stored;
    const response = await fetch(image.content, { mode: "cors", credentials: "same-origin" });
    if (!response.ok) throw new Error(`原图读取失败（${response.status}）`);
    return response.blob();
}

function rotationImage(image: UploadedImage): RotationImage & { storageKey: string; bytes: number; mimeType: string } {
    return { content: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

/** Integer transforms copy pixels without interpolation; PNG preserves transparent pixels. */
export async function rotateImageBlob(blob: Blob, quarterTurns: Exclude<ImageQuarterTurns, 0>) {
    if (![1, 2, 3].includes(quarterTurns)) throw new Error("旋转角度无效");
    const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
    let canvas: OffscreenCanvas | HTMLCanvasElement | undefined;
    try {
        const { width, height } = bitmap;
        if (width * height > MAX_ROTATION_PIXELS) throw new Error("图片超过 6400 万像素，请先调整图片尺寸后旋转");
        const rotatedWidth = quarterTurns % 2 ? height : width;
        const rotatedHeight = quarterTurns % 2 ? width : height;
        canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(rotatedWidth, rotatedHeight) : Object.assign(document.createElement("canvas"), { width: rotatedWidth, height: rotatedHeight });
        const context = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        if (!context) throw new Error("浏览器不支持图片旋转");
        context.imageSmoothingEnabled = false;
        if (quarterTurns === 1) context.setTransform(0, 1, -1, 0, height, 0);
        if (quarterTurns === 2) context.setTransform(-1, 0, 0, -1, width, height);
        if (quarterTurns === 3) context.setTransform(0, -1, 1, 0, 0, width);
        context.drawImage(bitmap, 0, 0);
        const result =
            "convertToBlob" in canvas
                ? await canvas.convertToBlob({ type: "image/png" })
                : await new Promise<Blob>((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((png) => (png ? resolve(png) : reject(new Error("旋转图片导出失败"))), "image/png"));
        return { blob: result, width: rotatedWidth, height: rotatedHeight, originalWidth: width, originalHeight: height };
    } finally {
        bitmap.close();
        if (canvas) canvas.width = canvas.height = 0;
    }
}

/** At most three immutable PNG variants per source, reused without decoding or uploading again. */
export async function prepareCanvasImageRotation(node: CanvasNodeData, direction: ImageRotationDirection, isCurrent: () => boolean = () => true): Promise<{ rotation: CanvasImageRotation; pendingRemoteUpload: boolean } | null> {
    const scope = getActiveUserScope();
    const assertCurrent = () => {
        if (scope !== getActiveUserScope() || !isCurrent()) throw new DOMException("图片旋转已取消", "AbortError");
    };
    assertCurrent();
    const saved = currentImageRotation(node);
    const quarterTurns = nextImageQuarterTurns(saved?.quarterTurns || 0, direction);
    if (quarterTurns === (saved?.quarterTurns || 0)) return null;
    if (saved && (quarterTurns === 0 || saved.variants?.[quarterTurns])) {
        const image = quarterTurns === 0 ? saved.original : saved.variants![quarterTurns]!;
        return { rotation: { ...saved, quarterTurns }, pendingRemoteUpload: Boolean(image.storageKey && !resourceIdFromStorageKey(image.storageKey)) };
    }
    let original: RotationImage = saved?.original || {
        content: node.metadata?.content || "",
        storageKey: node.metadata?.storageKey,
        width: node.metadata?.naturalWidth || 0,
        height: node.metadata?.naturalHeight || 0,
        bytes: node.metadata?.bytes,
        mimeType: node.metadata?.mimeType,
    };
    const blob = await readOriginalBlob(original);
    assertCurrent();
    const rendered = await rotateImageBlob(blob, quarterTurns as Exclude<ImageQuarterTurns, 0>);
    assertCurrent();
    let pendingRemoteUpload = false;
    // A plain URL may expire. Materialize it once so restore has the same durable reference contract as uploads.
    if (!original.storageKey) {
        const uploadedOriginal = await uploadImage(blob);
        assertCurrent();
        original = rotationImage(uploadedOriginal);
        pendingRemoteUpload = Boolean(uploadedOriginal.pendingRemoteUpload);
    } else original = { ...original, width: rendered.originalWidth, height: rendered.originalHeight };
    const uploaded = await uploadImage(rendered.blob);
    assertCurrent();
    return {
        rotation: { original, quarterTurns, variants: { ...saved?.variants, [quarterTurns]: rotationImage(uploaded) } },
        pendingRemoteUpload: pendingRemoteUpload || Boolean(uploaded.pendingRemoteUpload),
    };
}
