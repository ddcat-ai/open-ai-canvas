import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Input, Select, Switch, Tooltip } from "antd";
import { GripVertical, Image as ImageIcon, LoaderCircle, Play, Plus, RefreshCw, Rows3, Trash2, Upload } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { BATCH_REFERENCE_HANDLE_GAP, BATCH_REFERENCE_HANDLE_TOP, MAX_BATCH_REFERENCE_COLUMNS, MAX_BATCH_TEXT_COLUMNS, batchGridTemplateColumns, batchPromptForRow, batchReferenceColumns, batchReferenceHandleId, batchTextColumns, batchTextHandleId, batchTextHandleTop } from "@/lib/canvas/canvas-batch-table";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasBatchOperation, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasNodeData } from "@/types/canvas";

type Props = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    batch?: CanvasGenerationBatch;
    theme: CanvasTheme;
    onPatchTable: (patch: Partial<CanvasBatchTableData>) => void;
    onAddRow: () => void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<CanvasBatchRow>) => void;
    onFillRows: () => void;
    onGenerate: (rowIds?: string[]) => void;
    onRetryItem: (batchId: string, itemId: string) => void;
    onAddReferenceColumn: () => void;
    onAddTextColumn: () => void;
    onReorderReferenceColumns: (fromColumnId: string, toColumnId: string) => void;
    onMoveReferenceCell: (sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => void;
    onReplaceReference: (node: CanvasNodeData) => void;
    onUploadReference: (rowId: string, columnIndex: number, file: File) => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    readOnly?: boolean;
};

const OPERATION_OPTIONS = [
    { value: "try_on", label: "批量换装" },
    { value: "creative", label: "创意生图" },
] satisfies Array<{ value: CanvasBatchOperation; label: string }>;

type ReferenceCell = { rowId: string; columnIndex: number };

