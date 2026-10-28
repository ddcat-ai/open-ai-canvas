import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Link2 } from "lucide-react";
import { CANVAS_CONNECTION_STROKE_WIDTH, canvasThemes } from "@/lib/canvas-theme";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";

import { canvasConnectionPath, CanvasConnectionBeam, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { useCanvasVisualNode } from "@/components/canvas/canvas-node-resize-motion";
import type { CanvasConnectionApproach } from "@/lib/canvas/canvas-connection-tilt";
import type { CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { batchCellAnchor, BATCH_COLUMN_HEADER_HEIGHT, BATCH_TABLE_HEADER_HEIGHT, parseBatchCellHandle, type BatchScroll } from "@/lib/canvas/canvas-batch-references";
import { sortCanvasNodesByStackOrder, type CanvasNodeStackOrder } from "@/lib/canvas/canvas-node-stack-order";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import type { CanvasNodeRenderLOD } from "@/lib/canvas/canvas-node-lod";
import type { CanvasSpatialBounds } from "@/lib/canvas/canvas-spatial-index";
import { useCanvasProgressiveNodeMount } from "./use-canvas-progressive-node-mount";
import type { CanvasDisplayConnection, CanvasFolderStyle, CanvasFolderTheme, CanvasNodeData, Position, SelectionBox } from "@/types/canvas";

type DragPreview = { x: number; y: number; nodeIds: Set<string> } | null;
type NodeBounds = { left: number; top: number; width: number; height: number; count: number } | null;

type CanvasProjectWorldLayersProps = {
    projectId: string;
    viewportScale: number;
    connectionLayerBounds: { left: number; top: number; width: number; height: number };
    displayConnections: CanvasDisplayConnection[];
    selectedConnectionId: string | null;
    relatedConnectionIds: Set<string>;
    scriptScrollTopById: Record<string, number>;
    batchScrollById?: Record<string, BatchScroll>;
    connectionTargetNodeId: string | null;
    isConnecting: boolean;
    connectionApproach: CanvasConnectionApproach;
    nodeById: Map<string, CanvasNodeData>;
    /** 视口内与缓冲区候选节点；屏外部分由本层分帧挂载。 */
    candidateNodes: CanvasNodeData[];
    immediateRenderNodeIds: Set<string>;
    renderViewBounds: CanvasSpatialBounds;
    nodeRenderLODById: Map<string, CanvasNodeRenderLOD>;
    nodeStackOrder: CanvasNodeStackOrder;
    frameChildrenById: Map<string, CanvasNodeData[]>;
    linkedFolderPreviewNodesById: Map<string, CanvasNodeData[]>;
    dragPreview: DragPreview;
    selectedNodeIds: Set<string>;
    frameDropTargetId: string | null;
    relatedNodeIds: Set<string>;
    activeNodeId: string | null;
    selectionBox: SelectionBox | null;
    batchChildCountById: Map<string, number>;
    collapsingBatchIds: Set<string>;
    openingBatchIds: Set<string>;
    batchMotionById: Map<string, { x: number; y: number; index: number }>;
    showImageInfo: boolean;
    resourceReferenceByNodeId: Map<string, CanvasResourceReference>;
    mentionReferencesByNodeId: Map<string, CanvasResourceReference[]>;
    mediaEffectsDisabledNodeId?: string | null;
    selectedNodeBounds: NodeBounds;
    batchSourceNodeIds: string[];
    batchConnectionPreview: CanvasBatchConnectionPreview | null;
    isNodeDragging: boolean;
    selectionBoundsElementRef: RefObject<HTMLDivElement | null>;
    renderCanvasNodeContent: (node: CanvasNodeData) => ReactNode;
    onConnectionSelect: (connectionId: string) => void;
    onConnectionContextMenu: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
    onNodeMouseDown: (event: ReactMouseEvent, nodeId: string) => void;
    onNodeHoverStart: (nodeId: string) => void;
    onNodeHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: ReactPointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string, anchorRatio?: number) => void;
    onNodeResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onToggleFrame: (nodeId: string) => void;
    onFolderStyleChange: (nodeId: string, style: CanvasFolderStyle) => void;
    onFolderThemeChange: (nodeId: string, theme: CanvasFolderTheme) => void;
    onNodeTitleChange: (nodeId: string, title: string) => void;
    onNodeContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    onNodeContentChange: (nodeId: string, content: string) => void;
    onToggleBatch: (nodeId: string) => void;
    onSetBatchPrimary: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onReloadResource: (node: CanvasNodeData) => void;
    onOpenTaskDetails: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReplaceMedia: (node: CanvasNodeData) => void;
    onOpenTextEditor: (node: CanvasNodeData) => void;
    onOpenPrevis: (node: CanvasNodeData) => void;
    onOpenDrawing: (node: CanvasNodeData) => void;
    onStartBatchConnection: (event: ReactPointerEvent, sourceNodeIds: string[]) => void;
};

const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];
const EMPTY_CANVAS_NODES: CanvasNodeData[] = [];

