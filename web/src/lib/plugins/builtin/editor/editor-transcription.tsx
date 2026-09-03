// 字幕转写（editor-shell 预设插件贡献 transcription-provider 插槽，M3.6）。
// M4 后端转写任务（whisper.cpp 本地执行）：创建 POST /timeline/transcriptions
// → waitForGenerationTask 轮询进度 → 结果 segments 按 ADR-0004 协议以
// SrtEntry[] 落字幕轨道（rebuildSubtitleClips 重建快照），UI 契约与 M3.6 mock 一致。

import { useEffect, useMemo, useState } from "react";
import { AudioLines, Loader2 } from "lucide-react";

import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { getSubtitleTracks } from "@/lib/timeline/timeline-tracks";
import { waitForGenerationTask } from "@/services/api/task-center";
import {
    createTimelineTranscriptionTask,
    type TimelineTranscriptionResult,
    type TimelineTranscriptionSegment,
} from "@/services/api/timeline-tasks";
import type { ProjectAsset } from "@/services/api/projects";
import type { SrtEntry } from "@/types/timeline";

const WHISPER_WAIT_TIMEOUT_MS = 25 * 60 * 1000;

// 上传素材的底层对象以 resource:<id> 形式存储在资源表，取其中的资源 ID 提交转写。
function resourceIdOfAsset(asset: ProjectAsset): string | null {
    const key = asset.storageKey ?? "";
    if (key.startsWith("resource:")) return key.slice("resource:".length);
    return null;
}

export function EditorTranscription() {
    const { assets } = useEditorHostContext();
    const { project, dispatch } = useEditorStoreContext();
    // 音频与视频素材均可转写（视频静音会由后端明确报错）。
    const transcribableAssets = useMemo(
        () => assets.filter((a) => a.mediaType === "audio" || a.mediaType === "video"),
        [assets],
    );
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [running, setRunning] = useState(false);
    const [progressLabel, setProgressLabel] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (selectedId === null && transcribableAssets.length > 0) {
            const firstAudio = transcribableAssets.find((a) => a.mediaType === "audio");
            setSelectedId((firstAudio ?? transcribableAssets[0]).id);
        }
    }, [transcribableAssets, selectedId]);

    if (!project) return null;
    const subtitleTrack = getSubtitleTracks(project.tracks)[0];
    const selected = transcribableAssets.find((a) => a.id === selectedId) ?? null;

    const toSrtEntries = (segments: TimelineTranscriptionSegment[]): SrtEntry[] =>
        segments
            .map((seg, i) => ({
                index: i + 1,
                startMs: seg.startMs,
                endMs: seg.endMs,
                text: seg.text,
            }))
            .filter((entry) => entry.text.trim() !== "" && entry.endMs > entry.startMs);

    const transcribe = async () => {
        if (!selected || running) return;
        const resourceId = resourceIdOfAsset(selected);
        if (!resourceId) {
            setFailed(true);
            setMessage("该素材没有可转写的媒体对象（缺少 storageKey）");
            return;
        }
        setRunning(true);
        setFailed(false);
        setMessage(null);
        setProgressLabel("排队中…");
        try {
            const created = await createTimelineTranscriptionTask({
                resourceId,
            });
            const done = await waitForGenerationTask(created.id, {
                timeoutMs: WHISPER_WAIT_TIMEOUT_MS,
                intervalMs: 2000,
                onTaskUpdate: (task) => {
                    const stage = task.stage;
                    const progress = task.progress ?? 0;
                    if (stage) setProgressLabel(`${stage}${progress > 0 && progress < 100 ? ` ${progress}%` : ""}`);
                },
            });
            const parsed = JSON.parse(done.resultJson ?? "{}") as TimelineTranscriptionResult;
            const entries = toSrtEntries(parsed.segments ?? []);
            if (entries.length === 0) {
                setMessage("转写完成，但没有识别出可用字幕（语音内容为空？）");
            } else if (!subtitleTrack) {
                setMessage("项目没有字幕轨道，无法写入转写字幕");
            } else {
                dispatch({
                    op: "rebuildSubtitleClips",
                    payload: { nodeId: `transcription:${selected.id}`, entries, trackId: subtitleTrack.id },
                });
                const langHint = parsed.language ? `（${parsed.language}）` : "";
                setMessage(`已写入 ${entries.length} 条转写字幕${langHint}`);
            }
            setProgressLabel(null);
        } catch (err) {
            setFailed(true);
            setMessage(err instanceof Error ? err.message : "转写失败，请稍后重试");
            setProgressLabel(null);
        } finally {
            setRunning(false);
        }
    };

    return (
        <div className="flex h-full flex-col bg-[var(--director-sequencer-surface)]">
            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-3">
                {transcribableAssets.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <AudioLines className="size-5 text-[var(--director-dock-fg)]/40" />
                        <p className="text-xs text-[var(--director-dock-fg)]/60">项目暂无音视频素材</p>
                        <p className="max-w-[200px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">素材库加入音频或视频后可转写自动字幕</p>
                    </div>
                ) : (
                    <>
                        <label className="mb-2 block">
                            <span className="mb-1 block text-[11px] text-[var(--director-dock-fg)]/70">音视频素材</span>
                            <select
                                value={selectedId ?? ""}
                                onChange={(e) => setSelectedId(e.target.value)}
                                className="w-full rounded-md border border-[var(--director-sequencer-border)] bg-[var(--director-control-hover)] px-2 py-1.5 text-xs text-[var(--director-dock-fg-strong)] outline-none focus:border-[var(--workspace-accent)]/60 [&>option]:bg-[var(--director-sequencer-surface-raised)] [&>option]:text-[var(--director-dock-fg-strong)]"
                            >
                                {transcribableAssets.map((a) => (
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

                        {running && progressLabel && (
                            <p className="mt-2 text-[11px] text-[var(--director-dock-fg)]/60">{progressLabel}</p>
                        )}
                        {message && (
                            <p className={`mt-2 text-[11px] ${failed ? "text-[var(--director-danger)]" : "text-[var(--director-dock-fg)]/70"}`}>
                                {message}
                            </p>
                        )}
                        <p className="mt-2 text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">
                            由本地 whisper.cpp 识别，音视频不出本机；识别结果写入字幕轨道，可再编辑。
                        </p>
                    </>
                )}
            </div>
        </div>
    );
}
