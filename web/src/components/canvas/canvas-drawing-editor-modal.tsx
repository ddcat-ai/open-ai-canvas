import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { App, Modal } from "antd";
import { Check, Maximize2, X } from "lucide-react";

import type { CanvasDrawingEditorHandle } from "@/components/canvas/canvas-drawing-editor-types";
import { drawingEngineForNode, drawingEngineLabel, isDrawingEngineAvailable } from "@/lib/canvas/canvas-drawing-engine";
import { loadCanvasDrawing, saveCanvasDrawing, type CanvasDrawingSnapshot } from "@/lib/canvas/canvas-drawing-storage";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasNodeData } from "@/types/canvas";
import { useTranslation } from "react-i18next";

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
    const { t } = useTranslation("canvas");
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
            void loadCanvasDrawing(projectId, node.metadata.drawingId)
            .then((saved) => {
                if (cancelled) return;
                if (saved && saved.engine !== engine) throw new Error(t("canvas:invalid-drawing-document-version-or-engine"));
                currentRef.current = saved;
                setSnapshot(saved?.snapshot || null);
                setLoaded(true);
            })
            .catch((error) => {
                if (cancelled) return;
                const detail = error instanceof Error ? error.message : t("domain:local-drawing-document-cannot-be-read");
                setLoadError(detail);
                message.error(t("domain:failed-to-load-drawing-param", { detail: detail }));
            });
        return () => {
            cancelled = true;
        };
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
            message.error(error instanceof Error ? t("domain:failed-to-save-drawing-param", { message: error.message }) : t("domain:failed-to-save-drawing"));
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
                    <div className="flex min-w-0 items-center gap-2">
                        <Maximize2 className="size-4 opacity-55" />
                        <span className="truncate text-sm font-semibold">{node?.title || t("canvas:drawing")}</span>
                        <span className="text-[var(--fs-label)] opacity-45">
                            {drawingEngineLabel(engine)} · {ready ? t("domain:loaded") : t("domain:loading")}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-xs font-medium transition hover:bg-black/5 disabled:opacity-45 dark:hover:bg-white/10"
                            disabled={!ready || saving || unavailable}
                            onClick={() => void handleSave()}
                        >
                            <Check className="size-3.5" />
                            {saving ? t("domain:saving") : t("domain:save-drawing")}
                        </button>
                        <button type="button" className="grid size-8 place-items-center rounded-md border transition hover:bg-black/5 dark:hover:bg-white/10" aria-label={t("domain:close-drawing-editor")} onClick={() => void handleClose()}>
                            <X className="size-4" />
                        </button>
                    </div>
                </div>
                <div className="relative min-h-0 flex-1">
                    {unavailable ? (
                        <EditorState title={t("domain:tldraw-not-licensed")} detail={t("domain:no-valid-tldraw-license-key-is-configured-in-this-production-build")} />
                    ) : loadError ? (
                        <EditorState title={t("domain:unable-to-open-drawing")} detail={loadError} />
                    ) : loaded ? (
                        <Suspense fallback={<EditorState title={t("domain:loading-drawing-tools")} />}>
                            {engine === "excalidraw" ? (
                                <CanvasDrawingExcalidrawEditor ref={editorRef} snapshot={snapshot} colorScheme={colorScheme} onReady={() => setReady(true)} />
                            ) : (
                                <CanvasDrawingTldrawEditor ref={editorRef} snapshot={snapshot} colorScheme={colorScheme} onReady={() => setReady(true)} />
                            )}
                        </Suspense>
                    ) : (
                        <EditorState title={t("domain:preparing-drawing-canvas")} />
                    )}
                </div>
            </div>
        </Modal>
    );
}

function EditorState({ title, detail }: { title: string; detail?: string }) {
    return (
        <div className="grid h-full place-items-center px-6 text-center">
            <div>
                <div className="text-sm font-medium">{title}</div>
                {detail ? <div className="mt-1 text-xs text-foreground/50">{detail}</div> : null}
            </div>
        </div>
    );
}
