import { forwardRef, useImperativeHandle, useRef } from "react";
import { Excalidraw, exportToBlob, getNonDeletedElements, serializeAsJSON } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI, ExcalidrawInitialDataState } from "@excalidraw/excalidraw/types";
import "@excalidraw/excalidraw/index.css";

import type { CanvasDrawingEditorHandle, CanvasDrawingEditorProps } from "@/components/canvas/canvas-drawing-editor-types";

const DRAWING_RENDER_MAX_DIMENSION = 2048;
const DRAWING_RENDER_PADDING = 24;

export const CanvasDrawingExcalidrawEditor = forwardRef<CanvasDrawingEditorHandle, CanvasDrawingEditorProps>(function CanvasDrawingExcalidrawEditor({ snapshot, colorScheme, onReady }, ref) {
    const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);

    useImperativeHandle(ref, () => ({
        createSave: async () => {
            const api = apiRef.current;
            if (!api) throw new Error("Excalidraw 编辑器尚未准备完成");
            const elements = api.getSceneElementsIncludingDeleted();
            const appState = api.getAppState();
            const files = api.getFiles();
            const serialized = serializeAsJSON(elements, appState, files, "local");
            const savedSnapshot = JSON.parse(serialized) as unknown;
            const visibleElements = getNonDeletedElements(elements);
            if (!visibleElements.length) return { snapshot: savedSnapshot, preview: null, render: null };

            let outputWidth = 1;
            let outputHeight = 1;
            const blob = await exportToBlob({
                elements: visibleElements,
                appState: { ...appState, exportBackground: true, exportWithDarkMode: false, viewBackgroundColor: "#ffffff" },
                files,
                mimeType: "image/png",
                exportPadding: DRAWING_RENDER_PADDING,
                getDimensions: (width: number, height: number) => {
                    const scale = Math.min(4, DRAWING_RENDER_MAX_DIMENSION / Math.max(1, width, height));
                    outputWidth = Math.max(1, Math.round(width * scale));
                    outputHeight = Math.max(1, Math.round(height * scale));
                    return { width: outputWidth, height: outputHeight, scale };
                },
            });
            const render = { blob, pageId: "excalidraw-page", width: outputWidth, height: outputHeight, mimeType: blob.type || "image/png", background: "white" as const };
            return { snapshot: savedSnapshot, preview: blob, render };
        },
    }), []);

    const initialData = snapshot && typeof snapshot === "object"
        ? { ...(snapshot as ExcalidrawInitialDataState), scrollToContent: true }
        : { elements: [], appState: { viewBackgroundColor: "#ffffff" }, files: {}, scrollToContent: true };

    return (
        <Excalidraw
            initialData={initialData}
            langCode="zh-CN"
            theme={colorScheme}
            autoFocus
            excalidrawAPI={(api) => {
                apiRef.current = api;
                api.setActiveTool({ type: "freedraw" });
                onReady();
            }}
            UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false } }}
        />
    );
});
