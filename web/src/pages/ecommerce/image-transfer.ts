import { getActiveUserScope } from "@/lib/user-scope";
import { importResourceFromUrl, refreshResource, resourceFileUrl, uploadResourceFile, type RemoteResource } from "@/services/api/resources";
import type { EcommerceReference, EcommerceReferenceRole } from "@/services/api/ecommerce";

export const COMMERCE_IMAGE_RESOURCE_DND_TYPE = "application/x-yingce-image-resource";
export const COMMERCE_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/avif,image/bmp";
const maxImageBytes = 30 * 1024 * 1024;
const imageMime = /^image\/(?:png|jpeg|webp|gif|avif|bmp)$/i;
const extensionMimes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp" };

export type CommerceImageTransfer = { files: File[]; resourceId?: string; name?: string; url?: string };

export function normalizeCommerceImageFile(file: File): File {
    const inferred = extensionMimes[file.name.toLowerCase().split(".").pop() || ""];
    const type = !file.type || file.type === "application/octet-stream" ? inferred : file.type;
    if (!type || !imageMime.test(type)) throw new Error(`“${file.name}”不是支持的图片，请使用 PNG、JPEG、WebP、GIF、AVIF 或 BMP`);
    if (!file.size || file.size > maxImageBytes) throw new Error(`“${file.name}”须为不超过 30 MB 的非空图片`);
    return file.type === type ? file : new File([file], file.name, { type, lastModified: file.lastModified });
}

function supportedImageUrl(value: string, baseUrl?: string) {
    if (!value.trim()) return "";
    try {
        const url = new URL(value, baseUrl);
        if (url.username || url.password) return "";
        if (["https:", "http:"].includes(url.protocol)) return url.href;
        if (url.protocol === "data:" && /^data:image\/(?:png|jpeg|webp|gif|avif|bmp);base64,/i.test(value)) return value;
        if (url.protocol === "blob:" && baseUrl && url.origin === new URL(baseUrl).origin) return url.href;
    } catch {
        /* A drop can contain text instead of an image address. */
    }
    return "";
}

export function readCommerceImageTransfer(transfer: DataTransfer, baseUrl = globalThis.location?.href): CommerceImageTransfer {
    const files = Array.from(transfer.files || []);
    for (const item of Array.from(transfer.items || [])) {
        if (item.kind !== "file") continue;
        const file = item.getAsFile();
        if (file && !files.some((existing) => existing === file || (existing.name === file.name && existing.size === file.size && existing.type === file.type && existing.lastModified === file.lastModified))) files.push(file);
    }
    // Read synchronously while the browser still exposes the drag/clipboard store.
    const internal = transfer.getData(COMMERCE_IMAGE_RESOURCE_DND_TYPE);
    if (internal) {
        try {
            const value = JSON.parse(internal) as { resourceId?: unknown; name?: unknown };
            if (typeof value.resourceId === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(value.resourceId)) return { files, resourceId: value.resourceId, name: typeof value.name === "string" ? value.name.slice(0, 200) : undefined };
        } catch {
            /* Fall back to the browser's ordinary image payload. */
        }
    }
    const html = transfer.getData("text/html");
    const htmlImage = html && typeof DOMParser !== "undefined" ? new DOMParser().parseFromString(html, "text/html").querySelector("img")?.getAttribute("src") : "";
    const uriList = transfer
        .getData("text/uri-list")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
    const candidates = [htmlImage, ...uriList, transfer.getData("text/plain").trim()].filter((value): value is string => Boolean(value));
    for (const candidate of candidates) {
        // Relative image paths only make sense for same-app drags; plain text is never a relative URL.
        if (!/^(?:https?:|data:|blob:|\/)/i.test(candidate)) continue;
        const url = supportedImageUrl(candidate, baseUrl);
        if (url) return { files, url };
    }
    return { files };
}

export function mightContainCommerceImage(transfer: DataTransfer) {
    return Array.from(transfer.types).some((type) => ["Files", COMMERCE_IMAGE_RESOURCE_DND_TYPE, "text/uri-list", "text/html"].includes(type));
}

export function writeCommerceImageTransfer(transfer: DataTransfer, source: { resourceId?: string; name: string; url: string }) {
    transfer.effectAllowed = "copy";
    if (source.resourceId) transfer.setData(COMMERCE_IMAGE_RESOURCE_DND_TYPE, JSON.stringify({ resourceId: source.resourceId, name: source.name }));
    const url = source.resourceId ? resourceFileUrl(source.resourceId) : source.url;
    const absolute = supportedImageUrl(url, globalThis.location?.href);
    if (absolute) {
        transfer.setData("text/uri-list", absolute);
        transfer.setData("text/plain", absolute);
    }
}

