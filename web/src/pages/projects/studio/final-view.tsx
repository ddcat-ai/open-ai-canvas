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
    const readySegments = segments.filter((segment) => segment.videoResourceId && (segment.videoStatus === "ready" || segment.videoStatus === "stale")).length;
    // 合成要求各段为 ready（过期段需先重新生成）；与后端 timeline 校验一致。
    const composeReady = segments.length > 0 && segments.every((segment) => segment.videoStatus === "ready" && segment.videoResourceId);
    const rendering = episode.stage === "render";
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
                                {STAGE_LABEL[episode.stage]} · {rendering ? "正在合成成片…" : "全部段视频生成后自动合成，也可点右侧「合成成品」"}
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
                        {rendering ? "正在重新合成成片…" : "内容已修改，当前成片是修改前的版本，相关段重新生成后会自动重新合成，也可点下方「合成成品」。"}
                    </p>
                ) : null}
                <Button
                    type="primary"
                    icon={<Film className="size-4" />}
                    disabled={!composeReady}
                    loading={composeBusy}
                    onClick={onCompose}
                    title={composeReady ? (rendering ? "正在合成成片" : "按各段视频实测时长重新拼接成片") : "所有剧情段视频就绪后才能合成"}
                >
                    合成成品
                </Button>
                <Button icon={<Download className="size-4" />} disabled={!episode.finalResourceId} onClick={download}>
                    下载成片
                </Button>
                <Button icon={<Clapperboard className="size-4" />} disabled={!segments.length} onClick={() => setExportingDraft(true)} title="检查可用剧情段、缺段与旧版本后，导出剪映草稿">
                    导出剪映草稿
                </Button>
                {readySegments ? (
                    <p className="drama-editor-note">
                        当前 {readySegments}/{segments.length} 段视频可供检查；导出前会核对缺段、旧版本与文件读取状态。
                    </p>
                ) : null}
            </aside>
            {exportingDraft ? <JianyingDraftModal open projectId={projectId} episodeId={episode.id} episodeLabel={`第 ${episode.number} 集`} onClose={() => setExportingDraft(false)} /> : null}
        </div>
    );
}
