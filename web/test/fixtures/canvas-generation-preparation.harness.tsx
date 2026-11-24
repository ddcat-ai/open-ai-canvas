import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { Dispatch, SetStateAction } from "react";
import type { CanvasNodeData } from "../../src/types/canvas";

const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
Object.defineProperty(globalThis, "document", { configurable: true, value: dom.document });
Object.defineProperty(globalThis, "navigator", { configurable: true, value: dom.navigator });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const errors: string[] = [];
mock.module("antd", () => ({ App: { useApp: () => ({ message: { error: (value: string) => errors.push(value), info: () => {} }, modal: { confirm: ({ onCancel }: { onCancel: () => void }) => onCancel() } }) } }));
const executions: string[] = [];
mock.module("../../src/pages/canvas/canvas-image-generation-executor", () => ({
    executeImageGeneration: async () => {
        executions.push("image");
    },
}));
mock.module("../../src/pages/canvas/canvas-media-generation-executors", () => ({ executeVideoGeneration: async () => {}, executeAudioGeneration: async () => {} }));
mock.module("../../src/pages/canvas/canvas-text-generation-executor", () => ({ executeTextGeneration: async () => {} }));

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { useCanvasGenerationExecutor } = await import("../../src/pages/canvas/use-canvas-generation-executor");
const { createModelChannel, defaultConfig, useConfigStore } = await import("../../src/stores/use-config-store");
const { defaultModelCapabilityConfig } = await import("../../src/lib/model-capabilities");
const { isCanvasNodeGenerating } = await import("../../src/lib/canvas/canvas-node-task-state");
const { CanvasNodeType } = await import("../../src/types/canvas");

afterAll(() => dom.happyDOM.abort());

test.each([
    { name: "参考图数量不兼容", invalidSelection: false, error: "最多支持 0 张参考图", starts: 2 },
    { name: "已选渠道失效", invalidSelection: true, error: "节点选择的模型或渠道已不可用", starts: 0 },
])("$name 时保留失败原因并允许再次提交", async ({ invalidSelection, error, starts: expectedStarts }) => {
    errors.length = 0;
    const capabilityConfig = defaultModelCapabilityConfig();
    capabilityConfig.image!.references.maxImages = 0;
    const channel = createModelChannel({
        id: "test",
        models: ["image"],
        baseUrl: "/api/test",
        apiKey: "synthetic-test-key",
        interfaceType: "openai-image",
        modelCosts: [{ model: "image", capability: "image", capabilityConfig, billingMode: "fixed_request", unitPriceMicrocredits: 1 }],
    });
    useConfigStore.setState({ config: { ...defaultConfig, model: "test::image", imageModel: "test::image", channels: [channel] } });
    const reference: CanvasNodeData = { id: "reference", type: CanvasNodeType.Image, title: "参考图", position: { x: 0, y: 0 }, width: 300, height: 300, metadata: { content: "data:image/png;base64,AA==", status: "success" } };
    const target: CanvasNodeData = { ...reference, id: "target", metadata: { prompt: "添加标题", status: "idle" } };
    if (invalidSelection)
        target.metadata!.generationSpec = { version: 1, mode: "image", prompt: "添加标题", modelSelection: { kind: "channel", channelId: "missing", modelKey: "image" }, options: {}, referenceBindings: [], textInputMode: "append-sources" };
    const nodesRef = { current: [reference, target] };
    const setNodes: Dispatch<SetStateAction<CanvasNodeData[]>> = (next) => {
        nodesRef.current = typeof next === "function" ? next(nodesRef.current) : next;
    };
    let running: string | null = null;
    const starts: AbortController[] = [];
    const finishes: AbortController[] = [];
    let generate!: ReturnType<typeof useCanvasGenerationExecutor>;
    const noop = () => {};
    function Harness() {
        generate = useCanvasGenerationExecutor({
            projectId: "canvas",
            addedSkills: [],
            assets: [],
            nodesRef,
            connectionsRef: { current: [{ id: "link", fromNodeId: "reference", toNodeId: "target" }] },
            setNodes,
            setConnections: noop,
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setDialogNodeId: noop,
            setRunningNodeId: (next) => {
                running = typeof next === "function" ? next(running) : next;
            },
            startGenerationRequest: () => {
                const controller = new AbortController();
                starts.push(controller);
                return controller;
            },
            finishGenerationRequest: (_id, controller) => {
                finishes.push(controller);
            },
            bindGenerationTask: noop,
            applyGenerationTaskResult: async () => {},
        });
        return null;
    }
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
        await act(async () => root.render(<Harness />));
        for (let attempt = 0; attempt < 2; attempt++) {
            await act(async () => {
                await generate("target", "image", "添加标题");
            });
            const failed = nodesRef.current.find((node) => node.id === "target")!;
            expect(failed.metadata?.status).toBe("error");
            expect(failed.metadata?.errorDetails).toContain(error);
            expect(failed.metadata?.taskStage).toBeUndefined();
            expect(failed.metadata?.taskId).toBeUndefined();
            expect(isCanvasNodeGenerating(failed)).toBe(false);
            expect(running).toBeNull();
        }
        expect(errors).toHaveLength(2);
        expect(starts).toHaveLength(expectedStarts);
        expect(finishes).toEqual(starts);
        expect(executions).toEqual([]);
    } finally {
        await act(async () => root.unmount());
    }
});