function requireImageResource(resource: RemoteResource) {
    if (resource.kind !== "image" || resource.status !== "ready" || !imageMime.test(resource.mimeType)) throw new Error("该内容不是可用的图片资源，请保存原图后上传");
    if (!resource.size || resource.size > maxImageBytes) throw new Error("图片须为不超过 30 MB 的非空图片");
    return resource;
}

function sameOriginResourceId(url: string) {
    const location = globalThis.location;
    if (!location) return "";
    try {
        const address = new URL(url, location.href);
        if (address.origin !== location.origin) return "";
        const match = address.pathname.match(/\/resources\/([a-zA-Z0-9_-]{1,200})\/file$/);
        return match?.[1] || "";
    } catch {
        return "";
    }
}

export async function importCommerceImageTransfer(
    source: CommerceImageTransfer,
    role: EcommerceReferenceRole = "primary",
    options: {
        existingResourceIds?: string[];
        maxReferences?: number;
        onProgress?: (message: string) => void;
    } = {},
): Promise<{ references: EcommerceReference[]; errors: string[] }> {
    const scope = getActiveUserScope();
    const assertScope = () => {
        if (scope !== getActiveUserScope()) throw new DOMException("图片导入已因账号切换取消", "AbortError");
    };
    const references: EcommerceReference[] = [];
    const errors: string[] = [];
    const seen = new Set(options.existingResourceIds || []);
    const capacity = Math.max(0, Math.min(24, options.maxReferences ?? 24));
    const add = (resource: RemoteResource, name: string) => {
        assertScope();
        requireImageResource(resource);
        if (seen.has(resource.id)) return;
        if (references.length >= capacity) throw new Error("参考图片已达上限，请先移除部分图片");
        seen.add(resource.id);
        references.push({ resourceId: resource.id, role, name, ...(resource.width && resource.height ? { width: resource.width, height: resource.height } : {}) });
    };
    const resourceId = source.resourceId || sameOriginResourceId(source.url || "");
    // Native image drags can include a File as well as our typed identity.
    // Reuse the owned original first; never re-upload its thumbnail/blob copy.
    if (source.files.length && !resourceId) {
        const files = source.files.filter((file, index, all) => all.findIndex((entry) => entry === file || (entry.name === file.name && entry.size === file.size && entry.type === file.type && entry.lastModified === file.lastModified)) === index);
        for (const [index, original] of files.entries()) {
            assertScope();
            if (references.length >= capacity) {
                errors.push("参考图片已达上限，剩余图片未上传");
                break;
            }
            try {
                const file = normalizeCommerceImageFile(original);
                options.onProgress?.(`正在上传 ${index + 1}/${files.length} · ${file.name}`);
                const resource = await uploadResourceFile(file, "image", { fileName: file.name }, (loaded, total) => options.onProgress?.(`正在上传 ${index + 1}/${files.length} · ${total ? Math.round((loaded / total) * 100) : 0}%`));
                add(resource, file.name);
            } catch (error) {
                assertScope();
                errors.push(error instanceof Error ? error.message : `“${original.name}”上传失败`);
            }
        }
        return { references, errors };
    }
    if (resourceId && seen.has(resourceId)) return { references, errors };
    if (capacity === 0) throw new Error("参考图片已达上限，请先移除部分图片");
    if (resourceId) {
        options.onProgress?.("正在读取站内图片…");
        // A typed drag payload is untrusted. Always check ownership and current status on the server.
        add(await refreshResource(resourceId), source.name || "生成结果参考图");
        return { references, errors };
    }
    const url = supportedImageUrl(source.url || "", globalThis.location?.href);
    if (!url) throw new Error("未读取到图片，请拖入图片文件，或复制图片后在这里粘贴");
    options.onProgress?.("正在导入网页图片…");
    if (/^(?:blob:|data:)/i.test(url)) {
        if (url.length > maxImageBytes * 1.4) throw new Error("图片超过 30 MB，请缩小后上传");
        const response = await fetch(url, { credentials: "omit", signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error("无法读取临时图片，请复制图片或保存原图后上传");
        const blob = await response.blob();
        assertScope();
        const file = normalizeCommerceImageFile(new File([blob], "网页图片", { type: blob.type }));
        add(await uploadResourceFile(file, "image", { fileName: "网页图片" }), "网页图片");
    } else {
        // The existing import endpoint performs URL, redirects, network and content validation.
        add(await importResourceFromUrl(url, "image"), "网页图片");
    }
    return { references, errors };
}
