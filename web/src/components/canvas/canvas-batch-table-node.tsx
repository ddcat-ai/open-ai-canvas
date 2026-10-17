import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Button, Switch, Tooltip } from "antd";
import { Film, Image as ImageIcon, LoaderCircle, Maximize2, Minus, Play, Plus, Rows3, Trash2, Upload } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import { AppModal } from "@/components/ui/product/app-modal";
import {
    BATCH_REFERENCE_HANDLE_GAP,
    BATCH_REFERENCE_HANDLE_TOP,
    MAX_BATCH_REFERENCE_COLUMNS,
    MIN_BATCH_REFERENCE_COLUMNS,
    batchPromptForRow,
    batchReferenceColumns,
    batchReferenceHandleId,
    batchReferenceMentionToken,
    batchTextColumns,
    batchRowReady as rowReady,
} from "@/lib/canvas/canvas-batch-table";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasBatchOperation, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasNodeData } from "@/types/canvas";
import { generationErrorMessage } from "@/lib/generation-error";
import { BATCH_COLUMN_HEADER_HEIGHT, BATCH_ROW_HEIGHT, batchOutputResultPending, batchRowInputChanged, type BatchScroll } from "@/lib/canvas/canvas-batch-references";
import { batchRenderedRowIndices, batchVisibleRowRange, BATCH_VIRTUAL_ROW_THRESHOLD } from "@/lib/canvas/canvas-batch-window";
import { sameBatchReferenceNode } from "@/lib/canvas/canvas-batch-row-equality";

type ReferenceCell = { rowId: string; columnIndex: number };

type Props = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    batch?: CanvasGenerationBatch;
    theme: CanvasTheme;
    onPatchTable: (patch: Partial<CanvasBatchTableData>) => void;
    onAddRow: (afterRowId?: string) => string | void;
    onRemoveRow: (rowId: string) => void;
    onUpdateRow: (rowId: string, patch: Partial<CanvasBatchRow>) => void;
    onFillRows: () => void;
    onGenerate: (rowIds?: string[]) => void;
    onCreateStoryboard?: () => void;
    onRetryItem: (batchId: string, itemId: string) => void;
    onAddReferenceColumn: () => void;
    onRemoveReferenceColumn?: () => void;
    onFocusOutput?: (nodeId: string) => void;
    onReorderReferenceColumns?: (fromColumnId: string, toColumnId: string) => void;
    onMoveReferenceCell?: (sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => void;
    onUploadReference?: (rowId: string, columnIndex: number, file: File) => void;
    onPickReference?: (rowId: string, columnIndex: number) => void;
    onRemoveReference?: (rowId: string, columnIndex: number) => void;
    onScrollChange?: (scroll: BatchScroll) => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    readOnly?: boolean;
};

const OPERATION_OPTIONS = [
    { value: "try_on", label: "批量换装" },
    { value: "creative", label: "创意生图" },
] satisfies Array<{ value: CanvasBatchOperation; label: string }>;

const CONCURRENCY_OPTIONS = [1, 5, 10] as const;

function stopScrollbarMouseDown(event: ReactMouseEvent<HTMLDivElement>) {
    const scroll = event.currentTarget;
    if (event.target !== scroll) return;
    // 原生滚动条的事件落在滚动容器上；只拦截沟槽，保留内容留白的节点拖动。
    const bounds = scroll.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * scroll.offsetWidth / bounds.width;
    const y = (event.clientY - bounds.top) * scroll.offsetHeight / bounds.height;
    if (x < scroll.clientLeft || x >= scroll.clientLeft + scroll.clientWidth || y < scroll.clientTop || y >= scroll.clientTop + scroll.clientHeight) event.stopPropagation();
}

