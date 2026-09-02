// 转写（editor-shell 预设插件贡献 transcription-provider 插槽，M3.6）。
// M4 后端转写任务未就绪，先用 mockTranscriptionEntries 确定性模拟 ASR；
// 转写结果按 ADR-0004 协议以 SrtEntry[] 落字幕轨道（rebuildSubtitleClips 重建快照）。
// M4 接入真实任务客户端（创建/轮询/SSE）后替换 mock 来源，UI 契约不变。

import { useEffect, useMemo, useState } from "react";
import { AudioLines, Loader2 } from "lucide-react";

import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { mockTranscriptionEntries } from "@/lib/timeline/mock-transcription";
import { getSubtitleTracks } from "@/lib/timeline/timeline-tracks";
import type { ProjectAsset } from "@/services/api/projects";

const MOCK_DURATION_MS = 12_000;

export function EditorTranscription() {
    const { assets } = useEditorHostContext();
    const { project, dispatch } = useEditorStoreContext();
    const audioAssets = useMemo(() => assets.filter((a) => a.mediaType === "audio"), [assets]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    useEffect(() => {
        if (selectedId === null && audioAssets.length > 0) setSelectedId(audioAssets[0].id);
    }, [audioAssets, selectedId]);

    if (!project) return null;
    const subtitleTrack = getSubtitleTracks(project.tracks)[0];
    const selected = audioAssets.find((a) => a.id === selectedId) ?? null;

    const transcribe = () => {
        if (!selected || running) return;
        setRunning(true);
        setMessage(null);
        // mock：延迟模拟任务执行；M4 替换为任务客户端（创建 → 轮询/SSE 进度）。
        window.setTimeout(() => {
            const entries = mockTranscriptionEntries(selected.title ?? selected.storageKey, MOCK_DURATION_MS);
            if (entries.length === 0 || !subtitleTrack) {
                setMessage("无可转写字幕（无字幕轨道或音频过短）");
            } else {
                dispatch({
                    op: "rebuildSubtitleClips",
                    payload: { nodeId: `transcription:${selected.id}`, entries, trackId: subtitleTrack.id },
                });
                setMessage(`已写入 ${entries.length} 条转写字幕`);
            }
            setRunning(false);
        }, 900);
    };

    return (
        <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-3">
                {audioAssets.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <AudioLines className="size-5 text-[var(--director-dock-fg)]/40" />
                        <p className="text-xs text-[var(--director-dock-fg)]/60">项目暂无音频素材</p>
                        <p className="max-w-[200px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">素材库加入音频后可转写自动字幕</p>
                    </div>
                ) : (
                    <>
                        <label className="mb-2 block">
                            <span className="mb-1 block text-[11px] text-[var(--director-dock-fg)]/70">音频素材</span>
                            <select
                                value={selectedId ?? ""}
                                onChange={(e) => setSelectedId(e.target.value)}
                                className="w-full rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-2 py-1.5 text-xs text-[var(--director-dock-fg-strong)] outline-none focus:border-[var(--workspace-accent)]/60 [&>option]:bg-[var(--director-sequencer-surface-raised)] [&>option]:text-[var(--director-dock-fg-strong)]"
                            >
                                {audioAssets.map((a) => (
                                    <option key={a.id} value={a.id}>
                                        {a.title || a.storageKey}
                                    </option>
                                ))}
                            </select>
                        </label>

                        <button
                            type="button"
                            onClick={transcribe}
                            disabled={!selected || running}
                            className="flex w-full items-center justify-center gap-2 rounded-md bg-[var(--director-accent)] px-2 py-1.5 text-xs font-medium text-[var(--director-on-accent)] hover:bg-[var(--director-accent-hover)] disabled:opacity-40"
                        >
                            {running && <Loader2 className="size-3.5 animate-spin" />}
                            {running ? "转写中…" : "转写自动字幕"}
                        </button>

                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--director-dock-fg)]/55">
                            M3.6 为确定性 mock 转写；M4 接后端任务客户端（whisper.cpp / 云 ASR）后替换来源，结果同样写入字幕轨道。
                        </p>
                        {message && <p className="mt-2 text-[11px] text-[var(--director-dock-fg)]/70">{message}</p>}
                    </>
                )}
            </div>
        </div>
    );
}
