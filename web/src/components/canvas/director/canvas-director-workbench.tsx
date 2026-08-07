import { App, Button, ColorPicker, Input, InputNumber, Select, Switch } from "antd";
import { Box, BoxSelect, Camera, Circle, Cuboid, FileUp, Focus, Image as ImageIcon, LampDesk, Lightbulb, Plus, Redo2, Save, Trash2, Undo2, UserRound, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { nanoid } from "nanoid";
import type { AnimationClip } from "three";

import { DirectorViewport, type DirectorViewportHandle } from "@/components/canvas/director/director-viewport";
import { DirectorViewportDock } from "@/components/canvas/director/director-viewport-dock";
import { DirectorSequencer } from "@/components/canvas/director/director-sequencer";
import { canvasThemes } from "@/lib/canvas-theme";
import { compileDirectorPrompt } from "@/lib/canvas/director/director-prompt-compiler";
import { createDirectorActor, createDirectorBillboard, createDirectorCamera, createDirectorLight, createDirectorModel, createDirectorObject, DIRECTOR_ACTOR_COLORS, directorBoneLabel, directorPoseLabel, touchDirectorScene, upsertDirectorBoneKeyframe, upsertDirectorKeyframe } from "@/lib/canvas/director/director-scene";
import { uploadMediaFile } from "@/services/file-storage";
import { useAssetStore, type ModelAsset } from "@/stores/use-asset-store";
import { useDirectorWorkbenchStore } from "@/stores/canvas/use-director-workbench-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { DirectorCamera, DirectorCameraMove, DirectorHumanoidBone, DirectorLight, DirectorObject, DirectorPose, DirectorQuat, DirectorRig, DirectorScene, DirectorSceneOutput, DirectorShot, DirectorShotSize, DirectorTransform, DirectorVec3 } from "@/types/director";

export function CanvasDirectorWorkbench({ open, scene, imageNodes, onClose, onChange, onApply }: { open: boolean; scene: DirectorScene | null; imageNodes: CanvasNodeData[]; onClose: () => void; onChange: (scene: DirectorScene) => void; onApply: (output: DirectorSceneOutput) => Promise<void> }) {
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
    const setSelectedObjectId = useDirectorWorkbenchStore((state) => state.setSelectedObjectId);
    const setSelectedLightId = useDirectorWorkbenchStore((state) => state.setSelectedLightId);
    const setTransformMode = useDirectorWorkbenchStore((state) => state.setTransformMode);
    const setRenderMode = useDirectorWorkbenchStore((state) => state.setRenderMode);
    const setPlayhead = useDirectorWorkbenchStore((state) => state.setPlayhead);
    const setPlaying = useDirectorWorkbenchStore((state) => state.setPlaying);
    const setSelectedBone = useDirectorWorkbenchStore((state) => state.setSelectedBone);
    const setAutoKey = useDirectorWorkbenchStore((state) => state.setAutoKey);
    const setSequencerHeight = useDirectorWorkbenchStore((state) => state.setSequencerHeight);
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

    const addPrimitive = (primitive: DirectorObject["primitive"], name: string) => {
        const object = createDirectorObject(primitive, name);
        commit((current) => ({ ...current, objects: [...current.objects, object] }));
        setSelectedObjectId(object.id);
    };

    const addActor = () => {
        const actorCount = draft?.objects.filter((item) => item.kind === "actor").length || 0;
        const actor = createDirectorActor(`演员 ${actorCount + 1}`, [actorCount * 0.8, 0, 0], DIRECTOR_ACTOR_COLORS[actorCount % DIRECTOR_ACTOR_COLORS.length]);
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
        const assetId = addAsset({ kind: "model", title: file.name.replace(/\.(glb|gltf)$/i, ""), coverUrl: "", tags: ["3D模型"], source: "导演台", data: { url: uploaded.url, storageKey: uploaded.storageKey, bytes: uploaded.bytes, mimeType: uploaded.mimeType, fileName: file.name }, metadata: { source: "director" } });
        const asset = useAssetStore.getState().assets.find((item): item is ModelAsset => item.id === assetId && item.kind === "model");
        if (asset) addModelAsset(asset);
        message.success("3D 模型已加入场景和素材库");
    };

    const addBillboard = (node: CanvasNodeData) => {
        if (!node.metadata?.content) return;
        const object = createDirectorBillboard(node.title, node.metadata.content, node.metadata.storageKey, node.id);
        commit((current) => ({ ...current, objects: [...current.objects, object] }));
        setSelectedObjectId(object.id);
    };

    const addCamera = () => {
        const camera = createDirectorCamera(`摄影机 ${draft?.cameras.length ? draft.cameras.length + 1 : 1}`);
        commit((current) => ({ ...current, cameras: [...current.cameras, camera] }));
        if (activeShot) updateShot(activeShot.id, { cameraId: camera.id });
    };

    const addLight = () => {
        const light = createDirectorLight("point", `灯光 ${draft?.lights.length ? draft.lights.length + 1 : 1}`, [2, 3, 2], 1.5);
        commit((current) => ({ ...current, lights: [...current.lights, light] }));
        setSelectedLightId(light.id);
    };

    const addShot = () => {
        if (!activeCamera) return;
        const shot: DirectorShot = { id: nanoid(), name: `镜头 ${(draft?.shots.length || 0) + 1}`, cameraId: activeCamera.id, duration: 5, fps: 24, shotSize: "medium", cameraMove: "static", prompt: "" };
        commit((current) => ({ ...current, shots: [...current.shots, shot], activeShotId: shot.id }));
        setPlayhead(0);
    };

    const addObjectKeyframe = () => {
        if (!selectedObject) return;
        updateObject(selectedObject.id, { keyframes: upsertDirectorKeyframe(selectedObject.keyframes, playhead, selectedObject.transform) });
    };

    const addCameraKeyframe = () => {
        if (!activeCamera) return;
        commit((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === activeCamera.id ? { ...item, keyframes: upsertDirectorKeyframe(item.keyframes, playhead, item.transform) } : item) }));
    };

    const recordSelectedKeyframe = () => {
        if (selectedObject && selectedBone) {
            const rotation = selectedObject.boneOverrides?.[selectedBone as DirectorHumanoidBone] || [0, 0, 0, 1] as DirectorQuat;
            updateObject(selectedObject.id, { boneTracks: upsertDirectorBoneKeyframe(selectedObject.boneTracks || [], selectedBone as DirectorHumanoidBone, playhead, rotation) });
            return;
        }
        if (selectedObject) addObjectKeyframe();
        else addCameraKeyframe();
    };

    const handleObjectTransform = useCallback((id: string, transform: DirectorTransform) => {
        commit((current) => ({
            ...current,
            objects: current.objects.map((item) => item.id === id ? { ...item, transform, keyframes: autoKey ? upsertDirectorKeyframe(item.keyframes, playhead, transform) : item.keyframes } : item),
        }));
    }, [autoKey, commit, playhead]);

    const handleBoneTransform = useCallback((id: string, bone: string, rotation: DirectorQuat) => {
        commit((current) => ({
            ...current,
            objects: current.objects.map((item) => item.id === id ? {
                ...item,
                boneOverrides: { ...item.boneOverrides, [bone]: rotation },
                boneTracks: autoKey ? upsertDirectorBoneKeyframe(item.boneTracks || [], bone as DirectorHumanoidBone, playhead, rotation) : item.boneTracks,
            } : item),
        }));
    }, [autoKey, commit, playhead]);

    const handleActorRigReady = useCallback((id: string, rig: DirectorRig, animations: AnimationClip[]) => {
        replaceWithoutHistory((current) => ({
            ...current,
            objects: current.objects.map((item) => {
                if (item.id !== id) return item;
                const existing = item.motionClips || [];
                const motionClips = existing.length ? existing : animations.map((clip) => ({ id: nanoid(), name: clip.name || "动作片段", sourceAnimation: clip.name, start: 0, duration: Math.max(0.1, clip.duration), playbackRate: 1, loop: true }));
                return { ...item, rig, motionClips };
            }),
        }));
    }, [replaceWithoutHistory]);

    const applyCameraMove = () => {
        if (!activeCamera || !activeShot) return;
        const start = activeCamera.transform;
        const end = cameraMoveTransform(start, activeShot.cameraMove);
        commit((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === activeCamera.id ? { ...item, keyframes: [{ id: nanoid(), time: 0, transform: start }, { id: nanoid(), time: activeShot.duration, transform: end }] } : item) }));
        message.success("已生成相机运动关键帧");
    };

    const alignCameraToView = () => {
        if (!activeCamera) return;
        const transform = viewportRef.current?.readCameraTransform();
        if (!transform) return;
        commit((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === activeCamera.id ? { ...item, transform } : item) }));
        message.success("摄影机已对齐当前视图");
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
            message.success("导演台构图已回写画布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导演台输出失败");
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
            message.success("白膜视频已回写画布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "白膜视频导出失败");
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
                <IconButton label="关闭导演台" onClick={onClose}><X className="size-4" /></IconButton>
                <Input variant="borderless" value={draft.title} className="max-w-56 font-medium" onChange={(event) => replaceWithoutHistory((current) => ({ ...current, title: event.target.value }))} />
                <span className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                <IconButton label="撤销" disabled={!history.length} onClick={undo}><Undo2 className="size-4" /></IconButton>
                <IconButton label="重做" disabled={!future.length} onClick={redo}><Redo2 className="size-4" /></IconButton>
                <div className="ml-auto flex items-center gap-1">
                    <Select size="small" value={renderMode} className="w-24" options={[{ label: "预览", value: "beauty" }, { label: "彩色白膜", value: "clay" }, { label: "骨骼", value: "pose" }, { label: "深度", value: "depth" }, { label: "法线", value: "normal" }]} onChange={setRenderMode} />
                    <Button size="small" icon={<Video className="size-3.5" />} loading={recording} onClick={() => void exportClayVideo()}>导出白膜</Button>
                    <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void applyToCanvas()}>应用到镜头</Button>
                </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_292px] max-lg:grid-cols-[180px_minmax(0,1fr)]">
                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-r" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    <PanelTitle title="场景对象" action={<IconButton label="添加立方体" onClick={() => addPrimitive("box", "立方体")}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">
                        {draft.objects.map((object) => <SceneRow key={object.id} active={selectedObjectId === object.id} icon={object.kind === "actor" || object.primitive === "character" ? <UserRound /> : object.kind === "model" ? <BoxSelect /> : object.kind === "billboard" ? <ImageIcon /> : <Cuboid />} label={object.name} onClick={() => setSelectedObjectId(object.id)} />)}
                    </div>
                    <PanelTitle title="摄影机" action={<IconButton label="添加摄影机" onClick={addCamera}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">{draft.cameras.map((camera) => <SceneRow key={camera.id} active={activeShot.cameraId === camera.id && !selectedObjectId && !selectedLightId} icon={<Camera />} label={camera.name} onClick={() => { setSelectedObjectId(null); setSelectedLightId(null); updateShot(activeShot.id, { cameraId: camera.id }); }} />)}</div>
                    <PanelTitle title="灯光" action={<IconButton label="添加灯光" onClick={addLight}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">{draft.lights.map((light) => <SceneRow key={light.id} active={selectedLightId === light.id} icon={<Lightbulb />} label={light.name} onClick={() => setSelectedLightId(light.id)} />)}</div>
                    <PanelTitle title="快速添加" />
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-3">
                        <QuickAdd label="演员" icon={<UserRound />} onClick={addActor} />
                        <QuickAdd label="立方体" icon={<Box />} onClick={() => addPrimitive("box", "立方体")} />
                        <QuickAdd label="球体" icon={<Circle />} onClick={() => addPrimitive("sphere", "球体")} />
                        <QuickAdd label="圆柱" icon={<Cuboid />} onClick={() => addPrimitive("cylinder", "圆柱")} />
                        <QuickAdd label="上传模型" icon={<FileUp />} onClick={() => modelInputRef.current?.click()} />
                        <QuickAdd label="添加灯光" icon={<LampDesk />} onClick={addLight} />
                    </div>
                    {modelAssets.length ? <><PanelTitle title="3D 素材" /><div className="px-2 pb-3">{modelAssets.map((asset) => <SceneRow key={asset.id} icon={<BoxSelect />} label={asset.title} onClick={() => addModelAsset(asset)} />)}</div></> : null}
                    {imageNodes.length ? <><PanelTitle title="画布图片立牌" /><div className="px-2 pb-3">{imageNodes.slice(0, 20).map((node) => <SceneRow key={node.id} icon={<ImageIcon />} label={node.title} onClick={() => addBillboard(node)} />)}</div></> : null}
                    <input ref={modelInputRef} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" className="hidden" onChange={(event) => { void uploadModel(event.target.files?.[0]); event.currentTarget.value = ""; }} />
                </aside>

                <main className="relative min-h-0 overflow-hidden bg-neutral-900">
                    <DirectorViewport ref={viewportRef} scene={draft} selectedObjectId={selectedObjectId} selectedBone={selectedBone} transformMode={transformMode} renderMode={renderMode} playhead={playhead} onSelectObject={setSelectedObjectId} onSelectBone={setSelectedBone} onObjectTransform={handleObjectTransform} onBoneTransform={handleBoneTransform} onActorRigReady={handleActorRigReady} />
                    <div className="pointer-events-none absolute left-3 top-3 text-[var(--fs-tiny)] font-medium text-white/70">{activeShot.name} · {activeCamera?.name || "无摄影机"} · {activeShot.duration}s</div>
                    <DirectorViewportDock transformMode={transformMode} renderMode={renderMode} onTransformModeChange={setTransformMode} onRenderModeChange={setRenderMode} onAddActor={addActor} onAddBox={() => addPrimitive("box", "立方体")} onAddLight={addLight} onAddCamera={addCamera} onAlignCamera={alignCameraToView} />
                </main>

                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-l max-lg:hidden" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    {selectedObject ? <ObjectInspector object={selectedObject} playhead={playhead} selectedBone={selectedBone} onSelectBone={setSelectedBone} onUpdate={(patch) => updateObject(selectedObject.id, patch)} onAddKeyframe={recordSelectedKeyframe} onDelete={() => { commit((current) => ({ ...current, objects: current.objects.filter((item) => item.id !== selectedObject.id) })); setSelectedObjectId(null); }} /> : selectedLight ? <LightInspector light={selectedLight} onUpdate={(patch) => updateLight(selectedLight.id, patch)} onDelete={() => { commit((current) => ({ ...current, lights: current.lights.filter((item) => item.id !== selectedLight.id) })); setSelectedLightId(null); }} /> : <ShotInspector shot={activeShot} camera={activeCamera} cameras={draft.cameras} onUpdateShot={(patch) => updateShot(activeShot.id, patch)} onUpdateCamera={(patch) => activeCamera && commit((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === activeCamera.id ? { ...item, ...patch } : item) }))} onAddCameraKeyframe={addCameraKeyframe} onApplyCameraMove={applyCameraMove} onAlignCameraToView={alignCameraToView} onExportClay={exportClayVideo} recording={recording} />}
                </aside>
            </div>

            <DirectorSequencer scene={draft} shot={activeShot} camera={activeCamera} objects={draft.objects} selectedObjectId={selectedObjectId} selectedBone={selectedBone} playhead={playhead} playing={playing} autoKey={autoKey} height={sequencerHeight} onPlayToggle={() => setPlaying(!playing)} onPlayheadChange={setPlayhead} onAutoKeyChange={setAutoKey} onHeightChange={setSequencerHeight} onSelectObject={setSelectedObjectId} onSelectBone={setSelectedBone} onRecordKeyframe={recordSelectedKeyframe} onAddShot={addShot} onSelectShot={(id) => { commit((current) => ({ ...current, activeShotId: id })); setPlayhead(0); }} />
        </div>
    );
}

