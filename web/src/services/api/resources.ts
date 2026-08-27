import { getActiveUserScope } from "@/lib/user-scope";
import axios from "axios";
import { apiBaseURL, apiClient, request, type BackendEnvelope } from "@/services/api/request";
import type { OSSConnectionTestInput, OSSConnectionTestResult, OSSProvider, S3Preset } from "@/lib/oss-settings";

export type RemoteResource = {
    id: string;
    userId: string;
    kind: "image" | "video" | "audio" | "file" | string;
    status: "pending" | "ready" | "failed" | "deleted" | string;
    provider: string;
    endpoint: string;
    bucket: string;
    objectKey: string;
    publicUrl: string;
    mimeType: string;
    size: number;
    width?: number;
    height?: number;
    durationMs?: number;
    etag?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
};

export type UserOSSSetting = {
    enabled: boolean;
    provider: OSSProvider;
    s3Preset: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    bucket: string;
    accessKeyId: string;
    hasAccessKeySecret: boolean;
    sessionToken?: string;
    hasSessionToken: boolean;
    pathStyle: boolean;
    allowUserS3: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    testedAt?: string;
    testedDigest?: string;
    historyCount?: number;
    referencedResourceCount?: number;
    updatedAt?: string;
};

export type UserOSSSettingInput = Pick<UserOSSSetting, "enabled" | "provider" | "s3Preset" | "region" | "endpoint" | "cdnBaseUrl" | "bucket" | "accessKeyId" | "pathPrefix" | "pathStyle"> & {
    accessKeySecret?: string;
    sessionToken?: string;
};

export type AccountFileStorageUsage = {
    usedBytes: number;
    totalBytes: number;
};

export type ArkPrivateAssetSync = {
    resourceId: string;
    status: "active" | string;
};

const api = apiClient;
const resourceCache = new Map<string, RemoteResource>();
const resourceRequests = new Map<string, Promise<RemoteResource>>();
const missingResourceIds = new Set<string>();

export function resourceStorageKey(id: string) {
    return `resource:${id}`;
}

export function getUserOSSSetting() {
    return request<{ setting: UserOSSSetting }>(api.get("/settings/oss"));
}

export function updateUserOSSSetting(input: UserOSSSettingInput) {
    return request<{ setting: UserOSSSetting }>(api.patch("/settings/oss", input));
}

export function testUserOSSConnection(input: OSSConnectionTestInput) {
    return request<OSSConnectionTestResult>(api.post("/settings/oss/test", input));
}

export async function getAccountFileStorageUsage() {
    const data = await request<{ usage: AccountFileStorageUsage }>(api.get("/resources/storage-usage"));
    return data.usage;
}

export async function syncResourceToArkPrivateAsset(id: string) {
    const data = await request<{ sync: ArkPrivateAssetSync }>(api.post(`/resources/${encodeURIComponent(id)}/ark-private-asset`));
    return data.sync;
}

export function resourceIdFromStorageKey(storageKey?: string) {
    return storageKey?.startsWith("resource:") ? storageKey.slice("resource:".length) : "";
}

export function isResourceUrl(url?: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    const path = url?.split(/[?#]/, 1)[0] || "";
    return path.startsWith(`${base}/resources/`) && path.endsWith("/file");
}

export async function uploadResourceFile(file: Blob, kind: "image" | "video" | "audio" | "file", meta?: { width?: number; height?: number; durationMs?: number; fileName?: string }) {
    const formData = new FormData();
    const name = meta?.fileName || (file instanceof File ? file.name : `${kind}.${extensionFromMime(file.type, kind)}`);
    formData.append("kind", kind);
    formData.append("file", file, name);
    if (meta?.width) formData.append("width", String(Math.round(meta.width)));
    if (meta?.height) formData.append("height", String(Math.round(meta.height)));
    if (meta?.durationMs) formData.append("durationMs", String(Math.round(meta.durationMs)));
    const data = await request<{ resource: RemoteResource }>(api.post("/resources", formData));
    resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
    return data.resource;
}

export async function importResourceFromUrl(url: string, kind: "image" | "video" | "audio" | "file", meta?: { width?: number; height?: number; durationMs?: number }) {
    const data = await request<{ resource: RemoteResource }>(api.post("/resources/import", { url, kind, width: meta?.width, height: meta?.height, durationMs: meta?.durationMs }));
    resourceCache.set(resourceCacheKey(data.resource.id), data.resource);
    return data.resource;
}

export function getResource(id: string): Promise<RemoteResource> {
    const cacheKey = resourceCacheKey(id);
    const cached = resourceCache.get(cacheKey);
    if (cached) return Promise.resolve(cached);
    if (missingResourceIds.has(cacheKey)) return Promise.reject(new Error("资源不存在或已被删除"));
    const pending = resourceRequests.get(cacheKey);
    if (pending) return pending;
    const task = request<{ resource: RemoteResource }>(api.get(`/resources/${encodeURIComponent(id)}`))
        .then((data) => {
            resourceCache.set(cacheKey, data.resource);
            return data.resource;
        })
        .catch((error) => {
            if (axios.isAxiosError(error) && error.response?.status === 404) missingResourceIds.add(cacheKey);
            throw error;
        })
        .finally(() => resourceRequests.delete(cacheKey));
    resourceRequests.set(cacheKey, task);
    return task;
}

export async function getResourceOSSUrl(storageKey?: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) throw new Error("当前媒体尚未上传到后端资源存储");
    try {
        const data = await request<{ url: string }>(api.get(`/resources/${encodeURIComponent(id)}/oss-url`));
        if (!data.url) throw new Error("后端未返回对象存储地址");
        return data.url;
    } catch (error) {
        if (axios.isAxiosError<BackendEnvelope<unknown>>(error)) throw new Error(error.response?.data.msg || error.message || "获取对象存储地址失败");
        throw error;
    }
}

function resourceCacheKey(id: string) {
    return `${getActiveUserScope()}:${id}`;
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file`;
}

function resourceProxyFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?proxy=1`;
}

export function resolveResourceUrl(storageKey?: string, fallback = "") {
    const id = resourceIdFromStorageKey(storageKey);
    // 资源引用本身已经包含稳定 ID；恢复/展示阶段不需要再查一遍元数据。
    // 需要 publicUrl、mime 或尺寸时必须显式调用 getResource，避免隐式 N+1。
    return id ? resourceFileUrl(id) : fallback;
}

export async function getResourceBlob(storageKey: string) {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return null;
    const url = resourceProxyFileUrl(id);
    const response = await fetch(url, { credentials: isResourceUrl(url) ? "include" : "same-origin" });
    if (!response.ok) return null;
    return response.blob();
}

function extensionFromMime(mimeType: string, kind: string) {
    if (mimeType.includes("png")) return "png";
    if (mimeType.includes("jpeg")) return "jpg";
    if (mimeType.includes("webp")) return "webp";
    if (mimeType.includes("gif")) return "gif";
    if (mimeType.includes("mp4")) return "mp4";
    if (mimeType.includes("webm")) return "webm";
    if (mimeType.includes("mpeg")) return "mp3";
    if (mimeType.includes("wav")) return "wav";
    return kind === "image" ? "png" : "bin";
}
