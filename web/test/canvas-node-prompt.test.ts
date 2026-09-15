import assert from "node:assert/strict";
import test from "node:test";

import "./node-registry/definitions/index.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { canvasNodeHasCommittedContent, writeCanvasNodePrompt } from "./canvas-node-prompt.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { CanvasNodeType, type CanvasNodeData } from "../../types/canvas.ts";

function node(type: CanvasNodeData["type"], metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return {
        id: `${type}-node`,
        type,
        title: "测试节点",
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata,
    };
}

test("媒体节点已有结果时只更新下一版提示词草稿", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio]) {
        const current = node(type, {
            content: `https://example.com/${type}`,
            prompt: "已提交提示词",
            composerContent: "旧草稿",
            status: "success",
        });

        assert.equal(canvasNodeHasCommittedContent(current), true);
        assert.deepEqual(writeCanvasNodePrompt(current, "下一版提示词").metadata, {
            content: `https://example.com/${type}`,
            prompt: "已提交提示词",
            composerContent: "下一版提示词",
            status: "success",
        });
    }
});

test("空媒体草稿同时初始化提交提示词和编辑提示词", () => {
    const current = node(CanvasNodeType.Video, { status: "idle" });

    assert.equal(canvasNodeHasCommittedContent(current), false);
    assert.deepEqual(writeCanvasNodePrompt(current, "第一版提示词").metadata, {
        status: "idle",
        prompt: "第一版提示词",
        composerContent: "第一版提示词",
    });
});

test("图片仅保留 storageKey 时仍视为已有媒体结果", () => {
    const current = node(CanvasNodeType.Image, {
        storageKey: "canvas/image/result.png",
        prompt: "已提交提示词",
    });

    assert.equal(canvasNodeHasCommittedContent(current), true);
    assert.equal(writeCanvasNodePrompt(current, "新草稿").metadata?.prompt, "已提交提示词");
});

test("文本提示词本身不构成已提交内容", () => {
    const draft = node(CanvasNodeType.Text, { prompt: "文本草稿" });
    const committed = node(CanvasNodeType.Text, { content: "已生成文本", prompt: "已提交提示词" });

    assert.equal(canvasNodeHasCommittedContent(draft), false);
    assert.equal(canvasNodeHasCommittedContent(committed), true);
    assert.equal(writeCanvasNodePrompt(draft, "新文本草稿").metadata?.prompt, "新文本草稿");
    assert.equal(writeCanvasNodePrompt(committed, "下一版文本草稿").metadata?.prompt, "已提交提示词");
});

test("调用方可先清理失败任务元数据，再由统一写入器保存草稿", () => {
    const current = node(CanvasNodeType.Video, {
        content: "https://example.com/video.mp4",
        prompt: "已提交提示词",
        promptTemplateOperation: "storyboard-video",
        promptTemplateVariables: { shot: "1" },
        taskId: "failed-task",
    });
    const metadata = { ...current.metadata, taskId: undefined };

    const updated = writeCanvasNodePrompt(current, "修订草稿", {
        metadata,
        clearPromptTemplate: true,
    });

    assert.equal(updated.metadata?.prompt, "已提交提示词");
    assert.equal(updated.metadata?.composerContent, "修订草稿");
    assert.equal(updated.metadata?.taskId, undefined);
    assert.equal(updated.metadata?.promptTemplateOperation, undefined);
    assert.equal(updated.metadata?.promptTemplateVariables, undefined);
});
