import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { LoaderCircle, ScanFace, SquareDashedMousePointer, X } from "lucide-react";

import {
    CanvasNodeEmotionPanel,
    type CanvasEmotionCharacter,
    type CanvasImageEmotionPayload,
} from "@/components/canvas/canvas-node-emotion-panel";
import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    buildEmotionImageArtifacts,
    buildEmotionPrompt,
    neutralEmotionPreset,
    type CanvasEmotionPreset,
    type CanvasFaceBox,
} from "@/lib/canvas/canvas-emotion";
import { detectCanvasFaces } from "@/lib/canvas/canvas-face-detection";
import { subscribeCanvasViewportPreview } from "@/lib/canvas/canvas-live-viewport";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData, ViewportTransform } from "@/types/canvas";

type WorkspaceStatus = "detecting" | "selecting" | "manual" | "editing" | "generating" | "error";

type CanvasEmotionWorkspaceProps = {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    onClose: () => void;
    onConfirm: (payload: CanvasImageEmotionPayload) => void;
};

export function CanvasEmotionWorkspace({ node, viewport, containerRef, onClose, onConfirm }: CanvasEmotionWorkspaceProps) {
    const dataUrl = node.metadata?.content || "";
    const [status, setStatus] = useState<WorkspaceStatus>("detecting");
    const [faces, setFaces] = useState<CanvasFaceBox[]>([]);
    const [characters, setCharacters] = useState<CanvasEmotionCharacter[]>([]);
    const [activeCharacterId, setActiveCharacterId] = useState("");
    const [preset, setPreset] = useState<CanvasEmotionPreset>(neutralEmotionPreset);
    const [imageSize, setImageSize] = useState({ width: node.metadata?.naturalWidth || 0, height: node.metadata?.naturalHeight || 0 });
    const [error, setError] = useState("");
    const [manualDraft, setManualDraft] = useState<CanvasFaceBox | null>(null);
    const portalTarget = containerRef.current;

    useEffect(() => {
        const controller = new AbortController();
        setStatus("detecting");
        setError("");
        setFaces([]);
        setCharacters([]);
        setActiveCharacterId("");
        setPreset(neutralEmotionPreset);
        void detectCanvasFaces(dataUrl, controller.signal)
            .then((result) => {
                setImageSize({ width: result.imageWidth, height: result.imageHeight });
                setFaces(result.faces);
                if (result.faces.length) {
                    setStatus("selecting");
                    return;
                }
                setStatus("error");
                setError("未识别到清晰人脸，请手动框选");
            })
            .catch((reason) => {
                if (reason instanceof DOMException && reason.name === "AbortError") return;
                setStatus("error");
                setError(reason instanceof Error ? `${reason.message}，请手动框选` : "人脸识别失败，请手动框选");
            });
        return () => controller.abort();
    }, [dataUrl]);

    const selectFace = (face: CanvasFaceBox) => {
        const existing = characters.find((character) => sameFace(character.faceBox, face));
        if (existing) {
            setActiveCharacterId(existing.id);
            setStatus("editing");
            return;
        }
        const index = characters.length + 1;
        const character = { id: `character-${face.id}`, name: node.metadata?.characterName && !characters.length ? node.metadata.characterName : `角色${index}`, faceBox: face };
        setCharacters((current) => [...current, character]);
        setActiveCharacterId(character.id);
        setStatus("editing");
        setError("");
    };

    const beginManualSelection = () => {
        setStatus("manual");
        setManualDraft(null);
        setError("");
    };

    const confirmGeneration = async () => {
        const character = characters.find((item) => item.id === activeCharacterId);
        if (!character || !imageSize.width || !imageSize.height) return;
        setStatus("generating");
        setError("");
        try {
            const artifacts = await buildEmotionImageArtifacts(dataUrl, character.faceBox, imageSize.width, imageSize.height);
            const params = { presetId: preset.id, intimacy: preset.intimacy, arousal: preset.arousal, characterName: character.name, faceBox: character.faceBox };
            onConfirm({
                ...params,
                label: preset.label,
                prompt: buildEmotionPrompt(params, artifacts.editRegion),
                sourceDataUrl: artifacts.sourceDataUrl,
                maskDataUrl: artifacts.maskDataUrl,
                characterDataUrl: artifacts.characterDataUrl,
                editRegion: artifacts.editRegion,
                imageWidth: artifacts.imageWidth,
                imageHeight: artifacts.imageHeight,
            });
        } catch (reason) {
            setStatus("editing");
            setError(reason instanceof Error ? reason.message : "生成前处理失败");
        }
    };

    if (!portalTarget || !dataUrl) return null;
    const activeCharacter = characters.find((character) => character.id === activeCharacterId);
    return createPortal(
        <>
            <FaceSelectionOverlay
                node={node}
                viewport={viewport}
                containerRef={containerRef}
                imageWidth={imageSize.width}
                imageHeight={imageSize.height}
                faces={faces}
                characters={characters}
                activeCharacterId={activeCharacterId}
                status={status}
                manualDraft={manualDraft}
                onManualDraftChange={setManualDraft}
                onManualComplete={(face) => {
                    setFaces((current) => [...current, face]);
                    selectFace(face);
                    setManualDraft(null);
                }}
                onFaceSelect={selectFace}
            />
            <SelectionToolbar
                node={node}
                viewport={viewport}
                containerRef={containerRef}
                status={status}
                faceCount={faces.length}
                error={error}
                onManualSelect={beginManualSelection}
                onClose={onClose}
            />
            <AnimatePresence>
                {activeCharacter && (status === "editing" || status === "generating") ? (
                    <EmotionPanelOverlay node={node} viewport={viewport} containerRef={containerRef}>
                        <CanvasNodeEmotionPanel
                            dataUrl={dataUrl}
                            imageWidth={imageSize.width}
                            imageHeight={imageSize.height}
                            characters={characters}
                            activeCharacterId={activeCharacterId}
                            preset={preset}
                            generating={status === "generating"}
                            error={error}
                            onSelectCharacter={(id) => { setActiveCharacterId(id); setError(""); }}
                            onManualSelect={beginManualSelection}
                            onPresetChange={setPreset}
                            onClose={onClose}
                            onConfirm={() => void confirmGeneration()}
                        />
                    </EmotionPanelOverlay>
                ) : null}
            </AnimatePresence>
        </>,
        portalTarget,
    );
}

