// 预演台右侧检查器：物体、灯光、镜头、变换与骨骼旋转字段，以及场景列表的小控件。

import {
    type PrevisAspectRatio,
    type PrevisCamera,
    type PrevisCameraMove,
    type PrevisHumanoidBone,
    type PrevisLight,
    type PrevisObject,
    type PrevisActorArchetype,
    type PrevisPose,
    type PrevisQuat,
    type PrevisScene,
    type PrevisShot,
    type PrevisShotSize,
    type PrevisTransform,
    type PrevisVec3,
} from "@/types/previs";
import { type PrevisModeCapabilities } from "@/lib/canvas/previs/previs-modes";
import { PREVIS_ACTOR_ARCHETYPES, PREVIS_ACTOR_COLORS, previsActorArchetypeLabel, previsActorProfileForArchetype, previsBoneLabel, previsFocalLengthToFov, previsPoseLabel } from "@/lib/canvas/previs/previs-scene";
import { Button, ColorPicker, Dropdown, Input, InputNumber, type MenuProps, Slider } from "antd";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { Camera, Copy, Focus, Plus, Trash2, Video } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Euler, Quaternion } from "three";
import { releasePrevisFocusAfterPointer } from "@/lib/canvas/previs/previs-shortcuts";

const PREVIS_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizePrevisHexColor(value: string, fallback = "#ffffff") {
    const trimmed = value.trim().toLowerCase();
    if (!PREVIS_HEX_COLOR_PATTERN.test(trimmed)) return fallback;
    if (trimmed.length === 4) return `#${trimmed.slice(1).split("").map((part) => part + part).join("")}`;
    return trimmed;
}

function HexColorInput({ value, onChange, label = "十六进制颜色" }: { value: string; onChange: (value: string) => void; label?: string }) {
    const normalized = normalizePrevisHexColor(value);
    const [draft, setDraft] = useState(normalized);
    useEffect(() => setDraft(normalized), [normalized]);
    const commit = () => {
        const next = normalizePrevisHexColor(draft, "");
        if (!next) {
            setDraft(normalized);
            return;
        }
        setDraft(next);
        onChange(next);
    };
    return <Input size="small" aria-label={label} value={draft} maxLength={9} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onPressEnter={commit} placeholder="#RRGGBB" />;
}

export const poseOptions: Array<{ label: string; value: PrevisPose }> = [
    { label: "站立", value: "stand" },
    { label: "T 型", value: "t_pose" },
    { label: "行走", value: "walk" },
    { label: "跑步", value: "run" },
    { label: "坐姿", value: "sit" },
    { label: "蹲下", value: "squat" },
    { label: "单膝跪", value: "kneel_single" },
    { label: "双膝跪", value: "kneel_double" },
    { label: "叉腰", value: "hands_hips" },
    { label: "倚靠", value: "lean" },
    { label: "鞠躬", value: "bow" },
    { label: "思考", value: "think" },
    { label: "格斗", value: "fight" },
    { label: "踢球", value: "kick" },
    { label: "投掷", value: "throw" },
    { label: "推进", value: "push" },
    { label: "招手", value: "wave" },
    { label: "伸手", value: "reach" },
    { label: "抱臂", value: "arms_crossed" },
    { label: "看手机", value: "phone" },
];

export const poseEditBones: PrevisHumanoidBone[] = ["head", "spine", "leftUpperArm", "leftLowerArm", "rightUpperArm", "rightLowerArm", "leftUpperLeg", "rightUpperLeg"];

export const shotSizeOptions = [
    { label: "大远景", value: "extreme_wide" },
    { label: "远景", value: "wide" },
    { label: "全身景", value: "full" },
    { label: "中景", value: "medium" },
    { label: "近景", value: "close_up" },
    { label: "大特写", value: "extreme_close_up" },
];

export const cameraMoveOptions = [
    { label: "固定", value: "static" },
    { label: "推进", value: "push_in" },
    { label: "拉远", value: "pull_out" },
    { label: "左摇", value: "pan_left" },
    { label: "右摇", value: "pan_right" },
    { label: "上摇", value: "tilt_up" },
    { label: "下摇", value: "tilt_down" },
    { label: "左环绕", value: "orbit_left" },
    { label: "右环绕", value: "orbit_right" },
    { label: "手持", value: "handheld" },
];

