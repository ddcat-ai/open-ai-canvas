import { App, Button, InputNumber, Select } from "antd";
import { Clapperboard, Plus, Route, Trash2 } from "lucide-react";
import { useState } from "react";

import { addPrevisCameraMoves, buildPrevisCameraRecipeMoves, createPrevisCameraMove } from "@/lib/canvas/previs/previs-camera-moves";
import { PREVIS_PATH_EASINGS } from "@/lib/canvas/previs/previs-motion-path";
import {
    describePrevisCameraMove,
    PREVIS_CAMERA_FOLLOW_SHOT_SIZES,
    PREVIS_CAMERA_FOLLOW_SIDES,
    PREVIS_CAMERA_MAX_MOVES,
    PREVIS_CAMERA_RECIPES,
    PREVIS_CAMERA_TECHNIQUE_GROUPS,
    PREVIS_CAMERA_TECHNIQUES,
    resolvePrevisCameraTechnique,
    type PrevisCameraNumberParamKey,
    type PrevisCameraRecipe,
} from "@/lib/canvas/previs/previs-camera-techniques";
import type { PrevisCamera, PrevisCameraFollowSide, PrevisCameraMoveParams, PrevisCameraMoveSegment, PrevisCameraTechnique, PrevisPathEasing, PrevisScene, PrevisShotSize } from "@/types/previs";

/**
 * 摄影机「运镜」：view=technique 选单个手法（推拉摇移、环绕、希区柯克变焦、跟拍…）与主体，从播放头开始添加一段；
 * view=recipe 一键套用大师手法整套。两种视图共用同一份主体选择，切换时不丢。
 * 结果写进 camera.moves，视口、录制和提示词共用。
 */