export const CanvasProjectWorldLayers = memo(function CanvasProjectWorldLayers(props: CanvasProjectWorldLayersProps) {
    const { viewportScale } = props;
    const [activeMediaNodeId, setActiveMediaNodeId] = useState<string | null>(null);
    useEffect(() => {
        if (activeMediaNodeId && !props.nodeById.has(activeMediaNodeId)) setActiveMediaNodeId(null);
    }, [activeMediaNodeId, props.nodeById]);
    const visibleNodes = useCanvasProgressiveNodeMount(props.candidateNodes, props.immediateRenderNodeIds, props.renderViewBounds);
    const orderedVisibleNodes = useMemo(() => [
        ...visibleNodes.filter(isFrameNode),
        ...sortCanvasNodesByStackOrder(visibleNodes.filter((node) => !isFrameNode(node)), props.nodeStackOrder),
    ], [props.nodeStackOrder, visibleNodes]);
    const batchPreviewsRef = useRef(new Map<string, CanvasNodeData[]>());
    const batchPreviews = useMemo(() => {
        const previous = batchPreviewsRef.current;
        const next = new Map(visibleNodes.filter((node) => node.metadata?.isBatchRoot).map((node): [string, CanvasNodeData[]] => {
            const children = (node.metadata?.batchChildIds || []).filter((id) => id !== node.metadata?.primaryImageId)
                .map((id) => props.nodeById.get(id))
                .filter((child): child is CanvasNodeData => Boolean(child && child.metadata?.batchRootId === node.id))
                .slice(0, 5);
            // 子图对象未变时沿用旧数组，避免挂载/视口变化让所有批次封面重渲染。
            const current = previous.get(node.id);
            return [node.id, current && current.length === children.length && children.every((child, index) => child === current[index]) ? current : children];
        }));
        batchPreviewsRef.current = next;
        return next;
    }, [visibleNodes, props.nodeById]);
    const framePreviewNodes = (node: CanvasNodeData) => {
        const assetFolderId = node.metadata?.folder?.assetFolderId;
        if (assetFolderId) return props.linkedFolderPreviewNodesById.get(assetFolderId) || EMPTY_CANVAS_NODES;
        const localChildren = props.frameChildrenById.get(node.id) || EMPTY_CANVAS_NODES;
        if (localChildren.length) return localChildren;
        return EMPTY_CANVAS_NODES;
    };
    return (
        <>
            <svg
                className="absolute overflow-visible"
                viewBox={`${props.connectionLayerBounds.left} ${props.connectionLayerBounds.top} ${props.connectionLayerBounds.width} ${props.connectionLayerBounds.height}`}
                style={{ left: props.connectionLayerBounds.left, top: props.connectionLayerBounds.top, width: props.connectionLayerBounds.width, height: props.connectionLayerBounds.height, pointerEvents: "none", zIndex: 0 }}
            >
                {props.displayConnections.map(({ connection, from, to }) => (
                    <ConnectionPath
                        key={connection.id}
                        connection={connection}
                        from={from}
                        to={to}
                        fromScrollTop={props.scriptScrollTopById[from.id] || 0}
                        toScrollTop={props.scriptScrollTopById[to.id] || 0}
                        fromBatchScroll={props.batchScrollById?.[from.id]}
                        toBatchScroll={props.batchScrollById?.[to.id]}
                        active={props.selectedConnectionId === connection.id || props.relatedConnectionIds.has(connection.id)}
                        visualMode="hover-only"
                        // 拖动预览由 Leafer 图形层逐帧同步；隐藏这层静态 SVG 描边，避免两套位置叠出残影。
                        hideVisual={props.isNodeDragging}
                        onSelect={() => props.onConnectionSelect(connection.id)}
                        onContextMenu={(event) => props.onConnectionContextMenu(event, connection.id)}
                    />
                ))}
            </svg>

            {orderedVisibleNodes.map((node) =>
                isFrameNode(node) ? (
                    <CanvasFrameNode
                        key={node.id}
                        data={node}
                        renderLOD={props.nodeRenderLODById.get(node.id) || "full"}
                        dragOffset={props.dragPreview?.nodeIds.has(node.id) ? props.dragPreview : undefined}
                        childNodes={framePreviewNodes(node)}
                        scale={viewportScale}
                        isSelected={props.selectedNodeIds.has(node.id)}
                        isDropTarget={props.frameDropTargetId === node.id}
                        onMouseDown={props.onNodeMouseDown}
                        onResize={props.onNodeResize}
                        onToggleCollapsed={props.onToggleFrame}
                        onFolderStyleChange={props.onFolderStyleChange}
                        onFolderThemeChange={props.onFolderThemeChange}
                        onTitleChange={props.onNodeTitleChange}
                        onContextMenu={props.onNodeContextMenu}
                    />
                ) : (
                    <CanvasNode
                        key={node.id}
                        data={node}
                        renderLOD={props.nodeRenderLODById.get(node.id) || "full"}
                        dragOffset={props.dragPreview?.nodeIds.has(node.id) ? props.dragPreview : undefined}
                        scale={viewportScale}
                        isSelected={props.selectedNodeIds.has(node.id)}
                        mediaActive={activeMediaNodeId === node.id}
                        onMediaPlayRequest={setActiveMediaNodeId}
                        onMediaPlaybackEnded={() => setActiveMediaNodeId(null)}
                        onMediaPlaybackUnavailable={() => setActiveMediaNodeId(null)}
                        isRelated={props.relatedNodeIds.has(node.id)}
                        isFocusRelated={props.activeNodeId === node.id}
                        isConnectionTarget={props.connectionTargetNodeId === node.id || props.batchConnectionPreview?.targetNodeId === node.id}
                        isConnecting={props.isConnecting}
                        connectionApproach={props.connectionApproach?.nodeId === node.id ? props.connectionApproach.point : undefined}
                        forceInputMounted={Boolean(props.batchConnectionPreview)}
                        batchCount={props.batchChildCountById.get(node.id) || 0}
                        batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                        batchPreviewNodes={batchPreviews.get(node.id)}
                        batchClosing={Boolean(node.metadata?.batchRootId && props.collapsingBatchIds.has(node.metadata.batchRootId))}
                        batchOpening={props.openingBatchIds.has(node.metadata?.batchRootId || node.id)}
                        batchRecovering={props.collapsingBatchIds.has(node.id)}
                        batchPrimary={Boolean(node.metadata?.batchRootId && props.nodeById.get(node.metadata.batchRootId)?.metadata?.primaryImageId === node.id)}
                        batchMotion={props.batchMotionById.get(node.id)}
                        showImageInfo={props.showImageInfo}
                        disableMediaEffects={props.mediaEffectsDisabledNodeId === node.id}
                        resourceLabel={props.resourceReferenceByNodeId.get(node.id)}
                        mentionReferences={props.mentionReferencesByNodeId.get(node.id) || EMPTY_RESOURCE_REFERENCES}
                        renderNodeContent={props.renderCanvasNodeContent}
                        drawingProjectId={props.projectId}
                        onMouseDown={props.onNodeMouseDown}
                        onHoverStart={props.onNodeHoverStart}
                        onHoverEnd={props.onNodeHoverEnd}
                        onConnectStart={props.onConnectStart}
                        onResize={props.onNodeResize}
                        onTitleChange={props.onNodeTitleChange}
                        onContentChange={props.onNodeContentChange}
                        onToggleBatch={props.onToggleBatch}
                        onSetBatchPrimary={props.onSetBatchPrimary}
                        onRetry={props.onRetry}
                        onReloadResource={props.onReloadResource}
                        onOpenTaskDetails={props.onOpenTaskDetails}
                        onViewImage={props.onViewImage}
                        onReplaceMedia={props.onReplaceMedia}
                        onOpenTextEditor={props.onOpenTextEditor}
                        onOpenPrevis={props.onOpenPrevis}
                        onOpenDrawing={props.onOpenDrawing}
                        onContextMenu={props.onNodeContextMenu}
                    />
                ),
            )}

            {!props.isNodeDragging ? <BatchConnectionTails {...props} /> : null}

            {props.selectedNodeBounds && !props.selectionBox ? (
                <div
                    ref={props.selectionBoundsElementRef}
                    data-canvas-selection-bounds
                    className="pointer-events-none absolute z-[var(--z-panel-floating)] rounded-xl"
                    style={{
                        left: props.selectedNodeBounds.left - 12 / viewportScale,
                        top: props.selectedNodeBounds.top - 12 / viewportScale,
                        width: props.selectedNodeBounds.width + 24 / viewportScale,
                        height: props.selectedNodeBounds.height + 24 / viewportScale,
                    }}
                >
                    {props.batchSourceNodeIds.length > 0 ? (
                        <BatchConnectionHandle
                            scale={viewportScale}
                            count={props.batchSourceNodeIds.length}
                            active={Boolean(props.batchConnectionPreview)}
                            onPointerDown={(event) => props.onStartBatchConnection(event, props.batchSourceNodeIds)}
                        />
                    ) : null}
                </div>
            ) : null}
        </>
    );
});

