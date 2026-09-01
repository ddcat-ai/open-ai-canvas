// 片段检查器（editor-shell 预设插件贡献 inspector 插槽，M3.3）。
// 读取选中片段（store.selectedClipId），属性编辑经 setClipProperty 命令入队
// （可撤销、可回放、进黄金文件语义）；无选中时显示项目概览。

import { useEffect, useState } from "react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import type { TimelineClip } from "@/types/timeline";

export function EditorInspector() {
    const { project, selectedClipId, dispatch, selectClip } = useEditorStoreContext();
    const clip = project?.clips.find((c) => c.id === selectedClipId) ?? null;

    if (!clip) {
        return (
            <div className="flex h-full flex-col bg-[var(--workspace-surface)]">
                <InspectorHeader title="检查器" />
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                    <p className="text-xs text-foreground/45">未选中片段</p>
                    <p className="max-w-[180px] text-[11px] leading-relaxed text-foreground/35">在时间线中点击片段后，可在此编辑属性</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-[var(--workspace-surface)]">
            <InspectorHeader title="检查器" />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <ClipSummary clip={clip} />
                <PropertyField
                    label="名称"
                    value={clip.title ?? clip.nodeId ?? clip.id}
                    onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { title: value } } })}
                />
                {clip.kind === "subtitle" && (
                    <PropertyField
                        label="字幕文本"
                        value={clip.text ?? ""}
                        onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { text: value } } })}
                    />
                )}
                {clip.kind === "audio" && (
                    <PropertyField
                        label="音量"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={clip.volume ?? 1}
                        onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { volume: Number(value) } } })}
                    />
                )}
                {(clip.kind === "video" || clip.kind === "audio") && (
                    <>
                        <PropertyField
                            label="淡入"
                            type="range"
                            min={0}
                            max={2000}
                            step={50}
                            value={clip.fadeInMs ?? 0}
                            onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { fadeInMs: Number(value) } } })}
                        />
                        <PropertyField
                            label="淡出"
                            type="range"
                            min={0}
                            max={2000}
                            step={50}
                            value={clip.fadeOutMs ?? 0}
                            onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { fadeOutMs: Number(value) } } })}
                        />
                    </>
                )}
            </div>
            <div className="shrink-0 border-t border-border/60 p-2">
                <button
                    type="button"
                    onClick={() => selectClip(null)}
                    className="w-full rounded-md border border-border/60 py-1.5 text-xs text-foreground/60 hover:bg-foreground/5"
                >
                    清除选中
                </button>
            </div>
        </div>
    );
}

function InspectorHeader({ title }: { title: string }) {
    return (
        <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-3">
            <span className="text-xs font-medium text-foreground/75">{title}</span>
        </div>
    );
}

function ClipSummary({ clip }: { clip: TimelineClip }) {
    const kindLabel: Record<TimelineClip["kind"], string> = {
        video: "视频",
        audio: "音频",
        subtitle: "字幕",
        text: "文本",
        image: "图片",
    };
    return (
        <div className="mb-3 rounded-md border border-border/60 bg-foreground/3 p-2.5">
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground/85">{kindLabel[clip.kind] ?? clip.kind}</span>
                <span className="text-[10px] text-foreground/40">#{clip.id.slice(-6)}</span>
            </div>
            <dl className="mt-2 space-y-1 text-[11px]">
                <div className="flex justify-between">
                    <dt className="text-foreground/45">起点</dt>
                    <dd className="tabular-nums text-foreground/75">{formatTimelineTime(clip.startMs)}</dd>
                </div>
                <div className="flex justify-between">
                    <dt className="text-foreground/45">时长</dt>
                    <dd className="tabular-nums text-foreground/75">{formatTimelineTime(clip.durationMs)}</dd>
                </div>
                <div className="flex justify-between">
                    <dt className="text-foreground/45">源起点</dt>
                    <dd className="tabular-nums text-foreground/75">{formatTimelineTime(clip.sourceStartMs ?? 0)}</dd>
                </div>
            </dl>
        </div>
    );
}

function PropertyField({
    label,
    value,
    onChange,
    type = "text",
    min,
    max,
    step,
}: {
    label: string;
    value: string | number;
    onChange: (value: string) => void;
    type?: "text" | "range";
    min?: number;
    max?: number;
    step?: number;
}) {
    const [localValue, setLocalValue] = useState<string>(String(value));
    useEffect(() => setLocalValue(String(value)), [value]);

    return (
        <label className="mb-3 block">
            <span className="mb-1 block text-[11px] text-foreground/55">{label}</span>
            {type === "range" ? (
                <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={Number(localValue)}
                    onChange={(e) => {
                        setLocalValue(e.target.value);
                        onChange(e.target.value);
                    }}
                    className="h-1 w-full accent-[var(--workspace-accent)]"
                />
            ) : (
                <input
                    type="text"
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={() => {
                        if (localValue !== String(value)) onChange(localValue);
                    }}
                    className="w-full rounded-md border border-border/60 bg-foreground/3 px-2 py-1.5 text-xs text-foreground/85 outline-none focus:border-[var(--workspace-accent)]/60"
                />
            )}
        </label>
    );
}
