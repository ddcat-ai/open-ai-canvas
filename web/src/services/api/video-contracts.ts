import type { resolveModelRequestConfig } from "@/stores/use-config-store";

export type VideoResponse = {
    id?: string;
    request_id?: string;
    task_id?: string;
    status?: string;
    error?: { message?: string };
    video?: { url?: string };
    video_url?: string;
    result_url?: string;
};

export type MiniMaxVideoTask = {
    id?: string;
    status?: string;
    content?: { url?: string };
    error?: { code?: string | number; message?: string };
};

export type MiniMaxVideoCreateResponse = {
    task_id?: string;
    request_id?: string;
    data?: { task_id?: string; id?: string };
};

export type ApiVideoResponse = VideoResponse | { code?: number; data?: VideoResponse | null; msg?: string };
export type ResolvedAiConfig = ReturnType<typeof resolveModelRequestConfig>;

export type SeedanceTask = {
    id: string;
    task_id?: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    error_code?: string | null;
    video_url?: string | null;
    content?: { video_url?: string; last_frame_url?: string } | null;
};

export type ApiEnvelope<T> = T | { code?: number; data?: T | null; msg?: string };
export type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "video-generations" | "gemini-veo" | "novita" | "minimax"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };
