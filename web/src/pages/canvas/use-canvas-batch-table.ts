import { useCallback, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { App } from "antd";
import { nanoid } from "nanoid";

import { NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { MAX_BATCH_REFERENCE_COLUMNS, batchGenerationRows, batchInputColumns, batchPromptForRow, batchReferenceColumns, batchReferenceHandleId, batchTextInputColumns, createInheritedBatchRow, createBatchRowsFromColumns, moveBatchReferenceCell, removeLastBatchReferenceColumn, reorderBatchReferenceColumns } from "@/lib/canvas/canvas-batch-table";
import { createCanvasNode } from "@/lib/canvas/canvas-project-domain";
import { buildGenerationConfig, resetGenerationTaskMetadata } from "@/lib/canvas/canvas-project-generation";
import { navigateToSettings } from "@/lib/settings-navigation";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { CanvasNodeType, type CanvasBatchRow, type CanvasBatchTableData, type CanvasConnection, type CanvasGenerationBatchMode, type CanvasNodeData } from "@/types/canvas";
import type { BatchGenerationSettings } from "@/components/canvas/batch-generation-settings-dialog";

type Options = {
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    enqueueGenerationBatch: (sourceNodeId: string, mode: CanvasGenerationBatchMode, targets: Array<{ rowId: string; nodeId: string }>, options?: { concurrency?: number }) => string | undefined;
};

type PendingBatchGen = {
    nodeId: string;
    rows: CanvasBatchRow[];
    concurrency: number;
    tableSnapshot: string;
    requestedRowIds?: string[];
};

export function useCanvasBatchTable({ nodesRef, connectionsRef, setNodes, setConnections, setSelectedNodeIds, enqueueGenerationBatch }: Options) {
    const { message } = App.useApp();
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);

    const [batchGenDialog, setBatchGenDialog] = useState<{ open: boolean; pending: PendingBatchGen | null }>({ open: false, pending: null });

    const patchTable = useCallback((nodeId: string, patch: Partial<CanvasBatchTableData>) => {
        setNodes((current) => current.map((node) => node.id !== nodeId ? node : { ...node, metadata: { ...node.metadata, batchTable: { operation: "try_on", concurrency: 10, rows: [], ...node.metadata?.batchTable, ...patch } } }));
    }, [setNodes]);

    const updateRow = useCallback((nodeId: string, rowId: string, patch: Partial<CanvasBatchRow>) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        if (!node?.metadata?.batchTable) return;
        patchTable(nodeId, { rows: node.metadata.batchTable.rows.map((row) => row.id === rowId ? { ...row, ...patch } : row) });
    }, [nodesRef, patchTable]);

    const addRow = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        patchTable(nodeId, { rows: [...table.rows, createInheritedBatchRow(table.operation, table.rows)] });
    }, [nodesRef, patchTable]);

    const removeRow = useCallback((nodeId: string, rowId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        patchTable(nodeId, { rows: table.rows.filter((row) => row.id !== rowId) });
    }, [nodesRef, patchTable]);

    const addReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        if (columns.length >= MAX_BATCH_REFERENCE_COLUMNS) return message.info("最多支持 10 组参考图");
        const nextIndex = columns.length + 1;
        patchTable(nodeId, { referenceColumns: [...columns, { id: `reference-${nanoid()}`, label: `参考图 ${nextIndex}` }] });
    }, [message, nodesRef, patchTable]);

    const removeReferenceColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = batchReferenceColumns(table);
        const nextTable = removeLastBatchReferenceColumn(table);
        if (!nextTable) return message.info("至少保留 1 组参考图");
        patchTable(nodeId, nextTable);
        const removed = columns.at(-1);
        if (removed) {
            const handleId = batchReferenceHandleId(removed.id);
            setConnections((current) => current.filter((connection) => !(connection.toNodeId === nodeId && connection.toHandleId === handleId)));
        }
    }, [message, nodesRef, patchTable, setConnections]);

    const addTextColumn = useCallback((nodeId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const columns = table.textColumns || [];
        if (columns.length >= 4) return message.info("最多支持 4 组文字");
        patchTable(nodeId, { textColumns: [...columns, { id: `text-${nanoid()}`, label: `文字 ${columns.length + 1}` }] });
    }, [message, nodesRef, patchTable]);

    const syncRowsFromConnections = useCallback((nodeId: string, silent = false) => {
        const node = nodesRef.current.find((item) => item.id === nodeId);
        const table = node?.metadata?.batchTable;
        if (!node || !table) return false;
        // AI 列表模式已经根据用户要求生成了独立行；参考图连线只负责
        // 提供素材，不能在保存/连线刷新时把 N 行重置成“每张图一行”。
        if (table.aiGenerated) return false;
        const nodeById = new Map(nodesRef.current.map((item) => [item.id, item]));
        const columns = batchInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Image && Boolean(input.metadata?.content || input.metadata?.storageKey);
        }));
        if (!columns.some((column) => column.length)) {
            if (!silent) message.warning("请先把图片节点连接到批量创作表");
            return false;
        }
        const rows = createBatchRowsFromColumns(table.operation, columns, table.rows);
        const textColumns = batchTextInputColumns(node, connectionsRef.current).map((column) => column.filter((inputNodeId) => {
            const input = nodeById.get(inputNodeId);
            return input?.type === CanvasNodeType.Text && Boolean(input.metadata?.content || input.metadata?.prompt);
        }));
        const rowsWithText = rows.map((row, index) => ({
            ...row,
            textNodeIds: textColumns.some((column) => column.length) ? textColumns.flatMap((column) => {
                const input = column.length === 1 ? column[0] : column[index];
                return input ? [input] : [];
            }) : row.textNodeIds,
        }));
        if (!rows.length) {
            if (!silent) message.warning("批量换装至少需要一张人物图和一张服装图");
            return false;
        }
        const rowsChanged = JSON.stringify(table.rows) !== JSON.stringify(rowsWithText);
        if (!rowsChanged) return false;
        patchTable(nodeId, { rows: rowsWithText });
        if (!silent) message.success(`已按连线创建 ${rows.length} 行任务`);
        return true;
    }, [connectionsRef, message, nodesRef, patchTable]);

    const fillRowsFromConnections = useCallback((nodeId: string) => {
        syncRowsFromConnections(nodeId);
    }, [syncRowsFromConnections]);

    const reorderReferenceColumns = useCallback((nodeId: string, fromColumnId: string, toColumnId: string) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = reorderBatchReferenceColumns(table, fromColumnId, toColumnId);
        if (nextTable !== table) patchTable(nodeId, nextTable);
    }, [nodesRef, patchTable]);

    const moveReferenceCell = useCallback((nodeId: string, sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => {
        const table = nodesRef.current.find((item) => item.id === nodeId)?.metadata?.batchTable;
        if (!table) return;
        const nextTable = moveBatchReferenceCell(table, sourceRowId, sourceColumnIndex, targetRowId, targetColumnIndex);
        if (nextTable !== table) patchTable(nodeId, { rows: nextTable.rows });
    }, [nodesRef, patchTable]);

    const executeBatchGeneration = useCallback((pending: PendingBatchGen, settings: BatchGenerationSettings) => {
        const { nodeId, rows, concurrency } = pending;
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;

        const selectableRowIds = new Set(batchGenerationRows(sourceNode, nodesRef.current, pending.requestedRowIds).map((row) => row.id));
        if (JSON.stringify(table) !== pending.tableSnapshot || !rows.every((row) => selectableRowIds.has(row.id))) {
            message.warning("表格、素材或任务状态已变化，请重新打开生成设置后提交");
            return;
        }

        const mergedConfig = { ...effectiveConfig, ...settings };
        if (!isAiConfigReady(mergedConfig, mergedConfig.imageModel || mergedConfig.model)) {
            message.error("所选图片模型尚未配置，未提交生成任务");
            return;
        }

        const imageSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
        const nextNodes = [...nodesRef.current];
        let nextConnections = [...connectionsRef.current];
        const outputByRowId = new Map<string, string>();
        const targets: Array<{ rowId: string; nodeId: string }> = [];
        rows.forEach((row, index) => {
            const existingIndex = row.outputNodeId ? nextNodes.findIndex((node) => node.id === row.outputNodeId && node.type === CanvasNodeType.Image) : -1;
            const prompt = batchPromptForRow(table, row).trim();
            const metadata = {
                ...(existingIndex >= 0 ? resetGenerationTaskMetadata(nextNodes[existingIndex].metadata) : {}),
                prompt,
                composerContent: [prompt, ...(row.textNodeIds || []).map((textNodeId) => {
                    const textNode = nodesRef.current.find((node) => node.id === textNodeId);
                    return textNode?.metadata?.content || textNode?.metadata?.prompt || "";
                })].filter(Boolean).join("\n\n"),
                model: buildGenerationConfig(mergedConfig, undefined, "image").model,
                size: mergedConfig.size,
                quality: mergedConfig.quality,
                transparentBackground: mergedConfig.transparentBackground,
                count: 1,
                generationMode: "image" as const,
                generationType: "edit" as const,
                workflowKind: "final" as const,
                workflowTitle: `${table.operation === "try_on" ? "换装" : "创意"}任务 ${index + 1}`,
                status: "idle" as const,
                batchSourceNodeId: nodeId,
                batchRowId: row.id,
                batchOperation: table.operation,
                batchInputNodeIds: row.inputNodeIds,
                cameraControl: settings.cameraControl,
            };
            const output = existingIndex >= 0
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
        nextNodes[sourceIndex] = { ...sourceNode, metadata: { ...sourceNode.metadata, batchTable: { ...table, rows: table.rows.map((row) => outputByRowId.has(row.id) ? { ...row, outputNodeId: outputByRowId.get(row.id) } : row) } } };
        nodesRef.current = nextNodes;
        connectionsRef.current = nextConnections;
        setNodes(nextNodes);
        setConnections(nextConnections);
        setSelectedNodeIds(new Set(targets.map((target) => target.nodeId)));
        if (enqueueGenerationBatch(nodeId, "batch_image", targets, { concurrency })) message.success(`${targets.length} 个任务已加入并发队列`);
    }, [connectionsRef, effectiveConfig, enqueueGenerationBatch, isAiConfigReady, message, nodesRef, setConnections, setNodes, setSelectedNodeIds]);

    const generateRows = useCallback((nodeId: string, requestedRowIds?: string[]) => {
        const sourceNode = nodesRef.current.find((item) => item.id === nodeId);
        const table = sourceNode?.metadata?.batchTable;
        if (!sourceNode || !table) return;
        const imageModel = effectiveConfig.imageModel || effectiveConfig.model;
        if (!isAiConfigReady(effectiveConfig, imageModel)) {
            navigateToSettings({ continueCreation: true });
            return;
        }
        const rows = batchGenerationRows(sourceNode, nodesRef.current, requestedRowIds);
        if (!rows.length) return message.info("没有可提交的未完成任务，请检查参考图和提示词");

        setBatchGenDialog({ open: true, pending: { nodeId, rows, concurrency: table.concurrency, tableSnapshot: JSON.stringify(table), requestedRowIds } });
    }, [effectiveConfig, isAiConfigReady, message, nodesRef]);

    const closeBatchGenDialog = useCallback(() => {
        setBatchGenDialog({ open: false, pending: null });
    }, []);

    const confirmBatchGenDialog = useCallback((settings: BatchGenerationSettings) => {
        if (batchGenDialog.pending) {
            executeBatchGeneration(batchGenDialog.pending, settings);
        }
        setBatchGenDialog({ open: false, pending: null });
    }, [batchGenDialog.pending, executeBatchGeneration]);

    const dialogConfig = useMemo(() => effectiveConfig, [effectiveConfig]);

    return {
        addReferenceColumn,
        addTextColumn,
        addRow,
        fillRowsFromConnections,
        generateRows,
        moveReferenceCell,
        patchTable,
        removeReferenceColumn,
        removeRow,
        reorderReferenceColumns,
        syncRowsFromConnections,
        updateRow,
        batchGenDialogOpen: batchGenDialog.open,
        batchGenDialogRowCount: batchGenDialog.pending?.rows.length ?? 0,
        batchGenDialogConcurrency: batchGenDialog.pending?.concurrency ?? 1,
        batchGenDialogConfig: dialogConfig,
        closeBatchGenDialog,
        confirmBatchGenDialog,
    };
}
