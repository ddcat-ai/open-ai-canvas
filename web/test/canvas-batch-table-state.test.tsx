import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App } from "antd";

import { createCanvasStateWriter } from "@/lib/canvas/canvas-editor-state";
import { batchRowInputChanged } from "@/lib/canvas/canvas-batch-references";
import { readNodeGenerationSpec, specFromConfig } from "@/lib/canvas/generation-contract";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { batchGenerationRows, removeLastBatchReferenceColumn, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { patchCanvasBatchTableData, prepareCanvasBatchTableGeneration } from "@/lib/canvas/canvas-batch-table-state";
import { useCanvasGenerationBatches } from "@/pages/canvas/use-canvas-generation-batches";
import { defaultConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

function fixture() {
    const image = (id: string): CanvasNodeData => ({ id, type: CanvasNodeType.Image, title: id, position: { x: 0, y: 0 }, width: 200, height: 200, metadata: { content: `/api/resources/${id}/file`, storageKey: `resource:${id}` } });
    const inputs = [image("input-1"), image("input-2")];
    const output = image("old-result");
    output.metadata = { ...output.metadata, prompt: "old prompt", composerContent: "old prompt", status: "success", taskId: "old-task", taskStatus: "succeeded" };
    const source: CanvasNodeData = {
        id: "table",
        type: CanvasNodeType.BatchTable,
        title: "table",
        position: { x: 400, y: 0 },
        width: 900,
        height: 560,
        metadata: {
            batchTable: {
                operation: "creative",
                concurrency: 1,
                referenceColumns: [
                    { id: "first", label: "参考图 1" },
                    { id: "second", label: "参考图 2" },
                ],
                rows: [
                    { id: "first-row", enabled: true, inputNodeIds: [inputs[0].id, inputs[1].id], prompt: "new prompt", outputNodeId: output.id, inputChanged: true, generatedInputSignature: "old signature" },
                    { id: "second-row", enabled: true, inputNodeIds: [inputs[1].id], prompt: "second prompt" },
                ],
            },
        },
    };
    const connections: CanvasConnection[] = [{ id: "old-edge", fromNodeId: inputs[0].id, toNodeId: output.id }];
    return { source, inputs, output, nodes: [source, ...inputs, output], connections };
}

function freeze<T>(value: T): T {
    if (value && typeof value === "object") {
        Object.values(value).forEach(freeze);
        Object.freeze(value);
    }
    return value;
}

function prepare(state: ReturnType<typeof fixture>, nodes = state.nodes, settings = defaultConfig) {
    return prepareCanvasBatchTableGeneration({ nodes, connections: state.connections, sourceNodeId: state.source.id, rows: state.source.metadata!.batchTable!.rows, config: defaultConfig, settings, assets: [] });
}

describe("batch table state transitions", () => {
    test("a later invalid input rejects the complete candidate without changing old results, task bindings, rows or edges", () => {
        const state = fixture();
        // The first row is valid and reuses a completed output; the second row fails validation.
        state.source.metadata!.batchTable!.rows[0].inputNodeIds = [state.inputs[0].id];
        state.inputs[1].metadata!.storageKey = undefined;
        state.inputs[1].metadata!.content = "blob:http://localhost/unsaved";
        const rows = batchGenerationRows(state.source, state.nodes, ["first-row", "second-row"]);
        expect(rows).toHaveLength(2);
        const before = JSON.stringify(state);
        freeze(state);

        expect(() => prepare(state)).toThrow("尚未保存为资源");
        expect(JSON.stringify(state)).toBe(before);
        expect(state.source.metadata!.batchTable!.rows[0].inputChanged).toBe(true);
        expect(state.source.metadata!.batchTable!.rows[0].generatedInputSignature).toBe("old signature");
        expect(state.output.metadata!.taskId).toBe("old-task");
        expect(state.output.metadata!.status).toBe("success");
        expect(state.connections[0].id).toBe("old-edge");
        expect(state.nodes).toHaveLength(4);
    });

    test("valid candidates prepare frozen inputs once and enqueue reuses them without reading changed live images", () => {
        const state = fixture();
        const before = JSON.stringify(state);
        freeze(state);
        const candidate = prepare(state);
        expect(JSON.stringify(state)).toBe(before);
        expect(candidate.nodes).toHaveLength(5);
        expect(candidate.targets).toHaveLength(2);
        expect(candidate.targets[0].inputSnapshot.context.referenceImages.map((image) => image.storageKey)).toEqual(["resource:input-1", "resource:input-2"]);
        const candidateSource = candidate.nodes.find((node) => node.id === state.source.id)!;
        const candidateOutput = candidate.nodes.find((node) => node.id === state.output.id)!;
        expect(candidateOutput.metadata!.content).toBe(state.output.metadata!.content);
        expect(candidateOutput.metadata!.taskId).toBeUndefined();
        expect(candidateSource.metadata!.batchTable!.rows[0].inputChanged).toBe(true);
        expect(candidateSource.metadata!.batchTable!.rows[0].generatedInputSignature).toBe("old signature");
        expect(candidateOutput.metadata!.batchInputSignature).toBeDefined();
        expect(candidateOutput.metadata!.batchResultInputSignature).toBeUndefined();

        // Passing these prevalidated snapshots to the real queue must not compile them again.
        const nodesRef = { current: candidate.nodes.map((node) => (node.id === state.inputs[0].id ? { ...node, metadata: { content: "blob:http://localhost/replaced-after-prepare" } } : node)) };
        const connectionsRef = { current: candidate.connections };
        let enqueue!: ReturnType<typeof useCanvasGenerationBatches>["enqueueGenerationBatch"];
        function CaptureQueue() {
            enqueue = useCanvasGenerationBatches({
                projectId: "isolated-test",
                projectLoaded: false,
                nodes: nodesRef.current,
                nodesRef,
                connectionsRef,
                assets: [],
                setNodes: createCanvasStateWriter(nodesRef, () => {}),
                handleGenerateNode: async () => {
                    throw new Error("must not submit a model request");
                },
            }).enqueueGenerationBatch;
            return null;
        }
        renderToStaticMarkup(
            <App>
                <CaptureQueue />
            </App>,
        );
        const batchId = enqueue(state.source.id, "batch_image", candidate.targets, { concurrency: 1 });
        const queued = nodesRef.current.find((node) => node.id === state.source.id)!.metadata!.generationBatches![0];
        expect(batchId).toBe(queued.id);
        expect(queued.items[0].inputSnapshot).toBe(candidate.targets[0].inputSnapshot);
        expect(queued.items[0].inputSnapshot!.context.referenceImages[0].storageKey).toBe("resource:input-1");
        expect(queued.items.every((item) => item.status === "waiting")).toBe(true);
    });

    test("batch regeneration replaces stale generation specs with the current prompt and settings", () => {
        const state = fixture();
        state.output.metadata = {
            ...state.output.metadata,
            generationSpec: specFromConfig("image", "stale prompt", { ...defaultConfig, size: "1:1", imageResolution: "1K", imageParameters: JSON.stringify({ ratio: "1:1" }), quality: "low", transparentBackground: "false" }),
        };
        const settings = { ...defaultConfig, size: "3:2", imageResolution: "4K", imageParameters: JSON.stringify({ ratio: "3:2" }), quality: "high", transparentBackground: "true" };
        const candidate = prepare(state, state.nodes, settings);
        const output = candidate.nodes.find((node) => node.id === state.output.id)!;
        const spec = readNodeGenerationSpec(output)!;
        expect(output.metadata?.generationSpec).toBeUndefined();
        expect(spec.prompt).toBe("new prompt");
        expect(spec.options).toMatchObject({
            size: "3:2",
            imageResolution: "4K",
            imageParameters: settings.imageParameters,
            quality: "high",
            transparentBackground: true,
        });
        expect(buildGenerationConfig(settings, output, "image")).toMatchObject({
            size: "3:2",
            imageResolution: "4K",
            imageParameters: settings.imageParameters,
            quality: "high",
            transparentBackground: "true",
        });
        expect(candidate.targets[0].inputSnapshot.prompt).toBe("new prompt");
    });

    test("legacy completed results become stale after changing, reordering or removing a reference", () => {
        const state = fixture();
        const table = state.source.metadata!.batchTable!;
        table.rows[0] = { ...table.rows[0], generatedInputSignature: undefined, inputChanged: false };
        const patches = [{ rows: table.rows.map((row) => (row.id === "first-row" ? { ...row, inputNodeIds: ["replacement", state.inputs[1].id] } : row)) }, reorderBatchReferenceColumns(table, "first", "second"), removeLastBatchReferenceColumn(table)!];
        for (const patch of patches) {
            const changed = patchCanvasBatchTableData(table, patch);
            expect(changed.rows[0].inputChanged).toBe(true);
            expect(changed.rows[0].outputNodeId).toBe(state.output.id);
            expect(batchRowInputChanged(changed, changed.rows[0], new Map(state.nodes.map((node) => [node.id, node])))).toBe(true);
        }
        expect(table.rows[0].inputChanged).toBe(false);
    });

    test("enabling, disabling and concurrency changes do not mark an unchanged legacy result stale", () => {
        const table = fixture().source.metadata!.batchTable!;
        table.rows[0] = { ...table.rows[0], generatedInputSignature: undefined, inputChanged: false };
        const disabled = patchCanvasBatchTableData(table, { rows: table.rows.map((row) => ({ ...row, enabled: false })) });
        const enabled = patchCanvasBatchTableData(disabled, { concurrency: 5, rows: disabled.rows.map((row) => ({ ...row, enabled: true })) });
        expect(disabled.rows[0].inputChanged).toBe(false);
        expect(enabled.rows[0].inputChanged).toBe(false);
        expect(enabled.rows[0].outputNodeId).toBe(table.rows[0].outputNodeId);
    });
});