export function CanvasBatchTableNodeContent({ node, nodes, connections, batch, theme, onPatchTable, onAddRow, onRemoveRow, onUpdateRow, onFillRows, onGenerate, onRetryItem, onAddReferenceColumn, onAddTextColumn, onReorderReferenceColumns, onMoveReferenceCell, onReplaceReference, onUploadReference, onConnectStart, onConnectDrop, readOnly = false }: Props) {
    const table = node.metadata?.batchTable || { operation: "try_on" as const, concurrency: 10, rows: [] };
    const referenceColumns = batchReferenceColumns(table);
    const textColumns = batchTextColumns(table);
    const globalPrompt = table.globalPrompt || "";
    const hasGlobalPrompt = Boolean(globalPrompt.trim());
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const connectedImageCount = useMemo(() => new Set(connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.fromNodeId)).size, [connections, node.id]);
    const completed = table.rows.filter((row) => Boolean(row.outputNodeId && nodeById.get(row.outputNodeId)?.metadata?.content)).length;
    const gridTemplateColumns = batchGridTemplateColumns(referenceColumns.length, textColumns.length);
    const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
    const [draggingCell, setDraggingCell] = useState<ReferenceCell | null>(null);
    const [dropCell, setDropCell] = useState<ReferenceCell | null>(null);
    const draggingCellRef = useRef<ReferenceCell | null>(null);
    const dropCellRef = useRef<ReferenceCell | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; pointerId: number; cell: ReferenceCell } | null>(null);
    const lastPointerRef = useRef({ x: 0, y: 0 });
    const suppressClickRef = useRef(false);
    const uploadTargetRef = useRef<{ rowId: string; columnIndex: number } | null>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const clearReferenceDrag = useCallback(() => {
        dragStartRef.current = null;
        draggingCellRef.current = null;
        dropCellRef.current = null;
        setDraggingCell(null);
        setDropCell(null);
    }, []);

    const findReferenceCellAtPoint = useCallback((clientX: number, clientY: number) => {
        const hit = document.elementsFromPoint(clientX, clientY)
            .map((element) => element.closest<HTMLElement>("[data-batch-reference-cell]"))
            .find((element): element is HTMLElement => Boolean(element));
        if (!hit) return null;
        const rowId = hit.dataset.batchRowId;
        const columnIndex = Number(hit.dataset.batchColumnIndex);
        return rowId && Number.isInteger(columnIndex) ? { rowId, columnIndex } : null;
    }, []);

    const updateReferenceDrag = useCallback((clientX: number, clientY: number) => {
        const start = dragStartRef.current;
        if (!start || readOnly) return;
        const distance = Math.hypot(clientX - start.x, clientY - start.y);
        if (!draggingCellRef.current && distance < 5) return;
        if (!draggingCellRef.current) {
            draggingCellRef.current = start.cell;
            setDraggingCell(start.cell);
            suppressClickRef.current = true;
        }
        const nextDropCell = findReferenceCellAtPoint(clientX, clientY);
        dropCellRef.current = nextDropCell;
        setDropCell(nextDropCell);
    }, [findReferenceCellAtPoint, readOnly]);

    const finishReferenceDrag = useCallback((clientX: number, clientY: number, cancel = false) => {
        const start = dragStartRef.current;
        if (!start) return;
        const sourceCell = draggingCellRef.current;
        const targetCell = cancel ? null : dropCellRef.current || findReferenceCellAtPoint(clientX, clientY);
        if (sourceCell && targetCell) {
            onMoveReferenceCell(sourceCell.rowId, sourceCell.columnIndex, targetCell.rowId, targetCell.columnIndex);
        }
        clearReferenceDrag();
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }, [clearReferenceDrag, findReferenceCellAtPoint, onMoveReferenceCell]);

    const cancelReferenceDrag = useCallback(() => {
        if (!dragStartRef.current) return;
        clearReferenceDrag();
        window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    }, [clearReferenceDrag]);

    useEffect(() => {
        const handleWindowPointerMove = (event: PointerEvent) => {
            const start = dragStartRef.current;
            if (!start || event.pointerId !== start.pointerId) return;
            const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (distance >= 5) event.preventDefault();
            updateReferenceDrag(event.clientX, event.clientY);
        };
        const handleWindowPointerUp = (event: PointerEvent) => {
            const start = dragStartRef.current;
            if (!start || event.pointerId !== start.pointerId) return;
            finishReferenceDrag(event.clientX, event.clientY);
        };
        const handleWindowPointerCancel = (event: PointerEvent) => {
            const start = dragStartRef.current;
            if (!start || event.pointerId !== start.pointerId) return;
            cancelReferenceDrag();
        };
        const handleWindowMouseUp = () => {
            if (!dragStartRef.current) return;
            finishReferenceDrag(lastPointerRef.current.x, lastPointerRef.current.y);
        };
        const handleWindowBlur = () => cancelReferenceDrag();
        window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
        window.addEventListener("pointerup", handleWindowPointerUp, true);
        window.addEventListener("pointercancel", handleWindowPointerCancel, true);
        window.addEventListener("mouseup", handleWindowMouseUp, true);
        window.addEventListener("blur", handleWindowBlur);
        return () => {
            window.removeEventListener("pointermove", handleWindowPointerMove);
            window.removeEventListener("pointerup", handleWindowPointerUp, true);
            window.removeEventListener("pointercancel", handleWindowPointerCancel, true);
            window.removeEventListener("mouseup", handleWindowMouseUp, true);
            window.removeEventListener("blur", handleWindowBlur);
        };
    }, [cancelReferenceDrag, finishReferenceDrag, updateReferenceDrag]);

    const handleReferencePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>, rowId: string, columnIndex: number, hasMaterial: boolean) => {
        if (readOnly || !hasMaterial) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        dragStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, cell: { rowId, columnIndex } };
        suppressClickRef.current = false;
    }, [readOnly]);

    const handleReferencePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        updateReferenceDrag(event.clientX, event.clientY);
    }, [updateReferenceDrag]);

    const handleReferencePointerUp = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        finishReferenceDrag(event.clientX, event.clientY);
    }, [finishReferenceDrag]);

    const handleReferencePointerCancel = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        event.stopPropagation();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        cancelReferenceDrag();
    }, [cancelReferenceDrag]);

    return (
        <div
            data-canvas-no-zoom
            data-canvas-wheel-scroll
            data-canvas-batch-table
            className="relative flex h-full w-full flex-col overflow-visible pt-9 text-xs"
            style={{ color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
            onMouseDown={(event) => {
                // Only the top padding is a node drag surface; keep child controls isolated.
                if (event.target !== event.currentTarget) event.stopPropagation();
            }}
        >
            <input
                type="file"
                ref={uploadInputRef}
                accept="image/*"
                className="hidden"
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    const target = uploadTargetRef.current;
                    uploadTargetRef.current = null;
                    event.currentTarget.value = "";
                    if (file && target) onUploadReference(target.rowId, target.columnIndex, file);
                }}
            />
            {!readOnly ? <BatchReferenceHandles columns={referenceColumns} textColumns={textColumns} theme={theme} onAdd={onAddReferenceColumn} onAddText={onAddTextColumn} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} /> : null}
            <div
                className="flex min-h-12 flex-wrap items-center gap-2 border-b px-3 py-2"
                style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <Select size="small" value={table.operation} options={OPERATION_OPTIONS} disabled={readOnly} onChange={(operation) => onPatchTable({ operation })} className="w-28" aria-label="批量任务类型" />
                <span className="opacity-55">并发</span>
                <Select
                    size="small"
                    value={table.concurrency}
                    options={[10, 50, 100].map((value) => ({ value, label: String(value) }))}
                    disabled={readOnly}
                    onChange={(concurrency) => onPatchTable({ concurrency })}
                    className="w-20"
                    aria-label="并发数"
                />
                <span className="opacity-55">
                    {referenceColumns.length} 组参考 · 已连 {connectedImageCount} 张图 · 完成 {completed}/{table.rows.length}
                </span>
                {!readOnly ? (
                    <div className="flex min-w-[280px] max-w-[min(42vw,520px)] flex-1 items-center gap-2">
                        <span className="shrink-0 font-medium" style={{ color: theme.node.muted }}>全局提示词</span>
                        <Input.TextArea
                            size="small"
                            value={globalPrompt}
                            autoSize={{ minRows: 1, maxRows: 2 }}
                            placeholder="输入一次，覆盖所有任务提示词"
                            aria-label="全局提示词"
                            onChange={(event) => onPatchTable({ globalPrompt: event.target.value })}
                        />
                        {hasGlobalPrompt ? <span className="shrink-0 text-[11px]" style={{ color: theme.accent.primary }}>已覆盖全部</span> : null}
                    </div>
                ) : null}
                {!readOnly ? (
                    <div className="ml-auto flex gap-1.5">
                        <Button size="small" icon={<Rows3 className="size-3.5" />} onClick={onFillRows}>
                            同步连线
                        </Button>
                        <Button size="small" icon={<Plus className="size-3.5" />} onClick={onAddRow}>
                            加一行
                        </Button>
                        <Button size="small" type="primary" icon={<Play className="size-3.5" />} disabled={!table.rows.length} onClick={() => onGenerate()}>
                            生成未完成项
                        </Button>
                    </div>
                ) : null}
            </div>

            <div className="min-h-0 flex-1 overflow-auto rounded-b-[inherit]" onMouseDown={(event) => event.stopPropagation()}>
                <div className="sticky top-0 z-10 grid min-w-[820px] items-center gap-2 border-b px-3 py-2 font-medium" style={{ borderColor: theme.node.stroke, gridTemplateColumns, background: theme.node.panel, color: theme.node.muted }}>
                    <span>#</span>
                    <span>任务</span>
                    {referenceColumns.map((column) => (
                        <ReferenceColumnHeader key={column.id} column={column} theme={theme} readOnly={readOnly} dragging={draggingColumnId === column.id} onDragStart={() => setDraggingColumnId(column.id)} onDragEnd={() => setDraggingColumnId(null)} onDrop={(targetColumnId) => { if (draggingColumnId) onReorderReferenceColumns(draggingColumnId, targetColumnId); setDraggingColumnId(null); }} />
                    ))}
                    {textColumns.map((column, index) => (
                        <span key={column.id} className={index === 0 ? "border-l pl-3" : undefined} style={index === 0 ? { borderColor: theme.node.stroke } : undefined}>{column.label}</span>
                    ))}
                    <span>任务提示词</span>
                    <span>生成结果</span>
                    <span />
                </div>
                {table.rows.length ? (
                    table.rows.map((row, index) => {
                        const output = row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined;
                        const item = batchItemByRowId.get(row.id);
                        const status = rowStatus(item, output);
                        return (
                            <div key={row.id} className="grid min-w-[820px] items-center gap-2 border-b px-3 py-3" style={{ borderColor: theme.node.stroke, gridTemplateColumns }}>
                                <span className="tabular-nums opacity-45">{index + 1}</span>
                                <div className="flex items-center gap-1.5">
                                    <Switch size="small" checked={row.enabled !== false} disabled={readOnly} onChange={(enabled) => onUpdateRow(row.id, { enabled })} aria-label={`任务 ${index + 1}`} />
                                    <span className="text-[10px]" style={{ color: row.enabled === false ? theme.node.placeholder : theme.accent.primary }}>{row.enabled === false ? "关" : "开"}</span>
                                </div>
                                {referenceColumns.map((column, columnIndex) => (
                                    <ReferenceThumbnail
                                        key={column.id}
                                        node={nodeById.get(row.inputNodeIds[columnIndex])}
                                        theme={theme}
                                        readOnly={readOnly}
                                        rowId={row.id}
                                        columnIndex={columnIndex}
                                        columnId={column.id}
                                        draggingColumnId={draggingColumnId}
                                        isDraggingCell={draggingCell?.rowId === row.id && draggingCell.columnIndex === columnIndex}
                                        isDropTarget={dropCell?.rowId === row.id && dropCell.columnIndex === columnIndex}
                                        suppressClickRef={suppressClickRef}
                                        onReplace={onReplaceReference}
                                        onUpload={() => { uploadTargetRef.current = { rowId: row.id, columnIndex }; uploadInputRef.current?.click(); }}
                                        onPointerDown={handleReferencePointerDown}
                                        onPointerMove={handleReferencePointerMove}
                                        onPointerUp={handleReferencePointerUp}
                                        onPointerCancel={handleReferencePointerCancel}
                                        onLostPointerCapture={handleReferencePointerCancel}
                                    />
                                ))}
                                {textColumns.map((column, columnIndex) => (
                                    <div key={column.id} className={columnIndex === 0 ? "border-l pl-3" : undefined} style={columnIndex === 0 ? { borderColor: theme.node.stroke } : undefined}>
                                        <TextNodeCell node={row.textNodeIds?.[columnIndex] ? nodeById.get(row.textNodeIds[columnIndex]) : undefined} theme={theme} />
                                    </div>
                                ))}
                                <Input.TextArea value={batchPromptForRow(table, row)} readOnly={readOnly || hasGlobalPrompt} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={hasGlobalPrompt ? "已由全局提示词覆盖" : "描述这一行要生成的画面"} onChange={(event) => onUpdateRow(row.id, { prompt: event.target.value })} />
                                <div className="flex min-w-0 items-center gap-2">
                                    {output?.metadata?.content || output?.metadata?.storageKey ? (
                                        <CachedResourceImage
                                            eager
                                            src={output.metadata.previewContent || output.metadata.content}
                                            storageKey={output.metadata.storageKey}
                                            alt="生成结果"
                                            className="size-12 rounded object-cover"
                                            fallback={<EmptyThumbnail theme={theme} />}
                                        />
                                    ) : (
                                        <EmptyThumbnail theme={theme} />
                                    )}
                                    <div className="min-w-0">
                                        <div className="truncate font-medium">{status.label}</div>
                                        {!readOnly && status.retryable && batch && item ? (
                                            <Button type="link" size="small" className="h-auto p-0 text-[11px]" icon={<RefreshCw className="size-3" />} onClick={() => onRetryItem(batch.id, item.id)}>
                                                重试
                                            </Button>
                                        ) : null}
                                    </div>
                                    {status.loading ? <LoaderCircle className="ml-auto size-4 animate-spin opacity-55" /> : null}
                                </div>
                                {!readOnly ? (
                                    <Tooltip title="移除这一行">
                                        <Button type="text" size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onRemoveRow(row.id)} />
                                    </Tooltip>
                                ) : (
                                    <span />
                                )}
                            </div>
                        );
                    })
                ) : (
                    <div className="grid h-40 place-items-center px-5 text-center" style={{ color: theme.node.muted }}>连接图片后会自动生成任务；点击缩略图可替换素材，拖动参考图列可调整顺序。</div>
                )}
            </div>
        </div>
    );
}

