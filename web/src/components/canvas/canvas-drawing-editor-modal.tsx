import { useEffect, useMemo, useRef, useState } from "react";
import { App, Modal } from "antd";
import { Check, Maximize2, X } from "lucide-react";
import { Tldraw, createTLStore, getSnapshot, loadSnapshot } from "tldraw";
import type { Editor } from "tldraw";
import "tldraw/tldraw.css";

import { useThemeStore } from "@/stores/use-theme-store";
import { loadCanvasDrawing, saveCanvasDrawing, type CanvasDrawingRenderDraft, type CanvasDrawingSnapshot } from "@/lib/canvas/canvas-drawing-storage";
import type { CanvasNodeData } from "@/types/canvas";

const SINGLE_PAGE_OPTIONS = { maxPages: 1 } as const;
const DRAWING_RENDER_MAX_DIMENSION = 2048;
const DRAWING_RENDER_PADDING = 24;

type CanvasDrawingEditorModalProps = {
    open: boolean;
    projectId: string;
    node: CanvasNodeData | null;
    onClose: () => void;
    onSaved: (nodeId: string, summary: Pick<CanvasDrawingSnapshot, "revision" | "updatedAt" | "shapeCount" | "pageCount">) => void;
};

export function CanvasDrawingEditorModal({ open, projectId, node, onClose, onSaved }: CanvasDrawingEditorModalProps) {
    const { message } = App.useApp();
    const colorScheme = useThemeStore((state) => state.theme);
    const store = useMemo(() => createTLStore(), [node?.id]);
    const currentRef = useRef<CanvasDrawingSnapshot | null>(null);
    const editorRef = useRef<Editor | null>(null);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!open || !node?.metadata?.drawingId) return;
        let cancelled = false;
        setReady(false);
        currentRef.current = null;
        void loadCanvasDrawing(projectId, node.metadata.drawingId).then((saved) => {
            if (cancelled) return;
            currentRef.current = saved;
            if (saved?.snapshot) loadSnapshot(store, saved.snapshot as never);
            setReady(true);
        }).catch(() => {
            if (!cancelled) setReady(true);
        });
        return () => { cancelled = true; };
    }, [open, projectId, node?.metadata?.drawingId, store]);

    const handleSave = async () => {
        if (!node?.metadata?.drawingId || !ready) return false;
        setSaving(true);
        try {
            const render = await createDrawingRender(editorRef.current);
            const saved = await saveCanvasDrawing(projectId, node.metadata.drawingId, getSnapshot(store), currentRef.current, render?.blob || null, render);
            currentRef.current = saved;
            onSaved(node.id, saved);
            return true;
        } catch (error) {
            message.error(error instanceof Error ? `绘图保存失败：${error.message}` : "绘图保存失败");
            return false;
        } finally {
            setSaving(false);
        }
    };

    const handleClose = async () => {
        if (ready && !(await handleSave())) return;
        onClose();
    };

    return (
        <Modal
            open={open}
            onCancel={() => void handleClose()}
            footer={null}
            closable={false}
            destroyOnHidden
            width="100vw"
            centered
            styles={{ body: { padding: 0 }, content: { padding: 0, overflow: "hidden" } }}
            className="canvas-drawing-editor-modal"
        >
            <div className="flex h-[min(92dvh,980px)] flex-col">
                <div className="flex h-12 shrink-0 items-center justify-between border-b px-4" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <Maximize2 className="size-4 opacity-55" />
                        <span className="truncate text-sm font-semibold">{node?.title || "绘图"}</span>
                        <span className="text-[11px] opacity-45">{ready ? "已加载" : "正在加载"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-black/5 disabled:opacity-45 dark:hover:bg-white/10" disabled={!ready || saving} onClick={() => void handleSave()}>
                            <Check className="size-3.5" />{saving ? "保存中" : "保存绘图"}
                        </button>
                        <button type="button" className="grid size-8 place-items-center rounded-md border transition hover:bg-black/5 dark:hover:bg-white/10" aria-label="关闭绘图编辑器" onClick={() => void handleClose()}><X className="size-4" /></button>
                    </div>
                </div>
                <div className="relative min-h-0 flex-1">
                    {ready ? (
                        <Tldraw
                            store={store}
                            locale="zh-cn"
                            colorScheme={colorScheme}
                            options={SINGLE_PAGE_OPTIONS}
                            licenseKey={import.meta.env.VITE_TLDRAW_LICENSE_KEY || undefined}
                            onMount={(editor) => {
                                editorRef.current = editor;
                                // 每个绘图节点只允许一个页面；旧快照若包含多页，也在进入编辑器时收敛为首页。
                                const [primaryPage, ...extraPages] = editor.getPages();
                                if (primaryPage) editor.setCurrentPage(primaryPage.id);
                                extraPages.forEach((page) => editor.deletePage(page.id));
                                editor.setCurrentTool("draw");
                                return () => {
                                    if (editorRef.current === editor) editorRef.current = null;
                                };
                            }}
                        />
                    ) : <div className="grid h-full place-items-center text-sm opacity-55">正在准备绘图画布...</div>}
                </div>
            </div>
        </Modal>
    );
}

async function createDrawingRender(editor: Editor | null): Promise<CanvasDrawingRenderDraft | null> {
    if (!editor) throw new Error("绘图编辑器尚未准备完成");
    const shapeIds = [...editor.getCurrentPageShapeIds()];
    if (!shapeIds.length) return null;
    const bounds = editor.getShapesPageBounds(shapeIds);
    if (!bounds) throw new Error("无法读取绘图内容边界");

    const sourceDimension = Math.max(bounds.width, bounds.height) + DRAWING_RENDER_PADDING * 2;
    const scale = Math.min(4, DRAWING_RENDER_MAX_DIMENSION / Math.max(1, sourceDimension));
    const image = await editor.toImage(shapeIds, {
        format: "png",
        background: true,
        padding: DRAWING_RENDER_PADDING,
        scale,
        pixelRatio: 1,
        darkMode: false,
    });
    return {
        blob: image.blob,
        pageId: editor.getCurrentPageId(),
        width: image.width,
        height: image.height,
        mimeType: image.blob.type || "image/png",
        background: "white",
    };
}