/** 表内终段覆盖节点底色，但不接收鼠标，避免细线阻挡格子与提示词。 */
const BatchConnectionTails = memo(function BatchConnectionTails(props: CanvasProjectWorldLayersProps) {
    const groups = new Map<string, CanvasDisplayConnection[]>();
    for (const item of props.displayConnections) {
        if (!parseBatchCellHandle(item.connection.toHandleId)) continue;
        const items = groups.get(item.to.id) || [];
        items.push(item);
        groups.set(item.to.id, items);
    }
    return <>{Array.from(groups, ([tableId, items]) => {
        const node = props.nodeById.get(tableId);
        if (!node) return null;
        const top = node.position.y + BATCH_TABLE_HEADER_HEIGHT + BATCH_COLUMN_HEADER_HEIGHT;
        const height = Math.max(0, node.height - BATCH_TABLE_HEADER_HEIGHT - BATCH_COLUMN_HEADER_HEIGHT);
        const scroll = props.batchScrollById?.[tableId];
        return <svg key={tableId} data-batch-cell-connections={tableId} className="pointer-events-none absolute overflow-hidden" viewBox={`${node.position.x} ${top} ${node.width} ${height}`} style={{ left: node.position.x, top, width: node.width, height, zIndex: "var(--z-node-active)" }}>
            {items.map((item) => <BatchConnectionTail key={item.connection.id} item={item} top={top} scroll={scroll} fromScrollTop={props.scriptScrollTopById[item.from.id] || 0} fromBatchScroll={props.batchScrollById?.[item.from.id]} active={props.selectedConnectionId === item.connection.id || props.relatedConnectionIds.has(item.connection.id)} />)}
        </svg>;
    })}</>;
});

