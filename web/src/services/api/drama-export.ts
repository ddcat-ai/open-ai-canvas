import { http } from "./request";

export type JianyingDraftOptions = { draftRoot: string; captions: boolean };
export type JianyingDraftPreview = {
    draftRoot: string;
    revision: string;
    totalSegments: number;
    availableSegments: number;
    missingSegments: number;
    staleSegments: number;
    durationMs: number;
    mediaBytes: number;
    captionCount: number;
    segments: Array<{ index: number; title: string; included: boolean; stale: boolean; reason?: string; durationMs: number; durationEstimated: boolean }>;
    warnings: string[];
};

export function previewDramaJianyingDraft(projectId: string, episodeId: string, options: JianyingDraftOptions, signal?: AbortSignal) {
    return http.post<JianyingDraftPreview>(`/dramas/${encodeURIComponent(projectId)}/episodes/${encodeURIComponent(episodeId)}/jianying-draft/preview`, options, { signal });
}
