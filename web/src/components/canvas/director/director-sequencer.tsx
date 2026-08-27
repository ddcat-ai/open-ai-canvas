import { ChevronDown, ChevronRight, ChevronUp, KeyRound, Magnet, Pause, Play, Plus, Rows3, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { directorBoneLabel } from "@/lib/canvas/director/director-scene";
import { releaseDirectorFocusAfterPointer } from "@/lib/canvas/director/director-shortcuts";
import type { DirectorCamera, DirectorKeyframeDeleteTarget, DirectorKeyframeEasing, DirectorObject, DirectorScene, DirectorShot } from "@/types/director";

type DirectorSequencerProps = {
    scene: DirectorScene;
    shot: DirectorShot;
    camera: DirectorCamera | null;
    objects: DirectorObject[];
    selectedObjectId: string | null;
    selectedBone: string | null;
    playhead: number;
    playing: boolean;
    autoKey: boolean;
    height: number;
    visible: boolean;
    onPlayToggle: () => void;
    onPlayheadChange: (time: number) => void;
    onAutoKeyChange: (value: boolean) => void;
    onHeightChange: (height: number) => void;
    onVisibilityChange: (visible: boolean) => void;
    onSelectObject: (id: string | null) => void;
    onSelectBone: (bone: string | null) => void;
    onRecordKeyframe: () => void;
    onAddShot: () => void;
    /** 删除某条可见轨道上的关键帧；覆盖 transform / camera / bone 三类。 */
    onDeleteKeyframe: (target: DirectorKeyframeDeleteTarget) => void;
    /** 更新关键帧到下一帧区间的缓动。 */
    onSetKeyframeEasing: (target: DirectorKeyframeDeleteTarget, easing: DirectorKeyframeEasing) => void;
    onSelectShot: (id: string) => void;
};

/**
 * 轨道上的一个关键帧标记。
 * 带 target 才可删除；镜头总轨等只读轨道不给 target。
 */
type TrackKey = { id: string; time: number; color?: string; label?: string; easing?: DirectorKeyframeEasing; target?: DirectorKeyframeDeleteTarget };

export function DirectorSequencer({ scene, shot, camera, objects, selectedObjectId, selectedBone, playhead, playing, autoKey, height, visible, onPlayToggle, onPlayheadChange, onAutoKeyChange, onHeightChange, onVisibilityChange, onSelectObject, onSelectBone, onRecordKeyframe, onAddShot, onDeleteKeyframe, onSetKeyframeEasing, onSelectShot }: DirectorSequencerProps) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [showDetails, setShowDetails] = useState(true);
    const [timelineScale, setTimelineScale] = useState(1);
    const [selectedKey, setSelectedKey] = useState<TrackKey | null>(null);
    const duration = Math.max(0.5, shot.duration);
    const fps = shot.fps || 24;
    const rootRef = useRef<HTMLDivElement>(null);
    const ticks = useMemo(() => Array.from({ length: Math.ceil(duration) + 1 }, (_, index) => index), [duration]);
    const actorObjects = objects.filter((object) => object.kind === "actor" || object.primitive === "character");
    const activeSelectedKey = selectedKey?.target && directorKeyframeTargetExists(selectedKey.target, camera, objects) ? selectedKey : null;

    // 选择只对当前可见轨道有效。切换镜头/摄影机或外部删帧后立即废弃旧 target，
    // 避免顶部缓动与删除控件继续修改已经不可见的轨道。
    useEffect(() => {
        setSelectedKey((current) => current?.target && !directorKeyframeTargetExists(current.target, camera, objects) ? null : current);
    }, [camera, objects]);

    const setTimeFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const rawTime = Math.max(0, Math.min(duration, ((event.clientX - rect.left) / Math.max(rect.width, 1)) * duration));
        onPlayheadChange(snapEnabled ? Math.round(rawTime * fps) / fps : rawTime);
    };

    const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
        event.preventDefault();
        const startY = event.clientY;
        const startHeight = height;
        const move = (moveEvent: PointerEvent) => onHeightChange(startHeight + startY - moveEvent.clientY);
        const stop = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop, { once: true });
    };

    // 摄影机关键帧只在摄影机行提供删除入口；Camera Cut 是概览轨，保持只读。
    const cameraKeys: TrackKey[] = camera?.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#78a9ff", label: `${camera.name} 镜头`, easing: key.easing, target: { track: "camera", cameraId: camera.id, keyframeId: key.id } })) || [];

    const selectTrackKey = (key: TrackKey) => {
        if (!key.target) return;
        setSelectedKey(key);
        onPlayheadChange(key.time);
        if (key.target.track === "camera") {
            onSelectObject(null);
            onSelectBone(null);
        } else {
            onSelectObject(key.target.objectId);
            onSelectBone(key.target.track === "object-bone" ? key.target.bone : null);
        }
    };

    const deleteTrackKey = (target: DirectorKeyframeDeleteTarget) => {
        onDeleteKeyframe(target);
        if (selectedKey?.target && directorKeyframeTargetId(selectedKey.target) === directorKeyframeTargetId(target)) setSelectedKey(null);
    };

    if (!visible) {
        return <section className="director-sequencer shrink-0 border-t" style={{ height: "var(--space-8)", minHeight: 0, background: "var(--director-sequencer-surface)", borderColor: "var(--director-sequencer-border)" }}>
            <div className="flex h-full items-center justify-end px-3">
                <button type="button" className="director-sequencer-tool" title="显示时间轴" aria-label="显示时间轴" onClick={() => onVisibilityChange(true)}><ChevronUp className="size-3.5" /><span>显示时间轴</span></button>
            </div>
        </section>;
    }

    return (
        <section ref={rootRef} className="director-sequencer shrink-0 border-t" style={{ height, minHeight: "var(--director-sequencer-min-height)", background: "var(--director-sequencer-surface)", borderColor: "var(--director-sequencer-border)" }}>
            <div className="director-sequencer-resizer" onPointerDown={startResize} role="separator" aria-label="调整时间轴高度" />
            <header className="flex h-10 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: "var(--director-sequencer-border)" }}>
                <button type="button" className="director-sequencer-transport" onClick={onPlayToggle} aria-label={playing ? "暂停" : "播放"} title={playing ? "暂停" : "播放"}>{playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}</button>
                <span className="w-14 text-right text-[var(--fs-caption)] font-medium tabular-nums text-white/75">{formatTime(playhead)}</span>
                <span className="text-[var(--fs-micro)] text-white/35">/ {formatTime(duration)} · {fps}fps</span>
                <span className="mx-1 h-4 w-px bg-white/10" />
                <select className="director-sequencer-shot-select" value={shot.id} aria-label="当前镜头" onChange={(event) => onSelectShot(event.target.value)}>
                    {scene.shots.map((item, index) => <option key={item.id} value={item.id}>{index + 1}. {item.name}</option>)}
                </select>
                <button type="button" className={`director-sequencer-tool ${autoKey ? "is-active" : ""}`} onClick={() => onAutoKeyChange(!autoKey)} aria-pressed={autoKey} title="自动关键帧"><KeyRound className="size-3.5" /><span>自动关键帧</span></button>
                <button type="button" className={`director-sequencer-tool ${snapEnabled ? "is-active" : ""}`} title="吸附到帧" aria-pressed={snapEnabled} onClick={() => setSnapEnabled((value) => !value)}><Magnet className="size-3.5" /><span>吸附</span></button>
                <button type="button" className="director-sequencer-tool" title="记录当前关键帧" onClick={onRecordKeyframe}><KeyRound className="size-3.5" /><span>记录</span></button>
                {activeSelectedKey?.target ? <>
                    <select
                        className="director-sequencer-shot-select"
                        value={activeSelectedKey.easing || "linear"}
                        aria-label="关键帧缓动"
                        title="关键帧到下一帧的缓动"
                        onChange={(event) => {
                            const easing = event.target.value as DirectorKeyframeEasing;
                            onSetKeyframeEasing(activeSelectedKey.target!, easing);
                            setSelectedKey((current) => current ? { ...current, easing } : current);
                        }}
                    >
                        <option value="step">保持</option>
                        <option value="linear">线性</option>
                        <option value="smooth">平滑</option>
                    </select>
                    <button type="button" className="director-sequencer-icon" title="删除所选关键帧" aria-label="删除所选关键帧" onClick={() => deleteTrackKey(activeSelectedKey.target!)}><Trash2 className="size-3.5" /></button>
                </> : null}
                <span className="ml-auto flex items-center gap-1">
                    <button type="button" className="director-sequencer-icon" title="缩小时间轴" aria-label="缩小时间轴" onClick={() => setTimelineScale((value) => Math.max(0.75, value - 0.25))}><ZoomOut className="size-3.5" /></button>
                    <button type="button" className="director-sequencer-icon" title="放大时间轴" aria-label="放大时间轴" onClick={() => setTimelineScale((value) => Math.min(2.5, value + 0.25))}><ZoomIn className="size-3.5" /></button>
                    <button type="button" className={`director-sequencer-icon ${showDetails ? "is-active" : ""}`} title="显示子轨道" aria-label="显示子轨道" aria-pressed={showDetails} onClick={() => setShowDetails((value) => !value)}><Rows3 className="size-3.5" /></button>
                    <button type="button" className="director-sequencer-icon" title="新增镜头" aria-label="新增镜头" onClick={onAddShot}><Plus className="size-3.5" /></button>
                    <button type="button" className="director-sequencer-icon" title="隐藏时间轴" aria-label="隐藏时间轴" onClick={() => onVisibilityChange(false)}><ChevronDown className="size-3.5" /></button>
                </span>
            </header>

            <div className="director-sequencer-body thin-scrollbar overflow-auto">
                <div className="director-sequencer-grid" style={{ "--director-sequencer-duration": duration, "--director-sequencer-track-scale": timelineScale } as CSSProperties}>
                    <span className="director-sequencer-global-playhead"><i style={{ left: `${(playhead / duration) * 100}%` }} /></span>
                    <div className="director-sequencer-label director-sequencer-ruler-label">轨道</div>
                    <div className="director-sequencer-ruler" onPointerDown={setTimeFromPointer}>
                        {ticks.map((tick) => <span key={tick} className="director-sequencer-tick" style={{ left: `${(tick / duration) * 100}%` }}>{tick}s</span>)}
                        <span className="director-sequencer-playhead" style={{ left: `${(playhead / duration) * 100}%` }} />
                    </div>

                    <SequencerRow label="镜头总轨" icon="◈" selected={false} onClick={() => undefined}>
                        <TrackBar duration={duration} color="#7da2ff" label={`${shot.name} · ${formatTime(duration)}`} />
                    </SequencerRow>
                    <SequencerRow label="Camera Cut" icon="▣" selected={false} onClick={() => undefined}>
                        <TrackKeys duration={duration} keys={cameraKeys} />
                    </SequencerRow>
                    {camera ? <SequencerRow label={camera.name} icon="⌾" selected={!selectedObjectId} onClick={() => { onSelectObject(null); onSelectBone(null); }}>
                        <TrackBar duration={duration} color="#78a9ff" label="Transform · 焦距 · 景深" />
                        <TrackKeys duration={duration} keys={cameraKeys} selectedTarget={activeSelectedKey?.target} onSelectKey={selectTrackKey} onDeleteKey={deleteTrackKey} />
                    </SequencerRow> : null}
                    {actorObjects.map((object) => {
                        const isExpanded = expanded[object.id] ?? object.id === selectedObjectId;
                        const activeClip = object.motionClips?.find((clip) => clip.id === object.activeMotionClipId);
                        // 骨骼帧 id 在不同轨道间可能重复，React key 用「骨骼-帧」组合；删除目标仍指向原始帧 id。
                        const boneTrackKeys: TrackKey[] = object.boneTracks?.flatMap((track) => track.keyframes.map((key) => ({ id: `bone-${track.bone}-${key.id}`, time: key.time, color: "#f0b36a", label: `${object.name} ${directorBoneLabel(track.bone)}`, easing: key.easing, target: { track: "object-bone" as const, objectId: object.id, bone: track.bone, keyframeId: key.id } }))) || [];
                        const transformKeys: TrackKey[] = object.keyframes.map((key) => ({ id: `transform-${key.id}`, time: key.time, color: "#61d2ad", label: `${object.name} Transform`, easing: key.easing, target: { track: "object-transform" as const, objectId: object.id, keyframeId: key.id } }));
                        return <div key={object.id} className="contents">
                            <SequencerRow label={object.name} icon={isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} selected={selectedObjectId === object.id && !selectedBone} onClick={() => { onSelectObject(object.id); onSelectBone(null); setExpanded((current) => ({ ...current, [object.id]: !isExpanded })); }}>
                                {/* 折叠时这是唯一的关键帧入口，必须可删除。 */}
                                <TrackKeys duration={duration} keys={[...transformKeys, ...boneTrackKeys]} selectedTarget={activeSelectedKey?.target} onSelectKey={selectTrackKey} onDeleteKey={deleteTrackKey} />
                            </SequencerRow>
                            {isExpanded && showDetails ? <>
                                <SequencerRow label="动作片段" icon="▶" indent selected={selectedObjectId === object.id && !selectedBone} onClick={() => onSelectObject(object.id)}>
                                    <TrackBar duration={duration} color="#61d2ad" label={activeClip ? `${activeClip.name}${activeClip.loop ? " · 循环" : ""}` : "姿势 / 动作"} start={activeClip?.start || 0} clipDuration={activeClip?.loop ? duration : activeClip?.duration || duration} />
                                </SequencerRow>
                                <SequencerRow label="Transform" icon="◇" indent selected={selectedObjectId === object.id && !selectedBone} onClick={() => { onSelectObject(object.id); onSelectBone(null); }}>
                                    <TrackKeys duration={duration} keys={transformKeys} selectedTarget={activeSelectedKey?.target} onSelectKey={selectTrackKey} onDeleteKey={deleteTrackKey} />
                                </SequencerRow>
                                {object.boneTracks?.map((track) => {
                                    const keys: TrackKey[] = track.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#f0b36a", label: `${object.name} ${directorBoneLabel(track.bone)}`, easing: key.easing, target: { track: "object-bone", objectId: object.id, bone: track.bone, keyframeId: key.id } }));
                                    return <SequencerRow key={track.bone} label={directorBoneLabel(track.bone)} icon="◌" indent selected={selectedObjectId === object.id && selectedBone === track.bone} onClick={() => { onSelectObject(object.id); onSelectBone(track.bone); }}><TrackKeys duration={duration} keys={keys} selectedTarget={activeSelectedKey?.target} onSelectKey={selectTrackKey} onDeleteKey={deleteTrackKey} /></SequencerRow>;
                                })}
                            </> : null}
                        </div>;
                    })}
                    {objects.filter((object) => !actorObjects.some((actor) => actor.id === object.id)).map((object) => {
                        const keys: TrackKey[] = object.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#b8c0ca", label: `${object.name} Transform`, easing: key.easing, target: { track: "object-transform", objectId: object.id, keyframeId: key.id } }));
                        return <SequencerRow key={object.id} label={object.name} icon="□" selected={selectedObjectId === object.id} onClick={() => { onSelectObject(object.id); onSelectBone(null); }}><TrackKeys duration={duration} keys={keys} selectedTarget={activeSelectedKey?.target} onSelectKey={selectTrackKey} onDeleteKey={deleteTrackKey} /></SequencerRow>;
                    })}
                </div>
            </div>
        </section>
    );
}

