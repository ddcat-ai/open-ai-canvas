import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CanvasBatchTableNodeContent } from "@/components/canvas/canvas-batch-table-node";
import { canvasThemes } from "@/lib/canvas-theme";
import { batchOutputResultPending, batchRowInputChanged, batchRowInputSignature } from "@/lib/canvas/canvas-batch-references";
import { prepareCanvasBatchTableGeneration } from "@/lib/canvas/canvas-batch-table-state";
import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { applyGeneratedMediaResultMetadata, generationTaskOutputsApplied, imageMetadata } from "@/lib/canvas/canvas-generation-task-sync";
import { isolateCopiedNodeMetadata } from "@/lib/canvas/canvas-node-copy";
import { generationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { canvasTaskBindingStatus } from "@/lib/canvas/canvas-task-state";
import { executeImageGeneration } from "@/pages/canvas/canvas-image-generation-executor";
import { defaultConfig } from "@/stores/use-config-store";
import { useAssetStore, withAssetStorePersistenceSuppressed, type ImageAsset } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasGenerationBatch, type CanvasNodeData } from "@/types/canvas";

const noop = () => {};
const initialAssets = useAssetStore.getState().assets;
afterEach(() => withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: initialAssets })));
const task = {
    id: "new-task",
    type: "canvas_image",
    status: "succeeded" as const,
    prompt: "new prompt",
    attempts: 1,
    createdAt: "",
    updatedAt: "",
    resultJson: JSON.stringify({ mode: "image", images: [{ dataUrl: "/new.png", storageKey: "resource:new" }] }),
};

function fixture() {
    const input: CanvasNodeData = { id: "input", title: "input", type: CanvasNodeType.Image, width: 200, height: 200, position: { x: 0, y: 0 }, metadata: { content: "/input.png", storageKey: "resource:input" } };
    const output: CanvasNodeData = { ...input, id: "result", position: { x: 1600, y: 0 }, metadata: { content: "/old.png", storageKey: "resource:old", assetId: "old-asset", previewContent: "/old-preview.png", status: "success", taskId: "old-task" } };
    const table: CanvasNodeData = {
        ...input,
        id: "table",
        type: CanvasNodeType.BatchTable,
        width: 1280,
        height: 560,
        metadata: { batchTable: { operation: "creative", concurrency: 1, rows: [{ id: "row", enabled: true, inputNodeIds: [input.id], prompt: "old prompt", outputNodeId: output.id }] } },
    };
    const nodes = [input, table, output];
    const data = table.metadata!.batchTable!;
    const row = data.rows[0];
    row.generatedInputSignature = batchRowInputSignature(data, row, new Map(nodes.map((node) => [node.id, node])));
    row.prompt = "new prompt";
    row.inputChanged = true;
    return { input, output, table, nodes };
}

function prepare(state: ReturnType<typeof fixture>, nodes = state.nodes) {
    const table = nodes.find((node) => node.id === state.table.id)!;
    return prepareCanvasBatchTableGeneration({ nodes, connections: [], sourceNodeId: table.id, rows: table.metadata!.batchTable!.rows, assets: [], config: defaultConfig, settings: defaultConfig });
}

function dirty(nodes: CanvasNodeData[]) {
    const table = nodes.find((node) => node.id === "table")!.metadata!.batchTable!;
    return batchRowInputChanged(table, table.rows[0], new Map(nodes.map((node) => [node.id, node])));
}