function FaceSelectionOverlay({ node, viewport, containerRef, imageWidth, imageHeight, faces, characters, activeCharacterId, status, manualDraft, onManualDraftChange, onManualComplete, onFaceSelect }: {
    node: CanvasNodeData;
    viewport: ViewportTransform;
    containerRef: RefObject<HTMLDivElement | null>;
    imageWidth: number;
    imageHeight: number;
    faces: CanvasFaceBox[];
    characters: CanvasEmotionCharacter[];
    activeCharacterId: string;
    status: WorkspaceStatus;
    manualDraft: CanvasFaceBox | null;
    onManualDraftChange: (box: CanvasFaceBox | null) => void;
    onManualComplete: (box: CanvasFaceBox) => void;
    onFaceSelect: (box: CanvasFaceBox) => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const overlayRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    useScreenAnchor(overlayRef, node, viewport, containerRef, (next) => imageScreenRect(node, next, imageWidth, imageHeight));
    if (!imageWidth || !imageHeight) return null;
    const interactive = status !== "detecting" && status !== "generating";
    const faceIsSelected = (face: CanvasFaceBox) => characters.find((character) => sameFace(character.faceBox, face));
    const pointerPosition = (event: ReactPointerEvent<HTMLDivElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return { x: ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * imageWidth, y: ((event.clientY - bounds.top) / Math.max(1, bounds.height)) * imageHeight };
    };
    return (
        <div
            ref={overlayRef}
            data-canvas-no-zoom
            className={`absolute z-[var(--z-modal)] overflow-hidden rounded-[var(--r-2xl)] ${status === "manual" ? "cursor-crosshair touch-none" : "pointer-events-none"}`}
            style={{ left: 0, top: 0, width: node.width * viewport.k, height: node.height * viewport.k }}
            onPointerDown={status === "manual" ? (event) => {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.setPointerCapture(event.pointerId);
                const start = pointerPosition(event);
                dragStartRef.current = start;
                onManualDraftChange({ id: `manual-${Date.now()}`, x: start.x, y: start.y, width: 0, height: 0, source: "manual" });
            } : undefined}
            onPointerMove={status === "manual" ? (event) => {
                const start = dragStartRef.current;
                if (!start) return;
                const current = pointerPosition(event);
                onManualDraftChange({ id: manualDraft?.id || `manual-${Date.now()}`, x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y), source: "manual" });
            } : undefined}
            onPointerUp={status === "manual" ? (event) => {
                const start = dragStartRef.current;
                dragStartRef.current = null;
                if (!start) return;
                const current = pointerPosition(event);
                const box = { id: manualDraft?.id || `manual-${Date.now()}`, x: Math.min(start.x, current.x), y: Math.min(start.y, current.y), width: Math.abs(current.x - start.x), height: Math.abs(current.y - start.y), source: "manual" as const };
                if (box.width >= Math.max(18, imageWidth * 0.025) && box.height >= Math.max(18, imageHeight * 0.025)) onManualComplete(box);
                else onManualDraftChange(null);
            } : undefined}
            onPointerCancel={status === "manual" ? () => {
                dragStartRef.current = null;
                onManualDraftChange(null);
            } : undefined}
        >
            <svg aria-hidden className="pointer-events-none absolute inset-0 size-full" viewBox={`0 0 ${imageWidth} ${imageHeight}`} preserveAspectRatio="none">
                <defs>
                    <mask id={`emotion-face-mask-${node.id}`}>
                        <rect width={imageWidth} height={imageHeight} fill="white" />
                        {faces.map((face) => <rect key={face.id} x={face.x} y={face.y} width={face.width} height={face.height} rx={Math.min(face.width, face.height) * 0.16} fill="black" />)}
                        {manualDraft ? <rect x={manualDraft.x} y={manualDraft.y} width={manualDraft.width} height={manualDraft.height} rx={Math.min(manualDraft.width, manualDraft.height) * 0.12} fill="black" /> : null}
                    </mask>
                </defs>
                <rect width={imageWidth} height={imageHeight} fill="rgba(0,0,0,.38)" mask={`url(#emotion-face-mask-${node.id})`} />
            </svg>
            {faces.map((face) => {
                const selected = faceIsSelected(face);
                const active = selected?.id === activeCharacterId;
                return (
                    <motion.button
                        key={face.id}
                        type="button"
                        aria-label={selected ? `选择${selected.name}` : "选择此人脸"}
                        className={`absolute rounded-[7px] border-2 ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
                        style={{ left: `${(face.x / imageWidth) * 100}%`, top: `${(face.y / imageHeight) * 100}%`, width: `${(face.width / imageWidth) * 100}%`, height: `${(face.height / imageHeight) * 100}%`, borderColor: active ? theme.accent.primary : "rgba(255,255,255,.94)", boxShadow: active ? `0 0 0 3px ${theme.accent.primarySoft}, 0 8px 24px rgba(0,0,0,.24)` : "0 8px 20px rgba(0,0,0,.18)" }}
                        whileHover={{ scale: 1.025 }}
                        whileTap={{ scale: 0.985 }}
                        transition={aceternityMotion.spring.dock}
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => { event.stopPropagation(); onFaceSelect(face); }}
                    >
                        {selected ? <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[var(--fs-micro)] font-semibold text-white" style={{ background: active ? theme.accent.primary : "rgba(20,20,22,.82)" }}>{selected.name}</span> : null}
                    </motion.button>
                );
            })}
            {manualDraft ? <div className="pointer-events-none absolute rounded-[7px] border-2 border-dashed border-white" style={{ left: `${(manualDraft.x / imageWidth) * 100}%`, top: `${(manualDraft.y / imageHeight) * 100}%`, width: `${(manualDraft.width / imageWidth) * 100}%`, height: `${(manualDraft.height / imageHeight) * 100}%`, boxShadow: "0 0 0 3px rgba(255,255,255,.16)" }} /> : null}
        </div>
    );
}

function SelectionToolbar({ node, viewport, containerRef, status, faceCount, error, onManualSelect, onClose }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; status: WorkspaceStatus; faceCount: number; error: string; onManualSelect: () => void; onClose: () => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const toolbarRef = useRef<HTMLDivElement>(null);
    useScreenAnchor(toolbarRef, node, viewport, containerRef, (next, container) => toolbarScreenRect(node, next, container, toolbarRef.current));
    if (status === "editing" || status === "generating") return null;
    const label = status === "detecting" ? "正在识别人脸" : status === "manual" ? "拖动鼠标框选需要调节的人脸" : status === "selecting" ? `识别到 ${faceCount} 张人脸，请选择人物` : error || "请选择人物";
    return (
        <SpotlightSurface
            ref={toolbarRef}
            data-canvas-no-zoom
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -5, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel}
            className="aceternity-floating-panel absolute z-[var(--z-modal-overlay)] flex h-12 w-[420px] max-w-[calc(100%_-_24px)] items-center rounded-[15px] border px-2 backdrop-blur-2xl"
            style={{ left: 12, top: 76, background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 22px 60px ${theme.spatial.shadow}` }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            <div className="flex size-full items-center">
                <button type="button" aria-label="关闭情绪调节" className="grid size-8 shrink-0 place-items-center rounded-full hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}><X className="size-4" /></button>
                <span className="mx-2 h-5 w-px" style={{ background: theme.toolbar.border }} />
                <span className="grid size-8 shrink-0 place-items-center rounded-full" style={{ background: theme.toolbar.itemHover }}>{status === "detecting" ? <LoaderCircle className="size-4 animate-spin" /> : <ScanFace className="size-4" />}</span>
                <span className="min-w-0 flex-1 truncate px-2 text-[var(--fs-label)] font-medium leading-none">{label}</span>
                {status !== "detecting" ? <button type="button" className="flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--dock-item-radius)] px-2 text-[var(--fs-label)] font-medium leading-none transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onManualSelect}><SquareDashedMousePointer className="size-3.5" />手动框选</button> : null}
            </div>
        </SpotlightSurface>
    );
}

function EmotionPanelOverlay({ node, viewport, containerRef, children }: { node: CanvasNodeData; viewport: ViewportTransform; containerRef: RefObject<HTMLDivElement | null>; children: ReactNode }) {
    const panelRef = useRef<HTMLDivElement>(null);
    useScreenAnchor(panelRef, node, viewport, containerRef, (next, container) => panelScreenRect(node, next, container, panelRef.current));
    return <div ref={panelRef} data-canvas-no-zoom className="absolute z-[var(--z-modal-overlay)] w-[580px] max-w-[calc(100%_-_24px)]" style={{ left: 12, top: 76 }} onPointerDown={(event) => event.stopPropagation()}>{children}</div>;
}

function useScreenAnchor(ref: RefObject<HTMLElement | null>, node: CanvasNodeData, viewport: ViewportTransform, containerRef: RefObject<HTMLDivElement | null>, resolve: (viewport: ViewportTransform, container: HTMLDivElement) => { left: number; top: number; width?: number; height?: number }) {
    const resolveRef = useRef(resolve);
    resolveRef.current = resolve;
    useLayoutEffect(() => {
        const element = ref.current;
        const container = containerRef.current;
        if (!element || !container) return;
        const update = (next: ViewportTransform) => {
            const rect = resolveRef.current(next, container);
            element.style.left = `${rect.left}px`;
            element.style.top = `${rect.top}px`;
            if (typeof rect.width === "number") element.style.width = `${rect.width}px`;
            if (typeof rect.height === "number") element.style.height = `${rect.height}px`;
        };
        update(viewport);
        const observer = new ResizeObserver(() => update(viewport));
        observer.observe(container);
        observer.observe(element);
        const unsubscribe = subscribeCanvasViewportPreview(container, update);
        return () => { observer.disconnect(); unsubscribe(); };
    }, [containerRef, node.height, node.id, node.metadata?.freeResize, node.position.x, node.position.y, node.width, ref, viewport]);
}

function imageScreenRect(node: CanvasNodeData, viewport: ViewportTransform, imageWidth: number, imageHeight: number) {
    const nodeWidth = node.width * viewport.k;
    const nodeHeight = node.height * viewport.k;
    const nodeLeft = viewport.x + node.position.x * viewport.k;
    const nodeTop = viewport.y + node.position.y * viewport.k;
    if (node.metadata?.freeResize || !imageWidth || !imageHeight) return { left: nodeLeft, top: nodeTop, width: nodeWidth, height: nodeHeight };
    const scale = Math.min(nodeWidth / imageWidth, nodeHeight / imageHeight);
    const width = imageWidth * scale;
    const height = imageHeight * scale;
    return { left: nodeLeft + (nodeWidth - width) / 2, top: nodeTop + (nodeHeight - height) / 2, width, height };
}

function toolbarScreenRect(node: CanvasNodeData, viewport: ViewportTransform, container: HTMLDivElement, element: HTMLElement | null) {
    const width = Math.min(element?.offsetWidth || 420, Math.max(360, container.clientWidth - 24));
    const height = element?.offsetHeight || 48;
    const nodeRect = imageScreenRect(node, viewport, node.metadata?.naturalWidth || node.width, node.metadata?.naturalHeight || node.height);
    const viewportLeft = container.scrollLeft;
    const viewportTop = container.scrollTop;
    const left = clamp(nodeRect.left + nodeRect.width / 2 - width / 2, viewportLeft + 12, Math.max(viewportLeft + 12, viewportLeft + container.clientWidth - width - 12));
    const above = nodeRect.top - height - 10;
    const top = above >= viewportTop + 72
        ? above
        : clamp(nodeRect.top + nodeRect.height + 10, viewportTop + 72, Math.max(viewportTop + 72, viewportTop + container.clientHeight - height - 12));
    return { left, top };
}

function panelScreenRect(node: CanvasNodeData, viewport: ViewportTransform, container: HTMLDivElement, element: HTMLElement | null) {
    const width = Math.min(element?.offsetWidth || 580, Math.max(320, container.clientWidth - 24));
    const height = element?.offsetHeight || 303;
    const nodeRect = imageScreenRect(node, viewport, node.metadata?.naturalWidth || node.width, node.metadata?.naturalHeight || node.height);
    const viewportLeft = container.scrollLeft;
    const viewportTop = container.scrollTop;
    const left = clamp(nodeRect.left + nodeRect.width / 2 - width / 2, viewportLeft + 12, Math.max(viewportLeft + 12, viewportLeft + container.clientWidth - width - 12));
    const below = nodeRect.top + nodeRect.height + 10;
    const above = nodeRect.top - height - 10;
    const top = below + height <= viewportTop + container.clientHeight - 12 ? below : above;
    return { left, top: clamp(top, viewportTop + 72, Math.max(viewportTop + 72, viewportTop + container.clientHeight - height - 12)) };
}

function sameFace(left: CanvasFaceBox, right: CanvasFaceBox) {
    return left.id === right.id || (Math.abs(left.x - right.x) < 1 && Math.abs(left.y - right.y) < 1 && Math.abs(left.width - right.width) < 1 && Math.abs(left.height - right.height) < 1);
}

function clamp(value: number, min: number, max: number) {
    return Math.min(Math.max(value, min), max);
}
