// 上传中节点的本地预览地址只保存在当前页面内存里。
// 不写入节点 metadata：blob: 地址一旦进入画布数据会被同步到服务端，刷新或换设备后即失效。
// thumb：磨砂底图的 data URL；生成失败时为 THUMB_FAILED，预览组件据此直接显示清晰原图。
type UploadPreview = { url: string; thumb: string };

export const UPLOAD_THUMB_FAILED = "failed";

const previews = new Map<string, UploadPreview>();
const listeners = new Set<() => void>();
// 磨砂底图的长边像素：放大显示后自然模糊，不需要对原图做 CSS filter（缩放画布时逐帧重栅格化很贵）。
const THUMB_LONG_EDGE = 28;

function notify() {
    listeners.forEach((listener) => listener());
}

export function registerUploadPreview(nodeId: string, file: Blob) {
    releaseUploadPreview(nodeId);
    const preview: UploadPreview = { url: URL.createObjectURL(file), thumb: "" };
    previews.set(nodeId, preview);
    if (file.type.startsWith("image/")) {
        void createImageThumb(file).then((thumb) => {
            if (previews.get(nodeId) !== preview) return;
            preview.thumb = thumb || UPLOAD_THUMB_FAILED;
            notify();
        });
    }
    return preview.url;
}

/** 视频首帧可用后由预览组件补交磨砂底图。 */
export function setUploadPreviewThumb(nodeId: string, source: CanvasImageSource, width: number, height: number) {
    const preview = previews.get(nodeId);
    if (!preview || preview.thumb) return;
    preview.thumb = drawThumb(source, width, height) || UPLOAD_THUMB_FAILED;
    notify();
}

export function uploadPreviewUrl(nodeId: string) {
    return previews.get(nodeId)?.url || "";
}

export function uploadPreviewThumb(nodeId: string) {
    return previews.get(nodeId)?.thumb || "";
}

export function subscribeUploadPreviews(listener: () => void) {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

export function releaseUploadPreview(nodeId: string) {
    const preview = previews.get(nodeId);
    if (!preview) return;
    previews.delete(nodeId);
    URL.revokeObjectURL(preview.url);
}

async function createImageThumb(file: Blob) {
    if (typeof createImageBitmap !== "function") return "";
    let bitmap: ImageBitmap | undefined;
    try {
        // 带缩放参数时浏览器可在解码阶段直接降采样；不支持该参数时退回全尺寸解码。
        bitmap = await createImageBitmap(file, { resizeWidth: THUMB_LONG_EDGE * 2, resizeQuality: "low" }).catch(() => createImageBitmap(file));
        return drawThumb(bitmap, bitmap.width, bitmap.height);
    } catch {
        return "";
    } finally {
        bitmap?.close();
    }
}

function drawThumb(source: CanvasImageSource, width: number, height: number) {
    if (!width || !height || typeof document === "undefined") return "";
    const scale = THUMB_LONG_EDGE / Math.max(width, height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext("2d");
    if (!context) return "";
    try {
        // 在极小画布上模糊几乎没有成本，放大后得到柔和的磨砂效果。
        context.filter = "blur(1px) saturate(0.85)";
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.7);
    } catch {
        return "";
    }
}