function ReferenceColumnHeader({ column, theme, readOnly, dragging, onDragStart, onDragEnd, onDrop }: { column: { id: string; label: string }; theme: CanvasTheme; readOnly: boolean; dragging: boolean; onDragStart: () => void; onDragEnd: () => void; onDrop: (columnId: string) => void }) {
    return (
        <span
            draggable={!readOnly}
            className="flex min-w-0 items-center gap-1 rounded px-1 py-1 transition-opacity"
            style={{ opacity: dragging ? 0.45 : 1, cursor: readOnly ? "default" : "grab" }}
            title={readOnly ? column.label : `${column.label}：拖动调整顺序`}
            onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", column.id);
                onDragStart();
            }}
            onDragEnd={onDragEnd}
            onDragOver={(event) => { if (!readOnly) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; } }}
            onDrop={(event) => { event.preventDefault(); onDrop(column.id); }}
        >
            {!readOnly ? <GripVertical className="size-3 shrink-0 opacity-45" /> : null}
            <span className="truncate">{column.label}</span>
        </span>
    );
}

function BatchTextHandle(props: Omit<React.ComponentProps<typeof BatchReferenceHandle>, "column"> & { column: { id: string; label: string } }) {
    return <BatchReferenceHandle {...props} column={props.column} handlePrefix="text" />;
}