export function PrevisCameraMoveSection({
    camera,
    scene,
    playhead,
    shotDuration,
    view = "technique",
    onChange,
}: {
    camera: PrevisCamera;
    scene: Pick<PrevisScene, "objects">;
    playhead: number;
    shotDuration: number;
    view?: "technique" | "recipe";
    onChange: (moves: PrevisCameraMoveSegment[] | undefined) => void;
}) {
    const { message } = App.useApp();
    const subjects = scene.objects.filter((object) => object.visible && object.kind !== "layout").toSorted((left, right) => Number(isActor(right)) - Number(isActor(left)));
    const [technique, setTechnique] = useState<PrevisCameraTechnique>("push_in");
    const [subjectId, setSubjectId] = useState<string | undefined>(() => subjects.find(isActor)?.id);
    const [params, setParams] = useState<PrevisCameraMoveParams>({});
    const [duration, setDuration] = useState<number | null>(null);
    const [easing, setEasing] = useState<PrevisPathEasing>("smooth");
    const info = resolvePrevisCameraTechnique(technique) ?? PREVIS_CAMERA_TECHNIQUES[0];
    const start = Math.min(Math.max(0, playhead), Math.max(0, shotDuration - 0.1));
    const remaining = Math.max(0.1, shotDuration - start);
    const activeSubject = subjects.some((item) => item.id === subjectId) ? subjectId : undefined;
    const moves = camera.moves ?? [];
    const needsSubject = info.subject === "required" && !activeSubject;

    const commit = (next: PrevisCameraMoveSegment[]) => {
        const updated = addPrevisCameraMoves(camera, next);
        if (!updated) {
            message.warning(`每台摄影机最多 ${PREVIS_CAMERA_MAX_MOVES} 段运镜，先删掉一些再添加`);
            return;
        }
        onChange(updated.moves);
    };
    const add = () => {
        if (needsSubject) return;
        commit([createPrevisCameraMove({ technique, start, duration: duration ?? undefined, subjectId: info.subject === "none" ? undefined : activeSubject, params, easing: easing === "smooth" ? undefined : easing }, shotDuration)]);
    };
    const applyRecipe = (recipe: PrevisCameraRecipe) => {
        const built = buildPrevisCameraRecipeMoves(recipe, { start, duration: remaining, subjectId: recipe.subject === "none" ? undefined : activeSubject, shotDuration });
        if (built.length) commit(built);
    };
    const selectTechnique = (next: PrevisCameraTechnique) => {
        setTechnique(next);
        setParams({});
        setDuration(null);
    };
    const setNumber = (key: PrevisCameraNumberParamKey, value: number | null) => setParams((current) => ({ ...current, [key]: value ?? undefined }));

    const subjectSelect = ({ label, placeholder, clearable }: { label: string; placeholder: string; clearable: boolean }) => (
        <div className="pv-travel__row">
            <span className="pv-travel__hint">{label}</span>
            <Select
                size="small"
                className="pv-travel__select"
                value={activeSubject}
                allowClear={clearable}
                placeholder={placeholder}
                onChange={(value) => setSubjectId(value)}
                options={subjects.map((item) => ({ value: item.id, label: item.name }))}
                aria-label="运镜主体"
            />
        </div>
    );

    if (view === "recipe") {
        const blockedCount = PREVIS_CAMERA_RECIPES.filter((recipe) => recipe.subject === "required").length;
        return (
            <div className="pv-travel pv-camera-move">
                <div className="previs-inspector-note">
                    一键套用整套运镜，从播放头 {start.toFixed(1)}s 起铺满剩余 {remaining.toFixed(1)}s。
                </div>
                {subjectSelect({ label: "主体", placeholder: subjects.length ? "选择人物或物体" : "场景里还没有人物或物体", clearable: true })}
                {!activeSubject && blockedCount ? <div className="previs-inspector-note">灰色的手法要跟着人物或物体，先在上面选主体。</div> : null}
                <div className="pv-world__presets" role="group" aria-label="大师手法">
                    {PREVIS_CAMERA_RECIPES.map((recipe) => {
                        const blocked = recipe.subject === "required" && !activeSubject;
                        return (
                            <button key={recipe.id} type="button" className="pv-world__chip" disabled={blocked} title={`${recipe.source}：${recipe.hint}${blocked ? "（先选主体）" : ""}`} onClick={() => applyRecipe(recipe)}>
                                {recipe.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    }

    return (
        <div className="pv-travel pv-camera-move">
            {PREVIS_CAMERA_TECHNIQUE_GROUPS.map((group) => (
                <div key={group.id} className="pv-camera-move__group">
                    <span className="pv-camera-move__group-label">{group.label}</span>
                    <div className="pv-world__presets" role="group" aria-label={group.label}>
                        {PREVIS_CAMERA_TECHNIQUES.filter((item) => item.group === group.id).map((item) => (
                            <button key={item.id} type="button" aria-pressed={technique === item.id} title={item.hint} className={`pv-world__chip ${technique === item.id ? "is-active" : ""}`} onClick={() => selectTechnique(item.id)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
            ))}
            <div className="previs-inspector-note">{info.hint}</div>
            {info.subject !== "none" ? subjectSelect(info.subject === "required" ? { label: "主体", placeholder: "选择跟随的人物或物体", clearable: false } : { label: "围绕", placeholder: "焦点（不指定主体）", clearable: true }) : null}
            {info.params.length ? (
                <div className="pv-camera-move__params">
                    {info.params.map((spec) =>
                        spec.kind === "side" ? (
                            <label key={spec.key} className="pv-camera-move__param">
                                <span>{spec.label}</span>
                                <Select
                                    size="small"
                                    value={params.side ?? "behind"}
                                    onChange={(side: PrevisCameraFollowSide) => setParams((current) => ({ ...current, side }))}
                                    options={PREVIS_CAMERA_FOLLOW_SIDES.map((item) => ({ value: item.value, label: item.label }))}
                                    aria-label="跟拍方位"
                                />
                            </label>
                        ) : spec.kind === "shotSize" ? (
                            <label key={spec.key} className="pv-camera-move__param">
                                <span>{spec.label}</span>
                                <Select
                                    size="small"
                                    allowClear
                                    value={params.shotSize}
                                    placeholder="按方位默认距离"
                                    onChange={(shotSize: PrevisShotSize | undefined) => setParams((current) => ({ ...current, shotSize }))}
                                    options={PREVIS_CAMERA_FOLLOW_SHOT_SIZES.map((item) => ({ value: item.value, label: item.label }))}
                                    aria-label="跟拍景别"
                                />
                            </label>
                        ) : (
                            <label key={spec.key} className="pv-camera-move__param">
                                <span>
                                    {spec.label}
                                    {spec.unit ? ` · ${spec.unit}` : ""}
                                </span>
                                <InputNumber
                                    size="small"
                                    min={spec.min}
                                    max={spec.max}
                                    step={spec.step}
                                    value={params[spec.key] ?? null}
                                    placeholder={spec.defaultValue !== undefined ? String(spec.defaultValue) : (spec.autoHint ?? "自动")}
                                    onChange={(value) => setNumber(spec.key, value)}
                                    aria-label={spec.label}
                                />
                            </label>
                        ),
                    )}
                </div>
            ) : null}
            {info.layer ? null : (
                <div className="pv-camera-move__group">
                    <span className="pv-camera-move__group-label">运动规律</span>
                    <div className="pv-world__presets" role="group" aria-label="运镜运动规律">
                        {PREVIS_PATH_EASINGS.map((item) => (
                            <button key={item.value} type="button" title={item.hint} aria-pressed={easing === item.value} className={`pv-world__chip ${easing === item.value ? "is-active" : ""}`} onClick={() => setEasing(item.value)}>
                                {item.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            <div className="pv-travel__row">
                <span className="pv-travel__hint">{start.toFixed(1)}s 起，用时</span>
                <InputNumber
                    size="small"
                    min={0.1}
                    max={remaining}
                    step={0.5}
                    value={duration}
                    placeholder={String(Number(Math.min(info.duration ?? remaining, remaining).toFixed(2)))}
                    suffix="秒"
                    onChange={(value) => setDuration(value)}
                    aria-label="运镜时长"
                />
                <Button size="small" type="primary" icon={<Plus className="size-3.5" />} disabled={needsSubject} title={needsSubject ? "先选择跟随的主体" : `从 ${start.toFixed(1)}s 添加${info.label}`} onClick={add}>
                    添加
                </Button>
            </div>
            {moves.length ? null : <div className="previs-inspector-note">多段运镜按时间先后叠加，后一段从前一段结束的机位继续；手持、震动可以与其他运镜重叠。</div>}
        </div>
    );
}

/** 删除画出的运镜路径：与右键菜单的「删除整条路径」同一语义，路径展开的关键帧一并清掉。每次返回新数组，避免共享引用。 */
function clearedCameraPath(): Pick<PrevisCamera, "keyframes" | "motionPath"> {
    return { keyframes: [], motionPath: undefined };
}

/**
 * 摄影机已有的运镜：画出的运镜路径与每段运镜各占一行。点一行把播放头移到开始，垃圾桶删除，
 * 多于一项时可一键清空。摆场与动画模式都放在「运镜」分组最上方，删运镜不必翻到添加区下面。
 */
export function PrevisCameraMotionList({
    camera,
    scene,
    onChange,
    onSeek,
}: {
    camera: PrevisCamera;
    scene: Pick<PrevisScene, "objects">;
    onChange: (patch: Pick<Partial<PrevisCamera>, "moves" | "keyframes" | "motionPath">) => void;
    onSeek: (time: number) => void;
}) {
    const moves = (camera.moves ?? []).toSorted((left, right) => left.start - right.start);
    const path = camera.motionPath;
    const count = moves.length + (path ? 1 : 0);
    if (!count) return null;
    return (
        <>
            <ul className="pv-travel__list" aria-label="已有运镜">
                {path ? (
                    <li>
                        <button type="button" className="pv-camera-move__seek" title="把播放头移到运镜路径开始" onClick={() => onSeek(path.startDelay)}>
                            <Route className="size-3" aria-hidden />
                            <span>
                                画出的运镜路径 · {path.points.length} 个点 · {path.startDelay.toFixed(1)}s 起
                            </span>
                        </button>
                        <button type="button" aria-label="删除运镜路径" title="删除运镜路径" onClick={() => onChange(clearedCameraPath())}>
                            <Trash2 className="size-3.5" />
                        </button>
                    </li>
                ) : null}
                {moves.map((move) => (
                    <li key={move.id}>
                        <button type="button" className="pv-camera-move__seek" title="把播放头移到这段运镜开始" onClick={() => onSeek(move.start)}>
                            <Clapperboard className="size-3" aria-hidden />
                            <span>{describePrevisCameraMove(move, scene)}</span>
                        </button>
                        <button
                            type="button"
                            aria-label="删除这段运镜"
                            title="删除这段运镜"
                            onClick={() => {
                                const rest = moves.filter((item) => item.id !== move.id);
                                onChange({ moves: rest.length ? rest : undefined });
                            }}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </li>
                ))}
            </ul>
            {count > 1 ? (
                <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onChange({ moves: undefined, ...(path ? clearedCameraPath() : {}) })}>
                    清空运镜（{count} 项）
                </Button>
            ) : null}
        </>
    );
}

function isActor(object: { kind: string; primitive?: string }) {
    return object.kind === "actor" || object.primitive === "character";
}
