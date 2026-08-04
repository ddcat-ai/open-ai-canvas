import { forwardRef, useImperativeHandle, useMemo, useRef } from "react";
import { Tldraw, createTLStore, getSnapshot, loadSnapshot } from "tldraw";
import type { Editor } from "tldraw";
import "tldraw/tldraw.css";

import type { CanvasDrawingEditorHandle, CanvasDrawingEditorProps } from "@/components/canvas/canvas-drawing-editor-types";
import { resolveTldrawLicenseKey } from "@/lib/canvas/canvas-drawing-engine";
import { useUserStore } from "@/stores/use-user-store";

const SINGLE_PAGE_OPTIONS = { maxPages: 1 } as const;
const DRAWING_RENDER_MAX_DIMENSION = 2048;
const DRAWING_RENDER_PADDING = 24;

export const CanvasDrawingTldrawEditor = forwardRef<CanvasDrawingEditorHandle, CanvasDrawingEditorProps>(function CanvasDrawingTldrawEditor({ snapshot, colorScheme, onReady }, ref) {
    const tldrawLicenseKey = useUserStore((state) => state.drawingEngine.tldrawLicenseKey);
    const store = useMemo(() => {
        const next = createTLStore();
        if (snapshot) loadSnapshot(next, snapshot as never);
        return next;
    }, [snapshot]);
    const editorRef = useRef<Editor | null>(null);

    useImperativeHandle(ref, () => ({
        createSave: async () => {
            const editor = editorRef.current;
            if (!editor) throw new Error("tldraw 编辑器尚未准备完成");
            const shapeIds = [...editor.getCurrentPageShapeIds()];
            if (!shapeIds.length) return { snapshot: getSnapshot(store), preview: null, render: null };
            const bounds = editor.getShapesPageBounds(shapeIds);
            if (!bounds) throw new Error("无法读取 tldraw 绘图边界");
            const sourceDimension = Math.max(bounds.width, bounds.height) + DRAWING_RENDER_PADDING * 2;
            const scale = Math.min(4, DRAWING_RENDER_MAX_DIMENSION / Math.max(1, sourceDimension));
            const image = await editor.toImage(shapeIds, { format: "png", background: true, padding: DRAWING_RENDER_PADDING, scale, pixelRatio: 1, darkMode: false });
            const render = {
                blob: image.blob,
                pageId: editor.getCurrentPageId(),
                width: image.width,
                height: image.height,
                mimeType: image.blob.type || "image/png",
                background: "white" as const,
            };
            return { snapshot: getSnapshot(store), preview: image.blob, render };
        },
    }), [store]);

    return (
        <Tldraw
            store={store}
            locale="zh-cn"
            colorScheme={colorScheme}
            options={SINGLE_PAGE_OPTIONS}
            licenseKey={resolveTldrawLicenseKey(tldrawLicenseKey)}
            onMount={(editor) => {
                editorRef.current = editor;
                // 绘图节点只保留单页，避免预览和生成引用出现页选择歧义。
                const [primaryPage, ...extraPages] = editor.getPages();
                if (primaryPage) editor.setCurrentPage(primaryPage.id);
                extraPages.forEach((page) => editor.deletePage(page.id));
                editor.setCurrentTool("draw");
                onReady();
                return () => {
                    if (editorRef.current === editor) editorRef.current = null;
                };
            }}
        />
    );
});