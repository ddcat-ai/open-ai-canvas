import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Suspense, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { ScanFace, Sparkles, X } from "lucide-react";
import { Box3, Color, Mesh, MeshStandardMaterial, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { KTX2Loader } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

import { SpotlightSurface } from "@/components/ui/aceternity/spotlight-surface";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    canvasEmotionPresets,
    emotionBlendshapes,
    type CanvasEmotionParams,
    type CanvasEmotionPreset,
    type CanvasEmotionEditRegion,
    type CanvasFaceBox,
} from "@/lib/canvas/canvas-emotion";
import { useThemeStore } from "@/stores/use-theme-store";

export type CanvasImageEmotionPayload = CanvasEmotionParams & {
    label: string;
    prompt: string;
    sourceDataUrl: string;
    maskDataUrl: string;
    characterDataUrl: string;
    editRegion: CanvasEmotionEditRegion;
    imageWidth: number;
    imageHeight: number;
};

export type CanvasEmotionCharacter = {
    id: string;
    name: string;
    faceBox: CanvasFaceBox;
};

type CanvasNodeEmotionPanelProps = {
    dataUrl: string;
    imageWidth: number;
    imageHeight: number;
    characters: CanvasEmotionCharacter[];
    activeCharacterId: string;
    preset: CanvasEmotionPreset;
    generating: boolean;
    error?: string;
    onSelectCharacter: (characterId: string) => void;
    onManualSelect: () => void;
    onPresetChange: (preset: CanvasEmotionPreset) => void;
    onClose: () => void;
    onConfirm: () => void;
};

export function CanvasNodeEmotionPanel({ dataUrl, imageWidth, imageHeight, characters, activeCharacterId, preset, generating, error, onSelectCharacter, onManualSelect, onPresetChange, onClose, onConfirm }: CanvasNodeEmotionPanelProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    return (
        <SpotlightSurface
            data-canvas-no-zoom
            spotlightColor={theme.toolbar.itemHover}
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 5, scale: 0.98 }}
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.panel}
            className="aceternity-floating-panel w-[580px] max-w-full overflow-hidden rounded-[16px] border backdrop-blur-2xl"
            style={{ background: theme.spatial.elevated, borderColor: theme.toolbar.border, color: theme.node.text, boxShadow: `0 28px 80px ${theme.spatial.shadow}` }}
        >
            <div className="flex h-11 items-center gap-1.5 border-b px-2.5" style={{ borderColor: theme.toolbar.border }}>
                <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                    {characters.map((character) => (
                        <motion.button
                            key={character.id}
                            type="button"
                            layout
                            whileTap={reducedMotion ? undefined : { scale: 0.96 }}
                            className="relative flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border px-1.5 pr-2 text-[11px] font-medium outline-none"
                            style={{ background: activeCharacterId === character.id ? theme.toolbar.activeBg : theme.spatial.surface, borderColor: activeCharacterId === character.id ? theme.spatial.glowStrong : theme.toolbar.border }}
                            onClick={() => onSelectCharacter(character.id)}
                        >
                            {activeCharacterId === character.id ? <motion.span layoutId="emotion-active-character" className="absolute inset-0 -z-10 rounded-[8px]" style={{ boxShadow: `inset 0 0 0 1px ${theme.accent.primarySoft}` }} transition={aceternityMotion.spring.dock} /> : null}
                            <FaceThumbnail dataUrl={dataUrl} imageWidth={imageWidth} imageHeight={imageHeight} box={character.faceBox} />
                            <span>{character.name}</span>
                        </motion.button>
                    ))}
                    <button type="button" className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] border px-2 text-[11px] font-medium opacity-70 transition hover:opacity-100" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border }} onClick={onManualSelect}>
                        <ScanFace className="size-3.5" />手动框选
                    </button>
                </div>
                <button type="button" aria-label="关闭情绪调节" className="grid size-7 shrink-0 place-items-center rounded-full transition hover:bg-black/5 dark:hover:bg-white/10" onClick={onClose}><X className="size-3.5" /></button>
            </div>

            <div className="grid h-[216px] grid-cols-[minmax(0,1fr)_212px] gap-2.5 p-2.5">
                <EmotionHeadPreview preset={preset} />
                <EmotionPad preset={preset} onChange={onPresetChange} />
            </div>

            <div className="flex min-h-11 items-center gap-2 border-t px-3" style={{ borderColor: theme.toolbar.border }}>
                <span className="text-[10px]" style={{ color: theme.node.muted }}>情绪定位</span>
                <AnimatePresence mode="wait" initial={false}>
                    <motion.span key={preset.id} initial={reducedMotion ? false : { opacity: 0, y: 4, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} exit={reducedMotion ? undefined : { opacity: 0, y: -3, filter: "blur(3px)" }} transition={{ duration: reducedMotion ? 0 : 0.18 }} className="text-xs font-semibold">{preset.label}</motion.span>
                </AnimatePresence>
                {error ? <span className="min-w-0 flex-1 truncate text-right text-[10px]" style={{ color: theme.accent.danger }} title={error}>{error}</span> : <span className="flex-1" />}
                <motion.button
                    type="button"
                    disabled={generating}
                    whileHover={reducedMotion || generating ? undefined : { y: -1 }}
                    whileTap={reducedMotion || generating ? undefined : { scale: 0.97 }}
                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[11px] font-semibold disabled:cursor-wait disabled:opacity-55"
                    style={{ background: theme.node.activeStroke, color: theme.node.panel }}
                    onClick={onConfirm}
                >
                    <Sparkles className={`size-3.5 ${generating ? "animate-pulse" : ""}`} />{generating ? "准备生成" : "生成"}
                </motion.button>
            </div>
        </SpotlightSurface>
    );
}

