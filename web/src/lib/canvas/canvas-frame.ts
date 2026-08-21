import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export const FRAME_HEADER_HEIGHT = 36;
export const FRAME_PADDING = 24;
export const FRAME_COLLAPSED_WIDTH = 240;
export const FRAME_COLLAPSED_HEIGHT = 144;
export const FOLDER_COLLAPSED_WIDTH = 360;
export const FOLDER_COLLAPSED_HEIGHT = 280;

export function isFrameNode(node?: CanvasNodeData | null): node is CanvasNodeData & { type: CanvasNodeType.Frame } {
    return node?.type === CanvasNodeType.Frame;
}

export function isCanvasFolderNode(node?: CanvasNodeData | null) {
    return isFrameNode(node) && Boolean(node.metadata?.folder);
}

export function canFrameContain(node: CanvasNodeData) {
    return node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Text || node.type === CanvasNodeType.Drawing || node.type === CanvasNodeType.Script || node.type === CanvasNodeType.Video;
}

export function canFolderContain(node: CanvasNodeData) {
    return node.type !== CanvasNodeType.Frame;
}

export function canLinkedFolderArchive(node: CanvasNodeData) {
    return (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio || node.type === CanvasNodeType.Text) && Boolean(node.metadata?.assetId || node.metadata?.content?.trim());
}

export function getFrameChildren(frameId: string, nodes: CanvasNodeData[]) {
    return nodes.filter((node) => node.parentId === frameId);
}

export function getFrameChildIds(frameId: string, nodes: CanvasNodeData[]) {
    return new Set(getFrameChildren(frameId, nodes).map((node) => node.id));
}

export function getCollapsedParentFrame(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    if (!node.parentId) return null;
    const frame = nodes.find((item) => item.id === node.parentId && isFrameNode(item));
    return frame?.metadata?.frame?.collapsed ? frame : null;
}

export function isNodeHiddenByCollapsedFrame(node: CanvasNodeData, nodes: CanvasNodeData[]) {
    return Boolean(getCollapsedParentFrame(node, nodes));
}

export function findFrameDropTarget(nodes: CanvasNodeData[], draggedNodeIds: Set<string>) {
    const dragged = nodes.filter((node) => draggedNodeIds.has(node.id));
    if (!dragged.length) return null;

    return (
        [...nodes]
            .reverse()
            .find((frame) => {
                if (!isFrameNode(frame) || (frame.metadata?.frame?.collapsed && !isCanvasFolderNode(frame)) || draggedNodeIds.has(frame.id)) return false;
                const canContain = frame.metadata?.folder?.assetFolderId ? canLinkedFolderArchive : isCanvasFolderNode(frame) ? canFolderContain : canFrameContain;
                if (!dragged.every(canContain)) return false;
                const left = frame.position.x;
                const top = frame.position.y + (isCanvasFolderNode(frame) && frame.metadata?.frame?.collapsed ? 0 : FRAME_HEADER_HEIGHT);
                const right = frame.position.x + frame.width;
                const bottom = frame.position.y + frame.height;
                return dragged.every((node) => {
                    const centerX = node.position.x + node.width / 2;
                    const centerY = node.position.y + node.height / 2;
                    return centerX >= left && centerX <= right && centerY >= top && centerY <= bottom;
                });
            })?.id || null
    );
}

export function applyFrameDrop(nodes: CanvasNodeData[], draggedNodeIds: Set<string>, frameId: string | null) {
    const target = frameId ? nodes.find((node) => node.id === frameId && isFrameNode(node)) : null;
    const canContain = target?.metadata?.folder?.assetFolderId ? canLinkedFolderArchive : target && isCanvasFolderNode(target) ? canFolderContain : canFrameContain;
    const next = nodes.map((node) => {
        if (!draggedNodeIds.has(node.id)) return node;
        if (!frameId) return node.parentId ? { ...node, parentId: undefined } : node;
        return target && canContain(node) ? { ...node, parentId: frameId } : node;
    });
    if (!frameId) return next;

    const children = getFrameChildren(frameId, next);
    if (!children.length) return next;
    const frame = next.find((node) => node.id === frameId);
    if (!frame || !isFrameNode(frame)) return next;

    if (isCanvasFolderNode(frame) && frame.metadata?.frame?.collapsed) {
        return layoutCollapsedFolderChildren(next, frame);
    }

    const left = Math.min(frame.position.x, ...children.map((node) => node.position.x - FRAME_PADDING));
    const top = Math.min(frame.position.y, ...children.map((node) => node.position.y - FRAME_HEADER_HEIGHT - FRAME_PADDING));
    const right = Math.max(frame.position.x + frame.width, ...children.map((node) => node.position.x + node.width + FRAME_PADDING));
    const bottom = Math.max(frame.position.y + frame.height, ...children.map((node) => node.position.y + node.height + FRAME_PADDING));

    return next.map((node) =>
        node.id === frameId
            ? {
                  ...node,
                  position: { x: left, y: top },
                  width: right - left,
                  height: bottom - top,
                  metadata: {
                      ...node.metadata,
                      frame: {
                          collapsed: false,
                          expandedWidth: right - left,
                          expandedHeight: bottom - top,
                      },
                  },
              }
            : node,
    );
}

function layoutCollapsedFolderChildren(nodes: CanvasNodeData[], folder: CanvasNodeData) {
    const children = getFrameChildren(folder.id, nodes);
    if (!children.length) return nodes;
    const gap = 24;
    const padding = FRAME_PADDING;
    const columns = Math.min(3, Math.ceil(Math.sqrt(children.length)));
    const rows = Math.ceil(children.length / columns);
    const cellWidth = Math.max(...children.map((node) => node.width));
    const cellHeight = Math.max(...children.map((node) => node.height));
    const expandedWidth = padding * 2 + columns * cellWidth + Math.max(columns - 1, 0) * gap;
    const expandedHeight = FRAME_HEADER_HEIGHT + padding * 2 + rows * cellHeight + Math.max(rows - 1, 0) * gap;
    const indexById = new Map(children.map((node, index) => [node.id, index]));

    return nodes.map((node) => {
        if (node.id === folder.id) {
            return {
                ...node,
                metadata: {
                    ...node.metadata,
                    frame: { collapsed: true, expandedWidth, expandedHeight },
                },
            };
        }
        const index = indexById.get(node.id);
        if (index === undefined) return node;
        const column = index % columns;
        const row = Math.floor(index / columns);
        return {
            ...node,
            position: {
                x: folder.position.x + padding + column * (cellWidth + gap) + (cellWidth - node.width) / 2,
                y: folder.position.y + FRAME_HEADER_HEIGHT + padding + row * (cellHeight + gap) + (cellHeight - node.height) / 2,
            },
        };
    });
}

export function resolveFrameConnection(connection: CanvasConnection, nodes: CanvasNodeData[]) {
    const from = nodes.find((node) => node.id === connection.fromNodeId);
    const to = nodes.find((node) => node.id === connection.toNodeId);
    if (!from || !to) return null;

    const displayFrom = getCollapsedParentFrame(from, nodes) || from;
    const displayTo = getCollapsedParentFrame(to, nodes) || to;
    if (displayFrom.id === displayTo.id) return null;
    return { from: displayFrom, to: displayTo };
}
