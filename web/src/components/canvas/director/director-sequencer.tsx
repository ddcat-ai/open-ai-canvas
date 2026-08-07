import { ChevronDown, ChevronRight, KeyRound, Magnet, Pause, Play, Plus, Rows3, ZoomIn, ZoomOut } from "lucide-react";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { directorBoneLabel } from "@/lib/canvas/director/director-scene";
import type { DirectorCamera, DirectorObject, DirectorScene, DirectorShot } from "@/types/director";

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
    onPlayToggle: () => void;
    onPlayheadChange: (time: number) => void;
    onAutoKeyChange: (value: boolean) => void;
    onHeightChange: (height: number) => void;
    onSelectObject: (id: string | null) => void;
    onSelectBone: (bone: string | null) => void;
    onRecordKeyframe: () => void;
    onAddShot: () => void;
    onSelectShot: (id: string) => void;
};

type TrackKey = { id: string; time: number; color?: string };

export function DirectorSequencer({ scene, shot, camera, objects, selectedObjectId, selectedBone, playhead, playing, autoKey, height, onPlayToggle, onPlayheadChange, onAutoKeyChange, onHeightChange, onSelectObject, onSelectBone, onRecordKeyframe, onAddShot, onSelectShot }: DirectorSequencerProps) {
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [showDetails, setShowDetails] = useState(true);
    const [timelineScale, setTimelineScale] = useState(1);
    const duration = Math.max(0.5, shot.duration);
    const fps = shot.fps || 24;
    const rootRef = useRef<HTMLDivElement>(null);
    const ticks = useMemo(() => Array.from({ length: Math.ceil(duration) + 1 }, (_, index) => index), [duration]);
    const actorObjects = objects.filter((object) => object.kind === "actor" || object.primitive === "character");

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

    const cameraKeys = camera?.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#78a9ff" })) || [];

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
                <span className="ml-auto flex items-center gap-1">
                    <button type="button" className="director-sequencer-icon" title="缩小时间轴" aria-label="缩小时间轴" onClick={() => setTimelineScale((value) => Math.max(0.75, value - 0.25))}><ZoomOut className="size-3.5" /></button>
                    <button type="button" className="director-sequencer-icon" title="放大时间轴" aria-label="放大时间轴" onClick={() => setTimelineScale((value) => Math.min(2.5, value + 0.25))}><ZoomIn className="size-3.5" /></button>
                    <button type="button" className={`director-sequencer-icon ${showDetails ? "is-active" : ""}`} title="显示子轨道" aria-label="显示子轨道" aria-pressed={showDetails} onClick={() => setShowDetails((value) => !value)}><Rows3 className="size-3.5" /></button>
                    <button type="button" className="director-sequencer-icon" title="新增镜头" aria-label="新增镜头" onClick={onAddShot}><Plus className="size-3.5" /></button>
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

                    <SequencerRow label="镜头总轨" icon="◈" selected={false} keys={[]} onClick={() => undefined}>
                        <TrackBar duration={duration} color="#7da2ff" label={`${shot.name} · ${formatTime(duration)}`} />
                    </SequencerRow>
                    <SequencerRow label="Camera Cut" icon="▣" selected={false} keys={cameraKeys} onClick={() => undefined}>
                        <TrackKeys duration={duration} keys={cameraKeys} />
                    </SequencerRow>
                    {camera ? <SequencerRow label={camera.name} icon="⌾" selected={!selectedObjectId} keys={cameraKeys} onClick={() => { onSelectObject(null); onSelectBone(null); }}>
                        <TrackBar duration={duration} color="#78a9ff" label="Transform · 焦距 · 景深" />
                        <TrackKeys duration={duration} keys={cameraKeys} />
                    </SequencerRow> : null}
                    {actorObjects.map((object) => {
                        const isExpanded = expanded[object.id] ?? object.id === selectedObjectId;
                        const activeClip = object.motionClips?.find((clip) => clip.id === object.activeMotionClipId);
                        const boneTrackKeys = object.boneTracks?.flatMap((track) => track.keyframes.map((key) => ({ id: `${track.bone}-${key.id}`, time: key.time, color: "#f0b36a" }))) || [];
                        const transformKeys = object.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#61d2ad" }));
                        return <div key={object.id} className="contents">
                            <SequencerRow label={object.name} icon={isExpanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />} selected={selectedObjectId === object.id && !selectedBone} keys={transformKeys} onClick={() => { onSelectObject(object.id); onSelectBone(null); setExpanded((current) => ({ ...current, [object.id]: !isExpanded })); }}>
                                <TrackKeys duration={duration} keys={[...transformKeys, ...boneTrackKeys]} />
                            </SequencerRow>
                            {isExpanded && showDetails ? <>
                                <SequencerRow label="动作片段" icon="▶" indent selected={selectedObjectId === object.id && !selectedBone} keys={[]} onClick={() => onSelectObject(object.id)}>
                                    <TrackBar duration={duration} color="#61d2ad" label={activeClip ? `${activeClip.name}${activeClip.loop ? " · 循环" : ""}` : "姿势 / 动作"} start={activeClip?.start || 0} clipDuration={activeClip?.loop ? duration : activeClip?.duration || duration} />
                                </SequencerRow>
                                <SequencerRow label="Transform" icon="◇" indent selected={false} keys={transformKeys} onClick={() => onSelectObject(object.id)}>
                                    <TrackKeys duration={duration} keys={transformKeys} />
                                </SequencerRow>
                                {object.boneTracks?.map((track) => {
                                    const keys = track.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#f0b36a" }));
                                    return <SequencerRow key={track.bone} label={directorBoneLabel(track.bone)} icon="◌" indent selected={selectedBone === track.bone} keys={keys} onClick={() => { onSelectObject(object.id); onSelectBone(track.bone); }}><TrackKeys duration={duration} keys={keys} /></SequencerRow>;
                                })}
                            </> : null}
                        </div>;
                    })}
                    {objects.filter((object) => !actorObjects.some((actor) => actor.id === object.id)).map((object) => {
                        const keys = object.keyframes.map((key) => ({ id: key.id, time: key.time, color: "#b8c0ca" }));
                        return <SequencerRow key={object.id} label={object.name} icon="□" selected={selectedObjectId === object.id} keys={keys} onClick={() => { onSelectObject(object.id); onSelectBone(null); }}><TrackKeys duration={duration} keys={keys} /></SequencerRow>;
                    })}
                </div>
            </div>
        </section>
    );
}

