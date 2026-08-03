import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { Check, Maximize2, X } from "lucide-react";

import type { CanvasDrawingEditorHandle } from "@/components/canvas/canvas-drawing-editor-types";
import { drawingEngineForNode, drawingEngineLabel, isDrawingEngineAvailable } from "@/lib/canvas/canvas-drawing-engine";
import { loadCanvasDrawing, saveCanvasDrawing, type CanvasDrawingSnapshot } from "@/lib/canvas/canvas-drawing-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";

const CanvasDrawingTldrawEditor = lazy(() => import("@/components/canvas/canvas-drawing-tldraw-editor").then((module) => ({ default: module.CanvasDrawingTldrawEditor })));
const CanvasDrawingExcalidrawEditor = lazy(() => import("@/components/canvas/canvas-drawing-excalidraw-editor").then((module) => ({ default: module.CanvasDrawingExcalidrawEditor })));

type CanvasDrawingEditorModalProps = {
    open: boolean;
    projectId: string;
    node: CanvasNodeData | null;
    onClose: () => void;
    onSaved: (nodeId: string, summary: Pick<CanvasDrawingSnapshot, "engine" | "revision" | "updatedAt" | "shapeCount" | "pageCount">) => void;
};

export function CanvasDrawingEditorModal({ open, projectId, node, onClose, onSaved }: CanvasDrawingEditorModalProps) {
    const { message } = App.useApp();
    const colorScheme = useThemeStore((state) => state.theme);
    const tldrawLicenseKey = useUserStore((state) => state.drawingEngine.tldrawLicenseKey);
    const engine = drawingEngineForNode(node);
    const currentRef = useRef<CanvasDrawingSnapshot | null>(null);
    const editorRef = useRef<CanvasDrawingEditorHandle | null>(null);
    const [snapshot, setSnapshot] = useState<unknown>(null);
    const [loaded, setLoaded] = useState(false);
    const [ready, setReady] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState("");

    useEffect(() => {
        if (!open || !node?.metadata?.drawingId) return;
        let cancelled = false;
        setLoaded(false);
        setReady(false);
        setLoadError("");
        setSnapshot(null);
        currentRef.current = null;
        void loadCanvasDrawing(projectId, node.metadata.drawingId).then((saved) => {
            if (cancelled) return;
            if (saved && saved.engine !== engine) throw new Error(`绘图节点标记为 ${drawingEngineLabel(engine)}，但文档属于 ${drawingEngineLabel(saved.engine)}`);
            currentRef.current = saved;
            setSnapshot(saved?.snapshot || null);
            setLoaded(true);
        }).catch((error) => {
            if (cancelled) return;
            const detail = error instanceof Error ? error.message : "本地绘图文档无法读取";
            setLoadError(detail);
            message.error(`绘图加载失败：${detail}`);
        });
        return () => { cancelled = true; };
    }, [engine, message, node?.metadata?.drawingId, open, projectId]);

    const handleSave = async () => {
        if (!node?.metadata?.drawingId || !ready || !editorRef.current) return false;
        setSaving(true);
        try {
            const draft = await editorRef.current.createSave();
            const saved = await saveCanvasDrawing(projectId, node.metadata.drawingId, engine, draft.snapshot, currentRef.current, draft.preview, draft.render);
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
        if (!loadError && ready && !(await handleSave())) return;
        onClose();
    };

    const unavailable = !isDrawingEngineAvailable(engine, tldrawLicenseKey);
    return (
        <Modal open={open} onCancel={() => void handleClose()} footer={null} closable={false} destroyOnHidden width="100vw" centered styles={{ body: { padding: 0 }, container: { padding: 0, overflow: "hidden" } }} className="canvas-drawing-editor-modal">
            <div className="flex h-[min(92dvh,980px)] flex-col">
                <div className="flex h-12 shrink-0 items-center justify-between border-b px-4" style={{ background: "var(--background)", borderColor: "var(--border)" }}>
                    <div className="flex min-w-0 items-center gap-2"><Maximize2 className="size-4 opacity-55" /><span className="truncate text-sm font-semibold">{node?.title || "绘图"}</span><span className="text-[var(--fs-label)] opacity-45">{drawingEngineLabel(engine)} · {ready ? "已加载" : "正在加载"}</span></div>
                    <div className="flex items-center gap-2">
                        <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-black/5 disabled:opacity-45 dark:hover:bg-white/10" disabled={!ready || saving || unavailable} onClick={() => void handleSave()}><Check className="size-3.5" />{saving ? "保存中" : "保存绘图"}</button>
                        <button type="button" className="grid size-8 place-items-center rounded-md border transition hover:bg-black/5 dark:hover:bg-white/10" aria-label="关闭绘图编辑器" onClick={() => void handleClose()}><X className="size-4" /></button>
                    </div>
                </div>
                <div className="relative min-h-0 flex-1">
                    {unavailable ? <EditorState title="tldraw 未授权" detail="当前生产构建没有配置有效的 tldraw License Key。" /> : loadError ? <EditorState title="绘图无法打开" detail={loadError} /> : loaded ? (
                        <Suspense fallback={<EditorState title="正在载入绘图工具" />}>
                            {engine === "excalidraw"
                                ? <CanvasDrawingExcalidrawEditor ref={editorRef} snapshot={snapshot} colorScheme={colorScheme} onReady={() => setReady(true)} />
                                : <CanvasDrawingTldrawEditor ref={editorRef} snapshot={snapshot} colorScheme={colorScheme} onReady={() => setReady(true)} />}
                        </Suspense>
                    ) : <EditorState title="正在准备绘图画布" />}
                </div>
            </div>
        </Modal>
    );
}

function EditorState({ title, detail }: { title: string; detail?: string }) {
    return <div className="grid h-full place-items-center px-6 text-center"><div><div className="text-sm font-medium">{title}</div>{detail ? <div className="mt-1 text-xs text-foreground/50">{detail}</div> : null}</div></div>;
}
