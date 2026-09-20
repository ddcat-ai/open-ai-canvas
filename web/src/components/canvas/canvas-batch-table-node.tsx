import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Switch, Tooltip } from "antd";
import { Image as ImageIcon, LoaderCircle, Minus, Play, Plus, Rows3, Trash2, Upload } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { CanvasResourceMentionTextarea } from "@/components/canvas/canvas-resource-mention-textarea";
import {
    BATCH_REFERENCE_HANDLE_GAP,
    BATCH_REFERENCE_HANDLE_TOP,
    MAX_BATCH_REFERENCE_COLUMNS,
    MIN_BATCH_REFERENCE_COLUMNS,
    batchPromptForRow,
    batchReferenceColumns,
    batchReferenceHandleId,
    batchReferenceMentionToken,
} from "@/lib/canvas/canvas-batch-table";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { CanvasBatchOperation, CanvasBatchRow, CanvasBatchTableData, CanvasConnection, CanvasGenerationBatch, CanvasGenerationBatchItem, CanvasNodeData } from "@/types/canvas";

type ReferenceCell = { rowId: string; columnIndex: number };

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
    onRemoveReferenceColumn?: () => void;
    onFocusOutput?: (nodeId: string) => void;
    onReorderReferenceColumns?: (fromColumnId: string, toColumnId: string) => void;
    onMoveReferenceCell?: (sourceRowId: string, sourceColumnIndex: number, targetRowId: string, targetColumnIndex: number) => void;
    onUploadReference?: (rowId: string, columnIndex: number, file: File) => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    readOnly?: boolean;
};

const OPERATION_OPTIONS = [
    { value: "try_on", label: "批量换装" },
    { value: "creative", label: "创意生图" },
] satisfies Array<{ value: CanvasBatchOperation; label: string }>;

const CONCURRENCY_OPTIONS = [1, 5, 10] as const;

