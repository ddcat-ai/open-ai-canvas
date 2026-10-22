import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createVideoGenerationsTask } from "../src/services/api/video-provider-newapi";
import type { VideoProviderDeps } from "../src/services/api/video-provider-deps";
import { videoResponseTools } from "../src/services/api/video-response";
import { buildApiUrl, createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig } from "../src/stores/use-config-store";

function configForNewApiVideo(model: string, maxImages: number, maxVideos: number, maxAudios: number) {
    const capabilityConfig = defaultModelCapabilityConfig("newapi-channel-2", model);
    capabilityConfig.video!.references.maxImages = maxImages;
    capabilityConfig.video!.references.maxVideos = maxVideos;
    capabilityConfig.video!.references.maxAudios = maxAudios;
    const channel = createModelChannel({
        id: "newapi-video",
        name: "NewAPI Video Generations",
        baseUrl: "https://video.example.com/v1",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        interfaceType: "newapi-channel-2",
        models: [model],
        modelCosts: [{ model, capability: "video", protocol: "newapi-channel-2", billingMode: "per_second", unitPriceMicrocredits: 1, capabilityConfig }],
    });
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            channels: [channel],
            model: `newapi-video::${model}`,
            videoModel: `newapi-video::${model}`,
            videoSeconds: "5",
            size: "16:9",
            vquality: "720p",
        },
    }).config;
}

function providerDeps(config: ReturnType<typeof resolveModelRequestConfig>) {
    const calls: Array<{ url: string; body: unknown }> = [];
    const deps = {
        transport: {
            apiUrl: (path: string) => buildApiUrl(config.baseUrl, path),
            post: async (url: string, body: unknown) => {
                calls.push({ url, body });
                return { id: "video-1" };
            },
        },
        response: videoResponseTools,
    } as unknown as VideoProviderDeps;
    return { calls, deps };
}

describe("NewAPI Video Generations per-model reference limits", () => {
    test("accepts 40 images when the model capability allows 40", async () => {
        const aiConfig = configForNewApiVideo("seedance-2.5", 40, 10, 10);
        const requestConfig = resolveModelRequestConfig(aiConfig, aiConfig.model);
        const { calls, deps } = providerDeps(requestConfig);
        const images = Array.from({ length: 40 }, (_, index) => ({
            id: `image-${index}`,
            name: `${index}.png`,
            type: "image/png",
            dataUrl: "",
            url: `https://cdn.example.com/${index}.png`,
        }));
        const videos = Array.from({ length: 10 }, (_, index) => ({
            id: `video-${index}`,
            name: `${index}.mp4`,
            type: "video/mp4",
            url: `https://cdn.example.com/${index}.mp4`,
        }));
        const audios = Array.from({ length: 10 }, (_, index) => ({
            id: `audio-${index}`,
            name: `${index}.mp3`,
            type: "audio/mpeg",
            url: `https://cdn.example.com/${index}.mp3`,
        }));

        await createVideoGenerationsTask(deps, requestConfig, aiConfig.model, "multimodal references", images, videos, audios);

        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe("https://video.example.com/v1/video/generations");
        expect(calls[0]?.body).toMatchObject({
            image_urls: images.map((image) => image.url),
            video_urls: videos.map((video) => video.url),
            audio_urls: audios.map((audio) => audio.url),
        });
    });

    test("rejects the first image above the configured model limit", async () => {
        const aiConfig = configForNewApiVideo("seedance-2.5", 40, 10, 10);
        const requestConfig = resolveModelRequestConfig(aiConfig, aiConfig.model);
        const { calls, deps } = providerDeps(requestConfig);
        const images = Array.from({ length: 41 }, (_, index) => ({
            id: `image-${index}`,
            name: `${index}.png`,
            type: "image/png",
            dataUrl: "",
            url: `https://cdn.example.com/${index}.png`,
        }));

        await expect(createVideoGenerationsTask(deps, requestConfig, aiConfig.model, "too many images", images, [], [])).rejects.toThrow(
            "最多支持 40 张参考图、10 个参考视频和 10 个参考音频",
        );
        expect(calls).toHaveLength(0);
    });
});