async function executeCandidate(candidate: ReturnType<typeof prepare>, outcome: "failed" | "success", onReceipt?: (nodes: CanvasNodeData[]) => void) {
    const nodesRef = { current: candidate.nodes };
    const connectionsRef = { current: candidate.connections };
    const target = candidate.targets[0];
    const controller = new AbortController();
    const started: string[] = [];
    const submitted: string[] = [];
    let duringRequest: CanvasNodeData[] = [];
    const setNodes = createCanvasStateWriter(nodesRef, noop);
    await executeImageGeneration(
        {
            nodeId: target.nodeId,
            sourceNode: nodesRef.current.find((node) => node.id === target.nodeId),
            canvasNodes: nodesRef.current,
            canvasConnections: connectionsRef.current,
            prompt: target.inputSnapshot.prompt,
            effectivePrompt: target.inputSnapshot.context.prompt,
            generationContext: target.inputSnapshot.context,
            generationConfig: { ...defaultConfig, model: defaultConfig.imageModel, count: "1" },
            controller,
            projectId: "",
            editingTextNode: false,
            styleMetadata: {},
            skillMetadata: {},
            setNodes,
            setConnections: createCanvasStateWriter(connectionsRef, noop),
            setSelectedNodeIds: noop,
            setSelectedConnectionId: noop,
            setDialogNodeId: noop,
            startGenerationRequest: (id) => {
                started.push(id);
                return controller;
            },
            finishGenerationRequest: noop,
            registerPendingNodeIds: noop,
            showError: noop,
            bindGenerationTask: (id, completed) => setNodes((current) => current.map((node) => (node.id === id ? { ...node, metadata: { ...node.metadata, ...generationTaskMetadata(completed), status: canvasTaskBindingStatus(node, completed) } } : node))),
            applyGenerationTaskResult: async (id) => {
                setNodes((current) =>
                    current.map((node) =>
                        node.id === id
                            ? { ...node, metadata: applyGeneratedMediaResultMetadata(node, imageMetadata({ url: "/new.png", storageKey: "resource:new", width: 300, height: 200, mimeType: "image/png", bytes: 1 }), { generationOutputCount: 1 }) }
                            : node,
                    ),
                );
            },
        },
        async (options) => {
            submitted.push(options.nodeId || "");
            duringRequest = nodesRef.current;
            if (outcome === "failed") throw new Error("isolated generation failed");
            options.onTaskCreated?.(task);
            onReceipt?.(nodesRef.current);
            return { mode: "image", images: [{ dataUrl: "/new.png", storageKey: "resource:new" }] };
        },
    );
    return { nodes: nodesRef.current, started, submitted, duringRequest };
}

