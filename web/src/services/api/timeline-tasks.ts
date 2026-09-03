import { apiClient, request } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";
import type { TimelineProject } from "@/types/timeline";

// 时间线字幕转写任务（M4.1，whisper.cpp 本地执行）。
// 创建入参与后端 TimelineTranscriptionCreateRequest 契约一致。

export type TimelineTranscriptionCreateRequest = {
    resourceId: string;
    language?: string;
    projectId?: string;
};

export type TimelineTranscriptionResult = {
    segments: TimelineTranscriptionSegment[];
    srt?: string;
    language?: string;
};

export type TimelineTranscriptionSegment = {
    startMs: number;
    endMs: number;
    text: string;
};

export async function createTimelineTranscriptionTask(
    payload: TimelineTranscriptionCreateRequest,
    signal?: AbortSignal,
): Promise<GenerationTask> {
    return request<GenerationTask>(
        apiClient.post("/timeline/transcriptions", payload, { signal }),
    );
}

// 时间线成片渲染任务（M4.2，后端 ffmpeg 合成）。
// 创建入参与后端 TimelineRenderCreateRequest 契约一致；timeline 直接传
// TimelineProject v2（后端 renderProject 与其字段同名同构，多余字段被忽略）。
// 任务完成后轮询 status，ResultJSON = TimelineRenderResult。

export type TimelineRenderCreateRequest = {
    projectId: string;
    timeline: TimelineProject;
};

export type TimelineRenderResult = {
    resourceId: string;
    fileName?: string;
    size?: number;
    durationMs?: number;
    subtitleSrt?: string;
};

export async function createTimelineRenderTask(
    payload: TimelineRenderCreateRequest,
    signal?: AbortSignal,
): Promise<GenerationTask> {
    return request<GenerationTask>(
        apiClient.post("/timeline/renders", payload, { signal }),
    );
}
