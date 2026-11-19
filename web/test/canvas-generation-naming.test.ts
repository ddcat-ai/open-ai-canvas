import { afterEach, expect, mock, spyOn, test } from "bun:test";

import { buildNodeGenerationContext } from "@/components/canvas/canvas-node-generation";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { commitCanvasGenerationResult } from "@/lib/canvas/canvas-generation-result";
import { canvasNodeToAsset } from "@/lib/canvas/canvas-node-asset";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { executeImageGeneration } from "@/pages/canvas/canvas-image-generation-executor";
import { executeAudioGeneration, executeVideoGeneration } from "@/pages/canvas/canvas-media-generation-executors";
import * as generation from "@/services/api/generation-task";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

afterEach(() => mock.restore());

const executors = { image: executeImageGeneration, video: executeVideoGeneration, audio: executeAudioGeneration };
const noop = () => {};

async function generate(mode: keyof typeof executors, source: CanvasNodeData, prompt: string, live = source, count = 1) {
    const nodes = { current: [live] };
    const controller = new AbortController();
    const submittedTitles: string[] = [];
    spyOn(generation, "runBackendGenerationTask").mockImplementation(async (request) => {
        submittedTitles.push(String(request.metadata?.assetTitle));
        request.onTaskUpdate?.({ id: `task-${request.metadata?.nodeId}`, type: `canvas_${mode}`, status: "succeeded", prompt: request.prompt, createdAt: "", updatedAt: "", attempts: 1 });
        return {};
    });
    await executors[mode]({
        projectId: "",
        nodeId: source.id,
        sourceNode: source,
        canvasNodes: nodes.current,
        canvasConnections: [],
        prompt,
        effectivePrompt: prompt,
        generationConfig: { ...defaultConfig, count: String(count) },
        generationContext: buildNodeGenerationContext(source.id, nodes.current, [], prompt, []),
        controller,
        editingTextNode: false,
        styleMetadata: {},
        skillMetadata: {},
        setNodes: createCanvasStateWriter(nodes, noop),
        setConnections: noop,
        setSelectedNodeIds: noop,
        setSelectedConnectionId: noop,
        setDialogNodeId: noop,
        startGenerationRequest: () => controller,
        finishGenerationRequest: noop,
        bindGenerationTask: noop,
        applyGenerationTaskResult: async () => {},
        registerPendingNodeIds: noop,
        showError: (message) => {
            throw new Error(message);
        },
    });
    return { nodes: nodes.current, submittedTitles };
}

for (const mode of [CanvasNodeType.Image, CanvasNodeType.Video, CanvasNodeType.Audio] as const) {
    const prompt = "从远景推进到车站月台";
    test(`${mode} 已命名的空节点经提示词编辑、生成、入库和重试后保留名称`, async () => {
        const source = writeCanvasNodePrompt({ ...createCanvasNode(mode, { x: 0, y: 0 }), title: "月台初遇" }, prompt);
        const {
            nodes: [result],
            submittedTitles,
        } = await generate(mode, source, prompt);
        expect(submittedTitles).toEqual(["月台初遇"]);
        expect(result).toMatchObject({ id: source.id, title: "月台初遇", metadata: { manualTitle: true } });
        const asset = canvasNodeToAsset({ ...result, metadata: { ...result.metadata, storageKey: "resource:sample" } }, { canvasId: "canvas", source: "canvas-generation" });
        expect(asset?.title).toBe("月台初遇");

        const retry = writeCanvasNodePrompt({ ...result, metadata: { ...result.metadata, status: "error" } }, "切换到人物特写");
        expect((await generate(mode, retry, "切换到人物特写")).submittedTitles).toEqual(["月台初遇"]);
    });

    test(`${mode} 在准备参考素材时改名，以提交时的名称为准`, async () => {
        const source = writeCanvasNodePrompt(createCanvasNode(mode, { x: 0, y: 0 }), prompt);
        const renamed = { ...source, title: "站台背影", metadata: { ...source.metadata, manualTitle: true } };
        const { nodes, submittedTitles } = await generate(mode, source, prompt, renamed);
        expect(nodes[0]).toMatchObject({ title: renamed.title, metadata: { manualTitle: true } });
        expect(submittedTitles).toEqual([renamed.title]);
    });

    test(`${mode} 默认名的节点首次生成与重试分别采用各自的提示词`, async () => {
        const source = writeCanvasNodePrompt(createCanvasNode(mode, { x: 0, y: 0 }), prompt);
        const first = await generate(mode, source, prompt);
        expect(first.submittedTitles).toEqual([prompt]);
        const retry = writeCanvasNodePrompt({ ...first.nodes[0], metadata: { ...first.nodes[0].metadata, status: "error" } }, "灯光渐暗");
        expect((await generate(mode, retry, "灯光渐暗")).submittedTitles).toEqual(["灯光渐暗"]);
    });
}

test("同批子图按手动命名编号，迟到的任务结果保留节点与子图的改名", async () => {
    const source = writeCanvasNodePrompt({ ...createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }), title: "月台初遇" }, "侧光");
    const {
        nodes: [root, child, sibling],
        submittedTitles,
    } = await generate("image", source, "侧光", source, 2);
    expect(submittedTitles).toEqual(["月台初遇 · 1", "月台初遇 · 2"]);
    const childAsset = canvasNodeToAsset({ ...child, metadata: { ...child.metadata, storageKey: "resource:sample" } }, { canvasId: "canvas", source: "canvas-generation" });
    expect(childAsset?.title).toBe("月台初遇 · 1");
    const renamedChild = { ...child, title: "备选镜头", metadata: { ...child.metadata, manualTitle: true } };
    const committed = commitCanvasGenerationResult([root, renamedChild, sibling], root, { ...root, title: "侧光", metadata: { ...root.metadata, manualTitle: false } }, "task", [child]);
    expect(committed[0]).toMatchObject({ title: root.title, metadata: { manualTitle: true } });
    expect(committed[1]).toMatchObject({ title: renamedChild.title, metadata: { manualTitle: true } });
});
