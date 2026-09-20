import assert from "node:assert/strict";
import test from "node:test";

import "./node-registry/definitions/index.ts";
// @ts-expect-error -- Node 原生 TypeScript 测试运行器需要保留扩展名。
import { canvasNodeHasCommittedContent, writeCanvasNodePrompt } from "./canvas-node-prompt.ts";
import { canonicalGenerationMetadata } from "./generation-contract";
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
        const metadata = writeCanvasNodePrompt(current, "下一版提示词").metadata;
        assert.equal(metadata?.content, `https://example.com/${type}`);
        assert.equal(metadata?.prompt, "已提交提示词");
        assert.equal(metadata?.composerContent, "下一版提示词");
        assert.equal(metadata?.status, "success");
        assert.equal(metadata?.generationSpec?.prompt, "下一版提示词");
    }
});

test("空媒体草稿同时初始化提交提示词和编辑提示词", () => {
    const current = node(CanvasNodeType.Video, { status: "idle" });

    assert.equal(canvasNodeHasCommittedContent(current), false);
    const metadata = writeCanvasNodePrompt(current, "第一版提示词").metadata;
    assert.equal(metadata?.status, "idle");
    assert.equal(metadata?.prompt, "第一版提示词");
    assert.equal(metadata?.composerContent, "第一版提示词");
    assert.equal(metadata?.generationSpec?.prompt, "第一版提示词");
});

test("模板提示词清空后重新读取和保存重载均保持为空", () => {
    for (const type of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio]) {
        for (const content of [undefined, `https://example.com/${type}`]) {
            const current = node(type, { content, prompt: "已提交提示词" });
            const applied = writeCanvasNodePrompt(current, "模板预设文字");
            const cleared = writeCanvasNodePrompt(applied, "");
            assert.equal(cleared.metadata?.composerContent, "");
            assert.equal(cleared.metadata?.generationSpec?.prompt, "");
            assert.equal(cleared.metadata?.prompt, content ? "已提交提示词" : "");
            const reloaded = JSON.parse(JSON.stringify(cleared)) as CanvasNodeData;
            assert.equal(canonicalGenerationMetadata(reloaded, type).composerContent, "");
        }
    }
});

test("已有生成合同的提示词支持连续编辑而不回填旧模板", () => {
    const applied = writeCanvasNodePrompt(node(CanvasNodeType.Image), "模板预设文字");
    const edited = writeCanvasNodePrompt(applied, "修改后的文字");
    assert.equal(edited.metadata?.generationSpec?.prompt, "修改后的文字");
    assert.equal(canonicalGenerationMetadata(edited, "image").composerContent, "修改后的文字");
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
