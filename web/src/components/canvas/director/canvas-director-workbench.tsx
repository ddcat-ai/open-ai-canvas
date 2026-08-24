import { App, Button, ColorPicker, Dropdown, Input, InputNumber, Select, Slider, Switch } from "antd";
import type { MenuProps } from "antd";
import { Box, BoxSelect, Camera, Circle, Cuboid, FileUp, Focus, Image as ImageIcon, LampDesk, Lightbulb, Plus, Redo2, Save, Trash2, Undo2, UserRound, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { nanoid } from "nanoid";
import { Euler, Quaternion } from "three";
import type { AnimationClip } from "three";

import { DirectorViewport, type DirectorViewportHandle } from "@/components/canvas/director/director-viewport";
import { DirectorViewportDock } from "@/components/canvas/director/director-viewport-dock";
import { DirectorSequencer } from "@/components/canvas/director/director-sequencer";
import { canvasThemes } from "@/lib/canvas-theme";
import { compileDirectorPrompt } from "@/lib/canvas/director/director-prompt-compiler";
import {
    createDirectorActor,
    createDirectorBillboard,
    createDirectorCamera,
    createDirectorLight,
    createDirectorModel,
    createDirectorObject,
    DIRECTOR_ACTOR_COLORS,
    directorBoneLabel,
    directorPoseLabel,
    touchDirectorScene,
    upsertDirectorBoneKeyframe,
    upsertDirectorKeyframe,
} from "@/lib/canvas/director/director-scene";
import { uploadMediaFile } from "@/services/file-storage";
import { useAssetStore, type ModelAsset } from "@/stores/use-asset-store";
import { useDirectorWorkbenchStore } from "@/stores/canvas/use-director-workbench-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";
import type {
    DirectorCamera,
    DirectorCameraMove,
    DirectorHumanoidBone,
    DirectorLight,
    DirectorObject,
    DirectorPose,
    DirectorQuat,
    DirectorRig,
    DirectorScene,
    DirectorSceneOutput,
    DirectorShot,
    DirectorShotSize,
    DirectorTransform,
    DirectorVec3,
} from "@/types/director";

export function CanvasDirectorWorkbench({
    open,
    scene,
    imageNodes,
    onClose,
    onChange,
    onApply,
    onDeleteImageNode,
}: {
    open: boolean;
    scene: DirectorScene | null;
    imageNodes: CanvasNodeData[];
    onClose: () => void;
    onChange: (scene: DirectorScene) => void;
    onApply: (output: DirectorSceneOutput) => Promise<void>;
    onDeleteImageNode: (nodeId: string) => void;
}) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const viewportRef = useRef<DirectorViewportHandle>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<DirectorScene | null>(null);
    const [history, setHistory] = useState<DirectorScene[]>([]);
    const [future, setFuture] = useState<DirectorScene[]>([]);
    const [saving, setSaving] = useState(false);
    const [recording, setRecording] = useState(false);
    const selectedObjectId = useDirectorWorkbenchStore((state) => state.selectedObjectId);
    const selectedLightId = useDirectorWorkbenchStore((state) => state.selectedLightId);
    const transformMode = useDirectorWorkbenchStore((state) => state.transformMode);
    const renderMode = useDirectorWorkbenchStore((state) => state.renderMode);
    const playhead = useDirectorWorkbenchStore((state) => state.playhead);
    const playing = useDirectorWorkbenchStore((state) => state.playing);
    const selectedBone = useDirectorWorkbenchStore((state) => state.selectedBone);
    const autoKey = useDirectorWorkbenchStore((state) => state.autoKey);
    const sequencerHeight = useDirectorWorkbenchStore((state) => state.sequencerHeight);
    const sequencerVisible = useDirectorWorkbenchStore((state) => state.sequencerVisible);
    const setSelectedObjectId = useDirectorWorkbenchStore((state) => state.setSelectedObjectId);
    const setSelectedLightId = useDirectorWorkbenchStore((state) => state.setSelectedLightId);
    const setTransformMode = useDirectorWorkbenchStore((state) => state.setTransformMode);
    const setRenderMode = useDirectorWorkbenchStore((state) => state.setRenderMode);
    const setPlayhead = useDirectorWorkbenchStore((state) => state.setPlayhead);
    const setPlaying = useDirectorWorkbenchStore((state) => state.setPlaying);
    const setSelectedBone = useDirectorWorkbenchStore((state) => state.setSelectedBone);
    const setAutoKey = useDirectorWorkbenchStore((state) => state.setAutoKey);
    const setSequencerHeight = useDirectorWorkbenchStore((state) => state.setSequencerHeight);
    const setSequencerVisible = useDirectorWorkbenchStore((state) => state.setSequencerVisible);
    const resetWorkbench = useDirectorWorkbenchStore((state) => state.reset);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const modelAssets = useMemo(() => assets.filter((asset): asset is ModelAsset => asset.kind === "model"), [assets]);

    useEffect(() => {
        if (!open || !scene) return;
        const next = structuredClone(scene);
        next.shots = next.shots.map((shot) => ({ ...shot, fps: shot.fps || 24 }));
        setDraft(next);
        setHistory([]);
        setFuture([]);
        resetWorkbench();
    }, [open, resetWorkbench, scene]);

    const activeShot = draft?.shots?.find((item) => item.id === draft.activeShotId) || draft?.shots?.[0] || null;
    const activeCamera = draft?.cameras?.find((item) => item.id === activeShot?.cameraId) || draft?.cameras?.[0] || null;
    const selectedObject = draft?.objects?.find((item) => item.id === selectedObjectId) || null;
    const selectedLight = draft?.lights?.find((item) => item.id === selectedLightId) || null;

    useEffect(() => {
        if (!playing || !activeShot) return;
        let frame = 0;
        let last = performance.now();
        const tick = (now: number) => {
            const delta = (now - last) / 1000;
            last = now;
            const next = useDirectorWorkbenchStore.getState().playhead + delta;
            setPlayhead(next >= activeShot.duration ? 0 : next);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [activeShot, playing, setPlayhead]);

    const commit = useCallback((updater: (current: DirectorScene) => DirectorScene) => {
        setDraft((current) => {
            if (!current) return current;
            const next = touchDirectorScene(updater(current));
            setHistory((items) => [...items.slice(-49), structuredClone(current)]);
            setFuture([]);
            return next;
        });
    }, []);

    const replaceWithoutHistory = useCallback((updater: (current: DirectorScene) => DirectorScene) => setDraft((current) => (current ? touchDirectorScene(updater(current)) : current)), []);

    const undo = () => {
        const previous = history.at(-1);
        if (!previous || !draft) return;
        setHistory((items) => items.slice(0, -1));
        setFuture((items) => [structuredClone(draft), ...items].slice(0, 50));
        setDraft(previous);
    };
    const redo = () => {
        const next = future[0];
        if (!next || !draft) return;
        setFuture((items) => items.slice(1));
        setHistory((items) => [...items, structuredClone(draft)].slice(-50));
        setDraft(next);
    };

    const updateObject = (id: string, patch: Partial<DirectorObject>) => commit((current) => ({ ...current, objects: current.objects.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
    const updateLight = (id: string, patch: Partial<DirectorLight>) => commit((current) => ({ ...current, lights: current.lights.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
    const updateShot = (id: string, patch: Partial<DirectorShot>) => commit((current) => ({ ...current, shots: current.shots.map((item) => (item.id === id ? { ...item, ...patch } : item)) }));
    const removeObject = (id: string) => {
        commit((current) => ({ ...current, objects: current.objects.filter((item) => item.id !== id) }));
        if (selectedObjectId === id) {
            setSelectedObjectId(null);
            setSelectedBone(null);
        }
    };
    const removeLight = (id: string) => {
        commit((current) => ({ ...current, lights: current.lights.filter((item) => item.id !== id) }));
        if (selectedLightId === id) setSelectedLightId(null);
    };
    const removeCamera = (id: string) => {
        if (!draft || draft.cameras.length <= 1) {
            message.warning(t("canvas:keep-at-least-one-camera"));
            return;
        }
        const fallback = draft.cameras.find((item) => item.id !== id);
        if (!fallback) return;
        commit((current) => ({
            ...current,
            cameras: current.cameras.filter((item) => item.id !== id),
            shots: current.shots.map((shot) => (shot.cameraId === id ? { ...shot, cameraId: fallback.id } : shot)),
        }));
    };

    const addPrimitive = (primitive: DirectorObject["primitive"], name: string) => {
        const object = createDirectorObject(primitive, name);
        commit((current) => ({ ...current, objects: [...current.objects, object] }));
        setSelectedObjectId(object.id);
    };

    const addActor = () => {
        const actorCount = draft?.objects.filter((item) => item.kind === "actor").length || 0;
        const actor = createDirectorActor(`${t("canvas:actor")} ${actorCount + 1}`, [actorCount * 0.8, 0, 0], DIRECTOR_ACTOR_COLORS[actorCount % DIRECTOR_ACTOR_COLORS.length]);
        commit((current) => ({ ...current, objects: [...current.objects, actor] }));
        setSelectedObjectId(actor.id);
    };

    const addModelAsset = (asset: ModelAsset) => {
        const object = createDirectorModel({ name: asset.title, assetId: asset.id, storageKey: asset.data.storageKey, url: asset.data.url, mimeType: asset.data.mimeType });
        commit((current) => ({ ...current, objects: [...current.objects, object] }));
        setSelectedObjectId(object.id);
    };

    const uploadModel = async (file?: File) => {
        if (!file || !/\.(glb|gltf)$/i.test(file.name)) return;
        const uploaded = await uploadMediaFile(file, "model");
        const assetId = addAsset({
            kind: "model",
            title: file.name.replace(/\.(glb|gltf)$/i, ""),
            coverUrl: "",
            tags: [t("canvas:3d-models")],
            source: t("canvas:director-stage"),
            data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name },
            metadata: { source: "director" },
        });
        const asset = useAssetStore.getState().assets.find((item): item is ModelAsset => item.id === assetId && item.kind === "model");
        if (asset) addModelAsset(asset);
        message.success(t("canvas:3d-model-added-to-scene-and-asset-library"));
    };

    const addBillboard = (node: CanvasNodeData) => {
        if (!node.metadata?.content) return;
        const object = createDirectorBillboard(node.title, node.metadata.content, node.metadata.storageKey, node.id);
        commit((current) => ({ ...current, objects: [...current.objects, object] }));
        setSelectedObjectId(object.id);
    };

    const addCamera = () => {
        const camera = createDirectorCamera(`${t("canvas:camera")} ${draft?.cameras.length ? draft.cameras.length + 1 : 1}`);
        commit((current) => ({ ...current, cameras: [...current.cameras, camera] }));
        if (activeShot) updateShot(activeShot.id, { cameraId: camera.id });
    };

    const addLight = (type: DirectorLight["type"] = "point", label = t("canvas:lighting"), position: DirectorVec3 = [2, 3, 2], intensity = 1.5) => {
        const light = createDirectorLight(type, `${label} ${draft?.lights.length ? draft.lights.length + 1 : 1}`, position, intensity);
        commit((current) => ({ ...current, lights: [...current.lights, light] }));
        setSelectedLightId(light.id);
    };

    const addCameraMenuItems: MenuProps["items"] = [{ key: "camera", icon: <Camera className="size-3.5" />, label: t("canvas:add-camera"), onClick: addCamera }];
    const addLightMenuItems: MenuProps["items"] = [
        { key: "directional", icon: <Lightbulb className="size-3.5" />, label: t("canvas:directional-light"), onClick: () => addLight("directional", t("canvas:directional-light"), [4, 6, 4], 2.4) },
        { key: "point", icon: <Lightbulb className="size-3.5" />, label: t("canvas:point-light"), onClick: () => addLight("point", t("canvas:point-light")) },
        { key: "spot", icon: <Lightbulb className="size-3.5" />, label: t("canvas:spotlight"), onClick: () => addLight("spot", t("canvas:spotlight"), [2, 4, 2], 2) },
        { key: "ambient", icon: <LampDesk className="size-3.5" />, label: t("canvas:ambient-light"), onClick: () => addLight("ambient", t("canvas:ambient-light"), [0, 0, 0], 0.65) },
    ];
    const addObjectMenuItems: MenuProps["items"] = [
        { key: "actor", icon: <UserRound className="size-3.5" />, label: t("canvas:actors"), onClick: addActor },
        { key: "box", icon: <Box className="size-3.5" />, label: t("canvas:cube"), onClick: () => addPrimitive("box", t("canvas:cube")) },
        { key: "sphere", icon: <Circle className="size-3.5" />, label: t("canvas:sphere"), onClick: () => addPrimitive("sphere", t("canvas:sphere")) },
        { key: "cylinder", icon: <Cuboid className="size-3.5" />, label: t("canvas:cylinder"), onClick: () => addPrimitive("cylinder", t("canvas:cylinder")) },
        { key: "model", icon: <FileUp className="size-3.5" />, label: t("canvas:upload-model"), onClick: () => modelInputRef.current?.click() },
    ];

    const addShot = () => {
        if (!activeCamera) return;
        const shot: DirectorShot = { id: nanoid(), name: `${t("canvas:shot")} ${(draft?.shots.length || 0) + 1}`, cameraId: activeCamera.id, duration: 5, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" };
        commit((current) => ({ ...current, shots: [...current.shots, shot], activeShotId: shot.id }));
        setPlayhead(0);
    };

    const addObjectKeyframe = () => {
        if (!selectedObject) return;
        updateObject(selectedObject.id, { keyframes: upsertDirectorKeyframe(selectedObject.keyframes, playhead, selectedObject.transform) });
    };

    const addCameraKeyframe = () => {
        if (!activeCamera) return;
        commit((current) => ({ ...current, cameras: current.cameras.map((item) => (item.id === activeCamera.id ? { ...item, keyframes: upsertDirectorKeyframe(item.keyframes, playhead, item.transform) } : item)) }));
    };

    const recordSelectedKeyframe = () => {
        if (selectedObject && selectedBone) {
            const rotation = selectedObject.boneOverrides?.[selectedBone as DirectorHumanoidBone] || ([0, 0, 0, 1] as DirectorQuat);
            updateObject(selectedObject.id, { boneTracks: upsertDirectorBoneKeyframe(selectedObject.boneTracks || [], selectedBone as DirectorHumanoidBone, playhead, rotation) });
            return;
        }
        if (selectedObject) addObjectKeyframe();
        else addCameraKeyframe();
    };

    const handleObjectTransform = useCallback(
        (id: string, transform: DirectorTransform) => {
            commit((current) => ({
                ...current,
                objects: current.objects.map((item) => (item.id === id ? { ...item, transform, keyframes: autoKey ? upsertDirectorKeyframe(item.keyframes, playhead, transform) : item.keyframes } : item)),
            }));
        },
        [autoKey, commit, playhead],
    );

    const handleBoneTransform = useCallback(
        (id: string, bone: string, rotation: DirectorQuat) => {
            commit((current) => ({
                ...current,
                objects: current.objects.map((item) =>
                    item.id === id
                        ? {
                              ...item,
                              boneOverrides: { ...item.boneOverrides, [bone]: rotation },
                              boneTracks: autoKey ? upsertDirectorBoneKeyframe(item.boneTracks || [], bone as DirectorHumanoidBone, playhead, rotation) : item.boneTracks,
                          }
                        : item,
                ),
            }));
        },
        [autoKey, commit, playhead],
    );

    const handleActorRigReady = useCallback(
        (id: string, rig: DirectorRig, animations: AnimationClip[]) => {
            replaceWithoutHistory((current) => ({
                ...current,
                objects: current.objects.map((item) => {
                    if (item.id !== id) return item;
                    const existing = item.motionClips || [];
                    const motionClips = existing.length
                        ? existing
                        : animations.map((clip) => ({ id: nanoid(), name: clip.name || t("canvas:motion-clips"), sourceAnimation: clip.name, start: 0, duration: Math.max(0.1, clip.duration), playbackRate: 1, loop: true }));
                    return { ...item, rig, motionClips };
                }),
            }));
        },
        [replaceWithoutHistory],
    );

    const applyCameraMove = () => {
        if (!activeCamera || !activeShot) return;
        const start = activeCamera.transform;
        const end = cameraMoveTransform(start, activeShot.cameraMove);
        commit((current) => ({
            ...current,
            cameras: current.cameras.map((item) =>
                item.id === activeCamera.id
                    ? {
                          ...item,
                          keyframes: [
                              { id: nanoid(), time: 0, transform: start },
                              { id: nanoid(), time: activeShot.duration, transform: end },
                          ],
                      }
                    : item,
            ),
        }));
        message.success(t("canvas:camera-motion-keyframes-generated"));
    };

    const alignCameraToView = () => {
        if (!activeCamera) return;
        const transform = viewportRef.current?.readCameraTransform();
        if (!transform) return;
        commit((current) => ({ ...current, cameras: current.cameras.map((item) => (item.id === activeCamera.id ? { ...item, transform } : item)) }));
        message.success(t("canvas:camera-aligned-to-current-view"));
    };

    const applyToCanvas = async () => {
        if (!draft || !activeShot || !viewportRef.current) return;
        setSaving(true);
        try {
            const beauty = await viewportRef.current.capture("beauty");
            const prompt = compileDirectorPrompt(draft, activeShot);
            const next = touchDirectorScene(draft);
            setDraft(next);
            onChange(next);
            await onApply({ scene: next, shot: activeShot, prompt, beauty });
            message.success(t("canvas:director-composition-written-back-to-canvas"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:director-stage-export-failed"));
        } finally {
            setSaving(false);
        }
    };

    const exportClayVideo = async () => {
        if (!draft || !activeShot || !viewportRef.current || recording) return;
        setRecording(true);
        const wasPlaying = playing;
        const previousPlayhead = playhead;
        setPlayhead(0);
        setPlaying(true);
        try {
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            const clayVideo = await viewportRef.current.recordVideo(activeShot.duration, activeShot.fps);
            const next = touchDirectorScene(draft);
            onChange(next);
            await onApply({ scene: next, shot: activeShot, prompt: compileDirectorPrompt(next, activeShot), beauty: await viewportRef.current.capture("beauty"), clayVideo, clayVideoMimeType: clayVideo.type });
            message.success(t("canvas:clay-render-video-written-back-to-canvas"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:clay-render-video-export-failed"));
        } finally {
            setPlaying(wasPlaying);
            setPlayhead(previousPlayhead);
            setRecording(false);
        }
    };

    if (!open || !draft || !activeShot) return null;

    return (
        <div data-canvas-no-zoom className="fixed inset-0 z-[var(--z-toast)] flex min-h-0 flex-col overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <IconButton label={t("canvas:close-director-stage")} onClick={onClose}>
                    <X className="size-4" />
                </IconButton>
                <Input variant="borderless" value={draft.title} className="max-w-56 font-medium" onChange={(event) => replaceWithoutHistory((current) => ({ ...current, title: event.target.value }))} />
                <span className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                <IconButton label={t("canvas:undo")} disabled={!history.length} onClick={undo}>
                    <Undo2 className="size-4" />
                </IconButton>
                <IconButton label={t("canvas:redo")} disabled={!future.length} onClick={redo}>
                    <Redo2 className="size-4" />
                </IconButton>
                <div className="ml-auto flex items-center gap-1">
                    <Select
                        size="small"
                        value={renderMode}
                        className="w-24"
                        options={[
                            { label: t("canvas:preview"), value: "beauty" },
                            { label: t("canvas:colored-clay"), value: "clay" },
                            { label: t("canvas:bones"), value: "pose" },
                            { label: t("canvas:depth"), value: "depth" },
                            { label: t("canvas:normals"), value: "normal" },
                        ]}
                        onChange={setRenderMode}
                    />
                    <Button size="small" icon={<Video className="size-3.5" />} loading={recording} onClick={() => void exportClayVideo()}>
                        {t("canvas:export-clay-render")}
                    </Button>
                    <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void applyToCanvas()}>
                        {t("canvas:apply-to-shot")}
                    </Button>
                </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_292px] max-lg:grid-cols-[180px_minmax(0,1fr)]">
                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-r" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    <PanelTitle title={t("canvas:scene-objects")} action={<AddMenuButton label={t("canvas:add-scene-object")} items={addObjectMenuItems} />} />
                    <div className="px-2 pb-2">
                        {draft.objects.map((object) => (
                            <SceneRow
                                key={object.id}
                                active={selectedObjectId === object.id}
                                icon={object.kind === "actor" || object.primitive === "character" ? <UserRound /> : object.kind === "model" ? <BoxSelect /> : object.kind === "billboard" ? <ImageIcon /> : <Cuboid />}
                                label={object.name}
                                onClick={() => setSelectedObjectId(object.id)}
                                onDelete={() => removeObject(object.id)}
                            />
                        ))}
                    </div>
                    <PanelTitle title={t("canvas:cameras")} action={<AddMenuButton label={t("canvas:add-camera")} items={addCameraMenuItems} />} />
                    <div className="px-2 pb-2">
                        {draft.cameras.map((camera) => (
                            <SceneRow
                                key={camera.id}
                                active={activeShot.cameraId === camera.id && !selectedObjectId && !selectedLightId}
                                icon={<Camera />}
                                label={camera.name}
                                onClick={() => {
                                    setSelectedObjectId(null);
                                    setSelectedLightId(null);
                                    updateShot(activeShot.id, { cameraId: camera.id });
                                }}
                                onDelete={() => removeCamera(camera.id)}
                            />
                        ))}
                    </div>
                    <PanelTitle title={t("canvas:lighting")} action={<AddMenuButton label={t("canvas:add-lights")} items={addLightMenuItems} />} />
                    <div className="px-2 pb-2">
                        {draft.lights.map((light) => (
                            <SceneRow key={light.id} active={selectedLightId === light.id} icon={<Lightbulb />} label={light.name} onClick={() => setSelectedLightId(light.id)} onDelete={() => removeLight(light.id)} />
                        ))}
                    </div>
                    <PanelTitle title={t("canvas:quick-add")} />
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-3">
                        <QuickAdd label={t("canvas:actors")} icon={<UserRound />} onClick={addActor} />
                        <QuickAdd label={t("canvas:cube")} icon={<Box />} onClick={() => addPrimitive("box", t("canvas:cube"))} />
                        <QuickAdd label={t("canvas:sphere")} icon={<Circle />} onClick={() => addPrimitive("sphere", t("canvas:sphere"))} />
                        <QuickAdd label={t("canvas:cylinder")} icon={<Cuboid />} onClick={() => addPrimitive("cylinder", t("canvas:cylinder"))} />
                        <QuickAdd label={t("canvas:upload-model")} icon={<FileUp />} onClick={() => modelInputRef.current?.click()} />
                        <QuickAdd label={t("canvas:add-lights")} icon={<LampDesk />} onClick={addLight} />
                    </div>
                    {modelAssets.length ? (
                        <>
                            <PanelTitle title={t("canvas:3d-assets")} />
                            <div className="px-2 pb-3">
                                {modelAssets.map((asset) => (
                                    <SceneRow key={asset.id} icon={<BoxSelect />} label={asset.title} onClick={() => addModelAsset(asset)} />
                                ))}
                            </div>
                        </>
                    ) : null}
                    {imageNodes.length ? (
                        <>
                            <PanelTitle title={t("canvas:canvas-image-standee")} />
                            <div className="px-2 pb-3">
                                {imageNodes.slice(0, 20).map((node) => (
                                    <SceneRow key={node.id} icon={<ImageIcon />} label={node.title} onClick={() => addBillboard(node)} onDelete={() => onDeleteImageNode(node.id)} />
                                ))}
                            </div>
                        </>
                    ) : null}
                    <input
                        ref={modelInputRef}
                        type="file"
                        accept=".glb,.gltf,model/gltf-binary,model/gltf+json"
                        className="hidden"
                        onChange={(event) => {
                            void uploadModel(event.target.files?.[0]);
                            event.currentTarget.value = "";
                        }}
                    />
                </aside>

                <main className="relative min-h-0 overflow-hidden bg-neutral-900">
                    <DirectorViewport
                        ref={viewportRef}
                        scene={draft}
                        selectedObjectId={selectedObjectId}
                        selectedBone={selectedBone}
                        transformMode={transformMode}
                        renderMode={renderMode}
                        playhead={playhead}
                        onSelectObject={setSelectedObjectId}
                        onSelectBone={setSelectedBone}
                        onObjectTransform={handleObjectTransform}
                        onBoneTransform={handleBoneTransform}
                        onActorRigReady={handleActorRigReady}
                    />
                    <div className="pointer-events-none absolute left-3 top-3 text-[var(--fs-tiny)] font-medium text-white/70">
                        {activeShot.name} · {activeCamera?.name || t("canvas:no-camera")} · {activeShot.duration}s
                    </div>
                    <DirectorViewportDock
                        transformMode={transformMode}
                        renderMode={renderMode}
                        onTransformModeChange={setTransformMode}
                        onRenderModeChange={setRenderMode}
                        onAddActor={addActor}
                        onAddBox={() => addPrimitive("box", t("canvas:cube"))}
                        onAddLight={addLight}
                        onAddCamera={addCamera}
                        onAlignCamera={alignCameraToView}
                    />
                </main>

                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-l max-lg:hidden" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    {selectedObject ? (
                        <ObjectInspector
                            object={selectedObject}
                            playhead={playhead}
                            selectedBone={selectedBone}
                            autoKey={autoKey}
                            onSelectBone={setSelectedBone}
                            onUpdate={(patch) => updateObject(selectedObject.id, patch)}
                            onAddKeyframe={recordSelectedKeyframe}
                            onDelete={() => removeObject(selectedObject.id)}
                        />
                    ) : selectedLight ? (
                        <LightInspector light={selectedLight} onUpdate={(patch) => updateLight(selectedLight.id, patch)} onDelete={() => removeLight(selectedLight.id)} />
                    ) : (
                        <ShotInspector
                            shot={activeShot}
                            camera={activeCamera}
                            cameras={draft.cameras}
                            onUpdateShot={(patch) => updateShot(activeShot.id, patch)}
                            onUpdateCamera={(patch) => activeCamera && commit((current) => ({ ...current, cameras: current.cameras.map((item) => (item.id === activeCamera.id ? { ...item, ...patch } : item)) }))}
                            onAddCameraKeyframe={addCameraKeyframe}
                            onApplyCameraMove={applyCameraMove}
                            onAlignCameraToView={alignCameraToView}
                            onExportClay={exportClayVideo}
                            recording={recording}
                        />
                    )}
                </aside>
            </div>

            <DirectorSequencer
                scene={draft}
                shot={activeShot}
                camera={activeCamera}
                objects={draft.objects}
                selectedObjectId={selectedObjectId}
                selectedBone={selectedBone}
                playhead={playhead}
                playing={playing}
                autoKey={autoKey}
                height={sequencerHeight}
                visible={sequencerVisible}
                onPlayToggle={() => setPlaying(!playing)}
                onPlayheadChange={setPlayhead}
                onAutoKeyChange={setAutoKey}
                onHeightChange={setSequencerHeight}
                onVisibilityChange={setSequencerVisible}
                onSelectObject={setSelectedObjectId}
                onSelectBone={setSelectedBone}
                onRecordKeyframe={recordSelectedKeyframe}
                onAddShot={addShot}
                onSelectShot={(id) => {
                    commit((current) => ({ ...current, activeShotId: id }));
                    setPlayhead(0);
                }}
            />
        </div>
    );
}

function ObjectInspector({
    object,
    playhead,
    selectedBone,
    autoKey,
    onSelectBone,
    onUpdate,
    onAddKeyframe,
    onDelete,
}: {
    object: DirectorObject;
    playhead: number;
    selectedBone: string | null;
    autoKey: boolean;
    onSelectBone: (bone: string | null) => void;
    onUpdate: (patch: Partial<DirectorObject>) => void;
    onAddKeyframe: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation("canvas");
    const motionClips = object.motionClips || [];
    const activeMotionClip = motionClips.find((clip) => clip.id === object.activeMotionClipId);
    const mappedBones = Object.keys(object.rig?.boneMap || {}) as DirectorHumanoidBone[];
    const selectedBoneId = selectedBone as DirectorHumanoidBone | null;
    const selectedBoneRotation = selectedBoneId ? object.boneOverrides?.[selectedBoneId] || ([0, 0, 0, 1] as DirectorQuat) : null;
    const updateActiveMotion = (patch: Partial<NonNullable<DirectorObject["motionClips"]>[number]>) => activeMotionClip && onUpdate({ motionClips: motionClips.map((clip) => (clip.id === activeMotionClip.id ? { ...clip, ...patch } : clip)) });
    const updateSelectedBoneRotation = (rotation: DirectorQuat) => {
        if (!selectedBoneId) return;
        const patch: Partial<DirectorObject> = { boneOverrides: { ...object.boneOverrides, [selectedBoneId]: rotation } };
        if (autoKey) patch.boneTracks = upsertDirectorBoneKeyframe(object.boneTracks || [], selectedBoneId, playhead, rotation);
        onUpdate(patch);
    };
    const applyPose = (pose: DirectorPose) => onUpdate({ pose, activeMotionClipId: undefined, boneOverrides: {} });
    return (
        <Inspector title={object.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}>
            <TransformFields transform={object.transform} onChange={(transform) => onUpdate({ transform })} />
            {object.kind === "actor" || object.primitive === "character" ? (
                <Field label={t("canvas:character-color")}>
                    <div className="director-actor-colors">
                        {DIRECTOR_ACTOR_COLORS.map((color) => (
                            <button
                                key={color}
                                type="button"
                                className={`director-actor-color ${object.color.toLowerCase() === color ? "is-active" : ""}`}
                                style={{ background: color }}
                                aria-label={t("canvas:set-color-param", { color: color })}
                                onClick={() => onUpdate({ color })}
                            />
                        ))}
                        <ColorPicker value={object.color} size="small" onChange={(_, color) => onUpdate({ color })} />
                    </div>
                </Field>
            ) : (
                <Field label={t("canvas:color-2")}>
                    <ColorPicker value={object.color} onChange={(_, color) => onUpdate({ color })} />
                </Field>
            )}
            {object.kind === "actor" || object.primitive === "character" || motionClips.length ? (
                <>
                    <section className="director-pose-section">
                        <div className="director-inspector-section-title">
                            <span>{t("canvas:pose-presets")}</span>
                            <span>{directorPoseLabel(object.pose || "stand")}</span>
                        </div>
                        <div className="director-pose-grid">
                            {getPoseOptions().map((option) => (
                                <button key={option.value} type="button" className={`director-pose-button ${object.pose === option.value && !object.activeMotionClipId ? "is-active" : ""}`} title={option.label} onClick={() => applyPose(option.value)}>
                                    {option.label}
                                </button>
                            ))}
                        </div>
                    </section>
                    <div className="flex items-center justify-between border-y py-2 text-[var(--fs-label)]">
                        <span>{t("canvas:character-rig")}</span>
                        <span className="opacity-55">{object.rig?.status === "ready" ? t("canvas:param-bones", { length: mappedBones.length }) : t("canvas:waiting-for-model")}</span>
                    </div>
                    {motionClips.length ? (
                        <>
                            <Field label={t("canvas:motion-clips")}>
                                <Select
                                    className="w-full"
                                    value={object.activeMotionClipId || ""}
                                    options={[{ label: t("canvas:static-pose"), value: "" }, ...motionClips.map((clip) => ({ label: clip.name, value: clip.id }))]}
                                    onChange={(activeMotionClipId) => onUpdate({ activeMotionClipId: activeMotionClipId || undefined })}
                                />
                            </Field>
                            {activeMotionClip ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <Field label={t("canvas:playback-speed")}>
                                        <InputNumber className="w-full" min={0.1} max={4} step={0.1} value={activeMotionClip.playbackRate} onChange={(playbackRate) => updateActiveMotion({ playbackRate: playbackRate || 1 })} />
                                    </Field>
                                    <Field label={t("canvas:loop")}>
                                        <Switch checked={activeMotionClip.loop} onChange={(loop) => updateActiveMotion({ loop })} />
                                    </Field>
                                </div>
                            ) : null}
                        </>
                    ) : (
                        <div className="text-[var(--fs-tiny)] opacity-50">{t("canvas:available-motion-clips-appear-once-the-model-loads")}</div>
                    )}
                    {mappedBones.length ? (
                        <Field label={t("canvas:bone-controls")}>
                            <Select className="w-full" allowClear value={selectedBone || undefined} options={mappedBones.map((bone) => ({ label: directorBoneLabel(bone), value: bone }))} onChange={(bone) => onSelectBone(bone || null)} />
                        </Field>
                    ) : null}
                    {selectedBoneId && selectedBoneRotation ? <BoneRotationFields rotation={selectedBoneRotation} onChange={updateSelectedBoneRotation} /> : null}
                </>
            ) : null}
            <Field label={t("canvas:visible")}>
                <Switch checked={object.visible} onChange={(visible) => onUpdate({ visible })} />
            </Field>
            <Field label={t("canvas:cast-shadows")}>
                <Switch checked={object.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
            </Field>
            <Button block icon={<Focus className="size-3.5" />} onClick={onAddKeyframe}>
                {selectedBone ? t("canvas:record-bones-at", { t: playhead.toFixed(1) }) : t("canvas:record-keyframe-at", { t: playhead.toFixed(1) })}
            </Button>
            <div className="text-[var(--fs-tiny)] opacity-50">
                Transform {object.keyframes.length} {t("canvas:bones-2")} {object.boneTracks?.reduce((sum, track) => sum + track.keyframes.length, 0) || 0} {t("canvas:total-4")}
            </div>
        </Inspector>
    );
}

function LightInspector({ light, onUpdate, onDelete }: { light: DirectorLight; onUpdate: (patch: Partial<DirectorLight>) => void; onDelete: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <Inspector title={light.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}>
            <Field label={t("canvas:type")}>
                <Select
                    className="w-full"
                    value={light.type}
                    options={[
                        { label: t("canvas:directional-light"), value: "directional" },
                        { label: t("canvas:point-light"), value: "point" },
                        { label: t("canvas:spotlight"), value: "spot" },
                        { label: t("canvas:ambient-light"), value: "ambient" },
                    ]}
                    onChange={(type) => onUpdate({ type })}
                />
            </Field>
            <Vec3Field label={t("canvas:position-2")} value={light.transform.position} onChange={(position) => onUpdate({ transform: { ...light.transform, position } })} />
            <Field label={t("canvas:color-2")}>
                <ColorPicker value={light.color} onChange={(_, color) => onUpdate({ color })} />
            </Field>
            <Field label={t("canvas:intensity")}>
                <InputNumber className="w-full" min={0} max={20} step={0.1} value={light.intensity} onChange={(value) => onUpdate({ intensity: value || 0 })} />
            </Field>
            <Field label={t("canvas:cast-shadows")}>
                <Switch checked={light.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
            </Field>
        </Inspector>
    );
}

function ShotInspector({
    shot,
    camera,
    cameras,
    onUpdateShot,
    onUpdateCamera,
    onAddCameraKeyframe,
    onApplyCameraMove,
    onAlignCameraToView,
    onExportClay,
    recording,
}: {
    shot: DirectorShot;
    camera: DirectorCamera | null;
    cameras: DirectorScene["cameras"];
    onUpdateShot: (patch: Partial<DirectorShot>) => void;
    onUpdateCamera: (patch: Partial<DirectorCamera>) => void;
    onAddCameraKeyframe: () => void;
    onApplyCameraMove: () => void;
    onAlignCameraToView: () => void;
    onExportClay: () => void;
    recording: boolean;
}) {
    const { t } = useTranslation("canvas");
    return (
        <Inspector title={shot.name} onTitleChange={(name) => onUpdateShot({ name })}>
            <Field label={t("canvas:cameras")}>
                <Select className="w-full" value={shot.cameraId} options={cameras.map((item) => ({ label: item.name, value: item.id }))} onChange={(cameraId) => onUpdateShot({ cameraId })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label={t("canvas:shot-size")}>
                    <Select className="w-full" value={shot.shotSize} options={getShotSizeOptions()} onChange={(shotSize: DirectorShotSize) => onUpdateShot({ shotSize })} />
                </Field>
                <Field label={t("canvas:frame-rate")}>
                    <Select className="w-full" value={shot.fps} options={[24, 25, 30].map((fps) => ({ label: `${fps} fps`, value: fps }))} onChange={(fps: 24 | 25 | 30) => onUpdateShot({ fps })} />
                </Field>
            </div>
            <Field label={t("canvas:camera-move")}>
                <Select className="w-full" value={shot.cameraMove} options={getCameraMoveOptions()} onChange={(cameraMove: DirectorCameraMove) => onUpdateShot({ cameraMove })} />
            </Field>
            <Field label={t("canvas:duration-5")}>
                <InputNumber className="w-full" min={0.5} max={60} step={0.5} value={shot.duration} addonAfter={t("canvas:s-2")} onChange={(value) => onUpdateShot({ duration: value || 5 })} />
            </Field>
            <Field label={t("canvas:shot-intent")}>
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} value={shot.prompt} placeholder={t("canvas:acting-movement-narrative-goal")} onChange={(event) => onUpdateShot({ prompt: event.target.value })} />
            </Field>
            {camera ? (
                <>
                    <Vec3Field label={t("canvas:camera-position")} value={camera.transform.position} onChange={(position) => onUpdateCamera({ transform: { ...camera.transform, position } })} />
                    <Vec3Field label={t("canvas:focus-point")} value={camera.target} onChange={(target) => onUpdateCamera({ target })} />
                    <Field label={t("canvas:focal-length")}>
                        <InputNumber className="w-full" min={12} max={200} value={camera.focalLength} addonAfter="mm" onChange={(focalLength) => onUpdateCamera({ focalLength: focalLength || 35, fov: focalLengthToFov(focalLength || 35) })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label={t("canvas:aperture")}>
                            <InputNumber className="w-full" min={0.7} max={32} step={0.1} value={camera.aperture} addonBefore="f/" onChange={(aperture) => onUpdateCamera({ aperture: aperture || 2.8 })} />
                        </Field>
                        <Field label={t("canvas:focus-distance")}>
                            <InputNumber className="w-full" min={0.1} max={200} step={0.1} value={camera.focusDistance} addonAfter="m" onChange={(focusDistance) => onUpdateCamera({ focusDistance: focusDistance || 5 })} />
                        </Field>
                    </div>
                    <Button block icon={<Camera className="size-3.5" />} onClick={onAlignCameraToView}>
                        {t("canvas:align-camera-to-current-view-2")}
                    </Button>
                    <Button block icon={<Video className="size-3.5" />} onClick={onApplyCameraMove}>
                        {t("canvas:generate-trajectory-from-camera-move")}
                    </Button>
                    <Button block icon={<Focus className="size-3.5" />} onClick={onAddCameraKeyframe}>
                        {t("canvas:record-camera-keyframe")}
                    </Button>
                    <Button block type="primary" ghost icon={<Video className="size-3.5" />} loading={recording} onClick={onExportClay}>
                        {t("canvas:export-clay-render-video")}
                    </Button>
                </>
            ) : null}
        </Inspector>
    );
}

function Inspector({ title, children, onTitleChange, onDelete }: { title: string; children: ReactNode; onTitleChange: (value: string) => void; onDelete?: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
                <Input variant="borderless" value={title} className="min-w-0 flex-1 px-0 font-medium" onChange={(event) => onTitleChange(event.target.value)} />
                {onDelete ? (
                    <IconButton label={t("canvas:delete-5")} onClick={onDelete}>
                        <Trash2 className="size-4" />
                    </IconButton>
                ) : null}
            </div>
            {children}
        </div>
    );
}

function TransformFields({ transform, onChange }: { transform: DirectorTransform; onChange: (transform: DirectorTransform) => void }) {
    const { t } = useTranslation("canvas");
    return (
        <>
            <Vec3Field label={t("canvas:position-2")} value={transform.position} onChange={(position) => onChange({ ...transform, position })} />
            <Vec3Field label={t("canvas:rotation")} value={transform.rotation} step={0.05} onChange={(rotation) => onChange({ ...transform, rotation })} />
            <Vec3Field label={t("canvas:scale")} value={transform.scale} step={0.1} onChange={(scale) => onChange({ ...transform, scale })} />
        </>
    );
}

function BoneRotationFields({ rotation, onChange }: { rotation: DirectorQuat; onChange: (rotation: DirectorQuat) => void }) {
    const { t } = useTranslation("canvas");
    const initialDegrees = useMemo(() => {
        const euler = new Euler().setFromQuaternion(new Quaternion(...rotation), "XYZ");
        return [euler.x, euler.y, euler.z].map((value) => Number(((value * 180) / Math.PI).toFixed(1))) as DirectorVec3;
    }, [rotation]);
    const [degrees, setDegrees] = useState<DirectorVec3>(initialDegrees);
    const lastEmittedRotation = useRef<DirectorQuat | null>(null);
    useEffect(() => {
        if (lastEmittedRotation.current && sameDirectorQuaternion(rotation, lastEmittedRotation.current)) {
            lastEmittedRotation.current = null;
            return;
        }
        setDegrees(initialDegrees);
    }, [initialDegrees, rotation]);
    const updateAxis = (index: number, value: number) => {
        const next = degrees.map((entry, entryIndex) => (entryIndex === index ? value : entry)) as DirectorVec3;
        const radians = next.map((entry) => (entry * Math.PI) / 180) as DirectorVec3;
        const nextRotation = new Quaternion().setFromEuler(new Euler(radians[0], radians[1], radians[2], "XYZ")).toArray() as DirectorQuat;
        setDegrees(next);
        lastEmittedRotation.current = nextRotation;
        onChange(nextRotation);
    };
    return (
        <Field label={t("canvas:bone-rotation-local-degrees")}>
            <div className="space-y-1.5">
                {degrees.map((value, index) => (
                    <div key={index} className="grid grid-cols-[18px_minmax(0,1fr)_48px] items-center gap-2">
                        <span className="text-[var(--fs-tiny)] font-medium opacity-65">{["X", "Y", "Z"][index]}</span>
                        <Slider className="m-0" min={-180} max={180} step={1} value={value} onChange={(next) => updateAxis(index, Array.isArray(next) ? (next[0] ?? 0) : next)} />
                        <span className="text-right text-[var(--fs-tiny)] tabular-nums opacity-65">{value.toFixed(1)}°</span>
                    </div>
                ))}
            </div>
        </Field>
    );
}

function sameDirectorQuaternion(left: DirectorQuat, right: DirectorQuat) {
    const directDistance = left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
    const inverseDistance = left.reduce((sum, value, index) => sum + Math.abs(value + right[index]), 0);
    return Math.min(directDistance, inverseDistance) < 0.0001;
}

function Vec3Field({ label, value, step = 0.1, onChange }: { label: string; value: DirectorVec3; step?: number; onChange: (value: DirectorVec3) => void }) {
    return (
        <Field label={label}>
            <div className="grid grid-cols-3 gap-1">
                {value.map((item, index) => (
                    <InputNumber key={index} className="w-full" size="small" step={step} value={Number(item.toFixed(2))} onChange={(next) => onChange(value.map((entry, itemIndex) => (itemIndex === index ? next || 0 : entry)) as DirectorVec3)} />
                ))}
            </div>
        </Field>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-[var(--fs-label)] opacity-55">{label}</span>
            {children}
        </label>
    );
}
function PanelTitle({ title, action }: { title: string; action?: ReactNode }) {
    return (
        <div className="flex h-9 items-center px-3 text-[var(--fs-tiny)] font-semibold uppercase opacity-55">
            <span className="flex-1">{title}</span>
            {action}
        </div>
    );
}
function SceneRow({ active, icon, label, onClick, onDelete }: { active?: boolean; icon: ReactElement; label: string; onClick: () => void; onDelete?: () => void }) {
    const { t } = useTranslation("canvas");
    return (
        <div className={`flex h-8 w-full items-center gap-1 px-1 text-left text-xs transition ${active ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`}>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left" onClick={onClick}>
                <span className="[&>svg]:size-3.5">{icon}</span>
                <span className="truncate">{label}</span>
            </button>
            {onDelete ? (
                <button
                    type="button"
                    aria-label={t("canvas:delete-param", { label: label })}
                    title={t("canvas:delete-param", { label: label })}
                    className="grid size-6 shrink-0 place-items-center rounded opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete();
                    }}
                >
                    <Trash2 className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}
function AddMenuButton({ label, items }: { label: string; items: MenuProps["items"] }) {
    return (
        <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}>
            <button type="button" aria-label={label} title={label} className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10">
                <Plus className="size-3.5" />
            </button>
        </Dropdown>
    );
}
function QuickAdd({ label, icon, onClick }: { label: string; icon: ReactElement; onClick: () => void }) {
    return (
        <button type="button" className="flex h-8 items-center gap-1.5 border px-2 text-[var(--fs-tiny)] transition hover:bg-black/5 dark:hover:bg-white/5" onClick={onClick}>
            <span className="[&>svg]:size-3.5">{icon}</span>
            <span className="truncate">{label}</span>
        </button>
    );
}
function IconButton({ label, disabled, children, onClick }: { label: string; disabled?: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button type="button" aria-label={label} title={label} disabled={disabled} className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={onClick}>
            {children}
        </button>
    );
}
function getPoseOptions(): Array<{ label: string; value: DirectorPose }> {
    return [
    { label: t("canvas:stand"), value: "stand" },
    { label: t("canvas:t-pose"), value: "t_pose" },
    { label: t("canvas:walk"), value: "walk" },
    { label: t("canvas:run"), value: "run" },
    { label: t("canvas:sit"), value: "sit" },
    { label: t("canvas:crouch"), value: "squat" },
    { label: t("canvas:kneel-one-knee"), value: "kneel_single" },
    { label: t("canvas:kneel"), value: "kneel_double" },
    { label: t("canvas:hands-on-hips"), value: "hands_hips" },
    { label: t("canvas:lean"), value: "lean" },
    { label: t("canvas:bow"), value: "bow" },
    { label: t("canvas:think"), value: "think" },
    { label: t("canvas:fight-stance"), value: "fight" },
    { label: t("canvas:kick"), value: "kick" },
    { label: t("canvas:throw"), value: "throw" },
    { label: t("canvas:push-in"), value: "push" },
    { label: t("canvas:wave"), value: "wave" },
    { label: t("canvas:reach-out"), value: "reach" },
    { label: t("canvas:arms-crossed"), value: "arms_crossed" },
    { label: t("canvas:check-phone"), value: "phone" },
    ];
}
function getShotSizeOptions() {
    return [
    { label: t("canvas:extreme-wide-shot"), value: "extreme_wide" },
    { label: t("canvas:wide-shot"), value: "wide" },
    { label: t("canvas:full-shot"), value: "full" },
    { label: t("canvas:medium-shot"), value: "medium" },
    { label: t("canvas:close-up"), value: "close_up" },
    { label: t("canvas:extreme-close-up"), value: "extreme_close_up" },
    ];
}
function getCameraMoveOptions() {
    return [
    { label: t("canvas:static"), value: "static" },
    { label: t("canvas:push-in"), value: "push_in" },
    { label: t("canvas:pull-out"), value: "pull_out" },
    { label: t("canvas:pan-left"), value: "pan_left" },
    { label: t("canvas:pan-right"), value: "pan_right" },
    { label: t("canvas:tilt-up"), value: "tilt_up" },
    { label: t("canvas:tilt-down"), value: "tilt_down" },
    { label: t("canvas:orbit-left"), value: "orbit_left" },
    { label: t("canvas:orbit-right"), value: "orbit_right" },
    { label: t("canvas:handheld"), value: "handheld" },
    ];
}

function cameraMoveTransform(transform: DirectorTransform, move: DirectorCameraMove): DirectorTransform {
    const [x, y, z] = transform.position;
    const offsets: Record<DirectorCameraMove, DirectorVec3> = {
        static: [0, 0, 0],
        push_in: [0, 0, -2],
        pull_out: [0, 0, 2],
        pan_left: [-2, 0, 0],
        pan_right: [2, 0, 0],
        tilt_up: [0, 1.5, 0],
        tilt_down: [0, -1.2, 0],
        orbit_left: [-2.5, 0, -1.5],
        orbit_right: [2.5, 0, -1.5],
        handheld: [0.18, 0.08, -0.15],
    };
    const offset = offsets[move];
    return { ...transform, position: [x + offset[0], y + offset[1], z + offset[2]] };
}

function focalLengthToFov(focalLength: number) {
    return (2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI;
}
