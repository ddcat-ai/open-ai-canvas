import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { createVideoGenerationTask } from "../src/services/api/video";
import { agnesPollUrl, createAgnesVideoTask, pollAgnesVideoTask } from "../src/services/api/video-provider-agnes";
import type { VideoProviderDeps } from "../src/services/api/video-provider-deps";
import { videoResponseTools } from "../src/services/api/video-response";
import { buildApiUrl, createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, type AiConfig } from "../src/stores/use-config-store";

const originalAxiosPost = axios.post;

afterEach(() => {
    axios.post = originalAxiosPost;
});

function configForAgnes(model = "agnes-video-2.5", input: Partial<AiConfig> = {}) {
    const capabilityConfig = defaultModelCapabilityConfig("agnes-video", model);
    const channel = createModelChannel({
        id: "agnes",
        name: "Agnes",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        interfaceType: "agnes-video",
        models: [model],
        modelCosts: [{ model, capability: "video", protocol: "agnes-video", billingMode: "per_second", unitPriceMicrocredits: 1, capabilityConfig }],
    });
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            ...input,
            channels: [channel],
            model: `agnes::${model}`,
            videoModel: `agnes::${model}`,
            videoSeconds: input.videoSeconds || "5",
            size: input.size || "16:9",
            vquality: input.vquality || "720",
        },
    }).config;
}

function providerDeps(config: ReturnType<typeof resolveModelRequestConfig>, input?: { created?: unknown; polled?: unknown }) {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const deps = {
        transport: {
            apiUrl: (path: string) => buildApiUrl(config.baseUrl, path),
            post: async (url: string, body: unknown) => {
                calls.push({ method: "POST", url, body });
                return input?.created || { video_id: "video-1", status: "queued" };
            },
            postForm: async () => {
                throw new Error("Agnes must not use multipart");
            },
            get: async (url: string) => {
                calls.push({ method: "GET", url });
                return input?.polled || { video_id: "video-1", status: "in_progress" };
            },
        },
        response: {
            ...videoResponseTools,
            videoResultFromUrl: async (url: string) => ({ url, mimeType: "video/mp4" }),
        },
    } as unknown as VideoProviderDeps;
    return { calls, deps };
}

