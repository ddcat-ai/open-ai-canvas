import { App, Button, ColorPicker, Input, InputNumber, Select, Slider, Switch } from "antd";
import { Box, BoxSelect, Camera, Circle, Cuboid, FileUp, Focus, Image as ImageIcon, LampDesk, Lightbulb, Move3D, Pause, Play, Plus, Redo2, Rotate3D, Save, Scaling, Trash2, Undo2, UserRound, Video, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { nanoid } from "nanoid";

import { DirectorViewport, type DirectorViewportHandle } from "@/components/canvas/director/director-viewport";
import { canvasThemes } from "@/lib/canvas-theme";
import { compileDirectorPrompt } from "@/lib/canvas/director/director-prompt-compiler";
import { createDirectorBillboard, createDirectorCamera, createDirectorLight, createDirectorModel, createDirectorObject, touchDirectorScene, upsertDirectorKeyframe } from "@/lib/canvas/director/director-scene";
import { uploadMediaFile } from "@/services/file-storage";
import { useAssetStore, type ModelAsset } from "@/stores/use-asset-store";
import { useDirectorWorkbenchStore } from "@/stores/canvas/use-director-workbench-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasNodeData } from "@/types/canvas";
import type { DirectorCamera, DirectorCameraMove, DirectorLight, DirectorObject, DirectorScene, DirectorSceneOutput, DirectorShot, DirectorShotSize, DirectorTransform, DirectorVec3 } from "@/types/director";

export function CanvasDirectorWorkbench({ open, scene, imageNodes, onClose, onChange, onApply }: { open: boolean; scene: DirectorScene | null; imageNodes: CanvasNodeData[]; onClose: () => void; onChange: (scene: DirectorScene) => void; onApply: (output: DirectorSceneOutput) => Promise<void> }) {
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const viewportRef = useRef<DirectorViewportHandle>(null);
    const modelInputRef = useRef<HTMLInputElement>(null);
    const [draft, setDraft] = useState<DirectorScene | null>(null);
    const [history, setHistory] = useState<DirectorScene[]>([]);
    const [future, setFuture] = useState<DirectorScene[]>([]);
    const [saving, setSaving] = useState(false);
    const selectedObjectId = useDirectorWorkbenchStore((state) => state.selectedObjectId);
    const selectedLightId = useDirectorWorkbenchStore((state) => state.selectedLightId);
    const transformMode = useDirectorWorkbenchStore((state) => state.transformMode);
    const renderMode = useDirectorWorkbenchStore((state) => state.renderMode);
    const playhead = useDirectorWorkbenchStore((state) => state.playhead);
    const playing = useDirectorWorkbenchStore((state) => state.playing);
    const setSelectedObjectId = useDirectorWorkbenchStore((state) => state.setSelectedObjectId);
    const setSelectedLightId = useDirectorWorkbenchStore((state) => state.setSelectedLightId);
    const setTransformMode = useDirectorWorkbenchStore((state) => state.setTransformMode);
    const setRenderMode = useDirectorWorkbenchStore((state) => state.setRenderMode);
    const setPlayhead = useDirectorWorkbenchStore((state) => state.setPlayhead);
    const setPlaying = useDirectorWorkbenchStore((state) => state.setPlaying);
    const resetWorkbench = useDirectorWorkbenchStore((state) => state.reset);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const modelAssets = useMemo(() => assets.filter((asset): asset is ModelAsset => asset.kind === "model"), [assets]);

    useEffect(() => {
        if (!open || !scene) return;
        setDraft(structuredClone(scene));
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
        const shot: DirectorShot = { id: nanoid(), name: `镜头 ${(draft?.shots.length || 0) + 1}`, cameraId: activeCamera.id, duration: 5, shotSize: "medium", cameraMove: "static", prompt: "" };
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
            const depth = await viewportRef.current.capture("depth");
            const normal = await viewportRef.current.capture("normal");
            const prompt = compileDirectorPrompt(draft, activeShot);
            const next = touchDirectorScene(draft);
            setDraft(next);
            onChange(next);
            await onApply({ scene: next, shot: activeShot, prompt, beauty, depth, normal });
            message.success("镜头已回写画布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导演台输出失败");
        } finally {
            setSaving(false);
        }
    };

    if (!open || !draft || !activeShot) return null;

    return (
        <div data-canvas-no-zoom className="fixed inset-0 z-[500] flex min-h-0 flex-col overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <IconButton label="关闭导演台" onClick={onClose}><X className="size-4" /></IconButton>
                <Input variant="borderless" value={draft.title} className="max-w-56 font-medium" onChange={(event) => replaceWithoutHistory((current) => ({ ...current, title: event.target.value }))} />
                <span className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                <IconButton label="撤销" disabled={!history.length} onClick={undo}><Undo2 className="size-4" /></IconButton>
                <IconButton label="重做" disabled={!future.length} onClick={redo}><Redo2 className="size-4" /></IconButton>
                <span className="h-5 w-px" style={{ background: theme.toolbar.border }} />
                <ToolButton label="移动" active={transformMode === "translate"} onClick={() => setTransformMode("translate")}><Move3D className="size-4" /></ToolButton>
                <ToolButton label="旋转" active={transformMode === "rotate"} onClick={() => setTransformMode("rotate")}><Rotate3D className="size-4" /></ToolButton>
                <ToolButton label="缩放" active={transformMode === "scale"} onClick={() => setTransformMode("scale")}><Scaling className="size-4" /></ToolButton>
                <div className="ml-auto flex items-center gap-1">
                    <Select size="small" value={renderMode} className="w-24" options={[{ label: "预览", value: "beauty" }, { label: "深度", value: "depth" }, { label: "法线", value: "normal" }]} onChange={setRenderMode} />
                    <Button size="small" type="primary" icon={<Save className="size-3.5" />} loading={saving} onClick={() => void applyToCanvas()}>应用到镜头</Button>
                </div>
            </header>

            <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)_292px] max-lg:grid-cols-[180px_minmax(0,1fr)]">
                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-r" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    <PanelTitle title="场景对象" action={<IconButton label="添加立方体" onClick={() => addPrimitive("box", "立方体")}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">
                        {draft.objects.map((object) => <SceneRow key={object.id} active={selectedObjectId === object.id} icon={object.primitive === "character" ? <UserRound /> : object.kind === "model" ? <BoxSelect /> : object.kind === "billboard" ? <ImageIcon /> : <Cuboid />} label={object.name} onClick={() => setSelectedObjectId(object.id)} />)}
                    </div>
                    <PanelTitle title="摄影机" action={<IconButton label="添加摄影机" onClick={addCamera}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">{draft.cameras.map((camera) => <SceneRow key={camera.id} active={activeShot.cameraId === camera.id && !selectedObjectId && !selectedLightId} icon={<Camera />} label={camera.name} onClick={() => { setSelectedObjectId(null); setSelectedLightId(null); updateShot(activeShot.id, { cameraId: camera.id }); }} />)}</div>
                    <PanelTitle title="灯光" action={<IconButton label="添加灯光" onClick={addLight}><Plus className="size-3.5" /></IconButton>} />
                    <div className="px-2 pb-2">{draft.lights.map((light) => <SceneRow key={light.id} active={selectedLightId === light.id} icon={<Lightbulb />} label={light.name} onClick={() => setSelectedLightId(light.id)} />)}</div>
                    <PanelTitle title="快速添加" />
                    <div className="grid grid-cols-2 gap-1.5 px-2 pb-3">
                        <QuickAdd label="演员" icon={<UserRound />} onClick={() => addPrimitive("character", "演员")} />
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
                    <DirectorViewport ref={viewportRef} scene={draft} selectedObjectId={selectedObjectId} transformMode={transformMode} renderMode={renderMode} playhead={playhead} onSelectObject={setSelectedObjectId} onObjectTransform={(id, transform) => updateObject(id, { transform })} />
                    <div className="pointer-events-none absolute left-3 top-3 text-[10px] font-medium text-white/70">{activeShot.name} · {activeCamera?.name || "无摄影机"} · {activeShot.duration}s</div>
                </main>

                <aside className="thin-scrollbar min-h-0 overflow-y-auto border-l max-lg:hidden" style={{ background: theme.node.panel, borderColor: theme.toolbar.border }}>
                    {selectedObject ? <ObjectInspector object={selectedObject} playhead={playhead} onUpdate={(patch) => updateObject(selectedObject.id, patch)} onAddKeyframe={addObjectKeyframe} onDelete={() => { commit((current) => ({ ...current, objects: current.objects.filter((item) => item.id !== selectedObject.id) })); setSelectedObjectId(null); }} /> : selectedLight ? <LightInspector light={selectedLight} onUpdate={(patch) => updateLight(selectedLight.id, patch)} onDelete={() => { commit((current) => ({ ...current, lights: current.lights.filter((item) => item.id !== selectedLight.id) })); setSelectedLightId(null); }} /> : <ShotInspector shot={activeShot} camera={activeCamera} cameras={draft.cameras} onUpdateShot={(patch) => updateShot(activeShot.id, patch)} onUpdateCamera={(patch) => activeCamera && commit((current) => ({ ...current, cameras: current.cameras.map((item) => item.id === activeCamera.id ? { ...item, ...patch } : item) }))} onAddCameraKeyframe={addCameraKeyframe} onApplyCameraMove={applyCameraMove} onAlignCameraToView={alignCameraToView} />}
                </aside>
            </div>

            <footer className="shrink-0 border-t px-3 py-2" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                <div className="flex items-center gap-2">
                    <IconButton label={playing ? "暂停" : "播放"} onClick={() => setPlaying(!playing)}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</IconButton>
                    <span className="w-12 text-right text-[11px] tabular-nums">{playhead.toFixed(1)}s</span>
                    <Slider className="min-w-0 flex-1" min={0} max={activeShot.duration} step={0.05} value={playhead} onChange={setPlayhead} />
                    <Button size="small" type="text" icon={<Focus className="size-3.5" />} onClick={selectedObject ? addObjectKeyframe : addCameraKeyframe}>记录关键帧</Button>
                </div>
                <div className="mt-1.5 flex gap-1 overflow-x-auto">
                    {draft.shots.map((shot, index) => <button key={shot.id} type="button" className="h-8 min-w-28 shrink-0 border-l-2 px-2 text-left text-[11px] transition" style={{ borderColor: draft.activeShotId === shot.id ? theme.node.activeStroke : theme.toolbar.border, background: draft.activeShotId === shot.id ? theme.toolbar.itemHover : "transparent" }} onClick={() => { commit((current) => ({ ...current, activeShotId: shot.id })); setPlayhead(0); }}><span className="block truncate">{index + 1}. {shot.name}</span><span className="block opacity-45">{shot.duration}s</span></button>)}
                    <button type="button" className="grid h-8 w-9 shrink-0 place-items-center" title="新增镜头" onClick={addShot}><Plus className="size-4" /></button>
                </div>
            </footer>
        </div>
    );
}

