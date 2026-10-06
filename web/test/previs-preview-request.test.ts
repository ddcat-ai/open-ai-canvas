import { describe, expect, test } from "bun:test";

import { isPrevisPreviewRequestForWorkbench, previsPreviewRequestKey } from "../src/lib/canvas/previs/previs-preview";

describe("Agent 预演请求关联", () => {
    test("只接受当前画布、场景和活动镜头", () => {
        const request = { canvasId: "canvas-1", sceneId: "scene-1", shotId: "shot-1", previewRequestId: "call-1" };
        expect(isPrevisPreviewRequestForWorkbench({ request, canvasId: "canvas-1", sceneId: "scene-1", activeShotId: "shot-1" })).toBe(true);
        expect(isPrevisPreviewRequestForWorkbench({ request: { ...request, canvasId: "canvas-2" }, canvasId: "canvas-1", sceneId: "scene-1", activeShotId: "shot-1" })).toBe(false);
        expect(isPrevisPreviewRequestForWorkbench({ request: { ...request, sceneId: "scene-2" }, canvasId: "canvas-1", sceneId: "scene-1", activeShotId: "shot-1" })).toBe(false);
        expect(isPrevisPreviewRequestForWorkbench({ request: { ...request, shotId: "shot-2" }, canvasId: "canvas-1", sceneId: "scene-1", activeShotId: "shot-1" })).toBe(false);
    });

    test("配置了当前画布时拒绝缺少画布 ID 的旧事件", () => {
        expect(isPrevisPreviewRequestForWorkbench({ request: { sceneId: "scene-1", shotId: "shot-1" }, canvasId: "canvas-1", sceneId: "scene-1", activeShotId: "shot-1" })).toBe(false);
        expect(isPrevisPreviewRequestForWorkbench({ request: { sceneId: "scene-1", shotId: "shot-1" }, sceneId: "scene-1", activeShotId: "shot-1" })).toBe(true);
    });

    test("同一个后端请求 ID 产生稳定去重键", () => {
        expect(previsPreviewRequestKey({ canvasId: "canvas-1", sceneId: "scene-1", shotId: "shot-1", previewRequestId: "call-1" })).toBe("id:call-1");
        expect(previsPreviewRequestKey({ canvasId: "canvas-1", sceneId: "scene-1", shotId: "shot-1", duration: 5, fps: 24 })).toBe("fallback:canvas-1:scene-1:shot-1:5:24");
    });
});