/**
 * 轨道行。标签按钮是选择控件，点完必须释放焦点：
 *「点选轨道 -> 按 Delete」与场景列表同源，焦点留在按钮上会让守卫吃掉 Delete。
 * 注意 children 里的 TrackKeys 不走这条规则 —— 关键帧按钮自己拥有那些键。
 */
function SequencerRow({ label, icon, selected, indent, children, onClick }: { label: string; icon: ReactNode; selected: boolean; indent?: boolean; children: ReactNode; onClick: () => void }) {
    return <div className={`director-sequencer-row ${selected ? "is-selected" : ""}`}>
        <button type="button" className={`director-sequencer-label ${indent ? "is-indent" : ""}`} onClick={(event) => { onClick(); releaseDirectorFocusAfterPointer(event); }}><span className="director-sequencer-row-icon">{icon}</span><span className="min-w-0 truncate">{label}</span></button>
        <div className="director-sequencer-track">{children}</div>
    </div>;
}

/**
 * 关键帧渲染为真实 button：可 Tab 聚焦、可 Enter/Space/Delete 触发、也可点击。
 * 之前是惰性 span，关键帧一旦记录就无法删除。
 *
 * 只有同时具备 onDeleteKey 和 key.target 才可交互；
 * 概览轨（Camera Cut）保持只读 span，避免同一帧出现两个语义相同的删除入口。
 */
