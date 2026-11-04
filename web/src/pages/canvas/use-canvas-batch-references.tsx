import { translate } from "@/i18n";
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
            return { node, table, row, columnIndex, sourceId: row.inputNodeIds[columnIndex] || "", label: translate("canvasPage.batchReferences.cellLabel", { row: table.rows.indexOf(row) + 1, column: columnIndex + 1 }) };
        },
        [nodesRef],
    );
    const confirm = useCallback(
        (title: string, content: React.ReactNode) =>
            new Promise<boolean>((resolve) => {
                modal.confirm({
                    title,
                    content,
                    okText: translate("canvasPage.batchReferences.confirmReplace"),
                    cancelText: translate("common.cancel"),
                    cancelButtonProps: { "aria-label": translate("canvasPage.batchReferences.cancelReplace") },
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
    const describe = (id: string) => nodesRef.current.find((node) => node.id === id)?.title || (id ? translate("canvasPage.batchReferences.removedImage") : translate("canvasPage.batchReferences.empty"));
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
                message.warning(translate("canvasPage.batchReferences.cellChanged"));
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
                translate("canvasPage.batchReferences.replaceTitle", { label: state.label }),
                <>
                    <div className="flex gap-3">
                        {preview(state.sourceId, translate("canvasPage.batchReferences.original"))}
                        {preview(sourceId, translate("canvasPage.batchReferences.newImage"))}
                    </div>
                    <p>{translate("canvasPage.batchReferences.replaceHint")}</p>
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
                    translate("canvasPage.batchReferences.replaceTitle", { label: state.label }),
                    <>
                        <div className="flex gap-3">
                            {preview(state.sourceId, translate("canvasPage.batchReferences.original"))}
                            <div className="min-w-0 flex-1">
                                <span>{translate("canvasPage.batchReferences.newImageFile", { name: file.name })}</span>
                                <img src={url} alt={translate("canvasPage.batchReferences.newImage")} className="mt-2 h-28 w-full rounded border object-contain" />
                            </div>
                        </div>
                        <p>{translate("canvasPage.batchReferences.uploadHint")}</p>
                    </>,
                );
            } finally {
                URL.revokeObjectURL(url);
            }
            if (!accepted) return;
        }
        if (cellState(cell)?.sourceId !== state.sourceId) return void message.warning(translate("canvasPage.batchReferences.thisCellChanged"));
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
                translate("canvasPage.batchReferences.swapTitle"),
                <p>
                    {a.label}：“{describe(a.sourceId)}”<br />
                    {b.label}：“{describe(b.sourceId)}”<br />
                    {translate("canvasPage.batchReferences.swapHint")}
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
        if (!columns.some((ids) => ids.length)) return void message.info(translate("canvasPage.batchReferences.connectColumnsFirst"));
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
        if (overwritten.length && !(await confirm(translate("canvasPage.batchReferences.fillTitle", { count: overwritten.length }), <p>{translate("canvasPage.batchReferences.fillHint")}</p>))) return;
        const current = nodesRef.current.find((item) => item.id === tableId);
        const currentById = new Map(nodesRef.current.map((item) => [item.id, item]));
        const currentColumns = current && batchInputColumns(current, connectionsRef.current).map((ids) => ids.filter((id) => currentById.get(id)?.type === "image" && (currentById.get(id)?.metadata?.storageKey || currentById.get(id)?.metadata?.content)));
        if (current?.metadata?.locked || current?.metadata?.batchTable !== snapshot || JSON.stringify(currentColumns) !== JSON.stringify(columns)) return void message.warning(translate("canvasPage.batchReferences.tableChanged"));
        const nextNodes = nodesRef.current.map((item) => (item.id === tableId ? { ...item, metadata: { ...item.metadata, batchTable: { ...table, referenceMode: "cells" as const, rows } } } : item));
        const edges = reconcileBatchCellConnections(nextNodes, connectionsRef.current);
        setNodes(nextNodes);
        setConnections(edges);
    };
    const pickerState = picker && cellState(picker);
    const images = nodesRef.current.filter((node) => node.type === "image" && (node.metadata?.content || node.metadata?.storageKey) && (node.title || translate("canvasPage.common.image")).includes(search));
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
            <AppModal open={Boolean(pickerState)} title={translate("canvasPage.batchReferences.pickerTitle", { label: pickerState?.label || "" })} onCancel={() => setPicker(null)} footer={null} width={640}>
                <div data-canvas-no-drag data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()}>
                    <p>{translate("canvasPage.batchReferences.pickerHint")}</p>
                    <div className="mb-3 flex gap-3">
                        <input
                            aria-label={translate("canvasPage.batchReferences.searchLabel")}
                            className="min-w-0 flex-1 rounded border px-3"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder={translate("canvasPage.batchReferences.searchPlaceholder")}
                        />
                        <label className="cursor-pointer rounded border px-3 py-2">
                            {translate("canvasPage.batchReferences.uploadNew")}
                            <input
                                aria-label={translate("canvasPage.batchReferences.uploadLabel")}
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
                                aria-label={translate("canvasPage.batchReferences.selectImage", { title: image.title || image.id })}
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
                                <CachedResourceImage
                                    src={image.metadata?.previewContent || image.metadata?.content}
                                    storageKey={image.metadata?.storageKey}
                                    alt={image.title || translate("canvasPage.common.image")}
                                    className="h-24 w-full object-contain"
                                />
                                <span className="block truncate">{image.title || translate("canvasPage.common.image")}</span>
                            </button>
                        ))}
                    </div>
                    {!images.length && <p>{translate("canvasPage.batchReferences.noMatches")}</p>}
                    <div className="mt-4 flex justify-end gap-2">
                        {pickerState?.sourceId && (
                            <Button
                                onClick={() => {
                                    if (picker) void propose(picker, "");
                                    setPicker(null);
                                }}
                            >
                                {translate("canvasPage.batchReferences.removeReference")}
                            </Button>
                        )}
                        <Button onClick={() => setPicker(null)}>{translate("common.cancel")}</Button>
                    </div>
                </div>
            </AppModal>
        ),
    };
}
