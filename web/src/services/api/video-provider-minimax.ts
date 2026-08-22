import { getMediaBlob } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig } from "@/lib/seedance-video";
import { modelOptionName } from "@/stores/use-config-store";
import { isPublicMediaUrl } from "./video-validation";
import { blobToDataUrl } from "./video-response";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

import type { MiniMaxVideoCreateResponse, MiniMaxVideoTask, RequestOptions, ResolvedAiConfig, VideoGenerationTask, VideoGenerationTaskState } from "./video-contracts";
import type { VideoProviderDeps } from "./video-provider-deps";

export async function createMiniMaxVideoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const imageUrls = await Promise.all(references.slice(0, 9).map((image) => resolveMiniMaxImageUrl(image)));
    const videoUrls = await Promise.all(videoReferences.slice(0, 3).map((video) => resolveMiniMaxMediaUrl(video, "参考视频")));
    const audioUrls = await Promise.all(audioReferences.slice(0, 3).map((audio) => resolveMiniMaxMediaUrl(audio, "参考音频")));
    const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt.trim() }];
    imageUrls.forEach((url, index) => {
        // 首尾帧只允许成对出现；三张及以上图片统一作为多模态参考图，避免提交非法组合。
        const role = videoUrls.length || audioUrls.length || imageUrls.length > 2 ? "reference_image" : index === 0 ? "first_frame" : "last_frame";
        content.push({ type: "image_url", image_url: { url }, role });
    });
    videoUrls.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
    audioUrls.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    const frameMode = imageUrls.length > 0 && imageUrls.length <= 2 && videoUrls.length === 0 && audioUrls.length === 0;
    const payload = {
        model: modelOptionName(model),
        content,
        resolution: normalizeMiniMaxResolution(config.vquality),
        duration: normalizeMiniMaxDuration(config.videoSeconds),
        ratio: normalizeMiniMaxRatio(config.size, frameMode),
        aigc_watermark: boolConfig(config.videoWatermark, false),
    };
    try {
        const created = await deps.transport.post<MiniMaxVideoCreateResponse>(miniMaxVideoUrl(config, "/video_generation"), payload, options);
        const id = created.task_id || created.request_id || created.data?.task_id || created.data?.id || "";
        if (!id) throw new Error("MiniMax 视频接口没有返回任务 ID");
        return { id, provider: "minimax", model };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "MiniMax 视频任务创建失败"));
    }
}

export async function pollMiniMaxVideoTask(deps: VideoProviderDeps, config: ResolvedAiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const response = await deps.transport.get<{ task?: MiniMaxVideoTask }>(miniMaxVideoUrl(config, `/query/video_generation/${encodeURIComponent(task.id)}`), options);
        const state = response.task || {};
        const status = String(state.status || "").toLowerCase();
        if (status === "succeeded" || status === "completed") {
            const url = state.content?.url || "";
            if (!url) return { status: "failed", error: "MiniMax 视频任务已完成但没有返回视频地址" };
            return { status: "completed", result: await deps.response.videoResultFromUrl(url, options) };
        }
        if (status === "failed" || status === "cancelled") {
            const code = state.error?.code ? `${state.error.code}：` : "";
            return { status: "failed", error: `${code}${state.error?.message || "MiniMax 视频生成失败"}` };
        }
        return { status: "pending" };
    } catch (error) {
        throw new Error(deps.response.readAxiosError(error, "MiniMax 视频任务查询失败"));
    }
}

function miniMaxVideoUrl(config: ResolvedAiConfig, path: string) {
    const base = config.baseUrl.replace(/\/+$/, "");
    return /\/v2$/i.test(base) ? `${base}${path}` : `${base}/v2${path}`;
}

function normalizeMiniMaxResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    return ["2k", "4k", "high", "1080", "1080p", "1440p", "2160p"].includes(normalized) ? "2K" : "768P";
}

function normalizeMiniMaxDuration(value: string) {
    const seconds = Math.floor(Number(value) || 5);
    return Math.max(4, Math.min(15, seconds));
}

function normalizeMiniMaxRatio(value: string, frameMode: boolean) {
    if (frameMode) return "adaptive";
    return ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"].includes(value) ? value : "16:9";
}

async function resolveMiniMaxImageUrl(image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("data:")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("MiniMax 参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveMiniMaxMediaUrl(media: ReferenceVideo | ReferenceAudio, label: string) {
    if (isPublicMediaUrl(media.url) || media.url?.startsWith("data:")) return media.url;
    let blob: Blob | null = null;
    if (media.storageKey) blob = await getMediaBlob(media.storageKey);
    if (!blob && media.url?.startsWith("blob:")) blob = await (await fetch(media.url)).blob();
    if (!blob) throw new Error(`MiniMax ${label}必须是公网 URL 或本地已保存素材`);
    return blobToDataUrl(blob);
}