function TrackKeys({ duration, keys, selectedTarget, onSelectKey, onDeleteKey }: { duration: number; keys: TrackKey[]; selectedTarget?: DirectorKeyframeDeleteTarget; onSelectKey?: (key: TrackKey) => void; onDeleteKey?: (target: DirectorKeyframeDeleteTarget) => void }) {
    return (
        <div className="director-sequencer-track-content">
            {keys.map((key) => {
                const target = onDeleteKey && key.target;
                if (!target) {
                    return <span
                        key={key.id}
                        className="director-sequencer-key"
                        style={{ left: `${(key.time / duration) * 100}%`, background: key.color || "#d7dee8" }}
                        title={`${key.time.toFixed(2)}s`}
                    />;
                }
                return <button
                    key={key.id}
                    type="button"
                    className={`director-sequencer-key is-actionable ${selectedTarget && directorKeyframeTargetId(selectedTarget) === directorKeyframeTargetId(target) ? "is-selected" : ""}`}
                    style={{ left: `${(key.time / duration) * 100}%`, background: key.color || "#d7dee8" }}
                    aria-label={`选择 ${key.label ?? "关键帧"} ${key.time.toFixed(2)}s 的关键帧`}
                    aria-pressed={Boolean(selectedTarget && directorKeyframeTargetId(selectedTarget) === directorKeyframeTargetId(target))}
                    title={`${key.time.toFixed(2)}s · 点击定位，按 Delete 删除`}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSelectKey?.(key);
                    }}
                    onKeyDown={(event) => {
                        if (!["Enter", " ", "Delete", "Backspace"].includes(event.key)) return;
                        event.preventDefault();
                        event.stopPropagation();
                        if (event.key === "Delete" || event.key === "Backspace") onDeleteKey(target);
                        else onSelectKey?.(key);
                    }}
                />;
            })}
        </div>
    );
}

