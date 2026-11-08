import { expect, test } from "bun:test";
import axios from "axios";
import { createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { createVideoGenerationTask, pollVideoGenerationTask } from "../src/services/api/video";
import { createMiniMaxVideoTask } from "../src/services/api/video-provider-minimax";
import type { VideoProviderDeps } from "../src/services/api/video-provider-deps";
import { videoResponseTools } from "../src/services/api/video-response";

test("Metaso Seedance client tests use the correct create and poll endpoints", async () => {
    const original = axios.defaults.adapter;
    try {
        const calls: { url: string; body: Record<string, unknown> }[] = [];
        axios.defaults.adapter = async (request) => {
            calls.push({ url: String(request.headers.get("X-Canvas-Upstream-URL") || request.url), body: request.data ? JSON.parse(request.data) : {} });
            return { data: request.method === "post" ? { task_id: "test-video" } : { task: { status: "pending" } }, status: 200, statusText: "OK", headers: {}, config: request };
        };
        for (const protocol of ["minimax-video", "metaso-h3"]) {
            for (const model of ["seedance-2.0-mini", "seedance-2.0"]) {
                calls.length = 0;
                const channel = createModelChannel({ id: "metaso-test", name: "Metaso", baseUrl: protocol === "metaso-h3" ? "https://metaso.cn" : "https://metaso.cn/api/minimax", apiKey: "synthetic", interfaceType: protocol, models: [model] });
                const config = { ...defaultConfig, channels: [channel], model, videoModel: model, videoSeconds: "4", vquality: "480p", size: "16:9", videoWatermark: "false" };
                const task = await createVideoGenerationTask(config, "a boat");
                expect(task.provider).toBe("minimax");
                expect(calls[0].url).toBe("https://metaso.cn/api/minimax/v2/video_generation");
                expect(calls[0].body).toMatchObject({ model, duration: 4, resolution: "480p", aigc_watermark: false });
                await expect(pollVideoGenerationTask(config, task)).resolves.toEqual({ status: "pending" });
                expect(calls[1].url).toBe("https://metaso.cn/api/minimax/v2/query/video_generation/test-video");
            }
        }
    } finally {
        axios.defaults.adapter = original;
    }
});

test("Metaso client rejects unsupported Seedance parameters before transport", async () => {
    let calls = 0;
    const deps = {
        transport: {
            post: async () => {
                calls += 1;
                return { task_id: "test" };
            },
        },
        response: videoResponseTools,
    } as unknown as VideoProviderDeps;
    for (const [seconds, resolution, watermark] of [
        ["16", "480p", "false"],
        ["4.5", "480p", "false"],
        ["4", "4k", "false"],
        ["4", "480p", "true"],
    ]) {
        const config = { ...defaultConfig, videoSeconds: seconds, vquality: resolution, videoWatermark: watermark };
        await expect(createMiniMaxVideoTask(deps, config as never, "seedance-2.0-mini", "a boat", [], [], [])).rejects.toThrow("Seedance");
    }
    expect(calls).toBe(0);
    for (const resolution of ["480p", "720p", "1080p", "4k"]) {
        let body: unknown;
        const capture = {
            ...deps,
            transport: {
                post: async (_url: string, payload: unknown) => {
                    body = payload;
                    return { task_id: "test" };
                },
            },
        } as unknown as VideoProviderDeps;
        await createMiniMaxVideoTask(capture, { ...defaultConfig, videoSeconds: "15", vquality: resolution, videoWatermark: "false" } as never, "seedance-2.0", "a boat", [], [], []);
        expect(body).toMatchObject({ resolution, duration: 15 });
    }
});