function SequencerRow({ label, icon, selected, indent, children, onClick }: { label: string; icon: ReactNode; selected: boolean; indent?: boolean; keys?: TrackKey[]; children: ReactNode; onClick: () => void }) {
    return <div className={`director-sequencer-row ${selected ? "is-selected" : ""}`}>
        <button type="button" className={`director-sequencer-label ${indent ? "is-indent" : ""}`} onClick={onClick}><span className="director-sequencer-row-icon">{icon}</span><span className="min-w-0 truncate">{label}</span></button>
        <div className="director-sequencer-track">{children}</div>
    </div>;
}

function TrackKeys({ duration, keys }: { duration: number; keys: TrackKey[] }) {
    return <div className="director-sequencer-track-content">{keys.map((key) => <span key={key.id} className="director-sequencer-key" style={{ left: `${(key.time / duration) * 100}%`, background: key.color || "#d7dee8" }} title={`${key.time.toFixed(2)}s`} />)}</div>;
}

function TrackBar({ duration, color, label, start = 0, clipDuration }: { duration: number; color: string; label: string; start?: number; clipDuration?: number }) {
    return <div className="director-sequencer-track-content"><span className="director-sequencer-clip" style={{ left: `${(start / duration) * 100}%`, width: `${((clipDuration ?? duration) / duration) * 100}%`, background: `${color}33`, borderColor: `${color}88`, color }}><span className="truncate">{label}</span></span></div>;
}

function formatTime(time: number) {
    return `${time.toFixed(2)}s`;
}
