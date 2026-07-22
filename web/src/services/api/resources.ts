import axios from "axios";

import { getActiveUserScope } from "@/lib/user-scope";
import type { BackendEnvelope } from "@/services/api/task-center";

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
    provider: "aliyun";
    region: string;
    endpoint: string;
    bucket: string;
    accessKeyId: string;
    hasAccessKeySecret: boolean;
    publicBaseUrl: string;
    pathPrefix: string;
    updatedAt?: string;
};

export type UserOSSSettingInput = Pick<UserOSSSetting, "enabled" | "provider" | "region" | "endpoint" | "bucket" | "accessKeyId" | "pathPrefix"> & {
    accessKeySecret?: string;
};

const apiBaseURL = import.meta.env.VITE_CANVAS_BACKEND_URL || "/api";
const api = axios.create({ baseURL: apiBaseURL, withCredentials: true });
const resourceCache = new Map<string, RemoteResource>();
const resourceRequests = new Map<string, Promise<RemoteResource>>();
const missingResourceIds = new Set<string>();

async function request<T>(promise: Promise<{ data: BackendEnvelope<T> }>) {
    const response = await promise;
    if (response.data.code !== 0) throw new Error(response.data.msg || "请求失败");
    return response.data.data;
}

export function resourceStorageKey(id: string) {
    return `resource:${id}`;
}

export function getUserOSSSetting() {
    return request<{ setting: UserOSSSetting }>(api.get("/settings/oss"));
}

export function updateUserOSSSetting(input: UserOSSSettingInput) {
    return request<{ setting: UserOSSSetting }>(api.patch("/settings/oss", input));
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

function resourceCacheKey(id: string) {
    return `${getActiveUserScope()}:${id}`;
}

export function resourceFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file?direct=1`;
}

function resourceProxyFileUrl(id: string) {
    const base = String(apiBaseURL).replace(/\/+$/, "");
    return `${base}/resources/${encodeURIComponent(id)}/file`;
}

export async function resolveResourceUrl(storageKey?: string, fallback = "") {
    const id = resourceIdFromStorageKey(storageKey);
    if (!id) return fallback;
    const resource = await getResource(id).catch(() => null);
    return resource ? resource.publicUrl || resourceFileUrl(id) : fallback;
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
