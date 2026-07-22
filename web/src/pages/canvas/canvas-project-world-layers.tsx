import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode, RefObject } from "react";

import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasFrameNode } from "@/components/canvas/canvas-frame-node";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasNodeAnglePanel, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { isFrameNode } from "@/lib/canvas/canvas-frame";
import type { CanvasConnection, CanvasNodeData, ConnectionHandle, Position, SelectionBox } from "@/types/canvas";

type CanvasTheme = {
    accent: { primary: string };
    canvas: { selectionFill: string };
};

type DisplayConnection = { connection: CanvasConnection; from: CanvasNodeData; to: CanvasNodeData };
type DragPreview = { x: number; y: number; nodeIds: Set<string> } | null;
type NodeBounds = { left: number; top: number; width: number; height: number; count: number } | null;

type CanvasProjectWorldLayersProps = {
    theme: CanvasTheme;
    viewportScale: number;
    connectionLayerBounds: { left: number; top: number; width: number; height: number };
    displayConnections: DisplayConnection[];
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
    editingNodeId: string | null;
    editRequestNonce: number;
    selectionBox: SelectionBox | null;
    batchChildCountById: Map<string, number>;
    collapsingBatchIds: Set<string>;
    openingBatchIds: Set<string>;
    batchMotionById: Map<string, { x: number; y: number; index: number }>;
    showImageInfo: boolean;
    reduceMediaEffects: boolean;
    resourceReferenceByNodeId: Map<string, CanvasResourceReference>;
    mentionReferencesByNodeId: Map<string, CanvasResourceReference[]>;
    angleNode: CanvasNodeData | null;
    selectedNodeBounds: NodeBounds;
    isNodeDragging: boolean;
    selectionBoundsElementRef: RefObject<HTMLDivElement | null>;
    selectionBoxElementRef: RefObject<HTMLDivElement | null>;
    renderCanvasNodeContent: (node: CanvasNodeData) => ReactNode;
    onConnectionSelect: (connectionId: string) => void;
    onConnectionContextMenu: (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => void;
    onNodeMouseDown: (event: ReactMouseEvent, nodeId: string) => void;
    onNodeHoverStart: (nodeId: string) => void;
    onNodeHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: ReactPointerEvent, nodeId: string, handleType: "source" | "target", handleId?: string) => void;
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
    onGenerateImage: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onReplaceMedia: (node: CanvasNodeData) => void;
    onOpenDirector: (node: CanvasNodeData) => void;
    onOpenDocument: (node: CanvasNodeData) => void;
    onCloseAngle: () => void;
    onGenerateAngle: (params: CanvasImageAngleParams) => void;
};

const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];
const EMPTY_CANVAS_NODES: CanvasNodeData[] = [];

export function CanvasProjectWorldLayers(props: CanvasProjectWorldLayersProps) {
    const { theme, viewportScale } = props;
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
                        onSelect={() => props.onConnectionSelect(connection.id)}
                        onContextMenu={(event) => props.onConnectionContextMenu(event, connection.id)}
                    />
                ))}
                {props.connectingParams ? <ActiveConnectionPath node={props.nodeById.get(props.connectingParams.nodeId)} handle={props.connectingParams} mouseWorld={props.mouseWorld} target={props.connectionTargetNodeId ? props.nodeById.get(props.connectionTargetNodeId) : undefined} nodeScrollTop={props.scriptScrollTopById[props.connectingParams.nodeId] || 0} /> : null}
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
                        editRequestNonce={props.editingNodeId === node.id ? props.editRequestNonce : 0}
                        batchCount={props.batchChildCountById.get(node.id) || 0}
                        batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                        batchClosing={Boolean(node.metadata?.batchRootId && props.collapsingBatchIds.has(node.metadata.batchRootId))}
                        batchOpening={props.openingBatchIds.has(node.id)}
                        batchRecovering={props.collapsingBatchIds.has(node.id)}
                        batchMotion={props.batchMotionById.get(node.id)}
                        showImageInfo={props.showImageInfo}
                        reduceMediaEffects={props.reduceMediaEffects || props.isNodeDragging}
                        resourceLabel={props.resourceReferenceByNodeId.get(node.id)}
                        mentionReferences={props.mentionReferencesByNodeId.get(node.id) || EMPTY_RESOURCE_REFERENCES}
                        renderNodeContent={props.renderCanvasNodeContent}
                        onMouseDown={props.onNodeMouseDown}
                        onHoverStart={props.onNodeHoverStart}
                        onHoverEnd={props.onNodeHoverEnd}
                        onConnectStart={props.onConnectStart}
                        onResize={props.onNodeResize}
                        onContentChange={props.onNodeContentChange}
                        onToggleBatch={props.onToggleBatch}
                        onSetBatchPrimary={props.onSetBatchPrimary}
                        onRetry={props.onRetry}
                        onCancelTask={props.onCancelTask}
                        onOpenTaskDetails={props.onOpenTaskDetails}
                        onOpenVersions={props.onOpenVersions}
                        onGenerateImage={props.onGenerateImage}
                        onViewImage={props.onViewImage}
                        onReplaceMedia={props.onReplaceMedia}
                        onOpenDirector={props.onOpenDirector}
                        onOpenDocument={props.onOpenDocument}
                        onContextMenu={props.onNodeContextMenu}
                    />
                ),
            )}

            {props.angleNode?.metadata?.content ? (
                <div className="absolute z-[68]" style={{ left: props.angleNode.position.x, top: props.angleNode.position.y + props.angleNode.height + 16, width: Math.max(props.angleNode.width, 720) }}>
                    <CanvasNodeAnglePanel dataUrl={props.angleNode.metadata.content} onClose={props.onCloseAngle} onConfirm={props.onGenerateAngle} />
                </div>
            ) : null}

            {props.selectedNodeBounds && !props.selectionBox && !props.isNodeDragging ? (
                <div
                    ref={props.selectionBoundsElementRef}
                    className="pointer-events-none absolute z-[65] rounded-xl border"
                    style={{
                        left: props.selectedNodeBounds.left - 12 / viewportScale,
                        top: props.selectedNodeBounds.top - 12 / viewportScale,
                        width: props.selectedNodeBounds.width + 24 / viewportScale,
                        height: props.selectedNodeBounds.height + 24 / viewportScale,
                        borderColor: theme.accent.primary,
                        borderWidth: 1 / viewportScale,
                    }}
                />
            ) : null}

            {props.selectionBox ? (
                <div
                    ref={props.selectionBoxElementRef}
                    className="pointer-events-none absolute z-[100] border"
                    style={{
                        transform: `translate3d(var(--selection-x, ${Math.min(props.selectionBox.startWorldX, props.selectionBox.currentWorldX)}px), var(--selection-y, ${Math.min(props.selectionBox.startWorldY, props.selectionBox.currentWorldY)}px), 0)`,
                        width: `var(--selection-width, ${Math.abs(props.selectionBox.currentWorldX - props.selectionBox.startWorldX)}px)`,
                        height: `var(--selection-height, ${Math.abs(props.selectionBox.currentWorldY - props.selectionBox.startWorldY)}px)`,
                        borderColor: theme.accent.primary,
                        background: theme.canvas.selectionFill,
                        willChange: "transform,width,height",
                    }}
                />
            ) : null}
        </>
    );
}