function ObjectInspector({ object, playhead, onUpdate, onAddKeyframe, onDelete }: { object: DirectorObject; playhead: number; onUpdate: (patch: Partial<DirectorObject>) => void; onAddKeyframe: () => void; onDelete: () => void }) {
    return <Inspector title={object.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}><TransformFields transform={object.transform} onChange={(transform) => onUpdate({ transform })} /><Field label="颜色"><ColorPicker value={object.color} onChange={(_, color) => onUpdate({ color })} /></Field>{object.primitive === "character" ? <Field label="姿势"><Select className="w-full" value={object.pose} options={poseOptions} onChange={(pose) => onUpdate({ pose })} /></Field> : null}<Field label="可见"><Switch checked={object.visible} onChange={(visible) => onUpdate({ visible })} /></Field><Field label="投射阴影"><Switch checked={object.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} /></Field><Button block icon={<Focus className="size-3.5" />} onClick={onAddKeyframe}>在 {playhead.toFixed(1)}s 记录关键帧</Button><div className="text-[10px] opacity-50">已记录 {object.keyframes.length} 个关键帧</div></Inspector>;
}

function LightInspector({ light, onUpdate, onDelete }: { light: DirectorLight; onUpdate: (patch: Partial<DirectorLight>) => void; onDelete: () => void }) {
    return <Inspector title={light.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}><Field label="类型"><Select className="w-full" value={light.type} options={[{ label: "方向光", value: "directional" }, { label: "点光源", value: "point" }, { label: "聚光灯", value: "spot" }, { label: "环境光", value: "ambient" }]} onChange={(type) => onUpdate({ type })} /></Field><Vec3Field label="位置" value={light.transform.position} onChange={(position) => onUpdate({ transform: { ...light.transform, position } })} /><Field label="颜色"><ColorPicker value={light.color} onChange={(_, color) => onUpdate({ color })} /></Field><Field label="强度"><InputNumber className="w-full" min={0} max={20} step={0.1} value={light.intensity} onChange={(value) => onUpdate({ intensity: value || 0 })} /></Field><Field label="投射阴影"><Switch checked={light.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} /></Field></Inspector>;
}

