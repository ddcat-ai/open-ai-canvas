import { resourceFileUrl, resourceStorageKey, uploadResourceFile } from "@/services/api/resources";
import type { ReferenceImage } from "@/types/image";

/** 调色参数，单位与 CSS filter 一致（百分比 / 度） */
export type CanvasColorGrade = {
    brightness: number;
    contrast: number;
    saturate: number;
    hueRotate: number;
};

export const DEFAULT_COLOR_GRADE: CanvasColorGrade = { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0 };

export function isNeutralColorGrade(grade: CanvasColorGrade) {
    return grade.brightness === 100 && grade.contrast === 100 && grade.saturate === 100 && grade.hueRotate === 0;
}

/**
 * 预览（img 的 CSS filter）与导出（canvas 的 ctx.filter）共用同一个字符串。
 * 两处各写一份的话，用户看到的和生成用的就会悄悄不一致。
 */
export function colorGradeCssFilter(grade: CanvasColorGrade) {
    return `brightness(${grade.brightness}%) contrast(${grade.contrast}%) saturate(${grade.saturate}%) hue-rotate(${grade.hueRotate}deg)`;
}

// 同一张图 + 同一组参数在一次会话内只上传一次。
// 不做跨会话缓存：那需要往节点 metadata 回写，而构建参考图的路径拿不到写入通道。
const publishedCache = new Map<string, { url: string; storageKey: string; type: string }>();

function cacheKey(url: string, grade: CanvasColorGrade) {
    return `${url}|${grade.brightness}|${grade.contrast}|${grade.saturate}|${grade.hueRotate}`;
}

async function renderGradedBlob(url: string, grade: CanvasColorGrade) {
    const image = new Image();
    image.crossOrigin = "anonymous";
    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => reject(new Error("源图无法读取（可能不允许跨域）"));
        image.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布上下文");
    // ctx.filter 在少数浏览器上不存在——那会静默导出一张未调色的图，
    // 与用户看到的预览不一致。宁可明确失败。
    if (!("filter" in ctx)) throw new Error("当前浏览器不支持导出调色结果，请换用 Chrome / Edge");
    ctx.filter = colorGradeCssFilter(grade);
    ctx.drawImage(image, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("调色结果导出失败");
    return { blob, width: canvas.width, height: canvas.height };
}

/**
 * 把调色节点的参考图落地成真实资源——照 resolveCanvasDrawingReference 的做法：
 * 本地渲染 → 上传 → 换成 storageKey/url，让下游按普通图片消费。
 *
 * 只在生成真正要用它时才调用（见 canvas-node-generation），所以拖滑杆调参数不会产生上传。
 */
export async function resolveCanvasColorGradeReference(image: ReferenceImage): Promise<ReferenceImage> {
    const source = image.source;
    if (!source || source.kind !== "colorgrade") return image;

    const cached = publishedCache.get(cacheKey(source.url, source.grade));
    if (cached) return { ...image, dataUrl: "", url: cached.url, storageKey: cached.storageKey, type: cached.type };

    try {
        const render = await renderGradedBlob(source.url, source.grade);
        const resource = await uploadResourceFile(render.blob, "image", {
            width: render.width,
            height: render.height,
            fileName: `colorgrade-${image.id}.png`,
        });
        const storageKey = resourceStorageKey(resource.id);
        const url = resource.publicUrl || resourceFileUrl(resource.id);
        const type = resource.mimeType || "image/png";
        publishedCache.set(cacheKey(source.url, source.grade), { url, storageKey, type });
        return { ...image, dataUrl: "", url, storageKey, type };
    } catch (error) {
        throw new Error(error instanceof Error ? `调色参考图生成失败：${error.message}` : "调色参考图生成失败");
    }
}
