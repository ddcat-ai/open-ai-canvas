import { parseImageParameters } from "@/lib/image-parameters";
import { loadRasterImage } from "@/lib/image-raster";
import { getResourceBlob } from "@/services/api/resources";
import { startBrowserDownload } from "@/services/browser-download";
import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

const FILE_NAME_PART_LIMIT = 80;

const MIME_EXTENSIONS: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/ogg": "ogv",
    "video/mpeg": "mpeg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/flac": "flac",
    "audio/ogg": "ogg",
    "audio/opus": "opus",
};

const CONTENT_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "mp4", "webm", "mov", "ogv", "ogg", "mpeg", "mpg", "mp3", "m4a", "wav", "aac", "flac", "opus"]);

/** 只有带媒体内容的图片、视频、音频节点可以下载；文本、背板等节点没有可交给浏览器的文件。 */
export function canDownloadCanvasNodeMedia(node: CanvasNodeData) {
    const supported = node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio;
    return supported && Boolean(node.metadata?.content?.trim() || node.metadata?.storageKey?.trim());
}

/** 拆层合成图在合成完成前没有可下载的结果。 */
export function isCanvasMediaCompositePending(node: CanvasNodeData) {
    const status = node.metadata?.imageLayerGroup?.compositeStatus;
    return Boolean(status && status !== "ready");
}

export function buildCanvasMediaDownloadFileName(canvasTitle: string, node: CanvasNodeData, now = new Date()) {
    const canvasName = safeFileNamePart(canvasTitle, "未命名画布");
    const nodeName = safeFileNamePart(node.title, defaultNodeName(node.type));
    return `${canvasName}_${nodeName}_${formatDownloadDate(now)}.${canvasMediaFileExtension(node)}`;
}

export function canvasMediaFileExtension(node: CanvasNodeData) {
    return extensionFromMimeType(node.metadata?.mimeType)
        || extensionFromContent(node.metadata?.content)
        || defaultExtension(node.type);
}

function extensionFromMimeType(mimeType?: string) {
    const normalized = mimeType?.split(";", 1)[0]?.trim().toLowerCase();
    return normalized ? MIME_EXTENSIONS[normalized] : undefined;
}

function extensionFromContent(content?: string) {
    if (!content) return undefined;
    const dataMimeType = content.match(/^data:([^;,]+)/i)?.[1];
    const dataExtension = extensionFromMimeType(dataMimeType);
    if (dataExtension) return dataExtension;
    const path = content.split(/[?#]/, 1)[0];
    const extension = path.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
    if (!extension || !CONTENT_EXTENSIONS.has(extension)) return undefined;
    if (extension === "jpeg") return "jpg";
    if (extension === "mpg") return "mpeg";
    return extension;
}

function safeFileNamePart(value: string, fallback: string) {
    const normalized = value
        .trim()
        .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
        .replace(/_+/g, "_")
        .replace(/\s+/g, " ")
        .replace(/^_+|_+$/g, "")
        .slice(0, FILE_NAME_PART_LIMIT)
        .replace(/[. ]+$/g, "");
    if (!normalized) return fallback;
    return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(normalized) ? `_${normalized}` : normalized;
}

function formatDownloadDate(date: Date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}${month}${day}`;
}

function defaultNodeName(type: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Video) return "视频节点";
    if (type === CanvasNodeType.Audio) return "音频节点";
    return "图片节点";
}

function defaultExtension(type: CanvasNodeTypeId) {
    if (type === CanvasNodeType.Video) return "mp4";
    if (type === CanvasNodeType.Audio) return "mp3";
    return "png";
}

const CONVERTED_MIME = { jpeg: "image/jpeg", webp: "image/webp" } as const;
const CONVERTED_EXTENSION = { jpeg: "jpg", webp: "webp" } as const;

export type ImageDownloadFormat = keyof typeof CONVERTED_MIME;

/** 用户在图像设置里选定的输出格式。png 是生成原生格式无需转换；jpeg/webp 需要在下载时转码兑现。 */
export function preferredImageDownloadFormat(node: CanvasNodeData): ImageDownloadFormat | undefined {
    if (node.type !== CanvasNodeType.Image) return undefined;
    const parameters = parseImageParameters(node.metadata?.imageParameters);
    // 画布设置面板写驼峰 outputFormat；插件参数声明与直连协议用下划线 output_format，两者都认。
    const format = parameters.outputFormat ?? parameters.output_format;
    return format === "jpeg" || format === "webp" ? format : undefined;
}

export function withFileExtension(fileName: string, extension: string) {
    return `${fileName.replace(/\.[a-z0-9]+$/i, "")}.${extension}`;
}

/**
 * 按用户选定的输出格式转码后下载。部分模型/渠道会忽略 output_format 仍返回 PNG，
 * 这里在下载侧兑现用户的选择；任何一步失败都抛错，由调用方回退到原图直下。
 */
export async function downloadImageConvertedToFormat({ storageKey, url, fileName, format }: { storageKey?: string; url?: string; fileName: string; format: ImageDownloadFormat }) {
    // 转码需要真实字节：data:/blob: 直接用；远端资源走 browser-process 交付（平台代理、带
    // CORS）换取 Blob。download 变体会 302 到无 CORS 头的 CDN，canvas 读取必然失败。
    let source = url?.trim() || "";
    let releaseSource: (() => void) | undefined;
    if (!source || (!source.startsWith("data:") && !source.startsWith("blob:"))) {
        if (!storageKey?.trim()) throw new Error("媒体资源不存在");
        const blob = await getResourceBlob(storageKey, "browser-process");
        if (!blob) throw new Error("媒体资源不存在");
        source = URL.createObjectURL(blob);
        releaseSource = () => URL.revokeObjectURL(source);
    }
    try {
        const picture = await loadRasterImage(source);
        const canvas = document.createElement("canvas");
        canvas.width = picture.naturalWidth;
        canvas.height = picture.naturalHeight;
        const painter = canvas.getContext("2d");
        if (painter === null) throw new Error("浏览器无法创建图片处理画布");
        // jpeg 没有透明通道，先铺白底，避免透明像素转码后变成黑底。
        if (format === "jpeg") {
            painter.fillStyle = "#ffffff";
            painter.fillRect(0, 0, canvas.width, canvas.height);
        }
        painter.drawImage(picture, 0, 0);
        const converted = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, CONVERTED_MIME[format], 0.92));
        if (!converted) throw new Error("图片格式转换失败");
        const objectUrl = URL.createObjectURL(converted);
        try {
            startBrowserDownload(objectUrl, withFileExtension(fileName, CONVERTED_EXTENSION[format]));
        } finally {
            setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
        }
    } finally {
        releaseSource?.();
    }
}
