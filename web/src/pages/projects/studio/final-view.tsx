import { useRef, useState } from "react";
import { App, Button } from "antd";
import { Clapperboard, Download, Film, Scissors } from "lucide-react";

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
    onOpenCut,
    cutOpening,
}: {
    projectId: string;
    title: string;
    detail: DramaEpisodeDetail;
    aspectRatio: string;
    onOpenSegment: (index: number) => void;
    /** 把各段视频按成片顺序载入精修画布的时间线，在画布里精剪。 */
    onOpenCut: () => void;
    cutOpening: boolean;
}) {
    const { episode, segments } = detail;
    const { message } = App.useApp();
    const [exportingDraft, setExportingDraft] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const url = useResourceMediaUrl(episode.finalResourceId, "playback");
    const readySegments = segments.filter((segment) => segment.videoResourceId && (segment.videoStatus === "ready" || segment.videoStatus === "stale")).length;
    const starts: number[] = [];
    segments.reduce((cursor, segment) => {
        starts.push(cursor);
        return cursor + (segment.request.seconds || segment.durationMs / 1000);
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
                            <span>{STAGE_LABEL[episode.stage]} · 全部段视频生成后自动合成</span>
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
                                if (videoRef.current) videoRef.current.currentTime = starts[position];
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
                {episode.finalStale ? (
                    <p className="drama-finalv-stale" role="status">
                        内容已修改，当前成片是修改前的版本，相关段重新生成后会自动重新合成。
                    </p>
                ) : null}
                <Button icon={<Download className="size-4" />} disabled={!episode.finalResourceId} onClick={download}>
                    下载成片
                </Button>
                <Button icon={<Scissors className="size-4" />} disabled={!readySegments} loading={cutOpening} onClick={onOpenCut}>
                    到画布精剪
                </Button>
                <Button icon={<Clapperboard className="size-4" />} disabled={!readySegments} onClick={() => setExportingDraft(true)} title={readySegments ? "导出为剪映专业版草稿，在剪映里继续剪辑" : "本集还没有生成好的剧情段视频"}>
                    导出剪映草稿
                </Button>
                {readySegments ? <p className="drama-editor-note">按成片顺序把 {readySegments} 段视频载入精修画布的时间线，或导出为剪映草稿；剪辑结果不会替换这里的成片。</p> : null}
            </aside>
            {exportingDraft ? <JianyingDraftModal open projectId={projectId} episodeId={episode.id} episodeLabel={`第 ${episode.number} 集`} readySegments={readySegments} onClose={() => setExportingDraft(false)} /> : null}
        </div>
    );
}
