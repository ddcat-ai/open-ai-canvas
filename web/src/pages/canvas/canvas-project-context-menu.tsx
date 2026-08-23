import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeType, type CanvasNodeData, type CanvasWorkspaceMode, type ContextMenuState, type Position } from "@/types/canvas";

type CanvasAssetCategory = NonNullable<NonNullable<CanvasNodeData["metadata"]>["assetCategory"]>;

type CanvasProjectContextMenuProps = {
    menu: ContextMenuState | null;
    node: CanvasNodeData | null;
    workspaceMode: CanvasWorkspaceMode;
    isProjectLinked: boolean;
    canUndo: boolean;
    canRedo: boolean;
    canPaste: boolean;
    screenToCanvas: (clientX: number, clientY: number) => Position;
    onClose: () => void;
    onAddNode: (type: CanvasNodeType, position: Position) => void;
    onAddFolder: (position: Position) => void;
    onChooseStyle: () => void;
    onOpenDirector: (position?: Position) => void;
    onUpload: (nodeId: string | undefined, position: Position) => void;
    onOpenAssets: (position: Position) => void;
    onOpenProjectCharacters: (position: Position) => void;
    onUndo: () => void;
    onRedo: () => void;
    onPaste: (position: Position) => void;
    onCopyNode: (nodeId: string) => void;
    onDuplicate: (nodeId: string) => void;
    onDeleteNode: (nodeId: string) => void;
    onDeleteConnection: (connectionId: string) => void;
    onSaveAsset: (node: CanvasNodeData) => void;
    onViewMedia: (node: CanvasNodeData) => void;
    onEditText: (node: CanvasNodeData) => void;
    onOpenDrawing: (node: CanvasNodeData) => void;
    onGenerateImage: (node: CanvasNodeData) => void;
    onCopyContent: (node: CanvasNodeData | null) => void;
    onCopyMediaUrl: (node: CanvasNodeData | null) => void;
    onUploadToArkPrivateAsset: (node: CanvasNodeData) => void;
    onSetAssetCategory: (nodeId: string, category: CanvasAssetCategory) => void;
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
            isProjectLinked={props.isProjectLinked}
            canUndo={props.canUndo}
            canRedo={props.canRedo}
            canPaste={props.canPaste}
            onClose={props.onClose}
            onAddNode={(type) => {
                if (menu.type === "canvas") props.onAddNode(type, menu.position);
            }}
            onAddFolder={() => {
                if (menu.type === "canvas") props.onAddFolder(menu.position);
            }}
            onChooseStyle={props.onChooseStyle}
            onOpenDirector={props.onOpenDirector}
            onUpload={() => props.onUpload(menu.type === "node" ? menu.nodeId : undefined, menuPosition())}
            onOpenAssets={() => props.onOpenAssets(menuPosition())}
            onOpenProjectCharacters={() => props.onOpenProjectCharacters(menuPosition())}
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
            onViewMedia={() => {
                if (node) props.onViewMedia(node);
            }}
            onEditText={() => {
                if (node) props.onEditText(node);
            }}
            onOpenDrawing={() => {
                if (node) props.onOpenDrawing(node);
            }}
            onGenerateImage={() => {
                if (node) props.onGenerateImage(node);
            }}
            onCopyContent={() => props.onCopyContent(node)}
            onCopyMediaUrl={() => props.onCopyMediaUrl(node)}
            onUploadToArkPrivateAsset={() => {
                if (node?.type === CanvasNodeType.Image) props.onUploadToArkPrivateAsset(node);
            }}
            onSetAssetCategory={(category) => {
                if (menu.type === "node") props.onSetAssetCategory(menu.nodeId, category);
            }}
            onToggleFrame={() => {
                if (node?.type === CanvasNodeType.Frame) props.onToggleFrame(node);
            }}
        />
    );
}
