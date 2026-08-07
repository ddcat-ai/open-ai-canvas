import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import { ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import type { CanvasDisplayConnection, CanvasNodeData, ConnectionHandle, Position, SelectionBox } from "@/types/canvas";

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
    frameChildrenById: Map<string, CanvasNodeData[]>;
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
    onNodeTitleChange: (nodeId: string, title: string) => void;
    onNodeContextMenu: (event: ReactMouseEvent, nodeId: string) => void;
    onNodeContentChange: (nodeId: string, content: string) => void;
    onToggleBatch: (nodeId: string) => void;
    onSetBatchPrimary: (node: CanvasNodeData) => void;
    onRetry: (node: CanvasNodeData) => void;
    onCancelTask: (node: CanvasNodeData) => void;
    onOpenTaskDetails: (node: CanvasNodeData) => void;
    onOpenVersions: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReplaceMedia: (node: CanvasNodeData) => void;
    onOpenTextEditor: (node: CanvasNodeData) => void;
    onOpenDirector: (node: CanvasNodeData) => void;
    onOpenDrawing: (node: CanvasNodeData) => void;
};

const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];
const EMPTY_CANVAS_NODES: CanvasNodeData[] = [];

export function CanvasProjectWorldLayers(props: CanvasProjectWorldLayersProps) {
    const { viewportScale } = props;
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

            {props.visibleNodes.map((node) =>
                isFrameNode(node) ? (
                    <CanvasFrameNode
                        key={node.id}
                        data={node}
                        dragOffset={props.dragPreview?.nodeIds.has(node.id) ? props.dragPreview : undefined}
                        childNodes={props.frameChildrenById.get(node.id) || EMPTY_CANVAS_NODES}
                        scale={viewportScale}
                        isSelected={props.selectedNodeIds.has(node.id)}
                        isDropTarget={props.frameDropTargetId === node.id}
                        onMouseDown={props.onNodeMouseDown}
                        onResize={props.onNodeResize}
                        onToggleCollapsed={props.onToggleFrame}
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
                        isRelated={props.relatedNodeIds.has(node.id)}
                        isFocusRelated={props.activeNodeId === node.id}
                        isConnectionTarget={props.connectionTargetNodeId === node.id}
                        isConnecting={Boolean(props.connectingParams)}
                        batchCount={props.batchChildCountById.get(node.id) || 0}
                        batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                        batchClosing={Boolean(node.metadata?.batchRootId && props.collapsingBatchIds.has(node.metadata.batchRootId))}
                        batchOpening={props.openingBatchIds.has(node.id)}
                        batchRecovering={props.collapsingBatchIds.has(node.id)}
                        batchPrimary={Boolean(node.metadata?.batchRootId && props.nodeById.get(node.metadata.batchRootId)?.metadata?.primaryImageId === node.id)}
                        batchMotion={props.batchMotionById.get(node.id)}
                        showImageInfo={props.showImageInfo}
                        reduceMediaEffects={props.reduceMediaEffects || props.isNodeDragging || props.mediaEffectsDisabledNodeId === node.id}
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
                        onCancelTask={props.onCancelTask}
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
                />
            ) : null}
        </>
    );
}
