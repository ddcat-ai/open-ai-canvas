import { App, Button, InputNumber, Select } from "antd";
import { Footprints, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

import { Switch } from "@/components/ui/base/switch";
import {
    applyPrevisMotionPath,
    describePrevisMotionPath,
    insertPrevisPathPoint,
    planPrevisMotionPath,
    PREVIS_PATH_EASINGS,
    PREVIS_PATH_MAX_POINTS,
    PREVIS_PATH_SPEED_PRESETS,
    removePrevisPathPoint,
    resolvePrevisPathSpeed,
    updatePrevisPathPoint,
} from "@/lib/canvas/previs/previs-motion-path";
import { PREVIS_PATH_CAMERA_MODES, type PrevisPathCameraMode } from "@/lib/canvas/previs/previs-path-transfer";
import type { PrevisKeyframe, PrevisMarker, PrevisMotionPath, PrevisSketchPath, PrevisTransform, PrevisVec3 } from "@/types/previs";

type PathOwner = { id: string; transform: PrevisTransform; keyframes: PrevisKeyframe[]; motionPath?: PrevisMotionPath };

/**
 * 参考轨迹（没选对象时画下的紫色虚线）：每条一行，可删除；给了 onApply 时点一行套用到当前对象。
 * 摆场模式没有路径编辑区，镜头页直接用这个列表删除。
 */
export function PrevisSketchPathList({ paths, onApply, onDelete }: { paths: PrevisSketchPath[]; onApply?: (path: PrevisSketchPath) => void; onDelete?: (id: string) => void }) {
    if (!paths.length) return null;
    return (
        <div className="pv-camera-move__group">
            <span className="pv-camera-move__group-label">参考轨迹（没选对象时画下的）</span>
            <ul className="pv-travel__list" aria-label="参考轨迹">
                {paths.map((item) => (
                    <li key={item.id}>
                        {onApply ? (
                            <button type="button" className="pv-camera-move__seek" title="用这条轨迹替换当前路径" onClick={() => onApply(item)}>
                                <span>
                                    {item.label} · {item.points.length} 个点 · 套用
                                </span>
                            </button>
                        ) : (
                            <span>
                                {item.label} · {item.points.length} 个点
                            </span>
                        )}
                        {onDelete ? (
                            <button type="button" aria-label={`删除参考轨迹 ${item.label}`} title="删除这条参考轨迹" onClick={() => onDelete(item.id)}>
                                <Trash2 className="size-3.5" />
                            </button>
                        ) : null}
                    </li>
                ))}
            </ul>
        </div>
    );
}

/**
 * 路径编辑：速率（米/秒或用时）、运动规律、开始时间、折线 / 平滑曲线，逐个途经点的坐标、离地高度、
 * 段速度倍率与停留。每次修改都重新展开关键帧；高度以地面为 0 米。
 * 演员的高度写进关键帧 lift（人偶悬空移动），摄影机与道具直接作为位置高度。
 */
export function PrevisPathSection({
    owner,
    locked,
    origin,
    shotDuration,
    playhead,
    markers,
    sketchPaths,
    actors = [],
    onUpdate,
    onTransferToActor,
    onDeleteSketchPath,
    showDelete = true,
}: {
    owner: PathOwner;
    /** 演员：高度不低于 0，写进 lift。 */
    locked: boolean;
    /** 新建路径时的起点（对象当前所在位置，含高度）。 */
    origin: PrevisVec3;
    shotDuration: number;
    playhead: number;
    markers: PrevisMarker[];
    sketchPaths: PrevisSketchPath[];
    onUpdate: (patch: { keyframes: PrevisKeyframe[]; motionPath?: PrevisMotionPath }) => void;
    /** 场景里的演员；提供 onTransferToActor 时显示「让人物走这条轨迹」。 */
    actors?: Array<{ id: string; name: string }>;
    /** 把这条路径交给演员，并按 cameraMode 让镜头跟随（只在摄影机路径上提供）。 */
    onTransferToActor?: (input: { actorId: string; keepHeight: boolean; cameraMode: PrevisPathCameraMode }) => void;
    onDeleteSketchPath?: (id: string) => void;
    /** 摄影机的删除入口在「已有运镜」列表里，这里不再重复一个。 */
    showDelete?: boolean;
}) {
    const { message } = App.useApp();
    const path = owner.motionPath;
    const [sequence, setSequence] = useState<string[]>([]);
    const [transferActorId, setTransferActorId] = useState<string | undefined>(actors[0]?.id);
    const [transferMode, setTransferMode] = useState<PrevisPathCameraMode>("trail");
    const [keepHeight, setKeepHeight] = useState(false);
    const write = (next: PrevisMotionPath) => {
        try {
            const updated = applyPrevisMotionPath(owner, next, shotDuration, locked);
            onUpdate({ keyframes: updated.keyframes, motionPath: updated.motionPath });
        } catch (error) {
            message.warning(error instanceof Error ? error.message : "路径无效");
        }
    };
    const start = Math.min(Math.max(0, playhead), Math.max(0, shotDuration - 0.1));
    const fromPoints = (points: PrevisVec3[]) => write({ points, speed: "walk", metersPerSecond: locked ? 1.4 : 1.2, startDelay: start, orientToPath: locked });
    const markerOptions = markers.map((marker) => ({ value: marker.id, label: `点 ${marker.label}` }));
    const markerPoint = (id: string): PrevisVec3 | null => {
        const marker = markers.find((item) => item.id === id);
        return marker ? [marker.position[0], path?.points.at(-1)?.[1] ?? origin[1], marker.position[2]] : null;
    };

    const sketchList = <PrevisSketchPathList paths={sketchPaths} onApply={(item) => fromPoints(item.points.map((point) => [...point] as PrevisVec3))} onDelete={onDeleteSketchPath} />;

    if (!path) {
        return (
            <div className="pv-travel pv-path">
                <div className="previs-inspector-note">用画笔或折线在视口里画轨迹；也可以按顺序经过标记点，或套用画好的参考轨迹。</div>
                {markers.length ? (
                    <div className="pv-camera-move__group">
                        <span className="pv-camera-move__group-label">按顺序点选标记点{sequence.length ? `：${sequence.map((id) => markers.find((marker) => marker.id === id)?.label).join(" → ")}` : ""}</span>
                        <div className="pv-world__presets" role="group" aria-label="经过的标记点">
                            {markers.map((marker) => (
                                <button key={marker.id} type="button" className="pv-world__chip" onClick={() => setSequence((items) => [...items, marker.id])}>
                                    点 {marker.label}
                                </button>
                            ))}
                        </div>
                        <div className="pv-travel__row">
                            <Button size="small" disabled={!sequence.length} onClick={() => setSequence([])}>
                                清空
                            </Button>
                            <Button
                                size="small"
                                type="primary"
                                disabled={!sequence.length}
                                onClick={() => {
                                    const points = sequence.map((id) => markerPoint(id)).filter((point): point is PrevisVec3 => Boolean(point));
                                    fromPoints([origin, ...points.map((point) => [point[0], origin[1], point[2]] as PrevisVec3)]);
                                    setSequence([]);
                                }}
                            >
                                从当前位置依次经过
                            </Button>
                        </div>
                    </div>
                ) : null}
                {sketchList}
            </div>
        );
    }

    let plan: ReturnType<typeof planPrevisMotionPath> | null = null;
    try {
        plan = planPrevisMotionPath(path, shotDuration);
    } catch {
        plan = null;
    }
    const speed = resolvePrevisPathSpeed(path);
    const segmentSpeed = (index: number) => path.speeds?.[index] ?? 1;
    const hold = (index: number) => path.holds?.[index] ?? 0;
    const setArray = (key: "speeds" | "holds", index: number, value: number, fill: number, length: number) => {
        const values = Array.from({ length }, (_, item) => path[key]?.[item] ?? fill);
        values[index] = value;
        write({ ...path, [key]: values });
    };

    return (
        <div className="pv-travel pv-path">
            <div className="pv-path__head">
                <div className="pv-path__summary">{describePrevisMotionPath(path, plan)}</div>
                {showDelete ? (
                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => onUpdate({ keyframes: [], motionPath: undefined })}>
                        删除路径
                    </Button>
                ) : null}
            </div>
            {plan?.compressed ? <div className="previs-inspector-note">镜头时长不够，已整体加速压缩到 {plan.end.toFixed(1)}s 结束；加长镜头或缩短停留可恢复原速度。</div> : null}
            <div className="pv-camera-move__group">
                <span className="pv-camera-move__group-label">速率</span>
                <div className="pv-world__presets" role="group" aria-label="速度预设">
                    {PREVIS_PATH_SPEED_PRESETS.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            aria-pressed={!path.duration && Math.abs(speed - item.value) < 0.01}
                            className={`pv-world__chip ${!path.duration && Math.abs(speed - item.value) < 0.01 ? "is-active" : ""}`}
                            onClick={() => write({ ...path, metersPerSecond: item.value, duration: undefined })}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="pv-camera-move__params pv-path__timing">
                <label className="pv-camera-move__param">
                    <span>速度 m/s</span>
                    <InputNumber
                        size="small"
                        min={0.05}
                        max={100}
                        step={0.1}
                        value={path.duration ? null : Number(speed.toFixed(2))}
                        placeholder={path.duration ? "按用时" : undefined}
                        onChange={(value) => value && write({ ...path, metersPerSecond: value, duration: undefined })}
                        aria-label="速度"
                    />
                </label>
                <label className="pv-camera-move__param">
                    <span>或用时 s</span>
                    <InputNumber size="small" min={0.1} max={60} step={0.5} value={path.duration ?? null} placeholder={plan ? plan.travel.toFixed(1) : "自动"} onChange={(value) => write({ ...path, duration: value ?? undefined })} aria-label="移动用时" />
                </label>
                <label className="pv-camera-move__param">
                    <span className="pv-path__start-label">
                        开始 s
                        {Math.abs(path.startDelay - start) > 0.01 ? (
                            <button type="button" className="pv-path__link" title={`把开始时间设为播放头 ${start.toFixed(1)}s`} onClick={() => write({ ...path, startDelay: start })}>
                                用播放头
                            </button>
                        ) : null}
                    </span>
                    <InputNumber size="small" min={0} max={shotDuration} step={0.1} value={path.startDelay} onChange={(value) => write({ ...path, startDelay: value ?? 0 })} aria-label="开始时间" />
                </label>
            </div>
            <div className="pv-camera-move__group">
                <span className="pv-camera-move__group-label">运动规律</span>
                <div className="pv-world__presets" role="group" aria-label="运动规律">
                    {PREVIS_PATH_EASINGS.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            title={item.hint}
                            aria-pressed={(path.easing ?? "linear") === item.value}
                            className={`pv-world__chip ${(path.easing ?? "linear") === item.value ? "is-active" : ""}`}
                            onClick={() => write({ ...path, easing: item.value })}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            </div>
            <div className="previs-inspector-toggles">
                <label className="previs-inspector-toggle">
                    <span>平滑曲线</span>
                    <Switch checked={Boolean(path.curve)} onChange={(curve) => write({ ...path, curve })} />
                </label>
                {locked ? (
                    <label className="previs-inspector-toggle">
                        <span>面朝前进方向</span>
                        <Switch checked={path.orientToPath} onChange={(orientToPath) => write({ ...path, orientToPath })} />
                    </label>
                ) : null}
            </div>
            {/* 逐点坐标、段速和停留是精调：默认收起，视口里拖点就能改大部分。 */}
            <details className="previs-inspector-advanced">
                <summary>途经点（{path.points.length} 个）</summary>
                <div className="previs-inspector-advanced__body">
                    <div className="previs-inspector-note">高度以地面为 0 米；视口里拖动点改位置，按住 Shift 拖动改高度。</div>
                    <ol className="pv-path__points">
                        {path.points.map((point, index) => (
                            <li key={index}>
                                <div className="pv-path__point-head">
                                    <b>{index === 0 ? "起" : index === path.points.length - 1 ? "终" : index}</b>
                                    <InputNumber size="small" step={0.1} value={Number(point[0].toFixed(2))} prefix="X" onChange={(x) => x !== null && write(updatePrevisPathPoint(path, index, { x }))} aria-label={`第 ${index + 1} 点 X`} />
                                    <InputNumber
                                        size="small"
                                        step={0.1}
                                        min={0}
                                        value={Number(point[1].toFixed(2))}
                                        prefix="高"
                                        suffix="m"
                                        onChange={(y) => y !== null && write(updatePrevisPathPoint(path, index, { y: Math.max(0, y) }))}
                                        aria-label={`第 ${index + 1} 点离地高度`}
                                    />
                                    <InputNumber size="small" step={0.1} value={Number(point[2].toFixed(2))} prefix="Z" onChange={(z) => z !== null && write(updatePrevisPathPoint(path, index, { z }))} aria-label={`第 ${index + 1} 点 Z`} />
                                </div>
                                <div className="pv-path__point-tail">
                                    {index < path.points.length - 1 ? (
                                        <>
                                            <InputNumber
                                                size="small"
                                                min={0.1}
                                                max={10}
                                                step={0.1}
                                                value={segmentSpeed(index)}
                                                prefix="段速"
                                                suffix="×"
                                                onChange={(value) => value && setArray("speeds", index, value, 1, path.points.length - 1)}
                                                aria-label={`第 ${index + 1} 段速度倍率`}
                                            />
                                            <InputNumber
                                                size="small"
                                                min={0}
                                                max={60}
                                                step={0.5}
                                                value={hold(index)}
                                                prefix="停"
                                                suffix="s"
                                                onChange={(value) => setArray("holds", index, value ?? 0, 0, path.points.length)}
                                                aria-label={`第 ${index + 1} 点停留`}
                                            />
                                        </>
                                    ) : (
                                        <span className="pv-travel__hint pv-path__point-end">终点</span>
                                    )}
                                    <button type="button" disabled={path.points.length >= PREVIS_PATH_MAX_POINTS} title="在这个点后面加一个途经点" aria-label="在后面插入途经点" onClick={() => write(insertPrevisPathPoint(path, index))}>
                                        <Plus className="size-3.5" />
                                    </button>
                                    <button type="button" disabled={path.points.length <= 2} title="删除这个途经点" aria-label="删除途经点" onClick={() => write(removePrevisPathPoint(path, index))}>
                                        <Trash2 className="size-3.5" />
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ol>
                    {markers.length ? (
                        <Select
                            size="small"
                            placeholder="在末尾追加标记点为途经点…"
                            value={null}
                            options={markerOptions}
                            onChange={(id: string) => {
                                const point = markerPoint(id);
                                if (point) write(insertPrevisPathPoint(path, path.points.length - 1, point));
                            }}
                            aria-label="追加标记点"
                        />
                    ) : null}
                </div>
            </details>
            {/* 把摄影机路径交给人物是另一件事：收起，不和路径参数挤在一起；没有人物时整块不显示。 */}
            {onTransferToActor && actors.length ? (
                <details className="previs-inspector-advanced">
                    <summary>让人物走这条轨迹</summary>
                    <div className="previs-inspector-advanced__body pv-path__transfer">
                        {actors.length ? (
                            <>
                                <Select
                                    size="small"
                                    value={actors.some((actor) => actor.id === transferActorId) ? transferActorId : undefined}
                                    placeholder="选择人物"
                                    options={actors.map((actor) => ({ value: actor.id, label: actor.name }))}
                                    onChange={setTransferActorId}
                                    aria-label="走这条轨迹的人物"
                                />
                                <Select size="small" value={transferMode} options={PREVIS_PATH_CAMERA_MODES.map((item) => ({ value: item.value, label: item.label, title: item.hint }))} onChange={setTransferMode} aria-label="镜头怎么跟" />
                                <div className="previs-inspector-note">{PREVIS_PATH_CAMERA_MODES.find((item) => item.value === transferMode)?.hint}</div>
                                <label className="previs-inspector-toggle">
                                    <span>人物按轨迹高度飞行（关闭则贴地走）</span>
                                    <Switch checked={keepHeight} onChange={setKeepHeight} />
                                </label>
                                <Button
                                    size="small"
                                    type="primary"
                                    icon={<Footprints className="size-3.5" />}
                                    disabled={!actors.some((actor) => actor.id === transferActorId)}
                                    onClick={() => transferActorId && onTransferToActor({ actorId: transferActorId, keepHeight, cameraMode: transferMode })}
                                >
                                    人物走这条轨迹
                                </Button>
                            </>
                        ) : (
                            <div className="previs-inspector-note">场景里还没有人物；先从左侧工具条添加角色。</div>
                        )}
                    </div>
                </details>
            ) : null}
            {sketchList}
        </div>
    );
}
