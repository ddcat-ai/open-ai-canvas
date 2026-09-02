import { apiClient, request } from "@/services/api/request";
import type { GenerationTask } from "@/services/api/task-center";

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
