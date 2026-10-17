import { useCallback, useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { App, Button } from "antd";
import { AppModal } from "@/components/ui/product/app-modal";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { applyBatchReferenceEdits, reconcileBatchCellConnections, type BatchReferenceEdit } from "@/lib/canvas/canvas-batch-references";
import { batchInputColumns, batchReferenceColumns, createBatchRow } from "@/lib/canvas/canvas-batch-table";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { IMAGE_NODE_MAX_SIZE } from "@/lib/canvas/canvas-node-size";
import type { CanvasNodeData, CanvasConnection, Position } from "@/types/canvas";

type Options = {
    nodesRef: { current: CanvasNodeData[] };
    connectionsRef: { current: CanvasConnection[] };
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    createFileNode: (file: File, position: Position) => Promise<string | null | undefined>;
};
type Cell = { tableId: string; rowId: string; columnId: string };

export function useCanvasBatchReferences({ nodesRef, connectionsRef, setNodes, setConnections, createFileNode }: Options) {
    const { modal, message } = App.useApp();
    const [picker, setPicker] = useState<Cell | null>(null);
    const [search, setSearch] = useState("");
    const cellState = useCallback(
        (cell: Cell) => {
            const node = nodesRef.current.find((item) => item.id === cell.tableId);
            const table = node?.metadata?.batchTable;
            const row = table?.rows.find((item) => item.id === cell.rowId);
            const columnIndex = batchReferenceColumns(table).findIndex((column) => column.id === cell.columnId);
            if (!node || !table || !row || columnIndex < 0 || node.metadata?.locked) return;
            return { node, table, row, columnIndex, sourceId: row.inputNodeIds[columnIndex] || "", label: `任务 ${table.rows.indexOf(row) + 1} · 参考图 ${columnIndex + 1}` };
        },
        [nodesRef],
    );
    const confirm = useCallback(
        (title: string, content: React.ReactNode) =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title,
                    content,
                    okText: "确认替换",
                    cancelText: "取消",
                    cancelButtonProps: { "aria-label": "取消替换" },
                    onOk: () => {
                        resolve(true);
                    },
                    onCancel: () => {
                        resolve(false);
                    },
                });
            }),
        [modal],
    );
    const describe = (id: string) => nodesRef.current.find((node) => node.id === id)?.title || (id ? "已移除的图片" : "空白");
    const preview = (id: string, label: string) => {
        const image = nodesRef.current.find((node) => node.id === id);
        return (
            <div className="min-w-0 flex-1">
                <span>
                    {label} · {describe(id)}
                </span>
                <CachedResourceImage src={image?.metadata?.previewContent || image?.metadata?.content} storageKey={image?.metadata?.storageKey} alt={label} className="mt-2 h-28 w-full rounded border object-contain" />
            </div>
        );
    };
    const commit = useCallback(
        (tableId: string, edits: BatchReferenceEdit[]) => {
            const result = applyBatchReferenceEdits(nodesRef.current, connectionsRef.current, tableId, edits);
            if (!result) {
                message.warning("任务或参考图已变化，请重新选择");
                return;
            }
            setNodes(result.nodes);
            setConnections(result.connections);
        },
        [connectionsRef, message, nodesRef, setConnections, setNodes],
    );
    const propose = async (cell: Cell, sourceId: string) => {
        const state = cellState(cell);
        if (!state || state.sourceId === sourceId) return;
        if (
            state.sourceId &&
            sourceId &&
            !(await confirm(
                `替换${state.label}？`,
                <>
                    <div className="flex gap-3">
                        {preview(state.sourceId, "原图")}
                        {preview(sourceId, "新图")}
                    </div>
                    <p>仅修改这一格的引用，其他任务和原图保留。</p>
                </>,
            ))
        )
            return;
        commit(cell.tableId, [{ ...cell, sourceId, expectedSourceId: state.sourceId }]);
    };
    const cellAt = (tableId: string, rowId: string, index: number): Cell | undefined => {
        const table = nodesRef.current.find((node) => node.id === tableId)?.metadata?.batchTable;
        const column = batchReferenceColumns(table)[index];
        return column ? { tableId, rowId, columnId: column.id } : undefined;
    };
    const upload = async (cell: Cell, file: File) => {
        const state = cellState(cell);
        if (!state || !file.type.startsWith("image/")) return;
        if (state.sourceId) {
            const url = URL.createObjectURL(file);
            let accepted = false;
            try {
                accepted = await confirm(
                    `替换${state.label}？`,
                    <>
                        <div className="flex gap-3">
                            {preview(state.sourceId, "原图")}
                            <div className="min-w-0 flex-1">
                                <span>新图 · {file.name}</span>
                                <img src={url} alt="新图" className="mt-2 h-28 w-full rounded border object-contain" />
                            </div>
                        </div>
                        <p>原图及其他格子保留。</p>
                    </>,
                );
            } finally {
                URL.revokeObjectURL(url);
            }
            if (!accepted) return;
        }
        if (cellState(cell)?.sourceId !== state.sourceId) return void message.warning("这一格已变化，请重新选择");
        const area = findAvailableGenerationGroupPosition(nodesRef.current, { x: state.node.position.x - IMAGE_NODE_MAX_SIZE.width - 96, y: state.node.position.y }, IMAGE_NODE_MAX_SIZE);
        const id = await createFileNode(file, { x: area.x + IMAGE_NODE_MAX_SIZE.width / 2, y: area.y + IMAGE_NODE_MAX_SIZE.height / 2 });
        if (id) commit(cell.tableId, [{ ...cell, sourceId: id, expectedSourceId: state.sourceId }]);
    };
    const move = async (tableId: string, sourceRowId: string, sourceIndex: number, targetRowId: string, targetIndex: number) => {
        const from = cellAt(tableId, sourceRowId, sourceIndex),
            to = cellAt(tableId, targetRowId, targetIndex);
        if (!from || !to) return;
        const a = cellState(from),
            b = cellState(to);
        if (!a?.sourceId || !b || a.sourceId === b.sourceId) return;
        if (
            b.sourceId &&
            !(await confirm(
                "交换两格参考图？",
                <p>
                    {a.label}：“{describe(a.sourceId)}”<br />
                    {b.label}：“{describe(b.sourceId)}”<br />
                    确认后交换引用，原图保留。
                </p>,
            ))
        )
            return;
        commit(tableId, [
            { ...from, sourceId: b.sourceId, expectedSourceId: a.sourceId },
            { ...to, sourceId: a.sourceId, expectedSourceId: b.sourceId },
        ]);
    };
    const fillColumns = async (tableId: string) => {
        const node = nodesRef.current.find((item) => item.id === tableId),
            table = node?.metadata?.batchTable;
        if (!node || !table || node.metadata?.locked) return;
        const byId = new Map(nodesRef.current.map((item) => [item.id, item]));
        const columns = batchInputColumns(node, connectionsRef.current).map((ids) => ids.filter((id) => byId.get(id)?.type === "image" && (byId.get(id)?.metadata?.storageKey || byId.get(id)?.metadata?.content)));
        if (!columns.some((ids) => ids.length)) return void message.info("请先把图片连接到表格左侧的列端口。单张图整列共用，多张图按连线顺序逐行填充。");
        const snapshot = table;
        const count = Math.max(table.rows.length, ...columns.map((ids) => ids.length));
        const rows = Array.from({ length: count }, (_, index) => {
            const old = table.rows[index] || createBatchRow(table.operation);
            const ids = batchReferenceColumns(table).map((_, col) => (columns[col].length === 1 ? columns[col][0] : columns[col][index] || old.inputNodeIds[col] || ""));
            const changed = ids.some((id, col) => id !== (old.inputNodeIds[col] || ""));
            return {
                ...old,
                inputNodeIds: ids,
                referenceOverrides: batchReferenceColumns(table).flatMap((column, col) => (!columns[col].length && old.referenceOverrides?.includes(column.id) ? [column.id] : [])),
                inputChanged: (changed && Boolean(old.outputNodeId)) || old.inputChanged,
            };
        });
        const overwritten = rows.flatMap((row, index) => row.inputNodeIds.filter((id, col) => table.rows[index]?.inputNodeIds[col] && id !== table.rows[index].inputNodeIds[col]));
        if (overwritten.length && !(await confirm(`按列填充将替换 ${overwritten.length} 格参考图`, <p>单张图整列共用，多张图按顺序填入各行。已有任务、提示词和结果保留，可撤销恢复。</p>))) return;
        const current = nodesRef.current.find((item) => item.id === tableId);
        const currentById = new Map(nodesRef.current.map((item) => [item.id, item]));
        const currentColumns = current && batchInputColumns(current, connectionsRef.current).map((ids) => ids.filter((id) => currentById.get(id)?.type === "image" && (currentById.get(id)?.metadata?.storageKey || currentById.get(id)?.metadata?.content)));
        if (current?.metadata?.locked || current?.metadata?.batchTable !== snapshot || JSON.stringify(currentColumns) !== JSON.stringify(columns)) return void message.warning("表格或连线已变化，请重新填充");
        const nextNodes = nodesRef.current.map((item) => (item.id === tableId ? { ...item, metadata: { ...item.metadata, batchTable: { ...table, referenceMode: "cells" as const, rows } } } : item));
        const edges = reconcileBatchCellConnections(nextNodes, connectionsRef.current);
        setNodes(nextNodes);
        setConnections(edges);
    };
    const pickerState = picker && cellState(picker);
    const images = nodesRef.current.filter((node) => node.type === "image" && (node.metadata?.content || node.metadata?.storageKey) && (node.title || "图片").includes(search));
    const handlers = {
        connectCell: (tableId: string, rowId: string, columnId: string, sourceId: string) => {
            void propose({ tableId, rowId, columnId }, sourceId);
        },
        pick: (tableId: string, rowId: string, columnIndex: number) => {
            const cell = cellAt(tableId, rowId, columnIndex);
            if (cell && cellState(cell)) {
                setSearch("");
                setPicker(cell);
            }
        },
        remove: (tableId: string, rowId: string, columnIndex: number) => {
            const cell = cellAt(tableId, rowId, columnIndex);
            if (cell) void propose(cell, "");
        },
        upload: (tableId: string, rowId: string, columnIndex: number, file: File) => {
            const cell = cellAt(tableId, rowId, columnIndex);
            if (cell) void upload(cell, file);
        },
        move,
        fillColumns,
    };
    const handlersRef = useRef(handlers);
    useLayoutEffect(() => {
        handlersRef.current = handlers;
    });
    const actions = useMemo(
        () => ({
            connectCell: (...args: Parameters<typeof handlers.connectCell>) => handlersRef.current.connectCell(...args),
            pick: (...args: Parameters<typeof handlers.pick>) => handlersRef.current.pick(...args),
            remove: (...args: Parameters<typeof handlers.remove>) => handlersRef.current.remove(...args),
            upload: (...args: Parameters<typeof handlers.upload>) => handlersRef.current.upload(...args),
            move: (...args: Parameters<typeof handlers.move>) => handlersRef.current.move(...args),
            fillColumns: (...args: Parameters<typeof handlers.fillColumns>) => handlersRef.current.fillColumns(...args),
        }),
        [],
    );
    return {
        actions,
        pickerModal: (
            <AppModal open={Boolean(pickerState)} title={`选择参考图 · ${pickerState?.label || ""}`} onCancel={() => setPicker(null)} footer={null} width={640}>
                <div data-canvas-no-drag data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
                    <p>选择画布中的图片，或上传新图。也可以直接将图片节点的连线拖到格子上。</p>
                    <div className="mb-3 flex gap-3">
                        <input aria-label="搜索画布图片" className="min-w-0 flex-1 rounded border px-3" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="按图片名称搜索" />
                        <label className="cursor-pointer rounded border px-3 py-2">
                            上传新图
                            <input
                                aria-label="上传参考图"
                                type="file"
                                accept="image/*"
                                className="hidden"
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    if (file && picker) {
                                        const cell = picker;
                                        setPicker(null);
                                        void upload(cell, file);
                                    }
                                }}
                            />
                        </label>
                    </div>
                    <div className="grid max-h-80 grid-cols-4 gap-3 overflow-auto">
                        {images.map((image) => (
                            <button
                                type="button"
                                aria-label={`选择图片 ${image.title || image.id}`}
                                key={image.id}
                                className="overflow-hidden rounded border p-2"
                                onClick={() => {
                                    if (picker) {
                                        const cell = picker;
                                        setPicker(null);
                                        void propose(cell, image.id);
                                    }
                                }}
                            >
                                <CachedResourceImage src={image.metadata?.previewContent || image.metadata?.content} storageKey={image.metadata?.storageKey} alt={image.title || "图片"} className="h-24 w-full object-contain" />
                                <span className="block truncate">{image.title || "图片"}</span>
                            </button>
                        ))}
                    </div>
                    {!images.length && <p>当前没有匹配的画布图片，可以上传新图。</p>}
                    <div className="mt-4 flex justify-end gap-2">
                        {pickerState?.sourceId && (
                            <Button
                                onClick={() => {
                                    if (picker) void propose(picker, "");
                                    setPicker(null);
                                }}
                            >
                                移除此格引用
                            </Button>
                        )}
                        <Button onClick={() => setPicker(null)}>取消</Button>
                    </div>
                </div>
            </AppModal>
        ),
    };
}
