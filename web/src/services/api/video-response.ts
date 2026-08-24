import { t } from "@/i18n";
import axios from "axios";

import type { ApiEnvelope, ApiVideoResponse, RequestOptions, SeedanceTask, VideoGenerationResult } from "./video-contracts";

export function videoTaskId(payload: { id?: string; request_id?: string; task_id?: string }) {
    return payload.id || payload.request_id || payload.task_id || "";
}

export function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, t("domain:the-api-returned-no-video-task"));
}

export function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, t("domain:the-seedance-api-returned-no-task"));
}

export function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && typeof payload.code === "number") {
        if (payload.code !== 0) throw new Error(payload.msg || t("domain:request-failed"));
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

export function readAxiosError(error: unknown, fallback: string) {
    if (axios.isCancel(error)) return t("domain:request-cancelled-3");
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; code?: number }>(error)) {
        const responseData = error.response?.data;
        return responseData?.msg || responseData?.error?.message || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return t("domain:request-cancelled-3");
    return error instanceof Error ? error.message : fallback;
}

export function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return t("domain:authentication-failed-check-your-api-key-plan-permissions-or-model-acces");
    if (status === 429) return t("domain:rate-limited-or-out-of-quota-try-again-later");
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
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(payload.msg || t("domain:video-download-failed"));
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
        reader.onerror = () => reject(new Error(t("domain:failed-to-read-local-media")));
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