export function CanvasBatchTableNodeContent({ node, nodes, connections, batch, theme, onPatchTable, onAddRow, onRemoveRow, onUpdateRow, onFillRows, onGenerate, onCreateStoryboard, onRetryItem, onAddReferenceColumn, onRemoveReferenceColumn, onReorderReferenceColumns, onMoveReferenceCell, onUploadReference, onPickReference, onRemoveReference, onScrollChange, onFocusOutput, onConnectStart, onConnectDrop, readOnly = false }: Props) {
    const table = node.metadata?.batchTable || { operation: "try_on" as const, concurrency: 10, rows: [] };
    const referenceColumns = useMemo(() => batchReferenceColumns(table), [table.referenceColumns]);
    const textColumns = useMemo(() => batchTextColumns(table), [table.textColumns]);
    const globalPrompt = table.globalPrompt || "";
    const hasGlobalPrompt = Boolean(globalPrompt.trim());
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const connectedImageCount = useMemo(() => new Set(connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output").map((connection) => connection.fromNodeId)).size, [connections, node.id]);
    const completed = table.rows.filter((row) => hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const unfinishedReadyCount = table.rows.filter((row) => rowReady(row, table, nodeById) && !hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const gridTemplateColumns = `64px repeat(${referenceColumns.length}, 88px) ${textColumns.length ? `repeat(${textColumns.length}, minmax(168px, 0.75fr)) ` : ""}minmax(280px, 1fr) 88px 80px`;
    const subtleSurface = `color-mix(in srgb, ${theme.node.text} 4%, transparent)`;
    const inputSurface = theme.node.panel;
    const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
    const [draggingCell, setDraggingCell] = useState<ReferenceCell | null>(null);
    const draggingCellRef = useRef<ReferenceCell | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; pointerId: number; cell: ReferenceCell } | null>(null);
    const suppressClickRef = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const scrollFrameRef = useRef<number | null>(null);
    const [visibleRange, setVisibleRange] = useState(() => batchVisibleRowRange(table.rows.length, 0, node.height - 121));
    const [focusedRowId, setFocusedRowId] = useState<string | null>(null);
    const rowCountRef = useRef(table.rows.length);
    rowCountRef.current = table.rows.length;
    const updateVisibleRange = useCallback(() => {
        const scroll = scrollRef.current;
        if (!scroll || rowCountRef.current <= BATCH_VIRTUAL_ROW_THRESHOLD) return;
        const next = batchVisibleRowRange(rowCountRef.current, scroll.scrollTop, scroll.clientHeight);
        setVisibleRange(previous => previous.start === next.start && previous.end === next.end ? previous : next);
    }, []);
    const renderedIndices = batchRenderedRowIndices(table.rows.length, visibleRange, table.rows.findIndex(row => row.id === focusedRowId));
    const onScrollChangeRef = useRef(onScrollChange);
    useLayoutEffect(() => { onScrollChangeRef.current = onScrollChange; });
    const reportScroll = useCallback(() => {
        if (scrollFrameRef.current !== null) return;
        scrollFrameRef.current = requestAnimationFrame(() => {
            scrollFrameRef.current = null;
            const scroll = scrollRef.current;
            if (scroll) { updateVisibleRange(); onScrollChangeRef.current?.({ top: scroll.scrollTop, left: scroll.scrollLeft }); }
        });
    }, [updateVisibleRange]);
    useLayoutEffect(() => {
        const scroll = scrollRef.current;
        if (scroll) onScrollChangeRef.current?.({ top: scroll.scrollTop, left: scroll.scrollLeft });
        updateVisibleRange();
        const resize = new ResizeObserver(reportScroll);
        if (scroll) resize.observe(scroll);
        return () => { resize.disconnect(); if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current); scrollFrameRef.current = null; };
    }, [node.id, reportScroll, updateVisibleRange]);
    useLayoutEffect(updateVisibleRange, [table.rows.length, updateVisibleRange]);
    const pendingAddedRowRef = useRef<string | void>(undefined);
    const [editingRowId, setEditingRowId] = useState<string | null>(null);
    const editingRow = table.rows.find((row) => row.id === editingRowId);
    const editingRowIndex = editingRow ? table.rows.indexOf(editingRow) : -1;
    const editingRowLoading = editingRow ? rowStatus(batchItemByRowId.get(editingRow.id), nodeById.get(editingRow.outputNodeId || "")).loading : false;
    const canGenerateEditingRow = Boolean(editingRow && !readOnly && rowReady(editingRow, table, nodeById) && !editingRowLoading);

    const addRow = (afterRowId?: string) => {
        pendingAddedRowRef.current = onAddRow(afterRowId);
    };

    useEffect(() => {
        const rowId = pendingAddedRowRef.current;
        const scroll = scrollRef.current;
        if (!rowId || !scroll) return;
        const index = table.rows.findIndex(row => row.id === rowId);
        if (index < 0) { pendingAddedRowRef.current = undefined; return; }
        scroll.scrollTop = index * BATCH_ROW_HEIGHT;
        updateVisibleRange();
        const row = scroll.querySelector<HTMLElement>(`[data-batch-row-id="${CSS.escape(rowId)}"]`);
        if (!row) return;
        pendingAddedRowRef.current = undefined;
        reportScroll();
        row.querySelector<HTMLElement>('[data-batch-prompt] textarea, [data-batch-prompt] [contenteditable="true"]')?.focus({ preventScroll: true });
    }, [table.rows, reportScroll, updateVisibleRange, visibleRange]);

    const clearReferenceDrag = useCallback(() => {
        dragStartRef.current = null;
        draggingCellRef.current = null;
        setDraggingCell(null);
    }, []);

    const findReferenceCellAtPoint = useCallback((clientX: number, clientY: number) => {
        const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-batch-reference-cell]");
        if (target?.dataset.targetNodeId !== node.id) return null;
        const rowId = target?.dataset.rowId;
        const columnIndex = Number(target?.dataset.columnIndex);
        return rowId && Number.isInteger(columnIndex) ? { rowId, columnIndex } : null;
    }, [node.id]);

    useEffect(() => {
        if (readOnly) return;
        const handleMove = (event: PointerEvent) => {
            const start = dragStartRef.current;
            if (!start || start.pointerId !== event.pointerId) return;
            const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
            if (!draggingCellRef.current && distance < 5) return;
            if (!draggingCellRef.current) {
                draggingCellRef.current = start.cell;
                suppressClickRef.current = true;
                setDraggingCell(start.cell);
            }
        };
        const handleUp = (event: PointerEvent) => {
            const start = dragStartRef.current;
            if (!start || start.pointerId !== event.pointerId) return;
            const sourceCell = draggingCellRef.current;
            const targetCell = sourceCell ? findReferenceCellAtPoint(event.clientX, event.clientY) : null;
            if (sourceCell && targetCell) onMoveReferenceCell?.(sourceCell.rowId, sourceCell.columnIndex, targetCell.rowId, targetCell.columnIndex);
            const didDrag = Boolean(sourceCell);
            clearReferenceDrag();
            if (didDrag) {
                suppressClickRef.current = true;
                window.setTimeout(() => { suppressClickRef.current = false; }, 0);
            }
        };
        window.addEventListener("pointermove", handleMove);
        window.addEventListener("pointerup", handleUp);
        const handleCancel = () => { clearReferenceDrag(); suppressClickRef.current = false; };
        window.addEventListener("pointercancel", handleCancel);
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
            window.removeEventListener("pointercancel", handleCancel);
        };
    }, [clearReferenceDrag, findReferenceCellAtPoint, onMoveReferenceCell, readOnly]);

    const startCellDrag = (event: ReactPointerEvent, rowId: string, columnIndex: number) => {
        if (readOnly || event.button !== 0) return;
        event.stopPropagation();
        dragStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, cell: { rowId, columnIndex } };
    };

    const pickReference = (rowId: string, columnIndex: number) => {
        if (readOnly) return;
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }
        onPickReference?.(rowId, columnIndex);
    };

    const rowActions = useRef<BatchRowActions>({ onUpdateRow, onGenerate, onRemoveRow, onFocusOutput, onUploadReference, onRemoveReference, addRow, pickReference, startCellDrag, setEditingRowId });
    useLayoutEffect(() => {
        rowActions.current = { onUpdateRow, onGenerate, onRemoveRow, onFocusOutput, onUploadReference, onRemoveReference, addRow, pickReference, startCellDrag, setEditingRowId };
    });

    return (
        <div data-canvas-batch-table data-canvas-no-zoom data-canvas-wheel-scroll className="relative flex h-full w-full flex-col overflow-visible text-xs" style={{ color: theme.node.text }}>
            {!readOnly ? <BatchReferenceHandles columns={referenceColumns} theme={theme} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} /> : null}

            <div className="shrink-0 overflow-hidden rounded-t-[inherit] border-b" style={{ borderColor: theme.node.stroke, background: subtleSurface }}>
                <div data-canvas-batch-drag className="flex h-11 cursor-grab items-center gap-2 px-3 active:cursor-grabbing">
                    <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden" onPointerDown={(event) => event.stopPropagation()}>
                        <BatchChoiceGroup ariaLabel="批量任务类型" theme={theme} disabled={readOnly} options={OPERATION_OPTIONS} value={table.operation} onChange={(operation) => onPatchTable({ operation: operation as CanvasBatchOperation })} />
                        <div className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2" style={{ background: theme.node.panel }}>
                            <span className="font-medium" style={{ color: theme.node.muted }}>并发</span>
                            <BatchChoiceGroup ariaLabel="并发数" theme={theme} disabled={readOnly} compact options={CONCURRENCY_OPTIONS.map((value) => ({ value, label: String(value) }))} value={table.concurrency} onChange={(concurrency) => onPatchTable({ concurrency: Number(concurrency) })} />
                        </div>
                        <div className="flex h-8 shrink-0 items-center gap-0.5 rounded-lg px-2" style={{ background: theme.node.panel, color: theme.node.muted }}>
                            <span className="pr-1">{referenceColumns.length}/{MAX_BATCH_REFERENCE_COLUMNS} 组参考</span>
                            {!readOnly ? (
                                <>
                                    <Tooltip title={referenceColumns.length <= MIN_BATCH_REFERENCE_COLUMNS ? "至少保留 1 组参考图" : "减少一组参考图"}>
                                        <button type="button" aria-label="减少一组参考图" className="grid size-5 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10" style={{ color: theme.node.text }} disabled={referenceColumns.length <= MIN_BATCH_REFERENCE_COLUMNS} onClick={onRemoveReferenceColumn}>
                                            <Minus className="size-3.5" />
                                        </button>
                                    </Tooltip>
                                    <Tooltip title={referenceColumns.length >= MAX_BATCH_REFERENCE_COLUMNS ? `最多支持 ${MAX_BATCH_REFERENCE_COLUMNS} 组参考图` : `新增参考图 ${referenceColumns.length + 1}`}>
                                        <button type="button" aria-label={`新增参考图 ${referenceColumns.length + 1}`} className="grid size-5 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-2 focus-visible:outline-offset-1 dark:hover:bg-white/10" style={{ color: theme.node.text }} disabled={referenceColumns.length >= MAX_BATCH_REFERENCE_COLUMNS} onClick={onAddReferenceColumn}>
                                            <Plus className="size-3.5" />
                                        </button>
                                    </Tooltip>
                                </>
                            ) : null}
                        </div>
                        <span className="shrink-0 tabular-nums" style={{ color: theme.node.muted }}>已连 {connectedImageCount} · 完成 {completed}/{table.rows.length}</span>
                    </div>
                    {!readOnly ? (
                        <div className="ml-auto flex shrink-0 items-center gap-1.5" onPointerDown={(event) => event.stopPropagation()}>
                            <Tooltip title="列端口已自动生效。用列图片重新填充手动修改过的格子，覆盖前需确认">
                                <Button size="small" type="text" icon={<Rows3 className="size-3.5" />} onClick={onFillRows}>按列填充</Button>
                            </Tooltip>
                            {table.contentKind === "storyboard" && onCreateStoryboard ? <Button size="small" icon={<Film className="size-3.5" />} onClick={onCreateStoryboard}>创建视频脚本</Button> : null}
                            <Button size="small" type="primary" icon={<Play className="size-3.5" />} disabled={!unfinishedReadyCount} onClick={() => onGenerate()}>
                                生成未完成项{unfinishedReadyCount ? ` · ${unfinishedReadyCount}` : ""}
                            </Button>
                        </div>
                    ) : null}
                </div>
                <div className="flex h-[76px] flex-col gap-1.5 border-t px-3 py-2" style={{ borderColor: theme.node.stroke }} onPointerDown={(event) => event.stopPropagation()}>
                    <div className="flex items-center gap-2">
                        <label data-canvas-no-drag htmlFor={`batch-global-prompt-${node.id}`} className="shrink-0 text-sm font-semibold">全局提示词</label>
                        <span className="rounded px-2 py-0.5 font-medium" style={{ background: theme.accent.primarySoft, color: theme.node.text }}>{hasGlobalPrompt ? "所有行统一使用" : "各行分别填写"}</span>
                        <span className="ml-auto truncate" style={{ color: theme.node.muted }}>{table.operation === "try_on" ? "换装预设 · 每行至少 2 张参考图" : "创意预设 · 每行至少 1 张参考图"}</span>
                    </div>
                    <input
                        id={`batch-global-prompt-${node.id}`}
                        value={globalPrompt}
                        readOnly={readOnly}
                        placeholder="填写后，所有行统一使用这段提示词；清空后恢复使用各行原文"
                        aria-label="全局提示词"
                        className="h-8 min-w-0 w-full rounded-md border px-2.5 text-sm outline-none focus-visible:ring-2"
                        style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => onPatchTable({ globalPrompt: event.target.value })}
                    />
                </div>
            </div>

            <div ref={scrollRef} data-batch-scroll className="thin-scrollbar min-h-0 flex-1 overflow-auto overscroll-contain rounded-b-[inherit]" onMouseDown={stopScrollbarMouseDown} onScroll={reportScroll} onFocusCapture={event => { const id = (event.target as HTMLElement).closest<HTMLElement>("[data-batch-row-id]")?.dataset.batchRowId; if (id) setFocusedRowId(current => current === id ? current : id); }} onPointerDown={(event) => event.stopPropagation()}>
                <div style={{ minWidth: 64 + referenceColumns.length * 88 + textColumns.length * 168 + 280 + 88 + 80 + 24 }}>
                <div className="sticky top-0 z-10 grid items-center border-b px-3 text-center text-[11px] font-medium" style={{ height: BATCH_COLUMN_HEADER_HEIGHT, borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted, gridTemplateColumns }}>
                    <span className="min-w-0 truncate px-1">任务</span>
                    {referenceColumns.map((column) => (
                        <span
                            key={column.id}
                            data-canvas-no-drag
                            draggable={!readOnly}
                            title={column.label}
                            className="min-w-0 cursor-grab truncate px-1 active:cursor-grabbing"
                            style={{ opacity: draggingColumnId === column.id ? 0.45 : 1 }}
                            onDragStart={() => setDraggingColumnId(column.id)}
                            onDragEnd={() => setDraggingColumnId(null)}
                            onDragOver={(event) => { event.preventDefault(); }}
                            onDrop={() => { if (draggingColumnId) onReorderReferenceColumns?.(draggingColumnId, column.id); setDraggingColumnId(null); }}
                        >
                            {column.label}
                        </span>
                    ))}
                    {textColumns.map((column) => <span key={column.id} className="min-w-0 truncate px-1" title={column.label}>{column.label}</span>)}
                    <span className="min-w-0 truncate px-1">任务提示词</span>
                    <span className="min-w-0 truncate px-1">生成结果</span>
                    <span className="min-w-0 truncate px-1">操作</span>
                </div>

                {table.rows.length ? (
                    <>
                        {renderedIndices.map((index, position) => {
                            const row = table.rows[index];
                            const gap = index - (position ? renderedIndices[position - 1] + 1 : 0);
                            return <Fragment key={row.id}>
                                {gap > 0 ? <div aria-hidden data-batch-row-spacer style={{ height: gap * BATCH_ROW_HEIGHT }} /> : null}
                                <BatchTableRow tableId={node.id} row={row} index={index} table={table} nodeById={nodeById} item={batchItemByRowId.get(row.id)} referenceColumns={referenceColumns} textColumns={textColumns} theme={theme} readOnly={readOnly} gridTemplateColumns={gridTemplateColumns} draggingColumnIndex={draggingCell?.rowId === row.id ? draggingCell.columnIndex : undefined} actions={rowActions} />
                            </Fragment>;
                        })}
                        {(renderedIndices.at(-1) ?? -1) < table.rows.length - 1 ? <div aria-hidden data-batch-row-spacer style={{ height: (table.rows.length - (renderedIndices.at(-1) ?? -1) - 1) * BATCH_ROW_HEIGHT }} /> : null}
                    </>
                ) : (
                    <div className="grid min-h-44 place-items-center px-5 text-center">
                        <div className="flex max-w-sm flex-col items-center gap-2">
                            <div className="grid size-10 place-items-center rounded-xl" style={{ background: theme.accent.primarySoft, color: theme.node.text }}><Rows3 className="size-5" /></div>
                            <div className="font-medium">还没有批量任务</div>
                            <p className="m-0 leading-5" style={{ color: theme.node.muted }}>左侧 1、2 端口直接给对应列配图；也可以添加任务，点击格子选图或直接连到某一格。</p>
                            {!readOnly ? <Button icon={<Plus className="size-3.5" />} onClick={() => addRow()}>添加第一条任务</Button> : null}
                        </div>
                    </div>
                )}
                {table.rows.length > 0 && !readOnly ? <div className="px-3 py-2"><Button block type="dashed" icon={<Plus className="size-4" />} onClick={() => addRow()}>添加任务</Button></div> : null}
                </div>
            </div>
            {editingRow ? (
                <AppModal
                    open centered width="min(860px, calc(100vw - 32px))"
                    title={`任务 ${editingRowIndex + 1} · ${readOnly ? "查看" : "编辑"}提示词`}
                    onCancel={() => setEditingRowId(null)}
                    footer={
                        <div className="flex items-center justify-end gap-2">
                            <span className="mr-auto text-xs" style={{ color: theme.node.muted }}>{readOnly ? "只读查看" : "与表内同一份内容，修改即时回填"}</span>
                            {!readOnly ? <Button type="primary" disabled={!canGenerateEditingRow} onClick={() => onGenerate([editingRow.id])}>生成此行</Button> : null}
                            <Button aria-label="完成" onClick={() => setEditingRowId(null)}>完成</Button>
                        </div>
                    }
                >
                    <div data-canvas-no-drag data-canvas-no-zoom onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
                        <p style={{ color: theme.node.muted }}>{hasGlobalPrompt ? "当前所有行统一使用全局提示词。这里编辑的本行原文会保留，清空全局提示词后生效。" : "本次生成使用本行提示词。输入 @ 可引用本行参考图。"}</p>
                        <CanvasResourceMentionTextarea
                            value={editingRow.prompt}
                            references={batchRowMentionReferences(editingRow, referenceColumns, nodeById)}
                            readOnly={readOnly} sendOnEnter={false}
                            aria-label={`放大${readOnly ? "查看" : "编辑"}任务 ${editingRowIndex + 1} 提示词内容`}
                            containerClassName="h-[min(50dvh,420px)]"
                            className="thin-scrollbar h-full w-full resize-none overflow-y-auto overscroll-contain rounded-lg border p-4 text-base leading-7 outline-none focus-visible:ring-2"
                            style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                            onChange={(prompt) => onUpdateRow(editingRow.id, { prompt })}
                            onSubmit={canGenerateEditingRow ? () => onGenerate([editingRow.id]) : undefined}
                        />
                    </div>
                </AppModal>
            ) : null}
        </div>
    );
}

