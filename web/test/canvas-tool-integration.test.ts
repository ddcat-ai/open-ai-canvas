import { expect, test } from "bun:test";
import { applyToolMention, buildToolMentionReference, parseToolMentionTokens, removeToolMentions } from "../src/lib/canvas/canvas-resource-references";
import { createNineGridNode } from "../src/lib/canvas/canvas-image-source";
import { CanvasNodeType } from "../src/types/canvas";
import type { CanvasNodeData } from "../src/types/canvas";
import "../src/lib/canvas/node-registry/definitions/index";
import { writeCanvasNodePrompt } from "../src/lib/canvas/canvas-node-prompt";
import { canonicalGenerationMetadata } from "../src/lib/canvas/generation-contract";

for (const type of ["style", "nine_grid"]) {
    test(`${type} selection, replacement, removal and clearing persist across prompt panel reads`, () => {
        for (const content of [undefined, "/generated-image.png"]) {
            let node: CanvasNodeData = {
                id: "image",
                type: CanvasNodeType.Image,
                title: "图片",
                position: { x: 0, y: 0 },
                width: 320,
                height: 180,
                metadata: { content, prompt: "原始生成记录" },
            };
            const editAndRead = (prompt: string) => {
                node = writeCanvasNodePrompt(node, prompt);
                node = JSON.parse(JSON.stringify(node)) as CanvasNodeData;
                const metadata = canonicalGenerationMetadata(node, "image");
                expect(metadata.composerContent).toBe(prompt);
                expect(metadata.generationSpec?.prompt).toBe(prompt);
                if (content) expect(node.metadata?.prompt).toBe("原始生成记录");
                return metadata.composerContent!;
            };
            let prompt = editAndRead(applyToolMention("场景描述", { id: 1, type, label: "初始选择" }));
            prompt = editAndRead(applyToolMention(prompt, { id: 2, type, label: "替换选择" }));
            expect(parseToolMentionTokens(prompt).map((token) => token.toolId)).toEqual([2]);
            prompt = editAndRead(`${prompt}\n连续编辑`);
            prompt = editAndRead(removeToolMentions(prompt, type));
            expect(prompt).toBe("场景描述 \n连续编辑");
            expect(parseToolMentionTokens(prompt)).toEqual([]);
            editAndRead(applyToolMention(prompt, { id: 3, type, label: "再次选择" }));
            expect(parseToolMentionTokens(editAndRead(""))).toEqual([]);
            editAndRead("清空后的新内容");
        }
    });
}

test("tool labels round trip; style replaces, motion deduplicates; clear preserves prose", () => {
    const style = { id: 1, type: "style", label: "风格: [a] 中文" };
    const first = applyToolMention("第一行\n第二行", style);
    expect(parseToolMentionTokens(first)[0].label).toBe(style.label);
    const changed = applyToolMention(first, { ...style, id: 2 });
    expect(parseToolMentionTokens(changed).map((t) => t.toolId)).toEqual([2]);
    expect(removeToolMentions(changed, "style")).toBe("第一行\n第二行");
    const motion = { id: 46, type: "motion", label: "推镜" };
    const combined = applyToolMention(changed, motion);
    expect(applyToolMention(combined, motion)).toBe(combined);
    expect(parseToolMentionTokens(combined)).toHaveLength(2);
});

test("tool references with the same numeric id remain distinct across types", () => {
    let prompt = applyToolMention("", { id: 7, type: "style", label: "水墨" }, "Palette");
    prompt = applyToolMention(prompt, { id: 7, type: "motion", label: "推镜" }, "Camera");
    expect(parseToolMentionTokens(prompt).map(({ type, toolId, label }) => ({ type, toolId, label }))).toEqual([
        { type: "style", toolId: 7, label: "水墨" },
        { type: "motion", toolId: 7, label: "推镜" },
    ]);
    expect(buildToolMentionReference(7, "水墨", "style", "Palette").id)
        .not.toBe(buildToolMentionReference(7, "推镜", "motion", "Camera").id);
});

test("nine grid creates idle child using stable source token, not an auto generation", () => {
    const child = createNineGridNode({ id: "source", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { content: "/image.png" } }, "child", 79, "九宫格", "nine_grid", "Grid3x3");
    expect(child.metadata?.prompt).toContain("@[node:source]");
    expect(parseToolMentionTokens(child.metadata?.prompt ?? "")[0].toolId).toBe(79);
    expect(child.metadata?.content).toBeFalsy();
});

test("node style overrides project style and removing it restores inheritance", async () => {
    const { resolveCanvasStyleExecution } = await import("../src/lib/canvas/canvas-style-execution");
    const { defaultConfig } = await import("../src/stores/use-config-store");
    const styleNode = { id: "style", type: CanvasNodeType.Config, title: "画风", position: { x: 0, y: 0 }, width: 300, height: 200, metadata: { workflowKind: "styleboard" as const, stylePresetId: "test", prompt: "project style" } };
    const prompt = applyToolMention("scene", { id: 1, type: "style", label: "custom" });
    expect(resolveCanvasStyleExecution([styleNode], undefined, prompt, defaultConfig, "image")).toBeNull();
    expect(resolveCanvasStyleExecution([styleNode], undefined, removeToolMentions(prompt, "style"), defaultConfig, "image")).not.toBeNull();
});