function ObjectInspector({ object, playhead, selectedBone, onSelectBone, onUpdate, onAddKeyframe, onDelete }: { object: DirectorObject; playhead: number; selectedBone: string | null; onSelectBone: (bone: string | null) => void; onUpdate: (patch: Partial<DirectorObject>) => void; onAddKeyframe: () => void; onDelete: () => void }) {
    const motionClips = object.motionClips || [];
    const activeMotionClip = motionClips.find((clip) => clip.id === object.activeMotionClipId);
    const mappedBones = Object.keys(object.rig?.boneMap || {}) as DirectorHumanoidBone[];
    const updateActiveMotion = (patch: Partial<NonNullable<DirectorObject["motionClips"]>[number]>) => activeMotionClip && onUpdate({ motionClips: motionClips.map((clip) => clip.id === activeMotionClip.id ? { ...clip, ...patch } : clip) });
    const applyPose = (pose: DirectorPose) => onUpdate({ pose, activeMotionClipId: undefined, boneOverrides: {} });
    return <Inspector title={object.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}>
        <TransformFields transform={object.transform} onChange={(transform) => onUpdate({ transform })} />
        {object.kind === "actor" || object.primitive === "character"
            ? <Field label="角色颜色"><div className="director-actor-colors">{DIRECTOR_ACTOR_COLORS.map((color) => <button key={color} type="button" className={`director-actor-color ${object.color.toLowerCase() === color ? "is-active" : ""}`} style={{ background: color }} aria-label={`设置颜色 ${color}`} onClick={() => onUpdate({ color })} />)}<ColorPicker value={object.color} size="small" onChange={(_, color) => onUpdate({ color })} /></div></Field>
            : <Field label="颜色"><ColorPicker value={object.color} onChange={(_, color) => onUpdate({ color })} /></Field>}
        {object.kind === "actor" || object.primitive === "character" || motionClips.length ? <>
            <section className="director-pose-section">
                <div className="director-inspector-section-title"><span>姿势预设</span><span>{directorPoseLabel(object.pose || "stand")}</span></div>
                <div className="director-pose-grid">{poseOptions.map((option) => <button key={option.value} type="button" className={`director-pose-button ${object.pose === option.value && !object.activeMotionClipId ? "is-active" : ""}`} title={option.label} onClick={() => applyPose(option.value)}>{option.label}</button>)}</div>
            </section>
            <div className="flex items-center justify-between border-y py-2 text-[var(--fs-label)]"><span>角色绑定</span><span className="opacity-55">{object.rig?.status === "ready" ? `${mappedBones.length} 根骨骼` : "等待模型"}</span></div>
            {motionClips.length ? <><Field label="动作片段"><Select className="w-full" value={object.activeMotionClipId || ""} options={[{ label: "静态姿势", value: "" }, ...motionClips.map((clip) => ({ label: clip.name, value: clip.id }))]} onChange={(activeMotionClipId) => onUpdate({ activeMotionClipId: activeMotionClipId || undefined })} /></Field>{activeMotionClip ? <div className="grid grid-cols-2 gap-2"><Field label="播放速度"><InputNumber className="w-full" min={0.1} max={4} step={0.1} value={activeMotionClip.playbackRate} onChange={(playbackRate) => updateActiveMotion({ playbackRate: playbackRate || 1 })} /></Field><Field label="循环"><Switch checked={activeMotionClip.loop} onChange={(loop) => updateActiveMotion({ loop })} /></Field></div> : null}</> : <div className="text-[var(--fs-tiny)] opacity-50">模型加载后会显示可用动作 Clip</div>}
            {mappedBones.length ? <Field label="骨骼控制"><Select className="w-full" allowClear value={selectedBone || undefined} options={mappedBones.map((bone) => ({ label: directorBoneLabel(bone), value: bone }))} onChange={(bone) => onSelectBone(bone || null)} /></Field> : null}
        </> : null}
        <Field label="可见"><Switch checked={object.visible} onChange={(visible) => onUpdate({ visible })} /></Field>
        <Field label="投射阴影"><Switch checked={object.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} /></Field>
        <Button block icon={<Focus className="size-3.5" />} onClick={onAddKeyframe}>{selectedBone ? `在 ${playhead.toFixed(1)}s 记录骨骼` : `在 ${playhead.toFixed(1)}s 记录关键帧`}</Button>
        <div className="text-[var(--fs-tiny)] opacity-50">Transform {object.keyframes.length} 个 · 骨骼 {object.boneTracks?.reduce((sum, track) => sum + track.keyframes.length, 0) || 0} 个</div>
    </Inspector>;
}