type BatchRowActions = Pick<Props, "onUpdateRow" | "onGenerate" | "onRemoveRow" | "onFocusOutput" | "onUploadReference" | "onRemoveReference"> & {
    addRow: (afterRowId?: string) => void;
    pickReference: (rowId: string, columnIndex: number) => void;
    startCellDrag: (event: ReactPointerEvent, rowId: string, columnIndex: number) => void;
    setEditingRowId: (rowId: string) => void;
};

type BatchTableRowProps = {
    tableId: string;
    row: CanvasBatchRow;
    index: number;
    table: CanvasBatchTableData;
    nodeById: Map<string, CanvasNodeData>;
    item?: CanvasGenerationBatchItem;
    referenceColumns: ReturnType<typeof batchReferenceColumns>;
    textColumns: ReturnType<typeof batchTextColumns>;
    theme: CanvasTheme;
    readOnly: boolean;
    gridTemplateColumns: string;
    draggingColumnIndex?: number;
    actions: RefObject<BatchRowActions>;
};

// 单行编辑不重绘整张表；源图、文本来源、生成状态及行序变化仍需更新对应行。
const BatchTableRow = memo(function BatchTableRow({ tableId, row, index, table, nodeById, item, referenceColumns, textColumns, theme, readOnly, gridTemplateColumns, draggingColumnIndex, actions }: BatchTableRowProps) {
    const output = row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined;
    const hasGlobalPrompt = Boolean(table.globalPrompt?.trim());
    const globalPrompt = table.globalPrompt || "";
    const inputSurface = theme.node.panel;
    const status = row.enabled ? rowStatus(item, output) : { label: "已停用", tone: "idle" as const, loading: false, retryable: false };
    const ready = rowReady(row, table, nodeById);
    const completedRow = hasNodeMedia(output);
    const inputChanged = batchRowInputChanged(table, row, nodeById);
    const references = batchRowMentionReferences(row, referenceColumns, nodeById);
    const effectivePrompt = batchPromptForRow(table, row);
    const disabledReason = status.loading ? "当前任务正在生成" : !row.enabled ? "请先启用这一行" : !effectivePrompt.trim() ? "请填写任务提示词" : table.operation === "try_on" && row.inputNodeIds.filter(Boolean).length < 2 ? "批量换装至少需要两张参考图" : !ready ? "请补齐有效参考图" : "";
    return (
        <div key={row.id} data-batch-row-id={row.id} className="group grid items-center border-b px-3 py-2 transition-colors hover:bg-black/[.025] dark:hover:bg-white/[.025]" style={{ height: BATCH_ROW_HEIGHT, borderColor: theme.node.stroke, gridTemplateColumns, opacity: row.enabled ? 1 : 0.58 }}>
            <div className="flex flex-col items-center justify-center gap-2">
                <div className="flex items-center gap-1.5">
                    {!readOnly ? <Switch size="small" checked={row.enabled} aria-label={`启用任务 ${index + 1}`} onChange={(enabled) => actions.current.onUpdateRow(row.id, { enabled })} /> : null}
                    <span className="tabular-nums" style={{ color: theme.node.muted }}>{index + 1}</span>
                </div>
                {!readOnly ? <button type="button" title="在下方插入任务，沿用本行参考图" aria-label={`在任务 ${index + 1} 下方插入`} className="grid size-6 place-items-center rounded hover:bg-black/5 focus-visible:outline-2 dark:hover:bg-white/10" onClick={() => actions.current.addRow(row.id)}><Plus className="size-3.5" /></button> : null}
            </div>
            {referenceColumns.map((column, columnIndex) => (
                <div key={column.id} className="flex justify-center">
                    <ReferenceThumbnail
                        node={nodeById.get(row.inputNodeIds[columnIndex])}
                        hasReference={Boolean(row.inputNodeIds[columnIndex])}
                        label={batchReferenceMentionToken(columnIndex)}
                        theme={theme}
                        readOnly={readOnly}
                        rowId={row.id}
                        tableId={tableId}
                        columnId={column.id}
                        columnIndex={columnIndex}
                        targetLabel={`任务 ${index + 1} · 参考图 ${columnIndex + 1}`}
                        isDraggingCell={draggingColumnIndex === columnIndex}
                        onPickFile={() => actions.current.pickReference(row.id, columnIndex)}
                        onRemove={() => actions.current.onRemoveReference?.(row.id, columnIndex)}
                        onUploadFile={(file) => actions.current.onUploadReference?.(row.id, columnIndex, file)}
                        onPointerDown={(event) => actions.current.startCellDrag(event, row.id, columnIndex)}
                    />
                </div>
            ))}
            {textColumns.map((column, columnIndex) => (
                <div key={column.id} className="min-w-0 px-2">
                    {table.aiGenerated ? <textarea
                        aria-label={`任务 ${index + 1} ${column.label}`}
                        value={row.cells?.[column.id] || ""}
                        readOnly={readOnly}
                        className="thin-scrollbar h-20 w-full resize-none rounded-lg border px-2 py-2 text-sm outline-none focus-visible:ring-2"
                        style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => actions.current.onUpdateRow(row.id, { cells: { ...row.cells, [column.id]: event.target.value } })}
                    /> : <span data-canvas-no-drag className="thin-scrollbar block max-h-20 overflow-auto">{nodeById.get(row.textNodeIds?.[columnIndex] || "")?.metadata?.content || ""}</span>}
                </div>
            ))}
            <div data-batch-prompt className="min-w-0 pr-3">
                <CanvasResourceMentionTextarea
                    value={row.prompt}
                    references={references}
                    readOnly={readOnly}
                    sendOnEnter={false}
                    mentionMenuWidth={300}
                    aria-label={`任务 ${index + 1} 提示词`}
                    placeholder={hasGlobalPrompt ? "本行原文保留；清空全局提示词后生效" : "描述生成目标，输入 @ 引用本行参考图"}
                    containerClassName="h-20"
                    className="thin-scrollbar h-full w-full resize-none overflow-y-auto overscroll-contain rounded-lg border px-3 py-2 text-sm leading-5 outline-none transition-shadow focus-visible:ring-2"
                    style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                    onChange={(prompt) => actions.current.onUpdateRow(row.id, { prompt })}
                    onSubmit={!readOnly && ready && !status.loading ? () => actions.current.onGenerate([row.id]) : undefined}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
                <div className="mt-1 flex h-5 items-center gap-2 px-0.5 text-[11px]" style={{ color: theme.node.muted }}>
                    <span className="min-w-0 flex-1 truncate" title={hasGlobalPrompt ? globalPrompt : undefined}>{hasGlobalPrompt ? "本次生成使用全局提示词；本行原文保留" : readOnly ? "本次生成使用本行提示词" : "输入 @ 引用参考图 · Ctrl/⌘ + Enter 生成"}</span>
                    <button type="button" className="flex shrink-0 items-center gap-1 rounded px-1 hover:underline" aria-label={`${readOnly ? "放大查看" : "放大编辑"}任务 ${index + 1} 提示词`} onClick={() => actions.current.setEditingRowId(row.id)}><Maximize2 className="size-3" />{readOnly ? "放大查看" : "放大编辑"}</button>
                </div>
            </div>
            <div className="flex min-h-16 flex-col items-center justify-center gap-1">
                <ResultThumbnail
                    output={output}
                    status={status}
                    theme={theme}
                    onFocus={() => { if (row.outputNodeId) actions.current.onFocusOutput?.(row.outputNodeId); }}
                />
                {inputChanged ? <span className="whitespace-nowrap text-[10px] font-medium" style={{ color: theme.node.text }} title="参考图或提示词已变更，当前显示的是原结果；需要手动重新生成">输入已变更</span> : null}
            </div>
            {!readOnly ? (
                <div className="flex items-center justify-center gap-1">
                    <Tooltip title={disabledReason || (completedRow ? "重新生成这一行" : "只生成这一行")}>
                        <Button type={completedRow ? "text" : "primary"} size="small" className="w-8 px-0" disabled={Boolean(disabledReason)} icon={status.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={() => actions.current.onGenerate([row.id])} />
                    </Tooltip>
                    <Tooltip title="删除这一行"><Button type="text" size="small" className="w-7 px-0 opacity-60 transition-opacity group-hover:opacity-100" danger icon={<Trash2 className="size-3.5" />} onClick={() => actions.current.onRemoveRow(row.id)} /></Tooltip>
                </div>
            ) : <span />}
        </div>
    );
}, (previous, next) => {
    const { table: a, nodeById: aNodes, ...aProps } = previous;
    const { table: b, nodeById: bNodes, ...bProps } = next;
    if (a.operation !== b.operation || a.globalPrompt !== b.globalPrompt || a.aiGenerated !== b.aiGenerated) return false;
    if ((Object.keys(aProps) as Array<keyof typeof aProps>).some((key) => aProps[key] !== bProps[key])) return false;
    // Results retain full identity checks so task progress, errors and future output states stay visible.
    const outputId = next.row.outputNodeId || "";
    if (aNodes.get(outputId) !== bNodes.get(outputId)) return false;
    const referencedIds = [...next.row.inputNodeIds, ...(next.row.textNodeIds || [])];
    return referencedIds.every((id) => sameBatchReferenceNode(aNodes.get(id), bNodes.get(id)));
});