describe("Agnes Video 2.5 request contract", () => {
    test("video.ts dispatches Agnes through JSON instead of OpenAI multipart", async () => {
        let requestBody: unknown;
        let requestHeaders: Record<string, string> = {};
        axios.post = (async (_url: string, body: unknown, options?: { headers?: Record<string, string> }) => {
            requestBody = body;
            requestHeaders = options?.headers || {};
            return { data: { id: "task-1", video_id: "video-1", status: "queued" } };
        }) as typeof axios.post;

        const task = await createVideoGenerationTask(
            configForAgnes("agnes-video-2.5", { size: "1280x720" }),
            "自我介绍图片1",
            [{ id: "image-1", name: "reference.png", type: "image/png", dataUrl: "", url: "https://cdn.example.com/reference.png" }],
        );

        expect(task).toEqual({ id: "video-1", provider: "agnes", model: "agnes::agnes-video-2.5" });
        expect(requestBody).not.toBeInstanceOf(FormData);
        expect(requestHeaders["content-type"]).toBe("application/json");
        expect(requestBody).toEqual({
            model: "agnes-video-2.5",
            prompt: "自我介绍图片1",
            mode: "keyframe",
            seconds: "5",
            size: "720P",
            aspect_ratio: "16:9",
            n: 1,
            first_frame: "https://cdn.example.com/reference.png",
        });
        expect(requestBody as Record<string, unknown>).not.toHaveProperty("input_reference");
        expect(requestBody as Record<string, unknown>).not.toHaveProperty("resolution_name");
        expect(requestBody as Record<string, unknown>).not.toHaveProperty("preset");
    });

    test("maps multimodal references to official reference fields", async () => {
        const config = resolveModelRequestConfig(configForAgnes(), "agnes::agnes-video-2.5");
        const { calls, deps } = providerDeps(config);
        await createAgnesVideoTask(
            deps,
            config,
            "agnes::agnes-video-2.5",
            "参考素材生成",
            [
                { id: "image-1", name: "1.png", type: "image/png", dataUrl: "", url: "https://cdn.example.com/1.png" },
                { id: "image-2", name: "2.png", type: "image/png", dataUrl: "", url: "https://cdn.example.com/2.png" },
                { id: "image-3", name: "3.png", type: "image/png", dataUrl: "", url: "https://cdn.example.com/3.png" },
            ],
            [{ id: "video-1", name: "video.mp4", type: "video/mp4", url: "https://cdn.example.com/video.mp4" }],
            [{ id: "audio-1", name: "audio.mp3", type: "audio/mpeg", url: "https://cdn.example.com/audio.mp3" }],
        );

        expect(calls[0]?.body).toMatchObject({
            mode: "reference",
            images: ["https://cdn.example.com/1.png", "https://cdn.example.com/2.png", "https://cdn.example.com/3.png"],
            audios: ["https://cdn.example.com/audio.mp3"],
            videos: [{ url: "https://cdn.example.com/video.mp4" }],
        });
    });

    test("polls the Agnes host root and reads metadata.url", async () => {
        const config = resolveModelRequestConfig(configForAgnes(), "agnes::agnes-video-2.5");
        const { calls, deps } = providerDeps(config, { polled: { video_id: "video-1", status: "completed", metadata: { url: "https://cdn.example.com/result.mp4" } } });
        const state = await pollAgnesVideoTask(deps, config, { id: "video-1", provider: "agnes", model: "agnes::agnes-video-2.5" });

        expect(calls[0]?.url).toBe("https://apihub.agnes-ai.com/agnesapi?video_id=video-1&model_name=agnes-video-2.5");
        expect(state).toEqual({ status: "completed", result: { url: "https://cdn.example.com/result.mp4", mimeType: "video/mp4" } });
    });

    test("keeps system-channel polls inside the proxy while preserving the root path", () => {
        const config = { ...resolveModelRequestConfig(configForAgnes(), "agnes::agnes-video-2.5"), baseUrl: "/api/system-agnes" };
        expect(agnesPollUrl(config, "video/1", "agnes-video-2.5")).toBe("/api/system-agnes/agnesapi?video_id=video%2F1&model_name=agnes-video-2.5");
    });

    test("rejects unsupported duration, Flash inputs and local-only media", async () => {
        const longConfig = resolveModelRequestConfig(configForAgnes("agnes-video-2.5", { videoSeconds: "15" }), "agnes::agnes-video-2.5");
        await expect(createAgnesVideoTask(providerDeps(longConfig).deps, longConfig, "agnes::agnes-video-2.5", "test", [], [], [])).rejects.toThrow("4–12");

        const flashConfig = resolveModelRequestConfig(configForAgnes("agnes-video-2.5-flash", { vquality: "2K" }), "agnes::agnes-video-2.5-flash");
        await expect(createAgnesVideoTask(providerDeps(flashConfig).deps, flashConfig, "agnes::agnes-video-2.5-flash", "test", [], [], [])).rejects.toThrow("仅支持 720P");

        const config = resolveModelRequestConfig(configForAgnes(), "agnes::agnes-video-2.5");
        await expect(createAgnesVideoTask(providerDeps(config).deps, config, "agnes::agnes-video-2.5", "test", [{ id: "image-1", name: "local.png", type: "image/png", dataUrl: "data:image/png;base64,AAAA" }], [], [])).rejects.toThrow("需要公网 URL");
    });

    test("publishes Agnes-specific capability limits", () => {
        expect(defaultModelCapabilityConfig("agnes-video", "agnes-video-2.5").video).toMatchObject({
            duration: { selection: "range", min: 4, max: 12, default: 5 },
            resolutions: ["720P", "960P", "2K"],
            defaultResolution: "720P",
        });
        expect(defaultModelCapabilityConfig("agnes-video", "agnes-video-2.5-flash").video).toMatchObject({
            references: { maxImages: 5, maxVideos: 0 },
            resolutions: ["720P"],
        });
    });
});
