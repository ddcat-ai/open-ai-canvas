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
import { PREVIS_ACTOR_ARCHETYPES, PREVIS_ACTOR_COLORS, previsActorArchetypeLabel, previsActorProfileForArchetype, previsBoneLabel, previsPoseLabel } from "@/lib/canvas/previs/previs-scene";
import { PREVIS_ASPECT_RATIOS, previsAspectOption, previsHorizontalFov } from "@/lib/canvas/previs/previs-optics";
import { Button, ColorPicker, Dropdown, Input, InputNumber, type MenuProps, Slider } from "antd";
import { Select } from "@/components/ui/base/select";
import { Switch } from "@/components/ui/base/switch";
import { Camera, Check, Copy, Focus, Pause, Play, Plus, Route, Trash2, TriangleAlert, Video } from "lucide-react";
import { type ReactElement, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { Euler, Quaternion } from "three";
import { releasePrevisFocusAfterPointer } from "@/lib/canvas/previs/previs-shortcuts";
import { isPrevisStandardActor, PREVIS_MANNEQUIN_HEIGHT } from "@/lib/canvas/previs/previs-mannequin";
import { dropPrevisObjectToGround, isPrevisObjectOnGround } from "@/lib/canvas/previs/previs-grounding";

/** 演员色板：一行 8 个高区分度颜色，其余颜色用取色器/十六进制输入，避免两行杂乱色块。 */
const PREVIS_ACTOR_SWATCHES: readonly string[] = ["#2f7de1", "#d84949", "#dfae3f", "#34a276", "#8b5cf6", "#f97316", "#06b6d4", "#8a93a0"];
import { PREVIS_MOTION_IDS, PREVIS_MOTIONS, previsMotionLabel, previsMotionsOverlap } from "@/lib/canvas/previs/previs-motion";
import type { PrevisActorMotion, PrevisMotionId } from "@/types/previs";

/**
 * 标准人偶的动作库：点击动作即在当前播放头插入片段；移动步态由走位自动推导，不需要手动添加。
 * 上半身动作（招手、说话…）可以叠加在走路上，整身动作同层互斥并给出冲突提示。
 */
function ActorMotionSection({ object, playhead, onUpdate }: { object: PrevisObject; playhead: number; onUpdate: (patch: Partial<PrevisObject>) => void }) {
    const motions = object.motions || [];
    const sorted = motions.toSorted((left, right) => left.start - right.start);
    const add = (motion: PrevisMotionId) => {
        const definition = PREVIS_MOTIONS[motion];
        const next: PrevisActorMotion = { id: `motion-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, motion, start: Math.max(0, Number(playhead.toFixed(2))), duration: definition.duration, intensity: 1 };
        onUpdate({ motions: [...motions, next] });
    };
    const patch = (id: string, value: Partial<PrevisActorMotion>) => onUpdate({ motions: motions.map((item) => (item.id === id ? { ...item, ...value } : item)) });
    const remove = (id: string) => onUpdate({ motions: motions.filter((item) => item.id !== id) });
    return (
        <section className="previs-pose-section" aria-label="动作库">
            <div className="previs-pose-grid">
                {PREVIS_MOTION_IDS.map((id) => (
                    <button
                        key={id}
                        type="button"
                        className="previs-pose-button"
                        title={`${previsMotionLabel(id)}（${PREVIS_MOTIONS[id].layer === "upper" ? "上半身，可叠加走路" : "整身"}）`}
                        onClick={(event) => {
                            releasePrevisFocusAfterPointer(event);
                            add(id);
                        }}
                    >
                        {previsMotionLabel(id)}
                    </button>
                ))}
            </div>
            <div className="text-[var(--fs-tiny)] opacity-55">走位移动时会自动迈步和跑动，无需添加「走」「跑」。</div>
            {sorted.length ? (
                <ul className="previs-motion-list">
                    {sorted.map((item) => {
                        const conflict = previsMotionsOverlap(motions, item, item.id);
                        return (
                            <li key={item.id} className={`previs-motion-row ${conflict ? "is-conflict" : ""}`}>
                                <span className="previs-motion-row__name" title={conflict ? "与同层动作时间重叠，后添加的会覆盖前者" : undefined}>
                                    {previsMotionLabel(item.motion)}
                                    {conflict ? <TriangleAlert role="img" aria-label="动作时间重叠" className="ml-1 inline-block size-3.5 align-[-0.125em] text-[var(--status-warning)]" /> : null}
                                </span>
                                <InputNumber size="small" aria-label="开始秒" min={0} max={60} step={0.1} value={item.start} addonAfter="s" onChange={(start) => patch(item.id, { start: Math.max(0, Number(start) || 0) })} />
                                <InputNumber size="small" aria-label="时长秒" min={0.2} max={60} step={0.1} value={item.duration} addonAfter="长" onChange={(duration) => patch(item.id, { duration: Math.max(0.2, Number(duration) || 0.2) })} />
                                <Slider className="previs-motion-row__intensity" aria-label="幅度" min={0.2} max={1.6} step={0.05} value={item.intensity ?? 1} onChange={(intensity) => patch(item.id, { intensity })} />
                                <button type="button" className="previs-motion-row__remove" aria-label={`删除动作 ${previsMotionLabel(item.motion)}`} onClick={() => remove(item.id)}>
                                    <Trash2 className="size-3" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </section>
    );
}

const PREVIS_HEX_COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function normalizePrevisHexColor(value: string, fallback = "#ffffff") {
    const trimmed = value.trim().toLowerCase();
    if (!PREVIS_HEX_COLOR_PATTERN.test(trimmed)) return fallback;
    if (trimmed.length === 4)
        return `#${trimmed
            .slice(1)
            .split("")
            .map((part) => part + part)
            .join("")}`;
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

type ObjectInspectorTab = "animate" | "pose" | "props";

/**
 * 对象检查器：按标签分组，而不是一长串字段。
 * - 摆场：属性（变换/体型/外观）+ 姿态（演员）。
 * - 动画：动画（引导式三步：走位 → 动作 → 预览，手动关键帧收在「高级」）+ 姿态 + 属性。
 */
export function ObjectInspector({
    object,
    rendered,
    playhead,
    selectedBone,
    capabilities,
    playing,
    pathDrawing,
    onSelectBone,
    onUpdate,
    onTransformEdit,
    onBoneRotationStage,
    onBoneRotationCommit,
    onAddKeyframe,
    onTogglePlay,
    onToggleDrawPath,
    onClearPath,
    onDuplicate,
    onDelete,
}: {
    object: PrevisObject;
    rendered: PrevisTransform;
    playhead: number;
    selectedBone: string | null;
    capabilities: PrevisModeCapabilities;
    playing: boolean;
    pathDrawing: boolean;
    onSelectBone: (bone: string | null) => void;
    onUpdate: (patch: Partial<PrevisObject>) => void;
    onTransformEdit: (transform: PrevisTransform) => void;
    onBoneRotationStage: (rotation: PrevisQuat) => void;
    onBoneRotationCommit: () => void;
    onAddKeyframe: () => void;
    onTogglePlay: () => void;
    onToggleDrawPath: () => void;
    onClearPath: () => void;
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
    const profile = { ...previsActorProfileForArchetype(object.archetype || "adult"), ...(object.actorProfile || {}) };
    const updateProfile = (patch: Partial<typeof profile>) => onUpdate({ actorProfile: { ...profile, ...patch } });
    const grounded = isPrevisObjectOnGround(object, rendered);
    const hasPath = Boolean(object.motionPath) || object.keyframes.length > 1;
    const motionCount = object.motions?.length || 0;
    const boneKeyCount = object.boneTracks?.reduce((sum, track) => sum + track.keyframes.length, 0) || 0;

    const tabs: Array<{ id: ObjectInspectorTab; label: string }> = [
        ...(capabilities.timeline ? [{ id: "animate" as const, label: "动画" }] : []),
        { id: "props", label: "属性" },
        ...(isActor && capabilities.bones ? [{ id: "pose" as const, label: "姿态" }] : []),
    ];
    const [tab, setTab] = useState<ObjectInspectorTab>(tabs[0].id);
    // 换对象或换模式时回到该模式的首个标签：进入动画默认看动画步骤。
    useEffect(() => setTab(capabilities.timeline ? "animate" : "props"), [capabilities.timeline, object.id]);
    const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0].id;

    return (
        <Inspector title={object.name} onTitleChange={(name) => onUpdate({ name })} onDuplicate={onDuplicate} onDelete={onDelete}>
            {tabs.length > 1 ? (
                <div className="previs-inspector-tabs" role="tablist" aria-label="属性分类">
                    {tabs.map((item) => (
                        <button key={item.id} type="button" role="tab" aria-selected={activeTab === item.id} className={`previs-inspector-tab ${activeTab === item.id ? "is-active" : ""}`} onClick={() => setTab(item.id)}>
                            {item.label}
                        </button>
                    ))}
                </div>
            ) : null}

            {activeTab === "animate" ? (
                <>
                    {isActor ? (
                        <div className="previs-anim-guide">
                            <GuideStep index={1} title="走位" done={hasPath} hint="在俯视图的地面上按住拖出路线，演员会沿路线自动迈步；路线越长走得越快，过快会自动变成跑。">
                                <div className="previs-anim-guide__actions">
                                    <Button size="small" type={pathDrawing ? "primary" : "default"} icon={<Route className="size-3.5" />} onClick={onToggleDrawPath}>
                                        {pathDrawing ? "取消绘制" : hasPath ? "重新画走位" : "画走位路径"}
                                    </Button>
                                    {hasPath ? (
                                        <Button size="small" type="text" onClick={onClearPath}>
                                            清除走位
                                        </Button>
                                    ) : null}
                                </div>
                            </GuideStep>
                            {isPrevisStandardActor(object) ? (
                                <GuideStep index={2} title="动作" done={motionCount > 0} hint={`先把时间轴上的播放头拖到动作开始的时间（现在是 ${playhead.toFixed(1)}s），再点下面的动作。招手、说话等上半身动作可以边走边做。`}>
                                    <ActorMotionSection object={object} playhead={playhead} onUpdate={onUpdate} />
                                </GuideStep>
                            ) : null}
                            <GuideStep index={isPrevisStandardActor(object) ? 3 : 2} title="预览" hint="播放整段镜头，看走位和动作是否自然；满意后在顶栏导出白膜视频。">
                                <Button size="small" block icon={playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />} onClick={onTogglePlay}>
                                    {playing ? "暂停" : "播放预览"}
                                </Button>
                            </GuideStep>
                        </div>
                    ) : (
                        <div className="previs-inspector-note">道具动画用关键帧：把播放头拖到某个时间，移动道具后点「记录关键帧」；在另一个时间再摆一次，中间会自动补间。</div>
                    )}
                    {motionClips.length ? (
                        <InspectorGroup title="模型自带动作">
                            <Select
                                className="w-full"
                                size="small"
                                value={object.activeMotionClipId || ""}
                                options={[{ label: "静态姿势", value: "" }, ...motionClips.map((clip) => ({ label: clip.name, value: clip.id }))]}
                                onChange={(activeMotionClipId) => onUpdate({ activeMotionClipId: activeMotionClipId || undefined })}
                            />
                            {activeMotionClip ? (
                                <div className="grid grid-cols-2 gap-2">
                                    <Field label="播放速度">
                                        <InputNumber className="w-full" size="small" min={0.1} max={4} step={0.1} value={activeMotionClip.playbackRate} onChange={(playbackRate) => updateActiveMotion({ playbackRate: playbackRate || 1 })} />
                                    </Field>
                                    <Field label="循环">
                                        <Switch checked={activeMotionClip.loop} onChange={(loop) => updateActiveMotion({ loop })} />
                                    </Field>
                                </div>
                            ) : null}
                        </InspectorGroup>
                    ) : null}
                    {/* 记录关键帧属于动画模式；摆场不默认制造关键帧。 */}
                    {capabilities.keyframes ? (
                        <details className="previs-inspector-advanced" open={!isActor}>
                            <summary>{isActor ? "高级：手动关键帧" : "关键帧"}</summary>
                            <div className="previs-inspector-advanced__body">
                                <Button size="small" block icon={<Focus className="size-3.5" />} onClick={onAddKeyframe}>
                                    {selectedBone ? `在 ${playhead.toFixed(1)}s 记录当前部位` : `在 ${playhead.toFixed(1)}s 记录关键帧`}
                                </Button>
                                <div className="previs-inspector-note">
                                    位置 {object.keyframes.length} 帧 · 骨骼 {boneKeyCount} 帧。打开时间轴上的「自动关键帧」后，拖动对象会直接在播放头处记帧。
                                </div>
                            </div>
                        </details>
                    ) : null}
                </>
            ) : null}

            {activeTab === "pose" ? (
                <InspectorGroup title="姿势" hint={previsPoseLabel(object.pose || "stand")}>
                    <div className="previs-pose-grid">
                        {poseOptions.map((option) => (
                            <button key={option.value} type="button" className={`previs-pose-button ${object.pose === option.value && !object.activeMotionClipId ? "is-active" : ""}`} title={option.label} onClick={() => applyPose(option.value)}>
                                {option.label}
                            </button>
                        ))}
                    </div>
                    {poseBones.length ? (
                        <Field label="身体部位微调（也可直接点视口里的关节）">
                            <Select
                                className="w-full"
                                size="small"
                                allowClear
                                placeholder="选择身体部位"
                                value={selectedBone || undefined}
                                options={poseBones.map((bone) => ({ label: previsBoneLabel(bone), value: bone }))}
                                onChange={(bone) => onSelectBone(bone || null)}
                            />
                        </Field>
                    ) : null}
                    {selectedBoneId && selectedBoneRotation ? (
                        <>
                            <BoneRotationFields rotation={selectedBoneRotation} onChange={onBoneRotationStage} onChangeComplete={onBoneRotationCommit} />
                            <Button size="small" block onClick={resetSelectedBone}>
                                重置当前部位
                            </Button>
                        </>
                    ) : null}
                    <Button size="small" block onClick={() => applyPose("stand")}>
                        重置姿态
                    </Button>
                </InspectorGroup>
            ) : null}

            {activeTab === "props" ? (
                <>
                    <InspectorGroup title="位置" hint={isActor ? "Y 为脚底离地高度" : undefined}>
                        <TransformFields transform={rendered} onChange={onTransformEdit} scaleLabel={isActor ? "比例" : "尺寸"} scaleUnit={isActor ? "×" : "倍"} scaleAxisLabels={isActor ? undefined : ["W", "H", "D"]} />
                        <Button size="small" block disabled={grounded} onClick={() => onTransformEdit(dropPrevisObjectToGround({ ...object, transform: rendered, keyframes: [] }).transform)}>
                            贴地
                        </Button>
                    </InspectorGroup>
                    {isActor ? (
                        <InspectorGroup title="体型">
                            <Field label="角色原型">
                                <Select
                                    className="w-full"
                                    size="small"
                                    value={object.archetype || "adult"}
                                    options={PREVIS_ACTOR_ARCHETYPES.map((item) => ({ label: item.label, value: item.value }))}
                                    onChange={(archetype: PrevisActorArchetype) => onUpdate({ archetype, actorProfile: previsActorProfileForArchetype(archetype) })}
                                />
                            </Field>
                            <ProfileSlider label="身高" min={0.5} max={1.5} value={profile.height} suffix={`${(profile.height * PREVIS_MANNEQUIN_HEIGHT).toFixed(2)}m`} onChange={(height) => updateProfile({ height })} />
                            <ProfileSlider label="肩宽" min={0.6} max={1.5} value={profile.shoulderWidth} onChange={(shoulderWidth) => updateProfile({ shoulderWidth })} />
                            <ProfileSlider label="躯干" min={0.7} max={1.3} value={profile.torsoRatio} onChange={(torsoRatio) => updateProfile({ torsoRatio })} />
                            <ProfileSlider label="头部" min={0.7} max={1.5} value={profile.headRatio} onChange={(headRatio) => updateProfile({ headRatio })} />
                        </InspectorGroup>
                    ) : null}
                    <InspectorGroup title="外观">
                        <ColorRow value={object.color} swatches={isActor ? PREVIS_ACTOR_SWATCHES : undefined} label={isActor ? "角色十六进制颜色" : "十六进制颜色"} onChange={(color) => onUpdate({ color })} />
                        <div className="previs-inspector-toggles">
                            <label className="previs-inspector-toggle">
                                <span>可见</span>
                                <Switch checked={object.visible} onChange={(visible) => onUpdate({ visible })} />
                            </label>
                            <label className="previs-inspector-toggle">
                                <span>投射阴影</span>
                                <Switch checked={object.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
                            </label>
                        </div>
                    </InspectorGroup>
                </>
            ) : null}
        </Inspector>
    );
}

/** 引导步骤：编号 + 标题 + 一句话说明 + 操作。完成后编号变成对勾。 */
function GuideStep({ index, title, hint, done = false, children }: { index: number; title: string; hint: string; done?: boolean; children: ReactNode }) {
    return (
        <section className={`previs-anim-step ${done ? "is-done" : ""}`} aria-label={`第 ${index} 步：${title}`}>
            <div className="previs-anim-step__head">
                <span className="previs-anim-step__index" aria-hidden="true">
                    {done ? <Check className="size-3" /> : index}
                </span>
                <span className="previs-anim-step__title">{title}</span>
                {done ? <span className="previs-anim-step__state">已设置</span> : <span className="previs-anim-step__state">可选</span>}
            </div>
            <p className="previs-anim-step__hint">{hint}</p>
            {children}
        </section>
    );
}

function ColorRow({ value, swatches, label, onChange }: { value: string; swatches?: readonly string[]; label: string; onChange: (color: string) => void }) {
    return (
        <div className="previs-color-row">
            {swatches?.map((color) => (
                <button
                    key={color}
                    type="button"
                    className={`previs-actor-color ${value.toLowerCase() === color ? "is-active" : ""}`}
                    style={{ background: color }}
                    aria-label={`设置颜色 ${color}`}
                    aria-pressed={value.toLowerCase() === color}
                    onClick={() => onChange(color)}
                />
            ))}
            <ColorPicker value={normalizePrevisHexColor(value)} size="small" onChange={(color) => onChange(color.toHexString())} />
            <div className="previs-color-row__hex">
                <HexColorInput value={value} onChange={onChange} label={label} />
            </div>
        </div>
    );
}

const LIGHT_TYPE_OPTIONS = [
    { label: "方向光（太阳）", value: "directional" },
    { label: "点光源（灯泡）", value: "point" },
    { label: "聚光灯", value: "spot" },
    { label: "环境光", value: "ambient" },
];

export function LightInspector({ light, onUpdate, onDelete }: { light: PrevisLight; onUpdate: (patch: Partial<PrevisLight>) => void; onDelete: () => void }) {
    return (
        <Inspector title={light.name} onTitleChange={(name) => onUpdate({ name })} onDelete={onDelete}>
            <InspectorGroup title="灯光">
                <Field label="类型">
                    <Select className="w-full" size="small" value={light.type} options={LIGHT_TYPE_OPTIONS} onChange={(type) => onUpdate({ type })} />
                </Field>
                <ProfileSlider label="强度" min={0} max={10} step={0.1} value={light.intensity} suffix={light.intensity.toFixed(1)} onChange={(intensity) => onUpdate({ intensity })} />
                <ColorRow value={light.color} swatches={LIGHT_SWATCHES} label="灯光十六进制颜色" onChange={(color) => onUpdate({ color })} />
                {light.type !== "ambient" ? (
                    <label className="previs-inspector-toggle">
                        <span>投射阴影</span>
                        <Switch checked={light.castShadow} onChange={(castShadow) => onUpdate({ castShadow })} />
                    </label>
                ) : null}
            </InspectorGroup>
            {light.type !== "ambient" ? (
                <InspectorGroup title="位置">
                    <Vec3Field label="位置" unit="m" value={light.transform.position} onChange={(position) => onUpdate({ transform: { ...light.transform, position } })} />
                </InspectorGroup>
            ) : null}
        </Inspector>
    );
}

const LIGHT_SWATCHES: readonly string[] = ["#ffffff", "#ffe2b8", "#ffc58a", "#9cc7ff", "#c3b5ff", "#ff9b8a"];
const FOCAL_PRESETS = [18, 24, 35, 50, 85, 135];

/**
 * 镜头检查器：没选中对象时显示。
 * 画面（机位/景别/画幅/时长）→ 镜头（焦段/光圈）→ 机位（对齐视图/坐标）→ 运镜 → 镜头意图。
 * 运镜生成与关键帧只在动画模式出现；摆场模式只选运镜语义（会写进提示词）。
 */
export function ShotInspector({
    shot,
    camera,
    cameras,
    capabilities,
    pathDrawing,
    onUpdateShot,
    onUpdateCamera,
    onAddCameraKeyframe,
    onApplyCameraMove,
    onAlignCameraToView,
    onToggleDrawPath,
}: {
    shot: PrevisShot;
    camera: PrevisCamera | null;
    cameras: PrevisScene["cameras"];
    capabilities: PrevisModeCapabilities;
    pathDrawing: boolean;
    onUpdateShot: (patch: Partial<PrevisShot>) => void;
    onUpdateCamera: (patch: Partial<PrevisCamera>) => void;
    onAddCameraKeyframe: () => void;
    onApplyCameraMove: () => void;
    onAlignCameraToView: () => void;
    onToggleDrawPath: () => void;
}) {
    const setFocal = (focalLength: number) => onUpdateCamera({ focalLength, fov: previsHorizontalFov(focalLength) });
    return (
        <Inspector title={shot.name} onTitleChange={(name) => onUpdateShot({ name })}>
            <InspectorGroup title="画面">
                <Field label="使用机位">
                    <Select className="w-full" size="small" value={shot.cameraId} options={cameras.map((item) => ({ label: item.name, value: item.id }))} onChange={(cameraId) => onUpdateShot({ cameraId })} />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                    <Field label="景别">
                        <Select className="w-full" size="small" value={shot.shotSize} options={shotSizeOptions} onChange={(shotSize: PrevisShotSize) => onUpdateShot({ shotSize })} />
                    </Field>
                    <Field label="画幅">
                        <Select
                            className="w-full"
                            size="small"
                            value={previsAspectOption(shot.aspectRatio).value}
                            options={PREVIS_ASPECT_RATIOS.map((item) => ({ label: item.label, value: item.value }))}
                            onChange={(aspectRatio: PrevisAspectRatio) => onUpdateShot({ aspectRatio })}
                        />
                    </Field>
                    <Field label="时长">
                        <InputNumber className="w-full" size="small" min={0.5} max={60} step={0.5} value={shot.duration} addonAfter="秒" onChange={(value) => onUpdateShot({ duration: value || 5 })} />
                    </Field>
                    <Field label="帧率">
                        <Select className="w-full" size="small" value={shot.fps} options={[24, 25, 30].map((fps) => ({ label: `${fps} fps`, value: fps }))} onChange={(fps: 24 | 25 | 30) => onUpdateShot({ fps })} />
                    </Field>
                </div>
            </InspectorGroup>
            {camera ? (
                <>
                    <InspectorGroup title="镜头" hint={`${camera.focalLength}mm · f/${camera.aperture}`}>
                        <div className="previs-focal-chips" role="group" aria-label="常用焦段">
                            {FOCAL_PRESETS.map((value) => (
                                <button key={value} type="button" className={`previs-focal-chip ${camera.focalLength === value ? "is-active" : ""}`} aria-pressed={camera.focalLength === value} onClick={() => setFocal(value)}>
                                    {value}
                                </button>
                            ))}
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                            <Field label="焦距">
                                <InputNumber className="w-full" size="small" min={12} max={200} value={camera.focalLength} onChange={(focalLength) => setFocal(focalLength || 35)} />
                            </Field>
                            <Field label="光圈 f/">
                                <InputNumber className="w-full" size="small" min={0.7} max={32} step={0.1} value={camera.aperture} onChange={(aperture) => onUpdateCamera({ aperture: aperture || 2.8 })} />
                            </Field>
                            <Field label="对焦 m">
                                <InputNumber className="w-full" size="small" min={0.1} max={200} step={0.1} value={camera.focusDistance} onChange={(focusDistance) => onUpdateCamera({ focusDistance: focusDistance || 5 })} />
                            </Field>
                        </div>
                    </InspectorGroup>
                    <InspectorGroup title="机位">
                        <Button size="small" block icon={<Camera className="size-3.5" />} onClick={onAlignCameraToView}>
                            摄影机对齐当前视图
                        </Button>
                        <div className="previs-inspector-note">在 3D 视图里转到想要的角度，点上面的按钮，机位就移到这里。</div>
                        <details className="previs-inspector-advanced">
                            <summary>精确坐标</summary>
                            <div className="previs-inspector-advanced__body">
                                <Vec3Field label="摄影机位置" unit="m" value={camera.transform.position} onChange={(position) => onUpdateCamera({ transform: { ...camera.transform, position } })} />
                                <Vec3Field label="焦点" unit="m" value={camera.target} onChange={(target) => onUpdateCamera({ target })} />
                            </div>
                        </details>
                    </InspectorGroup>
                </>
            ) : null}
            <InspectorGroup title="运镜" hint={capabilities.timeline ? undefined : "切到「动画」可生成运镜"}>
                <Select className="w-full" size="small" value={shot.cameraMove} options={cameraMoveOptions} onChange={(cameraMove: PrevisCameraMove) => onUpdateShot({ cameraMove })} />
                {capabilities.timeline && camera ? (
                    <>
                        <div className="previs-anim-guide__actions">
                            <Button size="small" icon={<Video className="size-3.5" />} disabled={shot.cameraMove === "static"} title="根据上面选的运镜生成首尾关键帧" onClick={onApplyCameraMove}>
                                生成运镜
                            </Button>
                            <Button size="small" type={pathDrawing ? "primary" : "default"} icon={<Route className="size-3.5" />} onClick={onToggleDrawPath}>
                                {pathDrawing ? "取消绘制" : "画运镜路径"}
                            </Button>
                        </div>
                        {capabilities.keyframes ? (
                            <details className="previs-inspector-advanced">
                                <summary>高级：手动关键帧</summary>
                                <div className="previs-inspector-advanced__body">
                                    <Button size="small" block icon={<Focus className="size-3.5" />} onClick={onAddCameraKeyframe}>
                                        记录摄影机关键帧
                                    </Button>
                                    <div className="previs-inspector-note">在不同时间把机位摆到不同位置并分别记录，中间会自动补间。</div>
                                </div>
                            </details>
                        ) : null}
                    </>
                ) : null}
            </InspectorGroup>
            <InspectorGroup title="镜头意图">
                <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} value={shot.prompt} placeholder="人物表演、动作、叙事目标…会写进生成提示词" onChange={(event) => onUpdateShot({ prompt: event.target.value })} />
            </InspectorGroup>
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

const RAD_TO_DEG = 180 / Math.PI;

/**
 * 位置（米）、旋转（度，存档仍是弧度）、比例三行，每个输入都带 X/Y/Z 轴标记。
 * 低于地面的高度在提交时由落地规则拉回，这里不做只读限制。
 */
export function TransformFields({
    transform,
    onChange,
    scaleLabel = "缩放",
    scaleUnit,
    scaleAxisLabels,
}: {
    transform: PrevisTransform;
    onChange: (transform: PrevisTransform) => void;
    scaleLabel?: string;
    scaleUnit?: string;
    scaleAxisLabels?: [string, string, string];
}) {
    const degrees = transform.rotation.map((value) => value * RAD_TO_DEG) as PrevisVec3;
    return (
        <>
            <Vec3Field label="位置" unit="m" value={transform.position} onChange={(position) => onChange({ ...transform, position })} />
            <Vec3Field label="旋转" unit="°" value={degrees} step={5} precision={1} onChange={(rotation) => onChange({ ...transform, rotation: rotation.map((value) => value / RAD_TO_DEG) as PrevisVec3 })} />
            <Vec3Field label={scaleLabel} unit={scaleUnit} value={transform.scale} step={0.1} axisLabels={scaleAxisLabels} onChange={(scale) => onChange({ ...transform, scale })} />
        </>
    );
}

/** 检查器分组：小标题 + 可选右侧提示，组间留白与分隔线由 CSS 负责。 */
export function InspectorGroup({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
    return (
        <section className="previs-inspector-group" aria-label={title}>
            <div className="previs-inspector-group__title">
                <span>{title}</span>
                {hint ? <span className="previs-inspector-group__hint">{hint}</span> : null}
            </div>
            <div className="previs-inspector-group__body">{children}</div>
        </section>
    );
}

function ProfileSlider({ label, min, max, step = 0.01, value, suffix, onChange }: { label: string; min: number; max: number; step?: number; value: number; suffix?: string; onChange: (value: number) => void }) {
    return (
        <div className="previs-profile-slider">
            <span className="previs-profile-slider__label">{label}</span>
            <Slider className="m-0" min={min} max={max} step={step} value={value} aria-label={label} onChange={(next) => onChange(Array.isArray(next) ? (next[0] ?? value) : next)} />
            <span className="previs-profile-slider__value">{suffix ?? value.toFixed(2)}</span>
        </div>
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
            <div className="space-y-2">
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

const VEC3_AXES = ["X", "Y", "Z"] as const;

export function Vec3Field({
    label,
    value,
    step = 0.1,
    precision = 2,
    unit,
    axisLabels,
    onChange,
}: {
    label: string;
    value: PrevisVec3;
    step?: number;
    precision?: number;
    unit?: string;
    axisLabels?: [string, string, string];
    onChange: (value: PrevisVec3) => void;
}) {
    return (
        <div className="previs-vec3">
            <span className="previs-vec3__label">
                {label}
                {unit ? <span className="previs-vec3__unit">{unit}</span> : null}
            </span>
            <div className="previs-vec3__inputs">
                {value.map((item, index) => {
                    const axis = axisLabels?.[index] ?? VEC3_AXES[index];
                    return (
                        <label key={index} className={`previs-vec3__axis previs-vec3__axis--${VEC3_AXES[index].toLowerCase()}`}>
                            <span className="previs-vec3__axis-tag" aria-hidden="true">
                                {axis}
                            </span>
                            <InputNumber
                                className="w-full"
                                size="small"
                                variant="borderless"
                                step={step}
                                aria-label={`${label} ${axis}`}
                                value={Number(item.toFixed(precision))}
                                onChange={(next) => onChange(value.map((entry, itemIndex) => (itemIndex === index ? Number(next) || 0 : entry)) as PrevisVec3)}
                            />
                        </label>
                    );
                })}
            </div>
        </div>
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
            className="flex h-8 items-center gap-2 border px-2 text-[var(--fs-tiny)] transition hover:bg-black/5 dark:hover:bg-white/5"
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