function LightInspector({ light, onUpdate, onDelete }: { light: DirectorLight; onUpdate: (patch: Partial<DirectorLight>) => void; onDelete: () => void }) {
    return <Inspector title={light.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}><Field label="类型"><Select className="w-full" value={light.type} options={[{ label: "方向光", value: "directional" }, { label: "点光源", value: "point" }, { label: "聚光灯", value: "spot" }, { label: "环境光", value: "ambient" }]} onChange={(type) => onUpdate({ type })} /></Field><Vec3Field label="位置" value={light.transform.position} onChange={(position) => onUpdate({ transform: { ...light.transform, position } })} /><Field label="颜色"><ColorPicker value={light.color} onChange={(_, color) => onUpdate({ color })} /></Field><Field label="强度"><InputNumber className="w-full" min={0} max={20} step={0.1} value={light.intensity} onChange={(value) => onUpdate({ intensity: value || 0 })} /></Field><Field label="投射阴影"><Switch checked={light.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} /></Field></Inspector>;
}

function ShotInspector({ shot, camera, cameras, onUpdateShot, onUpdateCamera, onAddCameraKeyframe, onApplyCameraMove, onAlignCameraToView, onExportClay, recording }: { shot: DirectorShot; camera: DirectorCamera | null; cameras: DirectorScene["cameras"]; onUpdateShot: (patch: Partial<DirectorShot>) => void; onUpdateCamera: (patch: Partial<DirectorCamera>) => void; onAddCameraKeyframe: () => void; onApplyCameraMove: () => void; onAlignCameraToView: () => void; onExportClay: () => void; recording: boolean }) {
    return <Inspector title={shot.name} onTitleChange={(name) => onUpdateShot({ name })}>
        <Field label="摄影机"><Select className="w-full" value={shot.cameraId} options={cameras.map((item) => ({ label: item.name, value: item.id }))} onChange={(cameraId) => onUpdateShot({ cameraId })} /></Field>
        <div className="grid grid-cols-2 gap-2"><Field label="景别"><Select className="w-full" value={shot.shotSize} options={shotSizeOptions} onChange={(shotSize: DirectorShotSize) => onUpdateShot({ shotSize })} /></Field><Field label="帧率"><Select className="w-full" value={shot.fps} options={[24, 25, 30].map((fps) => ({ label: `${fps} fps`, value: fps }))} onChange={(fps: 24 | 25 | 30) => onUpdateShot({ fps })} /></Field></div>
        <Field label="运镜"><Select className="w-full" value={shot.cameraMove} options={cameraMoveOptions} onChange={(cameraMove: DirectorCameraMove) => onUpdateShot({ cameraMove })} /></Field>
        <Field label="时长"><InputNumber className="w-full" min={0.5} max={60} step={0.5} value={shot.duration} addonAfter="秒" onChange={(value) => onUpdateShot({ duration: value || 5 })} /></Field>
        <Field label="镜头意图"><Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} value={shot.prompt} placeholder="人物表演、动作、叙事目标…" onChange={(event) => onUpdateShot({ prompt: event.target.value })} /></Field>
        {camera ? <><Vec3Field label="摄影机位置" value={camera.transform.position} onChange={(position) => onUpdateCamera({ transform: { ...camera.transform, position } })} /><Vec3Field label="焦点" value={camera.target} onChange={(target) => onUpdateCamera({ target })} /><Field label="焦距"><InputNumber className="w-full" min={12} max={200} value={camera.focalLength} addonAfter="mm" onChange={(focalLength) => onUpdateCamera({ focalLength: focalLength || 35, fov: focalLengthToFov(focalLength || 35) })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="光圈"><InputNumber className="w-full" min={0.7} max={32} step={0.1} value={camera.aperture} addonBefore="f/" onChange={(aperture) => onUpdateCamera({ aperture: aperture || 2.8 })} /></Field><Field label="焦点距离"><InputNumber className="w-full" min={0.1} max={200} step={0.1} value={camera.focusDistance} addonAfter="m" onChange={(focusDistance) => onUpdateCamera({ focusDistance: focusDistance || 5 })} /></Field></div><Button block icon={<Camera className="size-3.5" />} onClick={onAlignCameraToView}>摄影机对齐当前视图</Button><Button block icon={<Video className="size-3.5" />} onClick={onApplyCameraMove}>按运镜生成轨迹</Button><Button block icon={<Focus className="size-3.5" />} onClick={onAddCameraKeyframe}>记录摄影机关键帧</Button><Button block type="primary" ghost icon={<Video className="size-3.5" />} loading={recording} onClick={onExportClay}>导出白膜视频</Button></> : null}
    </Inspector>;
}

