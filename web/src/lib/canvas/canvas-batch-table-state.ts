import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import type { BatchGenerationSettings } from "@/components/canvas/batch-generation-settings-dialog";
import type { Asset } from "@/stores/use-asset-store";
import type { AiConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasBatchRow, type CanvasBatchTableData, type CanvasConnection, type CanvasGenerationBatchItem, type CanvasNodeData } from "@/types/canvas";
import { createCanvasBatchInputSnapshot } from "./canvas-batch-input-snapshot";
import { batchRowInputSignature } from "./canvas-batch-references";
import { batchPromptForRow } from "./canvas-batch-table";
import { createCanvasNode } from "./canvas-project-domain";
import { buildGenerationConfig, resetGenerationTaskMetadata } from "./canvas-project-generation";

export type CanvasBatchGenerationTarget = Pick<CanvasGenerationBatchItem, "rowId" | "nodeId" | "inputSnapshot">;

function sameIds(before: string[] | undefined, after: string[] | undefined) {
    return (before?.length || 0) === (after?.length || 0) && (before || []).every((id, index) => id === after?.[index]);
}

/** Preserve completed results while marking changes to the inputs they were generated from. */
export function patchCanvasBatchTableData(previous: CanvasBatchTableData | undefined, patch: Partial<CanvasBatchTableData>): CanvasBatchTableData {
    const previousRows = new Map(previous?.rows.map((row) => [row.id, row]));
    const table = { operation: "try_on" as const, concurrency: 10, rows: [], ...previous, ...patch };
    const rows = table.rows.map((row) => {
        const old = previousRows.get(row.id);
        const changed = old?.prompt !== row.prompt || previous?.globalPrompt !== table.globalPrompt || previous?.operation !== table.operation || !sameIds(old?.inputNodeIds, row.inputNodeIds) || !sameIds(old?.textNodeIds, row.textNodeIds);
        return row.outputNodeId && changed ? { ...row, inputChanged: true } : row;
    });
    return { ...table, rows };
}

/** Build and validate the complete candidate before the editor publishes any output or row changes. */
export function prepareCanvasBatchTableGeneration({
    nodes,
    connections,
    sourceNodeId,
    rows,
    config,
    settings,
    assets,
}: {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    sourceNodeId: string;
    rows: CanvasBatchRow[];
    config: AiConfig;
    settings: BatchGenerationSettings;
    assets: Asset[];
}) {
    const sourceNode = nodes.find((node) => node.id === sourceNodeId);
    const table = sourceNode?.metadata?.batchTable;
    if (!sourceNode || !table || sourceNode.metadata?.locked) throw new Error("批量创作表已变化或锁定，请重新选择");
    const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const nextNodes = [...nodes];
    let nextConnections = [...connections];
    const outputByRowId = new Map<string, string>();
    const lastResultSignatureByRowId = new Map<string, string | undefined>();
    const targets: CanvasBatchGenerationTarget[] = [];
    const inputNodes = new Map(nodes.map((node) => [node.id, node]));
    const mergedConfig = { ...config, ...settings };
    const model = buildGenerationConfig(mergedConfig, undefined, "image").model;

    rows.forEach((row, index) => {
        const existingIndex = row.outputNodeId ? nextNodes.findIndex((node) => node.id === row.outputNodeId && node.type === CanvasNodeType.Image) : -1;
        const existingOutput = existingIndex >= 0 ? nextNodes[existingIndex] : undefined;
        lastResultSignatureByRowId.set(row.id, existingOutput?.metadata?.batchResultInputSignature || row.generatedInputSignature);
        const prompt = batchPromptForRow(table, row).trim();
        const metadata = {
            ...(existingIndex >= 0 ? resetGenerationTaskMetadata(nextNodes[existingIndex].metadata) : {}),
            generationSpec: undefined,
            logicalModelId: undefined,
            channelId: undefined,
            channelModelKey: undefined,
            prompt,
            composerContent: [
                prompt,
                ...(row.textNodeIds || []).map((textNodeId) => {
                    const textNode = inputNodes.get(textNodeId);
                    return textNode?.metadata?.content || textNode?.metadata?.prompt || "";
                }),
            ]
                .filter(Boolean)
                .join("\n\n"),
            model,
            size: mergedConfig.size,
            imageResolution: mergedConfig.imageResolution,
            imageParameters: mergedConfig.imageParameters,
            quality: mergedConfig.quality,
            transparentBackground: mergedConfig.transparentBackground,
            count: 1,
            generationMode: "image" as const,
            generationType: "edit" as const,
            workflowKind: "final" as const,
            workflowTitle: `${table.operation === "try_on" ? "换装" : "创意"}任务 ${index + 1}`,
            status: "idle" as const,
            batchSourceNodeId: sourceNodeId,
            batchRowId: row.id,
            batchOperation: table.operation,
            batchInputNodeIds: row.inputNodeIds,
            generationResultPlacement: "replace-node" as const,
            batchInputSignature: batchRowInputSignature(table, row, inputNodes),
            batchResultInputSignature: undefined,
            cameraControl: settings.cameraControl,
        };
        const output =
            existingIndex >= 0
                ? { ...nextNodes[existingIndex], metadata }
                : createCanvasNode(CanvasNodeType.Image, { x: sourceNode.position.x + sourceNode.width + 120 + imageSpec.width / 2, y: sourceNode.position.y + index * (imageSpec.height + 32) + imageSpec.height / 2 }, metadata);
        output.title = `${table.operation === "try_on" ? "换装" : "创意"} · ${index + 1}`;
        if (existingIndex >= 0) nextNodes[existingIndex] = output;
        else nextNodes.push(output);
        nextConnections = nextConnections.filter((connection) => connection.toNodeId !== output.id);
        row.inputNodeIds.filter(Boolean).forEach((inputNodeId) => nextConnections.push({ id: nanoid(), fromNodeId: inputNodeId, toNodeId: output.id }));
        nextConnections.push({ id: nanoid(), fromNodeId: sourceNode.id, toNodeId: output.id, relation: "batch-output", storyboardRowId: row.id });
        outputByRowId.set(row.id, output.id);
        targets.push({ rowId: row.id, nodeId: output.id });
    });
    const sourceIndex = nextNodes.findIndex((node) => node.id === sourceNode.id);
    nextNodes[sourceIndex] = {
        ...sourceNode,
        metadata: {
            ...sourceNode.metadata,
            batchTable: { ...table, rows: table.rows.map((row) => (outputByRowId.has(row.id) ? { ...row, outputNodeId: outputByRowId.get(row.id), generatedInputSignature: lastResultSignatureByRowId.get(row.id) } : row)) },
        },
    };
    const nodeById = new Map(nextNodes.map((node) => [node.id, node]));
    // A failure in any row discards this candidate, including previously prepared rows.
    const preparedTargets = targets.map((target) => ({ ...target, inputSnapshot: createCanvasBatchInputSnapshot(nodeById.get(target.nodeId)!, nextNodes, nextConnections, assets) }));
    return { nodes: nextNodes, connections: nextConnections, targets: preparedTargets };
}