function BatchChoiceGroup({ ariaLabel, options, value, onChange, theme, compact = false, disabled = false }: { ariaLabel: string; options: Array<{ value: string | number; label: string }>; value: string | number; onChange: (value: string | number) => void; theme: CanvasTheme; compact?: boolean; disabled?: boolean }) {
    return (
        <div role="group" aria-label={ariaLabel} className="flex shrink-0 items-center rounded-lg p-0.5" style={{ background: theme.node.panel }}>
            {options.map((option) => {
                const selected = option.value === value;
                return <button key={option.value} type="button" aria-pressed={selected} disabled={disabled} className={`rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${compact ? "min-w-7 px-1.5 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]"}`} style={{ background: selected ? theme.accent.primary : "transparent", color: selected ? theme.accent.onPrimary : theme.node.muted }} onClick={() => onChange(option.value)}>{option.label}</button>;
            })}
        </div>
    );
}

function BatchReferenceHandles({ columns, theme, onConnectStart, onConnectDrop }: { columns: ReturnType<typeof batchReferenceColumns>; theme: CanvasTheme; onConnectStart: (event: ReactPointerEvent, handleId: string) => void; onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void }) {
    const commonStyle = { left: 0, width: 36, height: 36, transform: "translate(-50%, -50%)", transformOrigin: "center" };
    return <>{columns.map((column, index) => <BatchReferenceHandle key={column.id} column={column} index={index} theme={theme} commonStyle={commonStyle} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} />)}</>;
}