function BatchReferenceHandles({
    columns,
    textColumns,
    theme,
    onAdd,
    onAddText,
    onConnectStart,
    onConnectDrop,
}: {
    columns: ReturnType<typeof batchReferenceColumns>;
    textColumns: ReturnType<typeof batchTextColumns>;
    theme: CanvasTheme;
    onAdd: () => void;
    onAddText: () => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
}) {
    const commonStyle = { left: 0, width: 44, height: 44, transform: "translate(-50%, -50%)", transformOrigin: "center" };
    const referenceAddTop = BATCH_REFERENCE_HANDLE_TOP + columns.length * BATCH_REFERENCE_HANDLE_GAP;
    const textTop = batchTextHandleTop(columns.length);
    return (
        <>
            {columns.map((column, index) => (
                <BatchReferenceHandle key={column.id} column={column} top={BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP} badge={String(index + 1)} theme={theme} commonStyle={commonStyle} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} />
            ))}
            {textColumns.map((column, index) => (
                <BatchTextHandle key={column.id} column={column} top={textTop + index * BATCH_REFERENCE_HANDLE_GAP} badge={`T${index + 1}`} theme={theme} commonStyle={commonStyle} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} />
            ))}
            {columns.length < MAX_BATCH_REFERENCE_COLUMNS ? (
                <Tooltip title={`新增参考图 ${columns.length + 1}`} placement="left">
                    <button type="button" aria-label={`新增参考图 ${columns.length + 1}`} className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none" style={{ ...commonStyle, top: referenceAddTop, color: theme.accent.primary }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAdd(); }}>
                        <span className="grid size-[22px] place-items-center rounded-full border shadow-sm transition-transform group-hover:scale-110 group-focus-visible:scale-110" style={{ background: theme.node.panel, borderColor: theme.accent.primary }}><Plus className="size-3" /></span>
                    </button>
                </Tooltip>
            ) : null}
            {textColumns.length < MAX_BATCH_TEXT_COLUMNS ? (
                <Tooltip title={`新增文字 ${textColumns.length + 1}`} placement="left">
                    <button type="button" aria-label={`新增文字 ${textColumns.length + 1}`} className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none" style={{ ...commonStyle, top: textTop + textColumns.length * BATCH_REFERENCE_HANDLE_GAP, color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onAddText(); }}>
                        <span className="grid size-[22px] place-items-center rounded-full border shadow-sm transition-transform group-hover:scale-110 group-focus-visible:scale-110" style={{ background: theme.node.panel, borderColor: theme.node.stroke }}><Plus className="size-3" /></span>
                    </button>
                </Tooltip>
            ) : null}
        </>
    );
}