export function ObjectInspector({
    object,
    rendered,
    playhead,
    selectedBone,
    capabilities,
    onSelectBone,
    onUpdate,
    onTransformEdit,
    onBoneRotationStage,
    onBoneRotationCommit,
    onAddKeyframe,
    onDuplicate,
    onDelete,
}: {
    object: PrevisObject;
    rendered: PrevisTransform;
    playhead: number;
    selectedBone: string | null;
    capabilities: PrevisModeCapabilities;
    onSelectBone: (bone: string | null) => void;
    onUpdate: (patch: Partial<PrevisObject>) => void;
    onTransformEdit: (transform: PrevisTransform) => void;
    onBoneRotationStage: (rotation: PrevisQuat) => void;
    onBoneRotationCommit: () => void;
    onAddKeyframe: () => void;
    onDuplicate: () => void;
    onDelete: () => void;
}) {
    const motionClips = object.motionClips || [];
    const activeMotionClip = motionClips.find((clip) => clip.id === object.activeMotionClipId);
    const isActor = object.kind === "actor" || object.primitive === "character";
    const mappedBones = Object.keys(object.rig?.boneMap || {}) as PrevisHumanoidBone[];
    const poseBones = mappedBones.length ? mappedBones : poseEditBones;
    const selectedBoneId = selectedBone as PrevisHumanoidBone | null;
    const selectedBoneRotation = selectedBoneId ? object.boneOverrides?.[selectedBoneId] || ([0, 0, 0, 1] as PrevisQuat) : null;
    const updateActiveMotion = (patch: Partial<NonNullable<PrevisObject["motionClips"]>[number]>) => activeMotionClip && onUpdate({ motionClips: motionClips.map((clip) => (clip.id === activeMotionClip.id ? { ...clip, ...patch } : clip)) });
    const applyPose = (pose: PrevisPose) => onUpdate({ pose, activeMotionClipId: undefined, boneOverrides: {} });
    const resetSelectedBone = () => {
        if (!selectedBoneId) return;
        const boneOverrides = { ...(object.boneOverrides || {}) };
        delete boneOverrides[selectedBoneId];
        onUpdate({ boneOverrides });
    };
    return (
        <Inspector title={object.name} onTitleChange={(name) => onUpdate({ name })} onDuplicate={onDuplicate} onDelete={onDelete}>
            <TransformFields transform={rendered} onChange={onTransformEdit} scaleLabel={isActor ? "比例" : "尺寸（W / H / D）"} scaleAxisLabels={isActor ? undefined : ["W", "H", "D"]} />
            {isActor ? (
                <>
                    <Field label="角色原型">
                        <Select className="w-full" size="small" value={object.archetype || "adult"} options={PREVIS_ACTOR_ARCHETYPES.map((item) => ({ label: item.label, value: item.value }))} onChange={(archetype: PrevisActorArchetype) => onUpdate({ archetype, actorProfile: previsActorProfileForArchetype(archetype) })} />
                        <div className="mt-1 text-[10px] opacity-50">{previsActorArchetypeLabel(object.archetype)}会影响体型、头身比和配件轮廓。</div>
                    </Field>
                    <Field label="角色颜色">
                        <div className="previs-actor-colors">
                            {PREVIS_ACTOR_COLORS.map((color) => <button key={color} type="button" className={`previs-actor-color ${object.color.toLowerCase() === color ? "is-active" : ""}`} style={{ background: color }} aria-label={`设置颜色 ${color}`} onClick={() => onUpdate({ color })} />)}
                            <ColorPicker value={normalizePrevisHexColor(object.color)} size="small" onChange={(color) => onUpdate({ color: color.toHexString() })} />
                        </div>
                        <div className="mt-1">
                            <HexColorInput value={object.color} onChange={(color) => onUpdate({ color })} label="角色十六进制颜色" />
                        </div>
                    </Field>
                </>
            ) : (
                <Field label="颜色">
                    <div className="space-y-1">
                        <ColorPicker value={normalizePrevisHexColor(object.color)} onChange={(color) => onUpdate({ color: color.toHexString() })} />
                        <HexColorInput value={object.color} onChange={(color) => onUpdate({ color })} />
                    </div>
                </Field>
            )}
            {/*
          骨骼与姿势入口：只在姿态/动画模式出现，且只对演员出现。
          规格要求「仅在演员选择时展示现有骨骼/姿势入口」——
          带动画的普通模型不是演员，不应拿到姿势预设与骨骼控制。
        */}
            {capabilities.bones && (object.kind === "actor" || object.primitive === "character") ? (
                <>
                    <section className="previs-pose-section">
                        <div className="previs-inspector-section-title">
                            <span>姿势预设</span>
                            <span>{previsPoseLabel(object.pose || "stand")}</span>
                        </div>
                        <div className="previs-pose-grid">
                            {poseOptions.map((option) => (
                                <button key={option.value} type="button" className={`previs-pose-button ${object.pose === option.value && !object.activeMotionClipId ? "is-active" : ""}`} title={option.label} onClick={() => applyPose(option.value)}>
                                    {option.label}
                                </button>
                            ))}
                        </div>
                        <Button size="small" block onClick={() => applyPose("stand")}>
                            重置姿态
                        </Button>
                    </section>
                    <div className="flex items-center justify-between border-y py-2 text-[var(--fs-label)]">
                        <span>角色绑定</span>
                        <span>{mappedBones.length ? `${mappedBones.length} 根骨骼` : "白膜骨架"}</span>
                    </div>
                    {poseBones.length ? (
                        <Field label="姿势调节">
                            <Select className="w-full" allowClear value={selectedBone || undefined} options={poseBones.map((bone) => ({ label: previsBoneLabel(bone), value: bone }))} onChange={(bone) => onSelectBone(bone || null)} />
                        </Field>
                    ) : null}
                    {selectedBoneId && selectedBoneRotation ? (
                        <>
                            <BoneRotationFields rotation={selectedBoneRotation} onChange={onBoneRotationStage} onChangeComplete={onBoneRotationCommit} />
                            <Button size="small" block onClick={resetSelectedBone}>
                                重置当前骨骼
                            </Button>
                        </>
                    ) : null}
                    {/* 演员还没加载出模型时给一句解释，避免「动作片段」区域凭空消失。 */}
                    {motionClips.length ? null : <div className="text-[var(--fs-tiny)] opacity-50">模型加载后会显示可用动作 Clip</div>}
                </>
            ) : null}
            {/* 动作片段是动画内容而非骨骼入口：任何带 Clip 的对象都能调，不限演员。 */}
            {motionClips.length ? (
                <>
                    <Field label="动作片段">
                        <Select
                            className="w-full"
                            value={object.activeMotionClipId || ""}
                            options={[{ label: "静态姿势", value: "" }, ...motionClips.map((clip) => ({ label: clip.name, value: clip.id }))]}
                            onChange={(activeMotionClipId) => onUpdate({ activeMotionClipId: activeMotionClipId || undefined })}
                        />
                    </Field>
                    {activeMotionClip ? (
                        <div className="grid grid-cols-2 gap-2">
                            <Field label="播放速度">
                                <InputNumber className="w-full" min={0.1} max={4} step={0.1} value={activeMotionClip.playbackRate} onChange={(playbackRate) => updateActiveMotion({ playbackRate: playbackRate || 1 })} />
                            </Field>
                            <Field label="循环">
                                <Switch checked={activeMotionClip.loop} onChange={(loop) => updateActiveMotion({ loop })} />
                            </Field>
                        </div>
                    ) : null}
                </>
            ) : null}
            <Field label="可见">
                <Switch checked={object.visible} onChange={(visible) => onUpdate({ visible })} />
            </Field>
            <Field label="投射阴影">
                <Switch checked={object.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
            </Field>
            {/* 记录关键帧属于动画模式；摆场与姿态模式不默认制造关键帧。 */}
            {capabilities.keyframes ? (
                <>
                    <Button block icon={<Focus className="size-3.5" />} onClick={onAddKeyframe}>
                        {selectedBone ? `在 ${playhead.toFixed(1)}s 记录骨骼` : `在 ${playhead.toFixed(1)}s 记录关键帧`}
                    </Button>
                    <div className="text-[var(--fs-tiny)] opacity-50">
                        Transform {object.keyframes.length} 个 · 骨骼 {object.boneTracks?.reduce((sum, track) => sum + track.keyframes.length, 0) || 0} 个
                    </div>
                </>
            ) : null}
        </Inspector>
    );
}

export function LightInspector({ light, onUpdate, onDelete }: { light: PrevisLight; onUpdate: (patch: Partial<PrevisLight>) => void; onDelete: () => void }) {
    return (
        <Inspector title={light.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}>
            <Field label="类型">
                <Select
                    className="w-full"
                    value={light.type}
                    options={[
                        { label: "方向光", value: "directional" },
                        { label: "点光源", value: "point" },
                        { label: "聚光灯", value: "spot" },
                        { label: "环境光", value: "ambient" },
                    ]}
                    onChange={(type) => onUpdate({ type })}
                />
            </Field>
            <Vec3Field label="位置" value={light.transform.position} onChange={(position) => onUpdate({ transform: { ...light.transform, position } })} />
            <Field label="颜色">
                <div className="space-y-1">
                    <ColorPicker value={normalizePrevisHexColor(light.color)} onChange={(color) => onUpdate({ color: color.toHexString() })} />
                    <HexColorInput value={light.color} onChange={(color) => onUpdate({ color })} />
                </div>
            </Field>
            <Field label="强度">
                <InputNumber className="w-full" min={0} max={20} step={0.1} value={light.intensity} onChange={(value) => onUpdate({ intensity: value || 0 })} />
            </Field>
            <Field label="投射阴影">
                <Switch checked={light.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
            </Field>
        </Inspector>
    );
}

export function ShotInspector({
    shot,
    camera,
    cameras,
    capabilities,
    onUpdateShot,
    onUpdateCamera,
    onAddCameraKeyframe,
    onApplyCameraMove,
    onAlignCameraToView,
    onExportClay,
    recording,
}: {
    shot: PrevisShot;
    camera: PrevisCamera | null;
    cameras: PrevisScene["cameras"];
    capabilities: PrevisModeCapabilities;
    onUpdateShot: (patch: Partial<PrevisShot>) => void;
    onUpdateCamera: (patch: Partial<PrevisCamera>) => void;
    onAddCameraKeyframe: () => void;
    onApplyCameraMove: () => void;
    onAlignCameraToView: () => void;
    onExportClay: () => void;
    recording: boolean;
}) {
    return (
        <Inspector title={shot.name} onTitleChange={(name) => onUpdateShot({ name })}>
            <Field label="摄影机">
                <Select className="w-full" value={shot.cameraId} options={cameras.map((item) => ({ label: item.name, value: item.id }))} onChange={(cameraId) => onUpdateShot({ cameraId })} />
            </Field>
            <div className="grid grid-cols-2 gap-2">
                <Field label="景别">
                    <Select className="w-full" value={shot.shotSize} options={shotSizeOptions} onChange={(shotSize: PrevisShotSize) => onUpdateShot({ shotSize })} />
                </Field>
                <Field label="画幅">
                    <Select className="w-full" value={shot.aspectRatio || "9:16"} options={["9:16", "16:9", "2.39:1"].map((value) => ({ label: value, value }))} onChange={(aspectRatio: PrevisAspectRatio) => onUpdateShot({ aspectRatio })} />
                </Field>
            </div>
            <div className="grid grid-cols-2 gap-2">
                <Field label="帧率">
                    <Select className="w-full" value={shot.fps} options={[24, 25, 30].map((fps) => ({ label: `${fps} fps`, value: fps }))} onChange={(fps: 24 | 25 | 30) => onUpdateShot({ fps })} />
                </Field>
                <Field label="时长">
                    <InputNumber className="w-full" min={0.5} max={60} step={0.5} value={shot.duration} addonAfter="秒" onChange={(value) => onUpdateShot({ duration: value || 5 })} />
                </Field>
            </div>
            <Field label="运镜">
                <Select className="w-full" value={shot.cameraMove} options={cameraMoveOptions} onChange={(cameraMove: PrevisCameraMove) => onUpdateShot({ cameraMove })} />
            </Field>
            <Field label="镜头意图">
                <Input.TextArea autoSize={{ minRows: 3, maxRows: 7 }} value={shot.prompt} placeholder="人物表演、动作、叙事目标…" onChange={(event) => onUpdateShot({ prompt: event.target.value })} />
            </Field>
            {camera ? (
                <>
                    <Vec3Field label="摄影机位置" value={camera.transform.position} onChange={(position) => onUpdateCamera({ transform: { ...camera.transform, position } })} />
                    <Vec3Field label="焦点" value={camera.target} onChange={(target) => onUpdateCamera({ target })} />
                    <Field label="焦距">
                        <InputNumber className="w-full" min={12} max={200} value={camera.focalLength} addonAfter="mm" onChange={(focalLength) => onUpdateCamera({ focalLength: focalLength || 35, fov: previsFocalLengthToFov(focalLength || 35) })} />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                        <Field label="光圈">
                            <InputNumber className="w-full" min={0.7} max={32} step={0.1} value={camera.aperture} addonBefore="f/" onChange={(aperture) => onUpdateCamera({ aperture: aperture || 2.8 })} />
                        </Field>
                        <Field label="焦点距离">
                            <InputNumber className="w-full" min={0.1} max={200} step={0.1} value={camera.focusDistance} addonAfter="m" onChange={(focusDistance) => onUpdateCamera({ focusDistance: focusDistance || 5 })} />
                        </Field>
                    </div>
                    <Button block icon={<Camera className="size-3.5" />} onClick={onAlignCameraToView}>
                        摄影机对齐当前视图
                    </Button>
                    <Button block icon={<Video className="size-3.5" />} title="根据当前运镜预设自动生成路径" onClick={onApplyCameraMove}>
                        用预设生成路径
                    </Button>
                    {capabilities.keyframes ? (
                        <Button block icon={<Focus className="size-3.5" />} onClick={onAddCameraKeyframe}>
                            记录摄影机关键帧
                        </Button>
                    ) : null}
                    <Button block type="primary" ghost icon={<Video className="size-3.5" />} loading={recording} onClick={onExportClay}>
                        导出白膜视频
                    </Button>
                </>
            ) : null}
        </Inspector>
    );
}

export function Inspector({ title, children, onTitleChange, onDuplicate, onDelete }: { title: string; children: ReactNode; onTitleChange: (value: string) => void; onDuplicate?: () => void; onDelete?: () => void }) {
    return (
        <div className="space-y-3 p-3">
            <div className="flex items-center gap-2">
                <Input variant="borderless" value={title} className="min-w-0 flex-1 px-0 font-medium" onChange={(event) => onTitleChange(event.target.value)} />
                {onDuplicate ? (
                    <IconButton label="复制" onClick={onDuplicate}>
                        <Copy className="size-4" />
                    </IconButton>
                ) : null}
                {onDelete ? (
                    <IconButton label="删除" onClick={onDelete}>
                        <Trash2 className="size-4" />
                    </IconButton>
                ) : null}
            </div>
            {children}
        </div>
    );
}

export function TransformFields({ transform, onChange, scaleLabel = "缩放", scaleAxisLabels }: { transform: PrevisTransform; onChange: (transform: PrevisTransform) => void; scaleLabel?: string; scaleAxisLabels?: [string, string, string] }) {
    return (
        <>
            <Vec3Field label="位置" value={transform.position} onChange={(position) => onChange({ ...transform, position })} />
            <Vec3Field label="旋转" value={transform.rotation} step={0.05} onChange={(rotation) => onChange({ ...transform, rotation })} />
            <Vec3Field label={scaleLabel} value={transform.scale} step={0.1} axisLabels={scaleAxisLabels} onChange={(scale) => onChange({ ...transform, scale })} />
        </>
    );
}

export function BoneRotationFields({ rotation, onChange, onChangeComplete }: { rotation: PrevisQuat; onChange: (rotation: PrevisQuat) => void; onChangeComplete: () => void }) {
    const initialDegrees = useMemo(() => {
        const euler = new Euler().setFromQuaternion(new Quaternion(...rotation), "XYZ");
        return [euler.x, euler.y, euler.z].map((value) => Number(((value * 180) / Math.PI).toFixed(1))) as PrevisVec3;
    }, [rotation]);
    const [degrees, setDegrees] = useState<PrevisVec3>(initialDegrees);
    const lastEmittedRotation = useRef<PrevisQuat | null>(null);
    useEffect(() => {
        if (lastEmittedRotation.current && samePrevisQuaternion(rotation, lastEmittedRotation.current)) {
            lastEmittedRotation.current = null;
            return;
        }
        setDegrees(initialDegrees);
    }, [initialDegrees, rotation]);
    const updateAxis = (index: number, value: number) => {
        const next = degrees.map((entry, entryIndex) => (entryIndex === index ? value : entry)) as PrevisVec3;
        const radians = next.map((entry) => (entry * Math.PI) / 180) as PrevisVec3;
        const nextRotation = new Quaternion().setFromEuler(new Euler(radians[0], radians[1], radians[2], "XYZ")).toArray() as PrevisQuat;
        setDegrees(next);
        lastEmittedRotation.current = nextRotation;
        onChange(nextRotation);
    };
    return (
        <Field label="骨骼旋转（局部角度 °）">
            <div className="space-y-1.5">
                {degrees.map((value, index) => (
                    <div key={index} className="grid grid-cols-[18px_minmax(0,1fr)_48px] items-center gap-2">
                        <span className="text-[var(--fs-tiny)] font-medium opacity-65">{["X", "Y", "Z"][index]}</span>
                        <Slider className="m-0" min={-180} max={180} step={1} value={value} onChange={(next) => updateAxis(index, Array.isArray(next) ? (next[0] ?? 0) : next)} onChangeComplete={onChangeComplete} />
                        <span className="text-right text-[var(--fs-tiny)] tabular-nums opacity-65">{value.toFixed(1)}°</span>
                    </div>
                ))}
            </div>
        </Field>
    );
}

export function samePrevisQuaternion(left: PrevisQuat, right: PrevisQuat) {
    const directDistance = left.reduce((sum, value, index) => sum + Math.abs(value - right[index]), 0);
    const inverseDistance = left.reduce((sum, value, index) => sum + Math.abs(value + right[index]), 0);
    return Math.min(directDistance, inverseDistance) < 0.0001;
}

export function Vec3Field({ label, value, step = 0.1, axisLabels, onChange }: { label: string; value: PrevisVec3; step?: number; axisLabels?: [string, string, string]; onChange: (value: PrevisVec3) => void }) {
    return (
        <Field label={label}>
            <div className="grid grid-cols-3 gap-1">
                {value.map((item, index) => <div key={index} className="relative">
                    <InputNumber className="w-full" size="small" step={step} value={Number(item.toFixed(2))} onChange={(next) => onChange(value.map((entry, itemIndex) => (itemIndex === index ? next || 0 : entry)) as PrevisVec3)} />
                    {axisLabels ? <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[9px] opacity-45">{axisLabels[index]}</span> : null}
                </div>)}
            </div>
        </Field>
    );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block">
            <span className="mb-1 block text-[var(--fs-label)] opacity-55">{label}</span>
            {children}
        </label>
    );
}

export function PanelTitle({ title, action }: { title: string; action?: ReactNode }) {
    return (
        <div className="flex h-9 items-center px-3 text-[var(--fs-tiny)] font-semibold uppercase opacity-55">
            <span className="flex-1">{title}</span>
            {action}
        </div>
    );
}

/**
 * 场景列表行。选择按钮点完必须释放焦点：
 *「点选对象 -> 按 Delete」是 delete-selected 快捷键的主流程，
 * 焦点留在按钮上会让守卫把 Delete 吃掉。
 */
export function SceneRow({ active, icon, label, onClick, onDelete }: { active?: boolean; icon: ReactElement; label: string; onClick: () => void; onDelete?: () => void }) {
    return (
        <div className={`flex h-8 w-full items-center gap-1 px-1 text-left text-xs transition ${active ? "bg-black/10 dark:bg-white/10" : "hover:bg-black/5 dark:hover:bg-white/5"}`}>
            <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 px-1 text-left"
                onClick={(event) => {
                    onClick();
                    releasePrevisFocusAfterPointer(event);
                }}
            >
                <span className="[&>svg]:size-3.5">{icon}</span>
                <span className="truncate">{label}</span>
            </button>
            {onDelete ? (
                <button
                    type="button"
                    aria-label={`删除${label}`}
                    title={`删除${label}`}
                    className="grid size-6 shrink-0 place-items-center rounded opacity-60 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    onClick={(event) => {
                        event.stopPropagation();
                        onDelete();
                        releasePrevisFocusAfterPointer(event);
                    }}
                >
                    <Trash2 className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}

export function AddMenuButton({ label, items }: { label: string; items: MenuProps["items"] }) {
    return (
        <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items }}>
            <button type="button" aria-label={label} title={label} className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 dark:hover:bg-white/10">
                <Plus className="size-3.5" />
            </button>
        </Dropdown>
    );
}

export function QuickAdd({ label, icon, onClick }: { label: string; icon: ReactElement; onClick: () => void }) {
    return (
        <button
            type="button"
            className="flex h-8 items-center gap-1.5 border px-2 text-[var(--fs-tiny)] transition hover:bg-black/5 dark:hover:bg-white/5"
            onClick={(event) => {
                onClick();
                releasePrevisFocusAfterPointer(event);
            }}
        >
            <span className="[&>svg]:size-3.5">{icon}</span>
            <span className="truncate">{label}</span>
        </button>
    );
}

export function IconButton({ label, disabled, children, onClick }: { label: string; disabled?: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            aria-label={label}
            title={label}
            disabled={disabled}
            className="grid size-8 shrink-0 place-items-center rounded-md transition hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10"
            onClick={(event) => {
                onClick();
                releasePrevisFocusAfterPointer(event);
            }}
        >
            {children}
        </button>
    );
}
