import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { Link2 } from "lucide-react";

import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import type { CanvasBatchConnectionPreview } from "@/lib/canvas/canvas-batch-connection";
import { resolveActiveCanvasMediaNodeId } from "@/lib/canvas/canvas-performance-mode";
import { sortCanvasNodesByStackOrder, type CanvasNodeStackOrder } from "@/lib/canvas/canvas-node-stack-order";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import type { CanvasDisplayConnection, CanvasFolderStyle, CanvasFolderTheme, CanvasNodeData, ConnectionHandle, Position, SelectionBox } from "@/types/canvas";

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
    connectingParams: ConnectionHandle | null;
    mouseWorld: Position;
    connectionTargetNodeId: string | null;
    nodeById: Map<string, CanvasNodeData>;
    visibleNodes: CanvasNodeData[];
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
    reduceMediaEffects: boolean;
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
    onOpenVersions: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReplaceMedia: (node: CanvasNodeData) => void;
    onOpenTextEditor: (node: CanvasNodeData) => void;
    onOpenDirector: (node: CanvasNodeData) => void;
    onOpenDrawing: (node: CanvasNodeData) => void;
    onStartBatchConnection: (event: ReactPointerEvent, sourceNodeIds: string[]) => void;
};

const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];
const EMPTY_CANVAS_NODES: CanvasNodeData[] = [];

export const CanvasProjectWorldLayers = memo(function CanvasProjectWorldLayers(props: CanvasProjectWorldLayersProps) {
    const { viewportScale } = props;
    const activeMediaNodeId = resolveActiveCanvasMediaNodeId(props.selectedNodeIds, props.nodeById);
    const orderedVisibleNodes = [
        ...props.visibleNodes.filter(isFrameNode),
        ...sortCanvasNodesByStackOrder(props.visibleNodes.filter((node) => !isFrameNode(node)), props.nodeStackOrder),
    ];
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
                        active={props.selectedConnectionId === connection.id || props.relatedConnectionIds.has(connection.id)}
                        visualMode="hover-only"
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
                        dragOffset={props.dragPreview?.nodeIds.has(node.id) ? props.dragPreview : undefined}
                        scale={viewportScale}
                        isSelected={props.selectedNodeIds.has(node.id)}
                        mediaActive={activeMediaNodeId === node.id}
                        hydrateMediaPreview={activeMediaNodeId === null}
                        isRelated={props.relatedNodeIds.has(node.id)}
                        isFocusRelated={props.activeNodeId === node.id}
                        isConnectionTarget={props.connectionTargetNodeId === node.id || props.batchConnectionPreview?.targetNodeId === node.id}
                        forceInputVisible={Boolean(props.batchConnectionPreview)}
                        batchCount={props.batchChildCountById.get(node.id) || 0}
                        batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                        batchClosing={Boolean(node.metadata?.batchRootId && props.collapsingBatchIds.has(node.metadata.batchRootId))}
                        batchOpening={props.openingBatchIds.has(node.id)}
                        batchRecovering={props.collapsingBatchIds.has(node.id)}
                        batchPrimary={Boolean(node.metadata?.batchRootId && props.nodeById.get(node.metadata.batchRootId)?.metadata?.primaryImageId === node.id)}
                        batchMotion={props.batchMotionById.get(node.id)}
                        showImageInfo={props.showImageInfo}
                        reduceMediaEffects={props.reduceMediaEffects || props.mediaEffectsDisabledNodeId === node.id}
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
                        onOpenVersions={props.onOpenVersions}
                        onViewImage={props.onViewImage}
                        onReplaceMedia={props.onReplaceMedia}
                        onOpenTextEditor={props.onOpenTextEditor}
                        onOpenDirector={props.onOpenDirector}
                        onOpenDrawing={props.onOpenDrawing}
                        onContextMenu={props.onNodeContextMenu}
                    />
                ),
            )}

            {props.selectedNodeBounds && !props.selectionBox && !props.isNodeDragging ? (
                <div
                    ref={props.selectionBoundsElementRef}
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
            className="pointer-events-auto absolute grid -translate-y-1/2 translate-x-1/2 place-items-center rounded-full border shadow-md transition hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
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