function directorKeyframeTargetExists(target: DirectorKeyframeDeleteTarget, camera: DirectorCamera | null, objects: DirectorObject[]) {
    if (target.track === "camera") return camera?.id === target.cameraId && camera.keyframes.some((keyframe) => keyframe.id === target.keyframeId);
    const object = objects.find((item) => item.id === target.objectId);
    if (!object) return false;
    if (target.track === "object-transform") return object.keyframes.some((keyframe) => keyframe.id === target.keyframeId);
    return object.boneTracks?.some((track) => track.bone === target.bone && track.keyframes.some((keyframe) => keyframe.id === target.keyframeId)) ?? false;
}

function directorKeyframeTargetId(target: DirectorKeyframeDeleteTarget) {
    if (target.track === "camera") return `camera:${target.cameraId}:${target.keyframeId}`;
    if (target.track === "object-transform") return `object:${target.objectId}:transform:${target.keyframeId}`;
    return `object:${target.objectId}:bone:${target.bone}:${target.keyframeId}`;
}

function TrackBar({ duration, color, label, start = 0, clipDuration }: { duration: number; color: string; label: string; start?: number; clipDuration?: number }) {
    return <div className="director-sequencer-track-content"><span className="director-sequencer-clip" style={{ left: `${(start / duration) * 100}%`, width: `${((clipDuration ?? duration) / duration) * 100}%`, background: `${color}33`, borderColor: `${color}88`, color }}><span className="truncate">{label}</span></span></div>;
}

function formatTime(time: number) {
    return `${time.toFixed(2)}s`;
}