function ShotInspector({ shot, camera, cameras, onUpdateShot, onUpdateCamera, onAddCameraKeyframe, onApplyCameraMove, onAlignCameraToView }: { shot: DirectorShot; camera: DirectorCamera | null; cameras: DirectorScene["cameras"]; onUpdateShot: (patch: Partial<DirectorShot>) => void; onUpdateCamera: (patch: Partial<DirectorCamera>) => void; onAddCameraKeyframe: () => void; onApplyCameraMove: () => void; onAlignCameraToView: () => void }) {
    return <Inspector title={shot.name} onTitleChange={(name) => onUpdateShot({ name })}><Field label="摄影机"><Select className="w-full" value={shot.cameraId} options={cameras.map((item) => ({ label: item.name, value: item.id }))} onChange={(cameraId) => onUpdateShot({ cameraId })} /></Field><Field label="景别"><Select className="w-full" value={shot.shotSize} options={shotSizeOptions} onChange={(shotSize: DirectorShotSize) => onUpdateShot({ shotSize })} /></Field><Field label="运镜"><Select className="w-full" value={shot.cameraMove} options={cameraMoveOptions} onChange={(cameraMove: DirectorCameraMove) => onUpdateShot({ cameraMove })} /></Field><Field label="时长"><InputNumber className="w-full" min={0.5} max={60} step={0.5} value={shot.duration} addonAfter="秒" onChange={(value) => onUpdateShot({ duration: value || 5 })} /></Field><Field label="镜头意图"><Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} value={shot.prompt} placeholder="人物表演、动作、叙事目标…" onChange={(event) => onUpdateShot({ prompt: event.target.value })} /></Field>{camera ? <><Vec3Field label="摄影机位置" value={camera.transform.position} onChange={(position) => onUpdateCamera({ transform: { ...camera.transform, position } })} /><Vec3Field label="焦点" value={camera.target} onChange={(target) => onUpdateCamera({ target })} /><Field label="焦距"><InputNumber className="w-full" min={12} max={200} value={camera.focalLength} addonAfter="mm" onChange={(focalLength) => onUpdateCamera({ focalLength: focalLength || 35, fov: focalLengthToFov(focalLength || 35) })} /></Field><div className="grid grid-cols-2 gap-2"><Field label="光圈"><InputNumber className="w-full" min={0.7} max={32} step={0.1} value={camera.aperture} addonBefore="f/" onChange={(aperture) => onUpdateCamera({ aperture: aperture || 2.8 })} /></Field><Field label="焦点距离"><InputNumber className="w-full" min={0.1} max={200} step={0.1} value={camera.focusDistance} addonAfter="m" onChange={(focusDistance) => onUpdateCamera({ focusDistance: focusDistance || 5 })} /></Field></div><Button block icon={<Camera className="size-3.5" />} onClick={onAlignCameraToView}>摄影机对齐当前视图</Button><Button block icon={<Video className="size-3.5" />} onClick={onApplyCameraMove}>按运镜生成轨迹</Button><Button block icon={<Focus className="size-3.5" />} onClick={onAddCameraKeyframe}>记录摄影机关键帧</Button></> : null}</Inspector>;
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

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="block"><span className="mb-1 block text-[11px] opacity-55">{label}</span>{children}</label>; }
function PanelTitle({ title, action }: { title: string; action?: ReactNode }) { return <div className="flex h-9 items-center px-3 text-[10px] font-semibold uppercase opacity-55"><span className="flex-1">{title}</span>{action}</div>; }
function SceneRow({ active, icon, label, onClick }: { active?: boolean; icon: ReactElement; label: string; onClick: () => void }) { return <button type="button" className={`flex h-8 w-full items-center gap-2 px-2 text-left text-xs transition ${active ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`} onClick={onClick}><span className="[&>svg]:size-3.5">{icon}</span><span className="truncate">{label}</span></button>; }
function QuickAdd({ label, icon, onClick }: { label: string; icon: ReactElement; onClick: () => void }) { return <button type="button" className="flex h-8 items-center gap-1.5 border px-2 text-[10px] transition hover:bg-black/5 dark:hover:bg-white/5" onClick={onClick}><span className="[&>svg]:size-3.5">{icon}</span><span className="truncate">{label}</span></button>; }
function IconButton({ label, disabled, children, onClick }: { label: string; disabled?: boolean; children: ReactNode; onClick: () => void }) { return <button type="button" aria-label={label} title={label} disabled={disabled} className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={onClick}>{children}</button>; }
function ToolButton({ label, active, children, onClick }: { label: string; active: boolean; children: ReactNode; onClick: () => void }) { return <button type="button" aria-label={label} title={label} className={`grid size-8 place-items-center rounded-md transition ${active ? "bg-black text-white dark:bg-white dark:text-black" : "hover:bg-black/5 dark:hover:bg-white/10"}`} onClick={onClick}>{children}</button>; }