function BatchReferenceHandle({ column, index, theme, commonStyle, onConnectStart, onConnectDrop }: { column: { id: string; label: string }; index: number; theme: CanvasTheme; commonStyle: { left: number; width: number; height: number; transform: string; transformOrigin: string }; onConnectStart: (event: ReactPointerEvent, handleId: string) => void; onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void }) {
    const [hovered, setHovered] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const handleId = batchReferenceHandleId(column.id);
    const reset = useCallback(() => { setHovered(false); setOffset({ x: 0, y: 0 }); }, []);
    const update = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const dx = event.clientX - (bounds.left + bounds.width / 2);
        const dy = event.clientY - (bounds.top + bounds.height / 2);
        const limit = 10;
        setOffset({ x: Math.max(-limit, Math.min(limit, dx)), y: Math.max(-limit, Math.min(limit, dy)) });
    }, []);
    return (
        <Tooltip title={`${column.label} · 按列填充：一张图供各行共用，多张图按顺序分配；也可直接连到目标格`} placement="left">
            <button type="button" data-icon-only aria-label={`${column.label}连线点`} className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none" style={{ ...commonStyle, top: BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP, cursor: "crosshair" }} onPointerEnter={(event) => { setHovered(true); update(event); }} onPointerMove={update} onPointerLeave={reset} onPointerDown={(event) => { event.stopPropagation(); onConnectStart(event, handleId); }} onPointerUp={(event) => { event.stopPropagation(); onConnectDrop?.(event, handleId); }}>
                <span className="grid size-[18px] place-items-center rounded-full border text-[8px] font-semibold shadow-sm transition-transform duration-100 group-hover:scale-125 group-focus-visible:scale-125" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${hovered ? 1.06 : 1})`, background: theme.node.panel, borderColor: theme.accent.primary, color: theme.accent.primary }}>{index + 1}</span>
            </button>
        </Tooltip>
    );
}

function batchRowMentionReferences(row: CanvasBatchRow, columns: ReturnType<typeof batchReferenceColumns>, nodeById: Map<string, CanvasNodeData>): CanvasResourceReference[] {
    return columns.flatMap((column, index) => {
        const source = nodeById.get(row.inputNodeIds[index]);
        if (!source) return [];
        return [{ id: `${row.id}:${column.id}:${source.id}`, nodeId: source.id, kind: "image" as const, label: `参考图${index + 1}`, title: `${column.label} · ${source.title || "图片"}`, previewUrl: source.metadata?.previewContent || source.metadata?.content, storageKey: source.metadata?.storageKey, active: true, sourceType: source.type, mentionToken: batchReferenceMentionToken(index) }];
    });
}

function ReferenceThumbnail({ node, hasReference, label, targetLabel, theme, readOnly, tableId, rowId, columnId, columnIndex, isDraggingCell, onPickFile, onRemove, onUploadFile, onPointerDown }: { node?: CanvasNodeData; hasReference: boolean; label: string; targetLabel: string; theme: CanvasTheme; readOnly: boolean; tableId: string; rowId: string; columnId: string; columnIndex: number; isDraggingCell: boolean; onPickFile: () => void; onRemove: () => void; onUploadFile: (file: File) => void; onPointerDown: (event: ReactPointerEvent) => void }) {
    const filled = node && hasNodeMedia(node);
    const fallback = <EmptyThumbnail theme={theme} />;
    return (
        <div
            data-batch-reference-cell
            data-canvas-no-drag
            data-target-node-id={tableId}
            data-row-id={rowId}
            data-column-id={columnId}
            data-column-index={columnIndex}
            data-reference-label={targetLabel}
            className="relative size-16 shrink-0"
            onDragStart={(event) => event.preventDefault()}
            onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
            onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
                if (file && !readOnly) onUploadFile(file);
            }}
        >
        <Tooltip title={filled ? `${targetLabel} · ${node.title || "图片"}；点击更换，也可拖到同表其他格交换` : `${targetLabel} · 点击选图、上传或拖入连线`}>
            <button
                type="button"
                aria-label={targetLabel}
                className="canvas-batch-thumbnail relative box-border grid size-16 shrink-0 place-items-center rounded-lg border"
                style={{ borderColor: filled ? theme.node.stroke : "transparent", background: theme.node.panel, opacity: isDraggingCell ? 0.55 : 1 }}
                disabled={readOnly}
                onPointerDown={onPointerDown}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!readOnly) onPickFile();
                }}
            >
                {filled ? <CachedResourceImage eager src={node.metadata?.previewContent || node.metadata?.content} storageKey={node.metadata?.storageKey} alt={node.title || "参考图"} className="block size-full max-h-full max-w-full object-contain" fallback={fallback} /> : fallback}
                <span className="absolute bottom-1 left-1 rounded px-1 py-0.5 text-[8px] font-medium text-white" style={{ background: "rgba(0,0,0,.58)" }}>{label}</span>
            </button>
        </Tooltip>
        {!readOnly ? <>
            <Tooltip title="点击选择图片，或把图片节点连线拖到这一格">
                <button type="button" aria-label={`${targetLabel}连接点`} className="absolute -left-2 top-1/2 z-10 grid size-4 -translate-y-1/2 place-items-center rounded-full border-2 shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2" style={{ background: theme.node.panel, borderColor: theme.accent.primary }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onPickFile(); }}>
                    <span className="size-1 rounded-full" style={{ background: theme.accent.primary }} />
                </button>
            </Tooltip>
            {hasReference ? <Tooltip title="清除此格引用，保留源图片节点">
                <button type="button" aria-label={`清除${targetLabel}引用`} className="absolute -right-1.5 -top-1.5 z-10 grid size-5 place-items-center rounded-full border shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2" style={{ background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.muted }} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); onRemove(); }}><Minus className="size-3" /></button>
            </Tooltip> : null}
        </> : null}
        </div>
    );
}

function ResultThumbnail({ output, status, theme, onFocus }: { output?: CanvasNodeData; status: ReturnType<typeof rowStatus>; theme: CanvasTheme; onFocus: () => void }) {
    const filled = hasNodeMedia(output);
    const tone = statusColor(status.tone, theme.node.stroke);
    const title = filled ? `${status.label} · 点击定位到画布节点` : status.label;
    return (
        <Tooltip title={title}>
            <button
                type="button"
                aria-label={title}
                disabled={!output}
                className="canvas-batch-thumbnail relative box-border grid size-16 shrink-0 place-items-center rounded-lg border-2"
                style={{ borderColor: tone, cursor: output ? "pointer" : "default" }}
                onClick={(event) => {
                    event.stopPropagation();
                    if (output) onFocus();
                }}
            >
                {filled && output ? <CachedResourceImage eager src={output.metadata?.previewContent || output.metadata?.content} storageKey={output.metadata?.storageKey} alt="生成结果" className="block size-full max-h-full max-w-full object-cover" fallback={<EmptyThumbnail theme={theme} compact />} /> : <EmptyThumbnail theme={theme} compact />}
                {status.loading ? <span className="absolute inset-0 grid place-items-center bg-black/35"><LoaderCircle className="size-4 animate-spin" style={{ color: tone }} /></span> : null}
                <span className="absolute right-1 top-1 size-2 rounded-full" style={{ background: tone }} />
            </button>
        </Tooltip>
    );
}

function statusColor(tone: RowStatusTone, fallback: string) {
    if (tone === "success") return "var(--status-success)";
    if (tone === "error") return "var(--status-error)";
    if (tone === "loading") return "var(--status-loading)";
    return fallback;
}

function EmptyThumbnail({ theme, compact = false }: { theme: CanvasTheme; compact?: boolean }): ReactNode {
    const sizeClass = "size-full";
    return (
        <div
            className={`grid shrink-0 place-items-center rounded-lg border border-dashed ${sizeClass}`}
            style={{ borderColor: theme.node.stroke, color: theme.node.placeholder, background: `color-mix(in srgb, ${theme.node.text} 3%, transparent)` }}
        >
            {compact ? <ImageIcon className="size-4" /> : (
                <span className="flex flex-col items-center gap-0.5">
                    <Upload className="size-4" />
                    <span className="text-[9px] leading-none">上传</span>
                </span>
            )}
        </div>
    );
}

function hasNodeMedia(node?: CanvasNodeData) {
    return Boolean(node?.metadata?.content || node?.metadata?.storageKey);
}

type RowStatusTone = "success" | "error" | "loading" | "idle";
type RowStatus = { label: string; tone: RowStatusTone; loading: boolean; retryable: boolean };

function rowStatus(item: CanvasGenerationBatchItem | undefined, output: CanvasNodeData | undefined): RowStatus {
    if (item?.status === "failed") return { label: item.errorDetails ? generationErrorMessage(item.errorDetails) : "生成失败", tone: "error", loading: false, retryable: true };
    if (item?.status === "cancelled") return { label: "已停止", tone: "error", loading: false, retryable: false };
    if (item && ["waiting", "submitting", "queued", "running"].includes(item.status)) return { label: item.status === "waiting" ? "等待中" : item.status === "submitting" ? "正在提交" : item.status === "queued" ? "已排队" : "生成中", tone: "loading", loading: true, retryable: false };
    if (output?.metadata?.status === "error") return { label: output.metadata.errorDetails ? generationErrorMessage(output.metadata.errorDetails) : "生成失败", tone: "error", loading: false, retryable: false };
    if (output?.metadata?.status === "loading") return { label: "生成中", tone: "loading", loading: true, retryable: false };
    if (hasNodeMedia(output)) return batchOutputResultPending(output?.metadata)
        ? { label: "保留上次结果", tone: "idle", loading: false, retryable: false }
        : { label: "生成完成", tone: "success", loading: false, retryable: false };
    return { label: "待生成", tone: "idle", loading: false, retryable: false };
}