function BatchConnectionTail({ item, top, scroll, fromScrollTop, fromBatchScroll, active }: { item: CanvasDisplayConnection; top: number; scroll?: BatchScroll; fromScrollTop: number; fromBatchScroll?: BatchScroll; active: boolean }) {
    const theme = canvasThemes[useActiveTheme()];
    const from = useCanvasVisualNode(item.from);
    const to = useCanvasVisualNode(item.to);
    const cell = batchCellAnchor(to, item.connection.toHandleId, scroll);
    if (!cell) return null;
    const path = canvasConnectionPath(item.connection, from, to, fromScrollTop, 0, fromBatchScroll, scroll);
    return <g>
        <path d={path.pathD} fill="none" stroke={theme.connection.stroke} strokeWidth={CANVAS_CONNECTION_STROKE_WIDTH} strokeOpacity={0.8} vectorEffect="non-scaling-stroke" />
        {active ? <CanvasConnectionBeam pathD={path.pathD} color={theme.connection.beam} /> : null}
        <circle cx={cell.x} cy={cell.y} r={3} fill={theme.connection.beam} fillOpacity={active ? 1 : 0.65} />
        {active && cell.clipped ? <text x={cell.x + 8} y={cell.y <= top + 8 ? cell.y + 15 : cell.y - 8} fill="var(--foreground)" fontSize={12}>{cell.label} · 滚动查看</text> : null}
    </g>;
}

function BatchConnectionHandle({ scale, count, active, onPointerDown }: { scale: number; count: number; active: boolean; onPointerDown: (event: ReactPointerEvent) => void }) {
    const inverseScale = 1 / Math.max(scale, 0.05);
    const buttonStyle: CSSProperties = {
        right: -18 * inverseScale,
        top: "50%",
        width: 30 * inverseScale,
        height: 30 * inverseScale,
        background: active ? "var(--workspace-accent)" : "var(--workspace-surface-strong)",
        borderColor: active ? "var(--workspace-accent)" : "var(--workspace-border)",
        color: active ? "var(--workspace-accent-foreground)" : "var(--foreground)",
    };
    return (
        <button
            type="button"
            data-canvas-no-zoom
            data-icon-only
            className="pointer-events-auto absolute grid -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border shadow-md transition-opacity duration-150 hover:opacity-85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
            style={buttonStyle}
            title={`批量连接 ${count} 个节点`}
            aria-label={`批量连接 ${count} 个节点`}
            onPointerDown={onPointerDown}
        >
            <Link2 style={{ width: 14 * inverseScale, height: 14 * inverseScale }} strokeWidth={2} />
            <span className="sr-only">连接 {count} 个节点</span>
        </button>
    );
}