function FaceThumbnail({ dataUrl, imageWidth, imageHeight, box }: { dataUrl: string; imageWidth: number; imageHeight: number; box: CanvasFaceBox }) {
    const scaleX = imageWidth / Math.max(1, box.width);
    const scaleY = imageHeight / Math.max(1, box.height);
    return (
        <span className="relative block size-6 shrink-0 overflow-hidden rounded-[6px] bg-black/20">
            <img src={dataUrl} alt="" draggable={false} className="pointer-events-none absolute max-w-none" style={{ width: `${scaleX * 100}%`, height: `${scaleY * 100}%`, left: `${-(box.x / Math.max(1, box.width)) * 100}%`, top: `${-(box.y / Math.max(1, box.height)) * 100}%` }} />
        </span>
    );
}

function EmotionPad({ preset, onChange }: { preset: CanvasEmotionPreset; onChange: (preset: CanvasEmotionPreset) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const reducedMotion = useReducedMotion();
    const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
    const [dragging, setDragging] = useState(false);
    const update = (event: ReactPointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(4, ((event.clientX - rect.left) / Math.max(1, rect.width)) * 5 - 0.5));
        const y = Math.max(0, Math.min(4, ((event.clientY - rect.top) / Math.max(1, rect.height)) * 5 - 0.5));
        setPointer({ x, y });
        const next = canvasEmotionPresets[Math.round(y) * 5 + Math.round(x)];
        if (next && next.id !== preset.id) onChange(next);
    };
    const selectedColumn = 2 - preset.intimacy;
    const selectedRow = 2 - preset.arousal;
    return (
        <div className="relative rounded-[12px] border px-[25px] pb-[22px] pt-[24px]" style={{ background: theme.toolbar.itemHover, borderColor: theme.toolbar.border }}>
            <span className="pointer-events-none absolute inset-x-0 top-1.5 text-center text-[9px]" style={{ color: theme.node.muted }}>激动</span>
            <span className="pointer-events-none absolute inset-x-0 bottom-1.5 text-center text-[9px]" style={{ color: theme.node.muted }}>平静</span>
            <span className="pointer-events-none absolute left-1 top-1/2 -translate-y-1/2 text-[9px] [writing-mode:vertical-rl]" style={{ color: theme.node.muted }}>亲近</span>
            <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] [writing-mode:vertical-rl]" style={{ color: theme.node.muted }}>疏离</span>
            <div
                role="slider"
                aria-label="情绪强度"
                aria-valuetext={preset.label}
                tabIndex={0}
                className="relative grid size-full touch-none cursor-crosshair grid-cols-5 grid-rows-5 outline-none"
                onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); update(event); }}
                onPointerMove={(event) => { if (dragging) update(event); }}
                onPointerUp={(event) => { setDragging(false); setPointer(null); event.currentTarget.releasePointerCapture(event.pointerId); }}
                onPointerCancel={() => { setDragging(false); setPointer(null); }}
                onKeyDown={(event) => {
                    const column = Math.max(0, Math.min(4, selectedColumn + (event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0)));
                    const row = Math.max(0, Math.min(4, selectedRow + (event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0)));
                    if (column !== selectedColumn || row !== selectedRow) { event.preventDefault(); onChange(canvasEmotionPresets[row * 5 + column]); }
                }}
            >
                {canvasEmotionPresets.map((item, index) => {
                    const column = index % 5;
                    const row = Math.floor(index / 5);
                    const active = item.id === preset.id;
                    const onPath = !dragging && (column === selectedColumn || row === selectedRow);
                    const distance = pointer ? Math.hypot(pointer.x - column, pointer.y - row) : 4;
                    const proximity = dragging ? Math.max(0, 1 - distance / 1.7) : 0;
                    return (
                        <button key={item.id} type="button" aria-label={item.label} title={item.label} className="relative m-auto grid size-7 place-items-center rounded-full outline-none" onClick={() => onChange(item)}>
                            <motion.span
                                animate={{ scale: active ? 1.65 : 1 + proximity * 0.42, opacity: active ? 1 : onPath ? 0.88 : 0.42 + proximity * 0.45 }}
                                transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock}
                                className={`block rounded-full ${active ? "size-3 border-2 bg-transparent" : "size-2 bg-current"}`}
                                style={{ color: active || onPath ? theme.node.activeStroke : theme.node.muted, borderColor: theme.node.activeStroke, boxShadow: active ? `0 0 0 5px ${theme.accent.primarySoft}, 0 0 18px ${theme.spatial.glowStrong}` : undefined }}
                            />
                        </button>
                    );
                })}
                {dragging && pointer ? <motion.span className="pointer-events-none absolute size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border" style={{ left: `${10 + pointer.x * 20}%`, top: `${10 + pointer.y * 20}%`, borderColor: theme.spatial.glowStrong, boxShadow: `0 0 18px ${theme.spatial.glow}` }} /> : null}
            </div>
        </div>
    );
}

