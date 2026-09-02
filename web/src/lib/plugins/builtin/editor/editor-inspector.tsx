// 片段检查器（editor-shell 预设插件贡献 inspector 插槽，M3.3）。
// 读取选中片段（store.selectedClipId），属性编辑经 setClipProperty 命令入队
// （可撤销、可回放、进黄金文件语义）；无选中时显示项目概览。
// 视觉参照 Concat inspector：分组小标题 + 紧凑控件 + sunken 滑块，token 随主题联动。

import { useEffect, useState } from "react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import type { TimelineClip } from "@/types/timeline";

export function EditorInspector() {
    const { project, selectedClipId, dispatch, selectClip } = useEditorStoreContext();
    const clip = project?.clips.find((c) => c.id === selectedClipId) ?? null;

    if (!clip) {
        return (
            <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
                <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center">
                    <p className="text-xs text-[var(--director-dock-fg)]/60">未选中片段</p>
                    <p className="max-w-[180px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">在时间线中点击片段后，可在此编辑属性</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
            <div className="director-scroll min-h-0 flex-1 overflow-y-auto px-3 py-3">
                <SectionTitle>片段</SectionTitle>
                <ClipSummary clip={clip} />
                <SectionTitle>基本</SectionTitle>
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
                        formatValue={(v) => `${Math.round(v * 100)}%`}
                        onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { volume: Number(value) } } })}
                    />
                )}
                {(clip.kind === "video" || clip.kind === "audio") && (
                    <>
                        <SectionTitle>转场</SectionTitle>
                        <PropertyField
                            label="淡入"
                            type="range"
                            min={0}
                            max={2000}
                            step={50}
                            value={clip.fadeInMs ?? 0}
                            formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
                            onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { fadeInMs: Number(value) } } })}
                        />
                        <PropertyField
                            label="淡出"
                            type="range"
                            min={0}
                            max={2000}
                            step={50}
                            value={clip.fadeOutMs ?? 0}
                            formatValue={(v) => `${(v / 1000).toFixed(1)}s`}
                            onChange={(value) => dispatch({ op: "setClipProperty", payload: { id: clip.id, patch: { fadeOutMs: Number(value) } } })}
                        />
                    </>
                )}
            </div>
            <div className="shrink-0 border-t border-[var(--director-sequencer-border)] p-2">
                <button
                    type="button"
                    onClick={() => selectClip(null)}
                    className="w-full rounded-md border border-[var(--director-sequencer-border)] py-1.5 text-xs text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                >
                    清除选中
                </button>
            </div>
        </div>
    );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
    return (
        <h3 className="mb-2 mt-4 text-[10px] font-medium uppercase tracking-wider text-[var(--director-dock-fg)]/45 first:mt-0">
            {children}
        </h3>
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
        <div>
            <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-[var(--director-dock-fg-strong)]">{kindLabel[clip.kind] ?? clip.kind}</span>
                <span className="font-mono text-[10px] text-[var(--director-dock-fg)]/40">#{clip.id.slice(-6)}</span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-[var(--director-dock-fg)]/45">起点</dt>
                    <dd className="tabular-nums text-[var(--director-dock-fg)]/80">{formatTimelineTime(clip.startMs)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-[var(--director-dock-fg)]/45">时长</dt>
                    <dd className="tabular-nums text-[var(--director-dock-fg)]/80">{formatTimelineTime(clip.durationMs)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-[var(--director-dock-fg)]/45">源起点</dt>
                    <dd className="tabular-nums text-[var(--director-dock-fg)]/80">{formatTimelineTime(clip.sourceStartMs ?? 0)}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                    <dt className="shrink-0 text-[var(--director-dock-fg)]/45">结束</dt>
                    <dd className="tabular-nums text-[var(--director-dock-fg)]/80">{formatTimelineTime(clip.startMs + clip.durationMs)}</dd>
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
    formatValue,
}: {
    label: string;
    value: string | number;
    onChange: (value: string) => void;
    type?: "text" | "range";
    min?: number;
    max?: number;
    step?: number;
    formatValue?: (value: number) => string;
}) {
    const [localValue, setLocalValue] = useState<string>(String(value));
    useEffect(() => setLocalValue(String(value)), [value]);

    const displayValue = type === "range" && formatValue ? formatValue(Number(localValue)) : localValue;

    return (
        <div className="mb-3">
            <div className="mb-1.5 flex items-center justify-between">
                <span className="text-[11px] text-[var(--director-dock-fg)]/70">{label}</span>
                {type === "range" && (
                    <span className="tabular-nums text-[10px] text-[var(--director-dock-fg)]/50">{displayValue}</span>
                )}
            </div>
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
                    className="editor-slider"
                />
            ) : (
                <input
                    type="text"
                    value={localValue}
                    onChange={(e) => setLocalValue(e.target.value)}
                    onBlur={() => {
                        if (localValue !== String(value)) onChange(localValue);
                    }}
                    className="h-7 w-full rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-sequencer-surface-raised)] px-2 text-xs text-[var(--director-dock-fg-strong)] outline-none transition-colors focus:border-[var(--director-dock-fg-strong)]/40"
                />
            )}
        </div>
    );
}
