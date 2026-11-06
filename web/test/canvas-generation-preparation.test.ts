import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

import { recoverCanvasPreparationWithoutTask } from "@/lib/canvas/canvas-task-state";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const preparing: CanvasNodeData = {
    id: "target",
    type: CanvasNodeType.Image,
    title: "图片",
    position: { x: 0, y: 0 },
    width: 300,
    height: 300,
    metadata: {
        status: "loading",
        taskStage: "正在准备参考素材",
        taskCreatedAt: "2026-11-06T12:00:00Z",
        taskProgress: 0,
        prompt: "添加标题",
        generationSpec: { version: 1, mode: "image", prompt: "添加标题", options: {}, referenceBindings: [], textInputMode: "append-sources" },
    },
};

describe("画布生成准备恢复", () => {
    test("完整查询确认没有任务后解除准备锁，保留提示词与生成设置", () => {
        const recovered = recoverCanvasPreparationWithoutTask(preparing, preparing.metadata?.taskCreatedAt, true);
        expect(recovered.metadata).toMatchObject({ status: "error", prompt: "添加标题", generationSpec: preparing.metadata?.generationSpec });
        expect(recovered.metadata?.errorDetails).toContain("任务准备已中断");
        expect(recovered.metadata?.taskStage).toBeUndefined();
        expect(recovered.metadata?.taskCreatedAt).toBeUndefined();
        expect(isCanvasNodeGenerating(recovered)).toBe(false);
        expect(preparing.metadata?.status).toBe("loading");
    });

    test("查询失败或任务列表截断时仍保留未知状态", () => {
        expect(recoverCanvasPreparationWithoutTask(preparing, preparing.metadata?.taskCreatedAt, false)).toBe(preparing);
    });

    test.each([
        { taskId: "created-task", taskStatus: "running" as const },
        { taskClientOperationId: "operation" },
        { taskStage: "正在准备生成任务" },
        { taskCreatedAt: "new-preparation" },
        { status: "success" as const, content: "existing-result" },
        { isBatchRoot: true },
    ])("不解锁已提交、已完成或新一轮生成的节点 %j", (patch) => {
        const live = { ...preparing, metadata: { ...preparing.metadata, ...patch } };
        expect(recoverCanvasPreparationWithoutTask(live, preparing.metadata?.taskCreatedAt, true)).toBe(live);
    });

    test("真实提交 hook 在参考图校验失败后退出生成中，并允许再次提交", () => {
        const result = Bun.spawnSync([process.execPath, "test", "./test/fixtures/canvas-generation-preparation.harness.tsx"], { cwd: resolve(import.meta.dir, ".."), timeout: 20000 });
        const output = new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr);
        expect(result.exitCode, output).toBe(0);
        expect(output).toContain("0 fail");
    });
});
