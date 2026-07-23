import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ContextMenuState, type Position } from "@/types/canvas";

type CanvasProjectContextMenuProps = {
    menu: ContextMenuState | null;
    node: CanvasNodeData | null;
    workspaceMode: CanvasWorkspaceMode;
    canUndo: boolean;
    canRedo: boolean;
    canPaste: boolean;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    onClose: () => void;
    onAddNode: (type: CanvasNodeType, position: Position) => void;
    onAddNovel: (position: Position) => void;
    onOpenDirector: (position?: Position) => void;
    onUpload: (nodeId: string | undefined, position: Position) => void;
    onOpenAssets: (position: Position) => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: (position: Position) => void;
    onCopyNode: (nodeId: string) => void;
    onDuplicate: (nodeId: string) => void;
    onDeleteNode: (nodeId: string) => void;
    onDeleteConnection: (connectionId: string) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onViewImage: (node: CanvasNodeData) => void;
    onEditNode: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onCopyContent: (node: CanvasNodeData | null) => void;
    onCopyOssUrl: (node: CanvasNodeData | null) => void;
    onToggleFrame: (node: CanvasNodeData) => void;
};

export function CanvasProjectContextMenu({ menu, node, screenToCanvas, ...props }: CanvasProjectContextMenuProps) {
    if (!menu) return null;
    const menuPosition = () => menu.type === "canvas" ? menu.position : screenToCanvas(menu.x, menu.y);
    return (
        <CanvasNodeContextMenu
            menu={menu}
            node={node}
            workspaceMode={props.workspaceMode}
            canUndo={props.canUndo}
            canRedo={props.canRedo}
            canPaste={props.canPaste}
            onClose={props.onClose}
            onAddNode={(type) => {
                if (menu.type === "canvas") props.onAddNode(type, menu.position);
            }}
            onAddNovel={() => {
                if (menu.type === "canvas") props.onAddNovel(menu.position);
            }}
            onOpenDirector={props.onOpenDirector}
            onUpload={() => props.onUpload(menu.type === "node" ? menu.nodeId : undefined, menuPosition())}
            onOpenAssets={() => props.onOpenAssets(menuPosition())}
            onUndo={props.onUndo}
            onRedo={props.onRedo}
            onPaste={() => props.onPaste(menuPosition())}
            onCopyNode={() => {
                if (menu.type === "node") props.onCopyNode(menu.nodeId);
            }}
            onDuplicate={() => {
                if (menu.type === "node") props.onDuplicate(menu.nodeId);
            }}
            onDelete={() => {
                if (menu.type === "node") props.onDeleteNode(menu.nodeId);
                else if (menu.type === "connection") props.onDeleteConnection(menu.connectionId);
            }}
            onSaveAsset={() => {
                if (node) props.onSaveAsset(node);
            }}
            onViewImage={() => {
                if (node) props.onViewImage(node);
            }}
            onEditNode={() => {
                if (node) props.onEditNode(node);
            }}
            onEditText={() => {
                if (node) props.onEditText(node);
            }}
            onGenerateImage={() => {
                if (node) props.onGenerateImage(node);
            }}
            onCopyContent={() => props.onCopyContent(node)}
            onCopyOssUrl={() => props.onCopyOssUrl(node)}
            onToggleFrame={() => {
                if (node?.type === CanvasNodeType.Frame) props.onToggleFrame(node);
            }}
        />
    );
}
