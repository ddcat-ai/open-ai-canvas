import { useCallback, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Input, Select, Tooltip } from "antd";
import { Image as ImageIcon, LoaderCircle, Play, Plus, RefreshCw, Rows3, Trash2 } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { BATCH_REFERENCE_HANDLE_GAP, BATCH_REFERENCE_HANDLE_TOP, MAX_BATCH_REFERENCE_COLUMNS, batchReferenceColumns, batchReferenceHandleId } from "@/lib/canvas/canvas-batch-table";
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
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
    readOnly?: boolean;
};

const OPERATION_OPTIONS = [
    { value: "try_on", label: "批量换装" },
    { value: "creative", label: "创意生图" },
] satisfies Array<{ value: CanvasBatchOperation; label: string }>;

export function CanvasBatchTableNodeContent({ node, nodes, connections, batch, theme, onPatchTable, onAddRow, onRemoveRow, onUpdateRow, onFillRows, onGenerate, onRetryItem, onAddReferenceColumn, onConnectStart, onConnectDrop, readOnly = false }: Props) {
    const table = node.metadata?.batchTable || { operation: "try_on" as const, concurrency: 10, rows: [] };
    const referenceColumns = batchReferenceColumns(table);
    const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes]);
    const batchItemByRowId = useMemo(() => new Map((batch?.items || []).map((item) => [item.rowId, item])), [batch?.items]);
    const connectedImageCount = useMemo(() => new Set(connections.filter((connection) => connection.toNodeId === node.id).map((connection) => connection.fromNodeId)).size, [connections, node.id]);
    const completed = table.rows.filter((row) => Boolean(row.outputNodeId && nodeById.get(row.outputNodeId)?.metadata?.content)).length;
    const gridTemplateColumns = `42px repeat(${referenceColumns.length}, 92px) minmax(280px, 1fr) 150px 40px`;

    return (
        <div data-canvas-no-zoom data-canvas-wheel-scroll className="relative flex h-full w-full flex-col overflow-visible pt-9 text-xs" style={{ color: theme.node.text }} onPointerDown={(event) => event.stopPropagation()}>
            {!readOnly ? <BatchReferenceHandles columns={referenceColumns} theme={theme} onAdd={onAddReferenceColumn} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} /> : null}
            <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2" style={{ borderColor: theme.node.stroke }}>
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

            <div className="min-h-0 flex-1 overflow-auto rounded-b-[inherit]">
                <div className="grid min-w-[820px] border-b px-2 py-1.5 font-medium opacity-60" style={{ borderColor: theme.node.stroke, gridTemplateColumns }}>
                    <span>#</span>
                    {referenceColumns.map((column) => (
                        <span key={column.id}>{column.label}</span>
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
                            <div key={row.id} className="grid min-w-[820px] items-center gap-2 border-b px-2 py-2" style={{ borderColor: theme.node.stroke, gridTemplateColumns }}>
                                <span className="tabular-nums opacity-45">{index + 1}</span>
                                {referenceColumns.map((column, columnIndex) => (
                                    <ReferenceThumbnail key={column.id} node={nodeById.get(row.inputNodeIds[columnIndex])} theme={theme} />
                                ))}
                                <Input.TextArea value={row.prompt} readOnly={readOnly} autoSize={{ minRows: 2, maxRows: 4 }} placeholder="描述这一行要生成的画面" onChange={(event) => onUpdateRow(row.id, { prompt: event.target.value })} />
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
                    <div className="grid h-40 place-items-center px-5 text-center opacity-55">把图片拖到左侧磁吸端口，选择“参考图 1”或“参考图 2”；需要更多分组时点击下方 +。</div>
                )}
            </div>
        </div>
    );
}

function BatchReferenceHandles({
    columns,
    theme,
    onAdd,
    onConnectStart,
    onConnectDrop,
}: {
    columns: ReturnType<typeof batchReferenceColumns>;
    theme: CanvasTheme;
    onAdd: () => void;
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
}) {
    const commonStyle = { left: 0, width: 56, height: 56, transform: "translate(-50%, -50%)", transformOrigin: "center" };
    return (
        <>
            {columns.map((column, index) => (
                <BatchReferenceHandle key={column.id} column={column} index={index} theme={theme} commonStyle={commonStyle} onConnectStart={onConnectStart} onConnectDrop={onConnectDrop} />
            ))}
            {columns.length < MAX_BATCH_REFERENCE_COLUMNS ? (
                <Tooltip title={`新增参考图 ${columns.length + 1}`} placement="left">
                    <button
                        type="button"
                        aria-label={`新增参考图 ${columns.length + 1}`}
                        className="absolute z-[var(--node-z-handle)] grid place-items-center rounded-full border shadow-sm"
                        style={{ ...commonStyle, top: BATCH_REFERENCE_HANDLE_TOP + columns.length * BATCH_REFERENCE_HANDLE_GAP, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                            event.stopPropagation();
                            onAdd();
                        }}
                    >
                        <Plus className="size-3" />
                    </button>
                </Tooltip>
            ) : null}
        </>
    );
}

function BatchReferenceHandle({
    column,
    index,
    theme,
    commonStyle,
    onConnectStart,
    onConnectDrop,
}: {
    column: { id: string; label: string };
    index: number;
    theme: CanvasTheme;
    commonStyle: { left: number; width: number; height: number; transform: string; transformOrigin: string };
    onConnectStart: (event: ReactPointerEvent, handleId: string) => void;
    onConnectDrop?: (event: ReactPointerEvent, handleId: string) => void;
}) {
    const [hovered, setHovered] = useState(false);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const handleId = batchReferenceHandleId(column.id);
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
                style={{ ...commonStyle, top: BATCH_REFERENCE_HANDLE_TOP + index * BATCH_REFERENCE_HANDLE_GAP, cursor: "crosshair" }}
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
                    style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${hovered ? 1.08 : 1})`, background: theme.node.panel, borderColor: theme.accent.primary, color: theme.accent.primary }}
                >
                    {index + 1}
                </span>
            </button>
        </Tooltip>
    );
}
function ReferenceThumbnail({ node, theme }: { node?: CanvasNodeData; theme: CanvasTheme }) {
    if (!node || (!node.metadata?.content && !node.metadata?.storageKey)) return <EmptyThumbnail theme={theme} />;
    const fallback = <EmptyThumbnail theme={theme} />;
    return (
        <Tooltip title={node.title || "图片"}>
            <div className="size-16 overflow-hidden rounded-md border" style={{ borderColor: theme.node.stroke }}>
                <CachedResourceImage eager src={node.metadata.previewContent || node.metadata.content} storageKey={node.metadata.storageKey} alt={node.title || "参考图"} className="size-16 object-cover" fallback={fallback} />
            </div>
        </Tooltip>
    );
}

function EmptyThumbnail({ theme }: { theme: CanvasTheme }): ReactNode {
    return (
        <div className="grid size-12 shrink-0 place-items-center rounded border" style={{ borderColor: theme.node.stroke, color: theme.node.placeholder }}>
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
