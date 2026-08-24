import { t } from "@/i18n";
import { imageToDataUrl } from "@/services/image-storage";
import { modelOptionName } from "@/stores/use-config-store";
import { isPublicMediaUrl } from "./video-validation";
import { normalizeSeedanceDuration } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

type NovitaVideoResult = { task?: { status?: string; reason?: string }; videos?: Array<{ video_url?: string }> };

export async function createNovitaVideoTask(
    deps: VideoProviderDeps,
    config: ResolvedAiConfig,
    model: string,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    options?: RequestOptions,
): Promise<VideoGenerationTask> {
    if (references.length > 1 || videoReferences.length || audioReferences.length) throw new Error(t("domain:novita-video-currently-supports-only-one-start-image-and-no-reference-vi"));
    const payload: Record<string, unknown> = {
        model: modelOptionName(model),
        prompt: prompt.trim(),
        duration: normalizeNovitaVideoDuration(config.videoSeconds),
    };
    if (references[0]) {
        payload.image = isPublicMediaUrl(references[0].url || "") ? references[0].url : await imageToDataUrl(references[0]);
    } else {
        payload.aspect_ratio = normalizeNovitaVideoRatio(config.size);
    }
    try {
        const created = await deps.transport.post<{ task_id?: string }>(novitaVideoUrl(config, "/video/create"), payload, options);
        if (!created.task_id) throw new Error(t("domain:the-novita-video-api-did-not-return-a-task-id"));
        return { id: created.task_id, provider: "novita", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, t("domain:novita-video-task-creation-failed")));
    }
}

export async function pollNovitaVideoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const result = await deps.transport.get<NovitaVideoResult>(novitaVideoUrl(config, `/async/task-result?task_id=${encodeURIComponent(task.id)}`), options);
        const status = result.task?.status || "";
        if (status === "TASK_STATUS_SUCCEED") {
            const url = result.videos?.[0]?.video_url || "";
            if (!url) return { status: "failed", error: t("domain:the-novita-video-task-finished-but-returned-no-video-url") };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (status === "TASK_STATUS_FAILED") return { status: "failed", error: result.task?.reason || t("domain:video-generation-failed") };
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, t("domain:novita-video-task-query-failed")));
    }
}

function novitaVideoUrl(config: ResolvedAiConfig, path: string) {
    return `${config.baseUrl.replace(/\/+$/, "")}${path}`;
}

function normalizeNovitaVideoDuration(value: string) {
    return normalizeSeedanceDuration(value) >= 8 ? "10" : "5";
}

function normalizeNovitaVideoRatio(value: string) {
    return value === "16:9" || value === "9:16" || value === "1:1" ? value : "16:9";
}