describe("batch regeneration result ownership", () => {
    test("waiting and failed regeneration keep the old image, dirty marker and same target ID", async () => {
        const state = fixture();
        const candidate = prepare(state);
        expect(dirty(candidate.nodes)).toBe(true);
        const result = await executeCandidate(candidate, "failed");
        expect(result.started).toEqual([state.output.id]);
        expect(result.submitted).toEqual([state.output.id]);
        expect(result.nodes).toHaveLength(state.nodes.length);
        expect(result.duringRequest.find((node) => node.id === state.output.id)!.metadata).toMatchObject({ content: "/old.png", storageKey: "resource:old", status: "loading" });
        expect(result.nodes.find((node) => node.id === state.output.id)!.metadata).toMatchObject({ content: "/old.png", storageKey: "resource:old", assetId: "old-asset", status: "error" });
        expect(result.nodes.find((node) => node.id === state.table.id)!.metadata!.batchTable!.rows[0].outputNodeId).toBe(state.output.id);
        expect(dirty(result.nodes)).toBe(true);
    });

    test("provider success does not clear dirty until media is consumed; the next failed attempt retains that successful signature", async () => {
        const state = fixture();
        const candidate = prepare(state);
        let receipts = 0;
        const result = await executeCandidate(candidate, "success", (nodes) => {
            receipts += 1;
            const output = nodes.find((node) => node.id === state.output.id)!;
            expect(output.metadata!.content).toBe("/old.png");
            expect(output.metadata!.status).toBe("loading");
            expect(batchOutputResultPending(output.metadata)).toBe(true);
            expect(generationTaskOutputsApplied(output, task)).toBe(false);
            expect(dirty(nodes)).toBe(true);
        });
        expect(receipts).toBe(1);
        const successfulOutput = result.nodes.find((node) => node.id === state.output.id)!;
        expect(successfulOutput.metadata).toMatchObject({ content: "/new.png", storageKey: "resource:new", status: "success" });
        expect(successfulOutput.metadata!.previewContent).toBeUndefined();
        expect(successfulOutput.metadata!.assetId).toBeUndefined();
        expect(successfulOutput.metadata!.batchResultInputSignature).toBe(successfulOutput.metadata!.batchInputSignature);
        expect(generationTaskOutputsApplied(successfulOutput, task)).toBe(false);
        const asset: ImageAsset = {
            id: "new-asset",
            kind: "image",
            title: "result",
            coverUrl: "/new.png",
            tags: [],
            createdAt: "",
            updatedAt: "",
            data: { dataUrl: "", storageKey: "resource:new", width: 300, height: 200, bytes: 1, mimeType: "image/png" },
        };
        withAssetStorePersistenceSuppressed(() => useAssetStore.setState({ assets: [asset] }));
        expect(generationTaskOutputsApplied({ ...successfulOutput, metadata: { ...successfulOutput.metadata, assetId: asset.id } }, task)).toBe(true);
        expect(dirty(result.nodes)).toBe(false);

        const nextNodes = result.nodes.map((node) =>
            node.id === state.table.id ? { ...node, metadata: { ...node.metadata, batchTable: { ...node.metadata!.batchTable!, rows: node.metadata!.batchTable!.rows.map((row) => ({ ...row, prompt: "third prompt" })) } } } : node,
        );
        const next = prepare(state, nextNodes);
        expect(next.nodes.find((node) => node.id === state.table.id)!.metadata!.batchTable!.rows[0].generatedInputSignature).toBe(successfulOutput.metadata!.batchResultInputSignature);
        const failedNext = await executeCandidate(next, "failed");
        expect(failedNext.nodes.find((node) => node.id === state.output.id)!.metadata!.content).toBe("/new.png");
        expect(dirty(failedNext.nodes)).toBe(true);
    });

    test("copying an output clears pending and consumed signatures tied to its previous ownership", () => {
        const state = fixture();
        state.output.metadata = { ...state.output.metadata, batchSourceNodeId: state.table.id, batchRowId: "row", batchInputSignature: "pending", batchResultInputSignature: "consumed" };
        const copied = isolateCopiedNodeMetadata(
            state.output,
            new Map([
                [state.table.id, "copied-table"],
                [state.output.id, "copied-output"],
            ]),
        );
        expect(copied.batchSourceNodeId).toBe("copied-table");
        expect(copied.batchInputSignature).toBeUndefined();
        expect(copied.batchResultInputSignature).toBeUndefined();
        expect(copied.content).toBe("/old.png");
    });

    test("ordinary existing images still generate a separate result and keep their original node", async () => {
        const state = fixture();
        const candidate = { ...prepare(state), nodes: [state.input, state.output] };
        const result = await executeCandidate(candidate, "failed");
        expect(result.started).toHaveLength(1);
        expect(result.started[0]).not.toBe(state.output.id);
        expect(result.nodes).toHaveLength(3);
        expect(result.nodes.find((node) => node.id === state.output.id)).toBe(state.output);
        expect(result.nodes.find((node) => node.id === result.started[0])!.metadata!.status).toBe("error");
    });

    test("old thumbnails do not hide waiting, running or failed task status", () => {
        const state = fixture();
        for (const [status, label] of [
            ["waiting", "等待中"],
            ["running", "生成中"],
            ["failed", "生成失败"],
        ] as const) {
            const batch: CanvasGenerationBatch = {
                id: "batch",
                projectId: "test",
                sourceNodeId: state.table.id,
                mode: "batch_image",
                status: "running",
                createdAt: "",
                updatedAt: "",
                items: [{ id: "item", rowId: "row", nodeId: state.output.id, retryCount: 0, status }],
            };
            const markup = renderToStaticMarkup(
                <CanvasBatchTableNodeContent
                    node={state.table}
                    nodes={state.nodes}
                    connections={[]}
                    batch={batch}
                    theme={canvasThemes.light}
                    onPatchTable={noop}
                    onAddRow={noop}
                    onRemoveRow={noop}
                    onUpdateRow={noop}
                    onFillRows={noop}
                    onGenerate={noop}
                    onRetryItem={noop}
                    onAddReferenceColumn={noop}
                    onConnectStart={noop}
                />,
            );
            expect(markup).toContain(`${label} · 点击定位到画布节点`);
            expect(markup).not.toContain("生成完成 · 点击定位到画布节点");
            expect(markup).toContain("输入已变更");
        }
    });
});
