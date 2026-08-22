import axios from "axios";

import type { ApiEnvelope, ApiVideoResponse, RequestOptions, SeedanceTask, VideoGenerationResult } from "./video-contracts";

export function videoTaskId(payload: { id?: string; request_id?: string; task_id?: string }) {
    return payload.id || payload.request_id || payload.task_id || "";
}

export function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

export function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

export function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

export function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? error.message : fallback;
}

export function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

export async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || "视频下载失败");
    if (payload.error?.message) throw new Error(payload.error.message);
}

export function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

export function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地素材失败"));
        reader.readAsDataURL(blob);
    });
}

export async function videoResultFromUrl(url: string, options?: RequestOptions): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: "video/mp4" };
    }
}

export type VideoResponseTools = {
    assertVideoBlob: typeof assertVideoBlob;
    blobToDataUrl: typeof blobToDataUrl;
    delay: typeof delay;
    readAxiosError: typeof readAxiosError;
    unwrapEnvelope: typeof unwrapEnvelope;
    unwrapEnvelopeRecord: typeof unwrapEnvelopeRecord;
    unwrapSeedanceTask: typeof unwrapSeedanceTask;
    unwrapVideoResponse: typeof unwrapVideoResponse;
    videoResultFromUrl: typeof videoResultFromUrl;
    videoTaskId: typeof videoTaskId;
};

function unwrapEnvelopeRecord(value: ApiEnvelope<Record<string, unknown>>): Record<string, unknown> {
    if (value && typeof value === "object" && "data" in value && value.data && typeof value.data === "object") return value.data as Record<string, unknown>;
    return value as Record<string, unknown>;
}

export const videoResponseTools: VideoResponseTools = {
    assertVideoBlob,
    blobToDataUrl,
    delay,
    readAxiosError,
    unwrapEnvelope,
    unwrapEnvelopeRecord,
    unwrapSeedanceTask,
    unwrapVideoResponse,
    videoResultFromUrl,
    videoTaskId,
};
