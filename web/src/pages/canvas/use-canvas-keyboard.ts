import { useEffect, type Dispatch, type SetStateAction } from "react";

import type { CanvasNodeData, ContextMenuState } from "@/types/canvas";

type UseCanvasKeyboardOptions = {
    nodesRef: { current: CanvasNodeData[] };
    selectedNodeIdsRef: { current: Set<string> };
    selectedConnectionId: string | null;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setShortcutRequestNonce: Dispatch<SetStateAction<number>>;
    setInfoNodeId: Dispatch<SetStateAction<string | null>>;
    setCropNodeId: Dispatch<SetStateAction<string | null>>;
    setMaskEditNodeId: Dispatch<SetStateAction<string | null>>;
    setAnnotationNodeId: Dispatch<SetStateAction<string | null>>;
    saveCanvasProject: () => unknown;
    zoomToActualSize: () => void;
    fitCanvasContent: () => void;
    fitCanvasSelection: () => void;
    undoCanvas: () => void;
    redoCanvas: () => void;
    cancelSelectionBox: () => void;
    copySelectedNodes: () => void;
    pasteCopiedNodes: () => boolean;
    restoreCopiedNodesFromText: (value: string) => boolean;
    shouldPreferCopiedNodes: () => boolean;
    pasteSystemClipboard: (position?: undefined, clipboardEvent?: ClipboardEvent | null) => Promise<boolean> | boolean;
    deleteNodes: (ids: Set<string>) => void;
    deleteConnection: (connectionId: string) => void;
    deselectCanvas: () => void;
    zoomCanvasIn: () => void;
    zoomCanvasOut: () => void;
    focusMode: boolean;
    exitFocusMode: () => void;
    toggleFocusMode: () => void;
};

export function useCanvasKeyboard({
    nodesRef,
    selectedNodeIdsRef,
    selectedConnectionId,
    setSelectedNodeIds,
    setSelectedConnectionId,
    setContextMenu,
    setShortcutRequestNonce,
    setInfoNodeId,
    setCropNodeId,
    setMaskEditNodeId,
    setAnnotationNodeId,
    saveCanvasProject,
    zoomToActualSize,
    fitCanvasContent,
    fitCanvasSelection,
    undoCanvas,
    redoCanvas,
    cancelSelectionBox,
    copySelectedNodes,
    pasteCopiedNodes,
    restoreCopiedNodesFromText,
    shouldPreferCopiedNodes,
    pasteSystemClipboard,
    deleteNodes,
    deleteConnection,
    deselectCanvas,
    zoomCanvasIn,
    zoomCanvasOut,
    focusMode,
    exitFocusMode,
    toggleFocusMode,
}: UseCanvasKeyboardOptions) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;
            const isTextEditingTarget = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || Boolean(target?.closest("[contenteditable='true']"));

            if (isModifierShortcut && !event.altKey && (key === "+" || key === "=" || event.code === "NumpadAdd")) {
                event.preventDefault();
                if (!isTextEditingTarget) zoomCanvasIn();
                return;
            }
            if (isModifierShortcut && !event.altKey && (key === "-" || key === "_" || event.code === "NumpadSubtract")) {
                event.preventDefault();
                if (!isTextEditingTarget) zoomCanvasOut();
                return;
            }
            if (isModifierShortcut && !event.altKey && (key === "0" || event.code === "Numpad0")) {
                event.preventDefault();
                if (!isTextEditingTarget) zoomToActualSize();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "s") {
                event.preventDefault();
                event.stopPropagation();
                if (!event.repeat) void saveCanvasProject();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "f") {
                event.preventDefault();
                if (!event.repeat) toggleFocusMode();
                return;
            }
            if (isTextEditingTarget) return;
            const isCanvasControlTarget = Boolean(target?.closest("[data-canvas-no-zoom]"));
            if (isCanvasControlTarget && !(isModifierShortcut && !event.altKey && (key === "c" || key === "v"))) return;
            if (event.key === "?" && !isModifierShortcut && !event.altKey) {
                event.preventDefault();
                setShortcutRequestNonce((value) => value + 1);
                return;
            }
            if (isModifierShortcut && !event.altKey && (key === "1" || key === "2" || key === "3")) {
                event.preventDefault();
                if (key === "1") zoomToActualSize();
                else if (key === "2") fitCanvasContent();
                else fitCanvasSelection();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                cancelSelectionBox();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }
            if (isModifierShortcut && !event.altKey && key === "v") {
                // 有些浏览器/焦点状态不会继续派发 paste 事件；内部节点复制必须有 keydown 兜底。
                if (shouldPreferCopiedNodes()) {
                    event.preventDefault();
                    if (pasteCopiedNodes()) return;
                    void navigator.clipboard?.readText?.().then((text) => {
                        if (restoreCopiedNodesFromText(text)) pasteCopiedNodes();
                    }).catch(() => undefined);
                }
                return;
            }
            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) deleteNodes(new Set(selectedNodeIdsRef.current));
                else if (selectedConnectionId) deleteConnection(selectedConnectionId);
            }
            if (event.key === "Escape") {
                // 沉浸专注：无选中且无弹窗/下拉/右键菜单时，Esc 退出专注；否则保留原有取消选择行为。
                const hasFocusOverlay = Boolean(document.querySelector(".ant-modal-wrap, .ant-dropdown, .ant-select-dropdown, .ant-popover, [data-canvas-context-menu]"));
                if (focusMode && !selectedNodeIdsRef.current.size && !hasFocusOverlay) {
                    event.stopPropagation();
                    exitFocusMode();
                    return;
                }
                deselectCanvas();
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setAnnotationNodeId(null);
            }
        };

        const handlePaste = (event: ClipboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true']")) return;
            // 节点标记写入失败或仍在写入时避开旧系统图片，其余情况保持系统内容优先。
            event.preventDefault();
            const text = event.clipboardData?.getData("text/plain") || "";
            if (text && restoreCopiedNodesFromText(text) && pasteCopiedNodes()) return;
            if (shouldPreferCopiedNodes() && pasteCopiedNodes()) return;
            void (async () => {
                const handled = await pasteSystemClipboard(undefined, event);
                if (!handled) pasteCopiedNodes();
            })();
        };

        window.addEventListener("keydown", handleKeyDown, true);
        window.addEventListener("paste", handlePaste, true);
        return () => {
            window.removeEventListener("keydown", handleKeyDown, true);
            window.removeEventListener("paste", handlePaste, true);
        };
    }, [cancelSelectionBox, copySelectedNodes, deleteConnection, deleteNodes, deselectCanvas, exitFocusMode, fitCanvasContent, fitCanvasSelection, focusMode, nodesRef, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, restoreCopiedNodesFromText, saveCanvasProject, selectedConnectionId, selectedNodeIdsRef, setAnnotationNodeId, setContextMenu, setCropNodeId, setInfoNodeId, setMaskEditNodeId, setSelectedConnectionId, setSelectedNodeIds, setShortcutRequestNonce, shouldPreferCopiedNodes, toggleFocusMode, undoCanvas, zoomCanvasIn, zoomCanvasOut, zoomToActualSize]);
}
