import { loadCanvasDrawingRender, saveCanvasDrawingRenderPublication } from "@/lib/canvas/canvas-drawing-storage";
import { resourceFileUrl, resourceIdFromStorageKey, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

export async function resolveCanvasDrawingReference(projectId: string, image: ReferenceImage): Promise<ReferenceImage> {
    const source = image.source;
    if (!source || source.kind !== "drawing") return image;
    if (!source.shapeCount) throw new Error(`绘图“${image.name}”为空，请先完成绘图再生成`);

    const render = await loadCanvasDrawingRender(projectId, source.drawingId);
    if (!render || render.revision !== source.revision) {
        throw new Error(`绘图“${image.name}”缺少当前版本的生成图，请打开绘图并保存后重试`);
    }

    if (resourceIdFromStorageKey(render.storageKey)) {
        return {
            ...image,
            dataUrl: "",
            url: render.url,
            storageKey: render.storageKey,
            type: render.mimeType,
        };
    }

    try {
        const resource = await uploadResourceFile(render.blob, "image", {
            width: render.width,
            height: render.height,
            fileName: `drawing-${source.drawingId}-r${source.revision}.png`,
        });
        const storageKey = resourceStorageKey(resource.id);
        const url = resource.publicUrl || resourceFileUrl(resource.id);
        const saved = await saveCanvasDrawingRenderPublication(projectId, source.drawingId, source.revision, { storageKey, url });
        if (!saved) throw new Error("绘图在上传期间发生了修改，请重新生成");
        return { ...image, dataUrl: "", url, storageKey, type: resource.mimeType || render.mimeType };
    } catch (error) {
        if (error instanceof Error && error.message === "绘图在上传期间发生了修改，请重新生成") throw error;
        throw new Error(error instanceof Error ? `绘图参考图上传失败：${error.message}` : "绘图参考图上传失败");
    }
}
