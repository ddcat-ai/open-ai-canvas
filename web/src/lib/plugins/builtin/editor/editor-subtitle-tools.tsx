// 字幕工具（editor-shell 预设插件贡献 subtitle-tool 插槽，M3.5）。
// SRT 导入导出（复用 srt-parser）+ 「从节点重建字幕片段」命令（§3.1 快照契约：
// 节点 subtitleEntries 权威 → 重建时间线字幕快照，替换过期快照，单向显式同步）。
// AI 高亮在 M6（editor-ai-assistant + ai.text 权限）接入，此处留占位。

import { useMemo, useState } from "react";

import { useEditorStoreContext } from "@/components/editor/editor-context";
import { parseSrt, serializeSrtEntries } from "@/lib/timeline/srt-parser";
import { getSubtitleTracks } from "@/lib/timeline/timeline-tracks";
import { formatTimelineTime } from "@/lib/timeline/timeline-view";
import type { SrtEntry, TimelineClip } from "@/types/timeline";

const DEFAULT_SRT_NODE_ID = "srt-import";

export function EditorSubtitleTools() {
    const { project, dispatch } = useEditorStoreContext();
    const [srtText, setSrtText] = useState("");
    const [message, setMessage] = useState<string | null>(null);

    const subtitleClips = useMemo(
        () => (project?.clips ?? []).filter((c) => c.kind === "subtitle").sort((a, b) => a.startMs - b.startMs),
        [project],
    );
    const subtitleTracks = useMemo(() => (project ? getSubtitleTracks(project.tracks) : []), [project]);

    // SRT 导入：解析文本 → rebuildSubtitleClips 以 DEFAULT_SRT_NODE_ID 为权威节点重建
    // 字幕快照。确定性 id（nodeId:subtitle:index）保证重复导入原地替换，不堆积漂移。
    const importSrt = () => {
        const entries = parseSrt(srtText);
        if (entries.length === 0) {
            setMessage("未解析到有效 SRT 条目");
            return;
        }
        dispatch({
            op: "rebuildSubtitleClips",
            payload: { nodeId: DEFAULT_SRT_NODE_ID, entries, trackId: subtitleTracks[0]?.id },
        });
        setMessage(`已从节点 ${DEFAULT_SRT_NODE_ID} 重建 ${entries.length} 条字幕快照`);
    };

    // SRT 导出：当前时间线字幕快照 → 序列化 → 下载 .srt（往返一致）。
    const exportSrt = () => {
        if (subtitleClips.length === 0) {
            setMessage("时间线上没有字幕片段");
            return;
        }
        const entries: SrtEntry[] = subtitleClips.map((clip, idx) => ({
            index: clip.subtitleEntryIndex ?? idx + 1,
            startMs: clip.startMs,
            endMs: clip.startMs + clip.durationMs,
            text: clip.text ?? "",
        }));
        const content = serializeSrtEntries(entries);
        const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "subtitles.srt";
        a.click();
        URL.revokeObjectURL(url);
        setMessage(`已导出 ${entries.length} 条字幕`);
    };

    return (
        <div className="flex h-full flex-col bg-[var(--workspace-surface)]">
            <SubtitleHeader title="字幕工具" />
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
                <div className="mb-3 rounded-md border border-border/60 bg-foreground/3 p-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground/85">时间线字幕</span>
                        <span className="text-[10px] text-foreground/40">{subtitleClips.length} 条</span>
                    </div>
                    {subtitleClips.length === 0 ? (
                        <p className="mt-2 text-[11px] leading-relaxed text-foreground/40">暂无字幕快照。粘贴 SRT 导入后，字幕会重建到时间线。</p>
                    ) : (
                        <ul className="mt-2 space-y-1">
                            {subtitleClips.slice(0, 6).map((clip) => (
                                <SubtitleRow key={clip.id} clip={clip} />
                            ))}
                            {subtitleClips.length > 6 && (
                                <li className="pt-1 text-[10px] text-foreground/35">…共 {subtitleClips.length} 条</li>
                            )}
                        </ul>
                    )}
                </div>

                <label className="mb-3 block">
                    <span className="mb-1 block text-[11px] text-foreground/55">SRT 文本（导入）</span>
                    <textarea
                        value={srtText}
                        onChange={(e) => setSrtText(e.target.value)}
                        rows={8}
                        placeholder={"1\n00:00:00,500 --> 00:00:02,500\n你好，影策"}
                        className="w-full resize-y rounded-md border border-border/60 bg-foreground/3 px-2 py-1.5 font-mono text-[11px] leading-relaxed text-foreground/85 outline-none focus:border-[var(--workspace-accent)]/60"
                    />
                </label>

                <div className="mb-3 flex gap-2">
                    <button
                        type="button"
                        onClick={importSrt}
                        disabled={!srtText.trim()}
                        className="flex-1 rounded-md bg-[var(--workspace-accent)] px-2 py-1.5 text-xs font-medium text-white disabled:opacity-40"
                    >
                        导入（重建字幕）
                    </button>
                    <button
                        type="button"
                        onClick={exportSrt}
                        disabled={subtitleClips.length === 0}
                        className="flex-1 rounded-md border border-border/60 px-2 py-1.5 text-xs text-foreground/60 hover:bg-foreground/5 disabled:opacity-40"
                    >
                        导出 SRT
                    </button>
                </div>

                <div className="rounded-md border border-border/60 bg-foreground/3 p-2.5">
                    <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-foreground/85">AI 高亮</span>
                        <span className="rounded-full bg-foreground/8 px-1.5 py-0.5 text-[10px] text-foreground/50">M6</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/40">
                        AI 字幕高亮与关键词标注将在 M6（ai-assistant 插件 + ai.text 权限）接入。
                    </p>
                </div>

                {message && <p className="mt-2 text-[11px] text-foreground/50">{message}</p>}
            </div>
        </div>
    );
}

function SubtitleHeader({ title }: { title: string }) {
    return (
        <div className="flex h-9 shrink-0 items-center border-b border-border/60 px-3">
            <span className="text-xs font-medium text-foreground/75">{title}</span>
        </div>
    );
}

function SubtitleRow({ clip }: { clip: TimelineClip }) {
    return (
        <li className="flex items-baseline gap-2 rounded border border-border/40 bg-foreground/2 px-1.5 py-1">
            <span className="shrink-0 tabular-nums text-[10px] text-foreground/40">
                {formatTimelineTime(clip.startMs)} – {formatTimelineTime(clip.startMs + clip.durationMs)}
            </span>
            <span className="truncate text-[11px] text-foreground/75">{clip.text ?? ""}</span>
        </li>
    );
}