export function CanvasBatchTableNodeContent({ node, nodes, connections, batch, theme, onPatchTable, onAddRow, onRemoveRow, onUpdateRow, onFillRows, onGenerate, onRetryItem, onAddReferenceColumn, onRemoveReferenceColumn, onReorderReferenceColumns, onMoveReferenceCell, onUploadReference, onFocusOutput, onConnectStart, onConnectDrop, readOnly = false }: Props) {
    const table = node.metadata?.batchTable || { operation: "try_on" as const, concurrency: 10, rows: [] };
    const referenceColumns = batchReferenceColumns(table);
    const globalPrompt = table.globalPrompt || "";
    const hasGlobalPrompt = Boolean(globalPrompt.trim());
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const connectedImageCount = useMemo(() => new Set(connections.filter((connection) => connection.toNodeId === node.id && connection.relation !== "batch-output").map((connection) => connection.fromNodeId)).size, [connections, node.id]);
    const completed = table.rows.filter((row) => hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const unfinishedReadyCount = table.rows.filter((row) => rowReady(row, table, nodeById) && !hasNodeMedia(row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined)).length;
    const gridTemplateColumns = `64px repeat(${referenceColumns.length}, 88px) minmax(280px, 1fr) 88px 80px`;
    const subtleSurface = `color-mix(in srgb, ${theme.node.text} 4%, transparent)`;
    const inputSurface = theme.node.panel;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<ReferenceCell | null>(null);
    const [draggingColumnId, setDraggingColumnId] = useState<string | null>(null);
    const [draggingCell, setDraggingCell] = useState<ReferenceCell | null>(null);
    const draggingCellRef = useRef<ReferenceCell | null>(null);
    const dragStartRef = useRef<{ x: number; y: number; pointerId: number; cell: ReferenceCell } | null>(null);
    const suppressClickRef = useRef(false);

    const clearReferenceDrag = useCallback(() => {
        dragStartRef.current = null;
        draggingCellRef.current = null;
        setDraggingCell(null);
    }, []);

    const findReferenceCellAtPoint = useCallback((clientX: number, clientY: number) => {
        const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-batch-reference-cell]");
        const rowId = target?.dataset.rowId;
        const columnIndex = Number(target?.dataset.columnIndex);
        return rowId && Number.isInteger(columnIndex) ? { rowId, columnIndex } : null;
    }, []);

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
        window.addEventListener("pointercancel", handleUp);
        return () => {
            window.removeEventListener("pointermove", handleMove);
            window.removeEventListener("pointerup", handleUp);
            window.removeEventListener("pointercancel", handleUp);
        };
    }, [clearReferenceDrag, findReferenceCellAtPoint, onMoveReferenceCell, readOnly]);

    const startCellDrag = (event: ReactPointerEvent, rowId: string, columnIndex: number) => {
        if (readOnly || event.button !== 0) return;
        event.stopPropagation();
        dragStartRef.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, cell: { rowId, columnIndex } };
    };

    const pickReferenceFile = (rowId: string, columnIndex: number) => {
        if (readOnly) return;
        if (suppressClickRef.current) {
            suppressClickRef.current = false;
            return;
        }
        uploadTargetRef.current = { rowId, columnIndex };
        fileInputRef.current?.click();
    };

    return (
        <div data-canvas-batch-table data-canvas-no-zoom data-canvas-wheel-scroll className="relative flex h-full w-full flex-col overflow-visible text-xs" style={{ color: theme.node.text }}>
            {!readOnly ? <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                const target = uploadTargetRef.current;
                event.currentTarget.value = "";
                uploadTargetRef.current = null;
                if (file && target) onUploadReference?.(target.rowId, target.columnIndex, file);
            }} /> : null}
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
                                    <Tooltip title={referenceColumns.length >= MAX_BATCH_REFERENCE_COLUMNS ? "最多支持 6 组参考图" : `新增参考图 ${referenceColumns.length + 1}`}>
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
                            <Tooltip title="增量同步画布连线，不会删除已有任务行">
                                <Button size="small" type="text" icon={<Rows3 className="size-3.5" />} onClick={onFillRows}>同步连线</Button>
                            </Tooltip>
                            <Button size="small" type="text" icon={<Plus className="size-3.5" />} onClick={onAddRow}>添加任务</Button>
                            <Button size="small" type="primary" icon={<Play className="size-3.5" />} disabled={!unfinishedReadyCount} onClick={() => onGenerate()}>
                                生成未完成项{unfinishedReadyCount ? ` · ${unfinishedReadyCount}` : ""}
                            </Button>
                        </div>
                    ) : null}
                </div>
                <div className="flex h-9 items-center gap-2 border-t px-3" style={{ borderColor: theme.node.stroke }} onPointerDown={(event) => event.stopPropagation()}>
                    <span className="shrink-0 font-medium" style={{ color: theme.node.muted }}>全局提示词</span>
                    <input
                        value={globalPrompt}
                        readOnly={readOnly}
                        placeholder="填写后覆盖各任务提示词，留空则使用每行自己的提示词"
                        aria-label="全局提示词"
                        className="h-7 min-w-0 flex-1 rounded-md border px-2.5 text-xs outline-none"
                        style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                        onChange={(event) => onPatchTable({ globalPrompt: event.target.value })}
                    />
                </div>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-auto rounded-b-[inherit]" onPointerDown={(event) => event.stopPropagation()}>
                <div className="sticky top-0 z-10 grid h-9 items-center border-b px-3 text-center text-[11px] font-medium" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted, gridTemplateColumns }}>
                    <span className="min-w-0 truncate px-1">任务</span>
                    {referenceColumns.map((column) => (
                        <span
                            key={column.id}
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
                    <span className="min-w-0 truncate px-1">任务提示词</span>
                    <span className="min-w-0 truncate px-1">生成结果</span>
                    <span className="min-w-0 truncate px-1">操作</span>
                </div>

                {table.rows.length ? (
                    table.rows.map((row, index) => {
                        const output = row.outputNodeId ? nodeById.get(row.outputNodeId) : undefined;
                        const item = batchItemByRowId.get(row.id);
                        const status = row.enabled ? rowStatus(item, output) : { label: "已停用", tone: "idle" as const, loading: false, retryable: false };
                        const ready = rowReady(row, table, nodeById);
                        const completedRow = hasNodeMedia(output);
                        const references = batchRowMentionReferences(row, referenceColumns, nodeById);
                        const effectivePrompt = batchPromptForRow(table, row);
                        const disabledReason = status.loading ? "当前任务正在生成" : !row.enabled ? "请先启用这一行" : !effectivePrompt.trim() ? "请填写任务提示词" : table.operation === "try_on" && row.inputNodeIds.filter(Boolean).length < 2 ? "批量换装至少需要两张参考图" : !ready ? "请补齐有效参考图" : "";
                        return (
                            <div key={row.id} className="group grid items-center border-b px-3 py-3 transition-colors hover:bg-black/[.025] dark:hover:bg-white/[.025]" style={{ borderColor: theme.node.stroke, gridTemplateColumns, opacity: row.enabled ? 1 : 0.58 }}>
                                <div className="flex items-center justify-center gap-1.5">
                                    {!readOnly ? <Switch size="small" checked={row.enabled} aria-label={`启用任务 ${index + 1}`} onChange={(enabled) => onUpdateRow(row.id, { enabled })} /> : null}
                                    <span className="tabular-nums" style={{ color: theme.node.muted }}>{index + 1}</span>
                                </div>
                                {referenceColumns.map((column, columnIndex) => (
                                    <div key={column.id} className="flex justify-center">
                                        <ReferenceThumbnail
                                            node={nodeById.get(row.inputNodeIds[columnIndex])}
                                            label={batchReferenceMentionToken(columnIndex)}
                                            theme={theme}
                                            readOnly={readOnly}
                                            rowId={row.id}
                                            columnIndex={columnIndex}
                                            isDraggingCell={draggingCell?.rowId === row.id && draggingCell.columnIndex === columnIndex}
                                            onPickFile={() => pickReferenceFile(row.id, columnIndex)}
                                            onUploadFile={(file) => onUploadReference?.(row.id, columnIndex, file)}
                                            onPointerDown={(event) => startCellDrag(event, row.id, columnIndex)}
                                        />
                                    </div>
                                ))}
                                <div className="min-w-0 pr-3">
                                    <CanvasResourceMentionTextarea
                                        value={row.prompt}
                                        references={references}
                                        readOnly={readOnly}
                                        sendOnEnter={false}
                                        mentionMenuWidth={300}
                                        aria-label={`任务 ${index + 1} 提示词`}
                                        placeholder={hasGlobalPrompt ? "已使用全局提示词，可在此填写行级覆盖" : "描述生成目标，输入 @ 引用本行参考图"}
                                        containerClassName="h-[108px]"
                                        className="thin-scrollbar h-full w-full overflow-y-auto rounded-lg border px-3 py-2 text-xs leading-5 outline-none transition-shadow focus-visible:ring-2"
                                        style={{ background: inputSurface, borderColor: theme.node.stroke, color: theme.node.text }}
                                        onChange={(prompt) => onUpdateRow(row.id, { prompt })}
                                        onSubmit={!readOnly && ready && !status.loading ? () => onGenerate([row.id]) : undefined}
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onWheel={(event) => event.stopPropagation()}
                                    />
                                    <div className="mt-1 truncate px-0.5 text-[10px]" style={{ color: theme.node.faint }}>
                                        {readOnly ? "输入 @ 插入参考图" : "输入 @ 插入参考图 · ⌘/Ctrl + Enter 生成此行"}
                                    </div>
                                </div>
                                <div className="flex h-16 min-h-16 items-center justify-center">
                                    <ResultThumbnail
                                        output={output}
                                        status={status}
                                        theme={theme}
                                        onFocus={() => { if (row.outputNodeId) onFocusOutput?.(row.outputNodeId); }}
                                    />
                                </div>
                                {!readOnly ? (
                                    <div className="flex items-center justify-center gap-1">
                                        <Tooltip title={disabledReason || (completedRow ? "重新生成这一行" : "只生成这一行")}>
                                            <Button type={completedRow ? "text" : "primary"} size="small" className="w-8 px-0" disabled={Boolean(disabledReason)} icon={status.loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />} onClick={() => onGenerate([row.id])} />
                                        </Tooltip>
                                        <Tooltip title="删除这一行"><Button type="text" size="small" className="w-7 px-0 opacity-60 transition-opacity group-hover:opacity-100" danger icon={<Trash2 className="size-3.5" />} onClick={() => onRemoveRow(row.id)} /></Tooltip>
                                    </div>
                                ) : <span />}
                            </div>
                        );
                    })
                ) : (
                    <div className="grid min-h-44 place-items-center px-5 text-center">
                        <div className="flex max-w-sm flex-col items-center gap-2">
                            <div className="grid size-10 place-items-center rounded-xl" style={{ background: theme.accent.primarySoft, color: theme.node.text }}><Rows3 className="size-5" /></div>
                            <div className="font-medium">还没有批量任务</div>
                            <p className="m-0 leading-5" style={{ color: theme.node.muted }}>把图片连接到左侧参考图端口后同步连线，或先添加一行手工配置。</p>
                            {!readOnly ? <Button size="small" icon={<Plus className="size-3.5" />} onClick={onAddRow}>添加第一条任务</Button> : null}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

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
        <Tooltip title={`连接到${column.label}`} placement="left">
            <button type="button" aria-label={`${column.label}连线点`} className="group absolute z-[var(--node-z-handle)] grid place-items-center rounded-full outline-none" style={{ ...commonStyle, top: BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP, cursor: "crosshair" }} onPointerEnter={(event) => { setHovered(true); update(event); }} onPointerMove={update} onPointerLeave={reset} onPointerDown={(event) => { event.stopPropagation(); onConnectStart(event, handleId); }} onPointerUp={(event) => { event.stopPropagation(); onConnectDrop?.(event, handleId); }}>
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

function ReferenceThumbnail({ node, label, theme, readOnly, rowId, columnIndex, isDraggingCell, onPickFile, onUploadFile, onPointerDown }: { node?: CanvasNodeData; label: string; theme: CanvasTheme; readOnly: boolean; rowId: string; columnIndex: number; isDraggingCell: boolean; onPickFile: () => void; onUploadFile: (file: File) => void; onPointerDown: (event: ReactPointerEvent) => void }) {
    const filled = node && hasNodeMedia(node);
    const fallback = <EmptyThumbnail theme={theme} />;
    return (
        <Tooltip title={filled ? `${label} · ${node.title || "图片"}` : `${label} · 点击上传或拖入图片`}>
            <button
                type="button"
                data-batch-reference-cell
                data-row-id={rowId}
                data-column-index={columnIndex}
                className="relative box-border grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border"
                style={{ borderColor: filled ? theme.node.stroke : "transparent", opacity: isDraggingCell ? 0.55 : 1 }}
                disabled={readOnly}
                onPointerDown={onPointerDown}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!readOnly) onPickFile();
                }}
                onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
                onDrop={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    const file = Array.from(event.dataTransfer.files).find((item) => item.type.startsWith("image/"));
                    if (file && !readOnly) onUploadFile(file);
                }}
            >
                {filled ? <CachedResourceImage eager src={node.metadata?.previewContent || node.metadata?.content} storageKey={node.metadata?.storageKey} alt={node.title || "参考图"} className="block size-full max-h-full max-w-full object-cover" fallback={fallback} /> : fallback}
                <span className="absolute bottom-1 left-1 rounded px-1 py-0.5 text-[8px] font-medium text-white" style={{ background: "rgba(0,0,0,.58)" }}>{label}</span>
            </button>
        </Tooltip>
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
                className="relative box-border grid size-16 shrink-0 place-items-center overflow-hidden rounded-lg border-2"
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

function rowReady(row: CanvasBatchRow, table: CanvasBatchTableData, nodeById: Map<string, CanvasNodeData>) {
    if (!row.enabled || !batchPromptForRow(table, row).trim()) return false;
    const inputNodeIds = row.inputNodeIds.filter(Boolean);
    if (table.operation === "try_on" && inputNodeIds.length < 2) return false;
    if (!inputNodeIds.length) return false;
    return inputNodeIds.every((id) => hasNodeMedia(nodeById.get(id)));
}

function hasNodeMedia(node?: CanvasNodeData) {
    return Boolean(node?.metadata?.content || node?.metadata?.storageKey);
}

type RowStatusTone = "success" | "error" | "loading" | "idle";
type RowStatus = { label: string; tone: RowStatusTone; loading: boolean; retryable: boolean };

function rowStatus(item: CanvasGenerationBatchItem | undefined, output: CanvasNodeData | undefined): RowStatus {
    if (hasNodeMedia(output)) return { label: "生成完成", tone: "success", loading: false, retryable: false };
    if (item?.status === "failed") return { label: item.errorDetails || "生成失败", tone: "error", loading: false, retryable: true };
    if (item?.status === "cancelled") return { label: "已停止", tone: "error", loading: false, retryable: false };
    if (item && ["waiting", "submitting", "queued", "running"].includes(item.status)) return { label: item.status === "waiting" ? "等待中" : item.status === "submitting" ? "正在提交" : item.status === "queued" ? "已排队" : "生成中", tone: "loading", loading: true, retryable: false };
    if (output?.metadata?.status === "error") return { label: output.metadata.errorDetails || "生成失败", tone: "error", loading: false, retryable: false };
    return { label: "待生成", tone: "idle", loading: false, retryable: false };
}