function EmotionHeadPreview({ preset }: { preset: CanvasEmotionPreset }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    return (
        <div className="relative overflow-hidden rounded-[12px] border" style={{ background: "#26272a", borderColor: theme.toolbar.border }}>
            <Canvas frameloop="demand" dpr={[1, 1.5]} camera={{ fov: 38, near: 0.1, far: 20, position: [0, 0, 4.15] }} gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}>
                <color attach="background" args={["#26272a"]} />
                <ambientLight intensity={0.82} />
                <directionalLight position={[-2.8, 4, 3]} intensity={1.45} color="#ffffff" />
                <directionalLight position={[3, 1, 2]} intensity={0.5} color="#c9d0dc" />
                <Suspense fallback={null}><EmotionFaceModel preset={preset} /></Suspense>
            </Canvas>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-black/55 to-transparent" />
            <AnimatePresence mode="wait" initial={false}>
                <motion.span key={preset.id} initial={{ opacity: 0, filter: "blur(6px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={{ opacity: 0, filter: "blur(5px)" }} transition={{ duration: 0.2 }} className="pointer-events-none absolute bottom-2 left-2.5 text-[10px] font-medium text-white/72">实时预览 · {preset.label}</motion.span>
            </AnimatePresence>
        </div>
    );
}

function EmotionFaceModel({ preset }: { preset: CanvasEmotionPreset }) {
    const renderer = useThree((state) => state.gl);
    const gltf = useLoader(GLTFLoader, "/canvas/models/facecap.glb", (loader) => {
        loader.setKTX2Loader(new KTX2Loader().setTranscoderPath("/three/basis/").detectSupport(renderer));
        loader.setMeshoptDecoder(MeshoptDecoder);
    });
    const invalidate = useThree((state) => state.invalidate);
    const reducedMotion = useReducedMotion();
    const model = useMemo(() => createMannequinModel(gltf.scene), [gltf.scene]);
    const animationRef = useRef<number | null>(null);

    useEffect(() => {
        const targets = emotionBlendshapes(preset);
        const meshes = morphMeshes(model);
        const starts = meshes.map((mesh) => [...(mesh.morphTargetInfluences || [])]);
        const startTime = performance.now();
        const duration = reducedMotion ? 0 : 220;
        const animate = (now: number) => {
            const progress = duration ? Math.min(1, (now - startTime) / duration) : 1;
            const eased = 1 - Math.pow(1 - progress, 3);
            meshes.forEach((mesh, meshIndex) => {
                const dictionary = mesh.morphTargetDictionary || {};
                const influences = mesh.morphTargetInfluences || [];
                Object.entries(dictionary).forEach(([name, index]) => {
                    const target = targets[name as keyof typeof targets] || 0;
                    influences[index] = (starts[meshIndex][index] || 0) + (target - (starts[meshIndex][index] || 0)) * eased;
                });
            });
            invalidate();
            if (progress < 1) animationRef.current = requestAnimationFrame(animate);
        };
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        animationRef.current = requestAnimationFrame(animate);
        return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
    }, [invalidate, model, preset, reducedMotion]);

    return <primitive object={model} />;
}

function createMannequinModel(source: Object3D) {
    const model = source.clone(true);
    model.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const material = new MeshStandardMaterial({ color: new Color("#aaacae"), roughness: 0.9, metalness: 0.01 });
        object.material = material;
        object.castShadow = false;
        object.receiveShadow = false;
    });
    // 不依赖模型原点，按真实包围盒归一化后再居中，避免不同导出版本出现头像偏移。
    const bounds = new Box3().setFromObject(model);
    const size = bounds.getSize(new Vector3());
    model.scale.multiplyScalar(2.35 / Math.max(size.y, 0.001));
    const normalizedBounds = new Box3().setFromObject(model);
    model.position.sub(normalizedBounds.getCenter(new Vector3()));
    return model;
}

function morphMeshes(model: Object3D) {
    const meshes: Mesh[] = [];
    model.traverse((object) => {
        if (object instanceof Mesh && object.morphTargetDictionary && object.morphTargetInfluences) meshes.push(object);
    });
    return meshes;
}
