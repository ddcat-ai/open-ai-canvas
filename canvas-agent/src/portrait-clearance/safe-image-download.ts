import dns from "node:dns/promises";

import sharp from "sharp";

import { decodePortraitImage, type DecodedPortraitImage } from "./image-metrics.js";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_REDIRECTS = 3;

export class PortraitCandidateDownloadError extends Error {
    constructor(readonly code: "portrait_candidate_download_blocked" | "portrait_candidate_invalid", message: string) {
        super(message);
        this.name = "PortraitCandidateDownloadError";
    }
}

export async function downloadPortraitCandidate(url: string, options: { signal?: AbortSignal; fetch?: typeof fetch } = {}) {
    const fetchImpl = options.fetch ?? fetch;
    let current = validatePublicUrl(url);
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
        try {
            await assertPublicImageHost(current);
        } catch (error) {
            if (error instanceof PortraitCandidateDownloadError) throw error;
            throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选来源无法通过网络安全校验");
        }
        const response = await fetchImpl(current, {
            method: "GET",
            redirect: "manual",
            signal: options.signal,
            headers: { accept: "image/jpeg,image/png,image/webp", "user-agent": "open-ai-canvas-portrait-clearance/1.0" },
        });
        if (response.status >= 300 && response.status < 400) {
            if (redirect === MAX_REDIRECTS) throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选图片重定向次数过多");
            const location = response.headers.get("location");
            if (!location) throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选图片重定向地址缺失");
            current = validatePublicUrl(new URL(location, current).toString());
            continue;
        }
        if (!response.ok || !response.body) throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选图片无法下载");
        const contentType = (response.headers.get("content-type") || "").split(";", 1)[0].toLowerCase();
        if (!(["image/jpeg", "image/png", "image/webp"] as string[]).includes(contentType)) throw new PortraitCandidateDownloadError("portrait_candidate_invalid", "候选响应不是受支持的图片类型");
        const declared = Number(response.headers.get("content-length"));
        if (Number.isFinite(declared) && (declared <= 0 || declared > MAX_IMAGE_BYTES)) throw new PortraitCandidateDownloadError("portrait_candidate_invalid", "候选图片超过大小限制");
        const bytes = await readBounded(response.body, MAX_IMAGE_BYTES, options.signal);
        let decoded: DecodedPortraitImage;
        try { decoded = await decodePortraitImage(bytes); } catch { throw new PortraitCandidateDownloadError("portrait_candidate_invalid", "候选图片无法解码"); }
        const metadata = await sharp(bytes).metadata();
        if (metadata.pages && metadata.pages > 1) throw new PortraitCandidateDownloadError("portrait_candidate_invalid", "不接受多帧候选图片");
        return { url: current, contentType: contentType as "image/jpeg" | "image/png" | "image/webp", bytes, decoded };
    }
    throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选图片下载失败");
}

export function validatePublicUrl(value: string) {
    let url: URL;
    try { url = new URL(value); } catch { throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选来源地址无效"); }
    if (!(["http:", "https:"] as string[]).includes(url.protocol) || url.username || url.password || url.port && !["80", "443"].includes(url.port)) throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选来源协议或地址不受支持");
    return url.toString();
}

async function readBounded(stream: ReadableStream<Uint8Array>, limit: number, signal?: AbortSignal) {
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            if (signal?.aborted) throw abortError();
            const item = await reader.read();
            if (item.done) break;
            total += item.value.byteLength;
            if (total > limit) throw new PortraitCandidateDownloadError("portrait_candidate_invalid", "候选图片超过大小限制");
            chunks.push(item.value);
        }
    } finally {
        await reader.cancel().catch(() => undefined);
    }
    const bytes = Buffer.allocUnsafe(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes;
}

async function isPublicAddress(hostname: string) {
    const records = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!records.length) return false;
    return records.every((record) => isPublicIp(record.address));
}

function isPublicIp(value: string) {
    if (value.includes(":")) {
        const normalized = value.toLowerCase();
        const mappedIpv4 = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
        if (mappedIpv4) return isPublicIp(mappedIpv4);
        return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("fe80:") && !normalized.startsWith("fc") && !normalized.startsWith("fd") && !normalized.startsWith("ff") && !normalized.startsWith("2001:db8:");
    }
    const parts = value.split(".").map(Number);
    if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
    const [a, b] = parts;
    return a !== 10 && a !== 127 && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31) && !(a === 192 && b === 168) && !(a === 100 && b >= 64 && b <= 127) && !(a === 198 && (b === 18 || b === 19)) && !(a === 0);
}

function abortError() {
    return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

// Keep the DNS guard in the same module as URL validation so future callers cannot
// accidentally add a redirect path that bypasses the private-network check.
export async function assertPublicImageHost(value: string) {
    const url = new URL(validatePublicUrl(value));
    if (url.hostname === "localhost" || !(await isPublicAddress(url.hostname))) throw new PortraitCandidateDownloadError("portrait_candidate_download_blocked", "候选来源解析到本机或私有网络地址");
    return url;
}