function BatchReferenceHandle({
    column,
    top,
    badge,
    theme,
    commonStyle,
    onConnectStart,
    onConnectDrop,
    handlePrefix = "reference",
}: {
    column: { id: string; label: string };
    top: number;
    badge: string;
    theme: CanvasTheme;
    commonStyle: { left: number; width: number; height: number; transform: string; transformOrigin: string };
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    handlePrefix?: "reference" | "text";
}) {
    const [hovered, setHovered] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const handleId = handlePrefix === "text" ? batchTextHandleId(column.id) : batchReferenceHandleId(column.id);
    const reset = useCallback(() => {
        setHovered(false);
        setOffset({ x: 0, y: 0 });
    }, []);
    const update = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const limit = 16;
        setOffset({ x: Math.max(-limit, Math.min(limit, dx)), y: Math.max(-limit, Math.min(limit, dy)) });
    }, []);
    return (
        <Tooltip title={`磁吸到${column.label}`} placement="left">
            <button
                type="button"
                aria-label={`${column.label}连线点`}
                className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none"
                style={{ ...commonStyle, top, cursor: "crosshair" }}
                onPointerEnter={(event) => {
                    setHovered(true);
                    update(event);
                }}
                onPointerMove={update}
                onPointerLeave={reset}
                onPointerDown={(event) => {
                    event.stopPropagation();
                    onConnectStart(event, handleId);
                }}
                onPointerUp={(event) => {
                    event.stopPropagation();
                    onConnectDrop?.(event, handleId);
                }}
            >
                <span
                    className="grid size-[22px] place-items-center rounded-full border text-[9px] font-semibold shadow-sm transition-transform duration-100 group-hover:scale-125 group-focus-visible:scale-125"
                    style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${hovered ? 1.08 : 1})`, background: theme.node.panel, borderColor: handlePrefix === "text" ? theme.node.stroke : theme.accent.primary, color: handlePrefix === "text" ? theme.node.text : theme.accent.primary }}
                >
                    {badge}
                </span>
            </button>
        </Tooltip>
    );
}
function TextNodeCell({ node, theme }: { node?: CanvasNodeData; theme: CanvasTheme }) {
    const content = node?.metadata?.content || node?.metadata?.prompt;
    return <div className="min-h-12 max-w-full overflow-hidden rounded border px-2 py-1.5 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, color: content ? theme.node.text : theme.node.placeholder }} title={content || "未连接文字节点"}>{content || "未连接文字"}</div>;
}

function ReferenceThumbnail({ node, theme, readOnly, rowId, columnIndex, columnId, draggingColumnId, isDraggingCell, isDropTarget, suppressClickRef, onReplace, onUpload, onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onLostPointerCapture }: {
    node?: CanvasNodeData;
    theme: CanvasTheme;
    readOnly: boolean;
    rowId: string;
    columnIndex: number;
    columnId: string;
    draggingColumnId: string | null;
    isDraggingCell: boolean;
    isDropTarget: boolean;
    suppressClickRef: MutableRefObject<boolean>;
    onReplace: (node: CanvasNodeData) => void;
    onUpload: () => void;
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>, rowId: string, columnIndex: number, hasMaterial: boolean) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
    const cellData = { "data-batch-reference-cell": true, "data-batch-row-id": rowId, "data-batch-column-index": String(columnIndex) };
    const dropStyle = isDropTarget ? { boxShadow: `0 0 0 2px ${theme.accent.primary}, 0 0 0 5px ${theme.accent.primary}33` } : undefined;
    if (!node || (!node.metadata?.content && !node.metadata?.storageKey)) {
        return (
            <Tooltip title={readOnly ? "未连接参考图" : "点击上传参考图"}>
                <button
                    type="button"
                    draggable={false}
                    className="group relative grid size-16 min-w-0 place-items-center rounded-md border border-dashed outline-none transition-all focus-visible:ring-2"
                    style={{ borderColor: isDropTarget ? theme.accent.primary : theme.node.stroke, background: `${theme.node.panel}88`, ...dropStyle }}
                    disabled={readOnly}
                    onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onUpload(); }}
                    aria-label={`${columnId}，点击上传图片`}
                    {...cellData}
                    onPointerDown={(event) => onPointerDown(event, rowId, columnIndex, false)}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onPointerCancel={onPointerCancel}
                    onLostPointerCapture={onLostPointerCapture}
                    onDragStart={(event) => event.preventDefault()}
                >
                    <EmptyThumbnail theme={theme} sizeClass="size-16 border-0" />
                    {!readOnly ? <span className="pointer-events-none absolute inset-x-1 bottom-1 rounded bg-black/60 px-1 py-1 text-center text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100">点击上传</span> : null}
                </button>
            </Tooltip>
        );
    }
    const fallback = <EmptyThumbnail theme={theme} />;
    return (
        <Tooltip title={readOnly ? (node.title || "图片") : `${node.title || "图片"} · 点击替换，拖动排序`}>
            <button
                type="button"
                draggable={false}
                className="group relative size-16 min-w-0 touch-none overflow-hidden rounded-md border outline-none transition-all hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2"
                style={{ borderColor: isDropTarget || draggingColumnId === columnId ? theme.accent.primary : theme.node.stroke, opacity: isDraggingCell || draggingColumnId === columnId ? 0.55 : 1, ...dropStyle }}
                aria-label={readOnly ? node.title || "参考图" : `${node.title || "参考图"}，点击替换素材`}
                onClick={(event) => { event.stopPropagation(); if (!readOnly && !draggingColumnId && !suppressClickRef.current) onReplace(node); }}
                {...cellData}
                onPointerDown={(event) => onPointerDown(event, rowId, columnIndex, true)}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerCancel}
                onLostPointerCapture={onLostPointerCapture}
                onDragStart={(event) => event.preventDefault()}
            >
                <CachedResourceImage draggable={false} eager src={node.metadata.previewContent || node.metadata.content} storageKey={node.metadata.storageKey} alt={node.title || "参考图"} className="size-16 select-none object-cover" fallback={fallback} />
                {!readOnly ? <span className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/55 px-1 py-1 text-[9px] text-white opacity-0 transition-opacity group-hover:opacity-100"><Upload className="size-3" />替换</span> : null}
            </button>
        </Tooltip>
    );
}

function EmptyThumbnail({ theme, sizeClass = "size-12" }: { theme: CanvasTheme; sizeClass?: string }): ReactNode {
    return (
        <div className={`grid ${sizeClass} shrink-0 place-items-center rounded border`} style={{ borderColor: theme.node.stroke, color: theme.node.placeholder }}>
            <ImageIcon className="size-5" />
        </div>
    );
}

function rowStatus(item: CanvasGenerationBatchItem | undefined, output: CanvasNodeData | undefined) {
    if (output?.metadata?.content) return { label: "生成完成", loading: false, retryable: false };
    if (item?.status === "failed") return { label: item.errorDetails || "生成失败", loading: false, retryable: true };
    if (item?.status === "cancelled") return { label: "已停止", loading: false, retryable: false };
    if (item && ["waiting", "submitting", "queued", "running"].includes(item.status))
        return { label: item.status === "waiting" ? "等待中" : item.status === "submitting" ? "正在提交" : item.status === "queued" ? "已排队" : "生成中", loading: true, retryable: false };
    if (output?.metadata?.status === "error") return { label: output.metadata.errorDetails || "生成失败", loading: false, retryable: false };
    return { label: "待生成", loading: false, retryable: false };
}
