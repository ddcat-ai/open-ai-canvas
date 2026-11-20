import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";

import { buildGenerationTaskNodeResult } from "@/lib/canvas/canvas-generation-task-sync";
import { getActiveUserScope, setActiveUserScope } from "@/lib/user-scope";
import { apiClient } from "@/services/api/request";
import { clearResourceAccessCache } from "@/services/api/resources";
import type { GenerationTask } from "@/services/api/task-center";
import { applyCanvasGenerationTaskNodeEffect } from "@/services/canvas-generation-consumer";
import * as resourceCache from "@/services/resource-blob-cache";
import { useAssetStore, withAssetStorePersistenceSuppressed } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const originalAdapter = apiClient.defaults.adapter;
const originalAssets = useAssetStore.getState().assets;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
let cacheRead: ReturnType<typeof spyOn<typeof resourceCache, "getCachedResourceBlob">>;

const node: CanvasNodeData = { id: "video-node", title: "视频", type: CanvasNodeType.Video, position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { taskId: "video-task", status: "loading" } };
const task: GenerationTask = {
    id: "video-task",
    type: "canvas_video",
    status: "succeeded",
    prompt: "镜头",
    attempts: 1,
    createdAt: "",
    updatedAt: "",
    resultJson: JSON.stringify({ video: { dataUrl: "https://stale.invalid/video.mp4", storageKey: "resource:generated-video", width: 1920, height: 1080, bytes: 12345, durationMs: 5000, mimeType: "video/mp4" } }),
};

beforeEach(() => {
    clearResourceAccessCache();
    cacheRead = spyOn(resourceCache, "getCachedResourceBlob").mockRejectedValue(new DOMException("Download timed out", "TimeoutError"));
});

afterEach(() => {
    cacheRead.mockRestore();
    apiClient.defaults.adapter = originalAdapter;
    clearResourceAccessCache();
    withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: originalAssets }));
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else delete (globalThis as { window?: unknown }).window;
});

function playbackAdapter(onAccess?: () => void) {
    apiClient.defaults.adapter = async (config) => {
        expect(config.url).toBe("/resources/access");
        const requests = JSON.parse(config.data);
        expect(requests).toEqual([{ resourceId: "generated-video", purpose: "display", variant: "playback" }]);
        onAccess?.();
        return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ access: { url: "https://media.example.test/playback.mp4", delivery: "origin" } }] } } };
    };
}

describe("生成视频交付", () => {
    test("整段缓存超时不影响已持久化视频通过播放地址回填", async () => {
        playbackAdapter();
        const result = await buildGenerationTaskNodeResult(node, task);
        expect(result.metadata).toMatchObject({
            content: "https://media.example.test/playback.mp4",
            storageKey: "resource:generated-video",
            status: "success",
            taskStatus: "succeeded",
            bytes: 12345,
            durationMs: 5000,
            naturalWidth: 1920,
            naturalHeight: 1080,
        });
        expect(cacheRead).not.toHaveBeenCalled();
    });

    test("缺少字节数时保留未知值，不依赖整段下载补齐元数据", async () => {
        playbackAdapter();
        const result = await buildGenerationTaskNodeResult(node, { ...task, resultJson: JSON.stringify({ video: { storageKey: "resource:generated-video" } }) });
        expect(result.metadata).toMatchObject({ bytes: 0, mimeType: "video/mp4", status: "success" });
    });

    for (const message of ["资源不存在或已被删除", "无权访问资源"]) {
        test(`${message}时仍报告失败，不回退任务旧地址`, async () => {
            apiClient.defaults.adapter = async (config) => ({ config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { items: [{ error: { msg: message } }] } } });
            await expect(buildGenerationTaskNodeResult(node, task)).rejects.toThrow(message);
            expect(cacheRead).not.toHaveBeenCalled();
        });
    }

    test("播放地址解析期间取消后不提交画布或发布成功节点", async () => {
        const controller = new AbortController();
        playbackAdapter(() => controller.abort());
        withAssetStorePersistenceSuppressed(() =>
            useAssetStore.setState({
                assets: [
                    {
                        id: "generated-asset",
                        kind: "video",
                        title: "视频",
                        coverUrl: "",
                        tags: [],
                        createdAt: "",
                        updatedAt: "",
                        data: { url: "https://stale.invalid/video.mp4", storageKey: "resource:generated-video", width: 1920, height: 1080, bytes: 12345, mimeType: "video/mp4" },
                    },
                ],
            }),
        );
        let publications = 0;
        await expect(
            applyCanvasGenerationTaskNodeEffect({
                projectId: "canvas",
                nodeId: node.id,
                task,
                output: { outputIndex: 0, mediaType: "video", materializedAssetId: "generated-asset" },
                effectKey: "attach-node:video-task:video-node:0",
                signal: controller.signal,
                nodesRef: { current: [node] },
                setNodes: () => {
                    publications += 1;
                },
            }),
        ).rejects.toMatchObject({ name: "AbortError" });
        expect(publications).toBe(0);
    });

    test("播放地址解析期间切换账号会保留AbortError", async () => {
        const values = new Map<string, string>();
        Object.defineProperty(globalThis, "window", { configurable: true, value: { localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } } });
        setActiveUserScope("video-owner");
        playbackAdapter(() => setActiveUserScope("other-owner"));
        await expect(buildGenerationTaskNodeResult(node, task)).rejects.toMatchObject({ name: "AbortError" });
        expect(getActiveUserScope()).toBe("other-owner");
    });
});