function Inspector({ title, children, onTitleChange, onDelete }: { title: string; children: ReactNode; onTitleChange: (value: string) => void; onDelete?: () => void }) {
    return <div className="space-y-3 p-3"><div className="flex items-center gap-2"><Input variant="borderless" value={title} className="min-w-0 flex-1 px-0 font-medium" onChange={(event) => onTitleChange(event.target.value)} />{onDelete ? <IconButton label="删除" onClick={onDelete}><Trash2 className="size-4" /></IconButton> : null}</div>{children}</div>;
}

function TransformFields({ transform, onChange }: { transform: DirectorTransform; onChange: (transform: DirectorTransform) => void }) {
    return <><Vec3Field label="位置" value={transform.position} onChange={(position) => onChange({ ...transform, position })} /><Vec3Field label="旋转" value={transform.rotation} step={0.05} onChange={(rotation) => onChange({ ...transform, rotation })} /><Vec3Field label="缩放" value={transform.scale} step={0.1} onChange={(scale) => onChange({ ...transform, scale })} /></>;
}

function Vec3Field({ label, value, step = 0.1, onChange }: { label: string; value: DirectorVec3; step?: number; onChange: (value: DirectorVec3) => void }) {
    return <Field label={label}><div className="grid grid-cols-3 gap-1">{value.map((item, index) => <InputNumber key={index} className="w-full" size="small" step={step} value={Number(item.toFixed(2))} onChange={(next) => onChange(value.map((entry, itemIndex) => itemIndex === index ? next || 0 : entry) as DirectorVec3)} />)}</div></Field>;
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1 block text-[var(--fs-label)] opacity-55">{label}</span>{children}</label>; }
function PanelTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="flex h-9 items-center px-3 text-[var(--fs-tiny)] font-semibold uppercase opacity-55"><span className="flex-1">{title}</span>{action}</div>; }
function SceneRow({ active, icon, label, onClick }: { active?: boolean; icon: ReactElement; label: string; onClick: () => void }) { return <button type="button" className={`flex h-8 w-full items-center gap-2 px-2 text-left text-xs transition ${active ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`} onClick={onClick}><span className="[&>svg]:size-3.5">{icon}</span><span className="truncate">{label}</span></button>; }
function QuickAdd({ label, icon, onClick }: { label: string; icon: ReactElement; onClick: () => void }) { return <button type="button" className="flex h-8 items-center gap-1.5 border px-2 text-[var(--fs-tiny)] transition hover:bg-black/5 dark:hover:bg-white/5" onClick={onClick}><span className="[&>svg]:size-3.5">{icon}</span><span className="truncate">{label}</span></button>; }
function IconButton({ label, disabled, children, onClick }: { label: string; disabled?: boolean; children: ReactNode; onClick: () => void }) { return <button type="button" aria-label={label} title={label} disabled={disabled} className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={onClick}>{children}</button>; }
const poseOptions: Array<{ label: string; value: DirectorPose }> = [
    { label: "站立", value: "stand" }, { label: "T 型", value: "t_pose" }, { label: "行走", value: "walk" }, { label: "跑步", value: "run" },
    { label: "坐姿", value: "sit" }, { label: "蹲下", value: "squat" }, { label: "单膝跪", value: "kneel_single" }, { label: "双膝跪", value: "kneel_double" },
    { label: "叉腰", value: "hands_hips" }, { label: "倚靠", value: "lean" }, { label: "鞠躬", value: "bow" }, { label: "思考", value: "think" },
    { label: "格斗", value: "fight" }, { label: "踢球", value: "kick" }, { label: "投掷", value: "throw" }, { label: "推进", value: "push" },
    { label: "招手", value: "wave" }, { label: "伸手", value: "reach" }, { label: "抱臂", value: "arms_crossed" }, { label: "看手机", value: "phone" },
];
const shotSizeOptions = [{ label: "大远景", value: "extreme_wide" }, { label: "远景", value: "wide" }, { label: "全身景", value: "full" }, { label: "中景", value: "medium" }, { label: "近景", value: "close_up" }, { label: "大特写", value: "extreme_close_up" }];
const cameraMoveOptions = [{ label: "固定", value: "static" }, { label: "推进", value: "push_in" }, { label: "拉远", value: "pull_out" }, { label: "左摇", value: "pan_left" }, { label: "右摇", value: "pan_right" }, { label: "上摇", value: "tilt_up" }, { label: "下摇", value: "tilt_down" }, { label: "左环绕", value: "orbit_left" }, { label: "右环绕", value: "orbit_right" }, { label: "手持", value: "handheld" }];

function cameraMoveTransform(transform: DirectorTransform, move: DirectorCameraMove): DirectorTransform {
    const [x, y, z] = transform.position;
    const offsets: Record<DirectorCameraMove, DirectorVec3> = { static: [0, 0, 0], push_in: [0, 0, -2], pull_out: [0, 0, 2], pan_left: [-2, 0, 0], pan_right: [2, 0, 0], tilt_up: [0, 1.5, 0], tilt_down: [0, -1.2, 0], orbit_left: [-2.5, 0, -1.5], orbit_right: [2.5, 0, -1.5], handheld: [0.18, 0.08, -0.15] };
    const offset = offsets[move];
    return { ...transform, position: [x + offset[0], y + offset[1], z + offset[2]] };
}

function focalLengthToFov(focalLength: number) { return (2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI; }