const poseOptions = [{ label: "自然", value: "neutral" }, { label: "站立", value: "stand" }, { label: "行走", value: "walk" }, { label: "奔跑", value: "run" }, { label: "坐姿", value: "sit" }, { label: "动作", value: "action" }];
const shotSizeOptions = [{ label: "大远景", value: "extreme_wide" }, { label: "远景", value: "wide" }, { label: "全身景", value: "full" }, { label: "中景", value: "medium" }, { label: "近景", value: "close_up" }, { label: "大特写", value: "extreme_close_up" }];
const cameraMoveOptions = [{ label: "固定", value: "static" }, { label: "推进", value: "push_in" }, { label: "拉远", value: "pull_out" }, { label: "左摇", value: "pan_left" }, { label: "右摇", value: "pan_right" }, { label: "上摇", value: "tilt_up" }, { label: "下摇", value: "tilt_down" }, { label: "左环绕", value: "orbit_left" }, { label: "右环绕", value: "orbit_right" }, { label: "手持", value: "handheld" }];

function cameraMoveTransform(transform: DirectorTransform, move: DirectorCameraMove): DirectorTransform {
    const [x, y, z] = transform.position;
    const offsets: Record<DirectorCameraMove, DirectorVec3> = { static: [0, 0, 0], push_in: [0, 0, -2], pull_out: [0, 0, 2], pan_left: [-2, 0, 0], pan_right: [2, 0, 0], tilt_up: [0, 1.5, 0], tilt_down: [0, -1.2, 0], orbit_left: [-2.5, 0, -1.5], orbit_right: [2.5, 0, -1.5], handheld: [0.18, 0.08, -0.15] };
    const offset = offsets[move];
    return { ...transform, position: [x + offset[0], y + offset[1], z + offset[2]] };
}

function focalLengthToFov(focalLength: number) { return (2 * Math.atan(36 / (2 * focalLength)) * 180) / Math.PI; }
