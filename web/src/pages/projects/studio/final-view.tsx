import { useRef, useState } from "react";
import { App, Button } from "antd";
import { Clapperboard, Download, Film } from "lucide-react";

import type { DramaEpisodeDetail } from "@/services/api/drama";

import { aspectRatioValue, downloadResource, formatDuration, MediaThumb, STAGE_LABEL, useResourceMediaUrl } from "../drama-shared";
import { JianyingDraftModal } from "./asset-transfer";
import { secondsLabel } from "./segment-parts";

/** 成片：各剧情段视频按顺序拼接，保留视频模型生成的对白与音效。片段条可跳到对应段并打开该段详情。 */
export function FinalView({
    projectId,
    title,
    detail,
    aspectRatio,
    onOpenSegment,
    onCompose,
    composing,
}: {
    projectId: string;
    title: string;
    detail: DramaEpisodeDetail;
    aspectRatio: string;
    onOpenSegment: (index: number) => void;
    /** 手动重新合成成品（按实测时长拼接）。 */
    onCompose: () => void;
    composing: boolean;
}) {
    const { episode } = detail;
    const segments = [...detail.segments].sort((left, right) => left.index - right.index);
    const { message } = App.useApp();
    const [exportingDraft, setExportingDraft] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const url = useResourceMediaUrl(episode.finalResourceId, "playback");
    const available = segments.filter((segment) => segment.videoResourceId && (segment.videoStatus === "ready" || segment.videoStatus === "stale"));
    const missing = segments.length - available.length;
    const stale = available.filter((segment) => segment.videoStatus === "stale").length;
    const rendering = detail.composeJob?.status === "queued" || detail.composeJob?.status === "running" || detail.jobs.some((job) => job.kind === "render" && job.status === "running");
    const composeBusy = composing || rendering;
    const starts: number[] = [];
    segments.reduce((cursor, segment) => {
        starts.push(cursor);
        return cursor + (segment.videoSeconds || segment.request.seconds || segment.durationMs / 1000);
    }, 0);
    const download = () => {
        if (!episode.finalResourceId) return;
        void downloadResource(episode.finalResourceId, `${title}-第${episode.number}集.mp4`).catch((error) => message.error(error instanceof Error ? error.message : "下载失败"));
    };
    return (
        <div className="drama-finalv">
            <div className="drama-finalv-stage">
                <div className="drama-finalv-player" style={{ aspectRatio: aspectRatioValue(aspectRatio) }}>
                    {url ? (
                        <video ref={videoRef} key={url} src={url} controls playsInline />
                    ) : (
                        <div className="drama-finalv-empty">
                            <Film className="size-6" aria-hidden />
                            <span>
                                {STAGE_LABEL[episode.stage]} · {rendering ? "正在合成成片…" : "暂无成片"}
                            </span>
                        </div>
                    )}
                </div>
                <div className="drama-filmstrip thin-scrollbar">
                    {segments.map((segment, position) => (
                        <button
                            key={segment.id || segment.index}
                            type="button"
                            className="drama-filmstrip-item"
                            title={segment.title}
                            onClick={() => {
                                if (videoRef.current && !episode.finalStale) videoRef.current.currentTime = starts[position];
                                onOpenSegment(segment.index);
                            }}
                        >
                            <MediaThumb resourceId={segment.tailFrameResourceId} alt={segment.title} fallback={<span className="drama-filmstrip-empty" />} />
                            <span>
                                第 {segment.index + 1} 段 · {secondsLabel(segment.durationMs)}
                            </span>
                        </button>
                    ))}
                </div>
            </div>
            <aside className="drama-finalv-side">
                <h2>
                    第 {episode.number} 集 · {episode.title}
                </h2>
                <p>
                    {formatDuration(episode.durationMs)} · {segments.length} 个剧情段 · 对白与音效来自视频模型
                </p>
                {episode.finalResourceId && episode.finalStale ? (
                    <p className="drama-finalv-stale" role="status">
                        当前成片未包含本集全部最新段视频。
                    </p>
                ) : null}
                {available.length === 0 ? (
                    <p className="drama-editor-note">还没有可合成的段视频。</p>
                ) : missing || stale ? (
                    <p className="drama-finalv-stale" role="status">
                        本次按顺序合成 {available.length}/{segments.length} 段。{missing > 0 && `跳过 ${missing} 段未就绪视频。`}
                        {stale > 0 && `${stale} 段沿用旧版视频，不会重新生成。`}
                    </p>
                ) : null}
                {detail.composeJob?.status === "failed" && !rendering ? <p role="alert">上次手动合成失败：{detail.composeJob.error}</p> : null}
                <Button
                    type="primary"
                    icon={<Film className="size-4" />}
                    disabled={!available.length || composeBusy}
                    loading={composeBusy}
                    onClick={onCompose}
                    title={available.length ? "按现有段视频的实际时长拼接，不重新生成视频" : "还没有可合成的段视频"}
                >
                    合成成品
                </Button>
                <Button icon={<Download className="size-4" />} disabled={!episode.finalResourceId} onClick={download}>
                    下载成片
                </Button>
                <Button icon={<Clapperboard className="size-4" />} disabled={!segments.length} onClick={() => setExportingDraft(true)} title="检查可用剧情段、缺段与旧版本后，导出剪映草稿">
                    导出剪映草稿
                </Button>
                {available.length ? (
                    <p className="drama-editor-note">
                        当前 {available.length}/{segments.length} 段视频可供检查；导出前会核对缺段、旧版本与文件读取状态。
                    </p>
                ) : null}
            </aside>
            {exportingDraft ? <JianyingDraftModal open projectId={projectId} episodeId={episode.id} episodeLabel={`第 ${episode.number} 集`} onClose={() => setExportingDraft(false)} /> : null}
        </div>
    );
}
