import { AntTooltip as Tooltip } from "@/components/ui/base/tooltip/ant-tooltip";
import { AlertCircle, Check, Film, Loader2 } from "lucide-react";

import type { DramaCast, DramaSegment } from "@/services/api/drama";

import { aspectRatioValue, CAST_KIND_LABEL, mediaBusy, MediaThumb, useResourceMediaUrl } from "../drama-shared";

// 剧情段的共用展示：状态、视频、生成依据（首帧 + 参考图）。分镜卡片与镜头弹窗共用，保证两处说法一致。

export function secondsLabel(ms: number) {
    const seconds = Math.round(ms / 100) / 10;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)}s`;
}

export type SegmentTone = "idle" | "busy" | "ready" | "stale" | "failed" | "blocked";

/** 等待原因的短标签：取冒号或括号前的部分，完整原因放在提示里。 */
export function videoWaitLabel(wait: string) {
    return wait.split(/[：（]/)[0] || wait;
}

/** 剧情段当前处于哪一步，以及用户下一步该做什么。detail 是需要悬停查看的完整原因。 */
export function segmentState(segment: DramaSegment): { tone: SegmentTone; label: string; detail?: string } {
    const writing = segment.promptStatus === "queued" || segment.promptStatus === "running";
    if (segment.promptStatus === "failed") return { tone: "failed", label: "提示词撰写失败" };
    // 视频已入库但尾帧等后处理失败：视频本身可看，重试只重新处理已有视频。
    if (segment.videoStatus === "failed") return segment.videoReprocessable ? { tone: "failed", label: "视频后处理失败" } : { tone: "failed", label: "视频生成失败" };
    if (writing) return { tone: "busy", label: "撰写提示词中" };
    if (segment.promptStatus === "none") return { tone: "idle", label: "待撰写提示词" };
    if (segment.promptStatus === "stale" && !segment.custom) return { tone: "stale", label: "提示词已过期" };
    // 已请求但调度还没提交：显示真实的等待原因，不冒充“生成中”。
    if (segment.videoStatus === "queued" && segment.videoWait) return { tone: "blocked", label: videoWaitLabel(segment.videoWait), detail: segment.videoWait };
    if (segment.videoStatus === "queued" && segment.videoJob?.status !== "running") return { tone: "busy", label: "排队提交中" };
    if (mediaBusy(segment.videoStatus)) {
        if (segment.request.firstFramePending) return { tone: "blocked", label: "等待上一段" };
        // 按班次出片的渠道会先候车，显示上游给出的真实阶段，而不是笼统的“生成中”。
        const stage = segment.videoJob?.status === "running" ? segment.videoJob.providerStage : undefined;
        return stage ? { tone: "busy", label: stage, detail: `上游进度：${stage}` } : { tone: "busy", label: "生成视频中" };
    }
    if (segment.videoStatus === "ready") return { tone: "ready", label: "视频已生成" };
    if (segment.videoStatus === "stale") return { tone: "stale", label: "视频需重新生成" };
    return { tone: "idle", label: "待生成视频" };
}

export function promptReady(segment: DramaSegment) {
    return segment.custom || segment.promptStatus === "ready";
}

export function SegmentStatus({ segment }: { segment: DramaSegment }) {
    const state = segmentState(segment);
    return (
        <span className={`drama-sg-status is-${state.tone}`} title={state.detail}>
            {state.tone === "busy" ? (
                <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : state.tone === "failed" ? (
                <AlertCircle className="size-3" aria-hidden />
            ) : state.tone === "ready" ? (
                <Check className="size-3" aria-hidden />
            ) : (
                <i aria-hidden />
            )}
            {state.label}
        </span>
    );
}

export function SegmentVideo({ segment, aspectRatio, className = "" }: { segment: DramaSegment; aspectRatio: string; className?: string }) {
    const viewable = segment.videoStatus === "ready" || segment.videoStatus === "stale" || segment.videoStatus === "failed";
    const url = useResourceMediaUrl(viewable ? segment.videoResourceId : undefined, "playback");
    const state = segmentState(segment);
    return (
        <div className={`drama-sg-video ${className}`} style={{ aspectRatio: aspectRatioValue(aspectRatio) }}>
            {url ? (
                <video key={url} src={url} controls playsInline preload="metadata" />
            ) : (
                <span className={`drama-sg-video-empty ${state.tone === "busy" ? "is-busy" : ""}`}>
                    <Film className="size-5" aria-hidden />
                    <span>{state.label}</span>
                    <small>{secondsLabel(segment.durationMs)} · 对白与音效由视频模型生成</small>
                </span>
            )}
        </div>
    );
}

/**
 * 生成依据：首帧（第 2 段起是上一段视频的最后一帧）和随请求发送的参考图。
 * 参考图编号与提示词里的“参考图N”一致；未附图的设定说明原因。
 */
/** 参考图未随请求发送的原因；与后端 prepareDramaSegment 的判断一致。 */
export function referenceMissingReason(segment: DramaSegment, cast: DramaCast | undefined) {
    if (cast?.imageStatus === "failed") return "参考图生成失败";
    if (mediaBusy(cast?.imageStatus || "")) return "参考图生成中";
    if (!cast?.imageResourceId || cast.imageStatus !== "ready") return "参考图未生成";
    if (segment.request.operation === "text_to_video") return "模型按文生视频生成，不收参考图";
    return segment.request.referenceLimited ? "超出每段参考图上限" : "超出模型参考图上限";
}

export function SegmentInputs({ segment, castById, compact = false, frameOnly = false, onOpenCast }: { segment: DramaSegment; castById: Map<string, DramaCast>; compact?: boolean; frameOnly?: boolean; onOpenCast?: (id: string) => void }) {
    const { request } = segment;
    const first = segment.index === 0 && !request.firstFrameResourceId && !request.firstFramePending;
    return (
        <div className={`drama-sg-inputs ${compact ? "is-compact" : ""}`}>
            <Tooltip title={`首帧：${first ? "开场段，按提示词与参考图生成" : request.firstFrameResourceId ? `第 ${segment.index} 段视频最后一帧` : `等第 ${segment.index} 段视频生成后取最后一帧`}`} mouseEnterDelay={0.3}>
                <div className="drama-sg-input is-frame">
                    <span className="drama-sg-thumb is-frame">
                        {request.firstFrameResourceId ? <MediaThumb resourceId={request.firstFrameResourceId} alt="上一段最后一帧" /> : <span className="drama-sg-thumb-empty">{first ? "开场" : "等待"}</span>}
                        <em>首帧</em>
                    </span>
                    {compact ? null : (
                        <span className="drama-sg-input-text">
                            <b>首帧</b>
                            <small>{first ? "开场段，按提示词生成" : request.firstFrameResourceId ? `第 ${segment.index} 段最后一帧` : `等第 ${segment.index} 段视频生成`}</small>
                        </span>
                    )}
                </div>
            </Tooltip>
            {(frameOnly ? [] : request.references).map((ref) => {
                const cast = castById.get(ref.castId);
                const reason = ref.sent ? "" : referenceMissingReason(segment, cast);
                const body = (
                    <>
                        <span className={`drama-sg-thumb is-wide ${ref.sent ? "" : "is-missing"}`}>
                            {cast?.imageResourceId ? <MediaThumb resourceId={cast.imageResourceId} alt={ref.name} /> : <span className="drama-sg-thumb-empty">{CAST_KIND_LABEL[ref.kind]}</span>}
                            <em>{ref.label.replace("参考图", "图")}</em>
                        </span>
                        {compact ? null : (
                            <span className="drama-sg-input-text">
                                <b>{ref.name}</b>
                                <small>
                                    {CAST_KIND_LABEL[ref.kind]} · {ref.sent ? "随请求发送" : `未附图：${reason}`}
                                </small>
                            </span>
                        )}
                    </>
                );
                return (
                    <Tooltip key={ref.castId} title={`${ref.label} · ${CAST_KIND_LABEL[ref.kind]} · ${ref.name}${ref.sent ? "" : `（未附图：${reason}，按文字设定生成）`}`} mouseEnterDelay={0.3}>
                        {onOpenCast ? (
                            <button type="button" className={`drama-sg-input ${ref.sent ? "" : "is-missing"}`} onClick={() => onOpenCast(ref.castId)}>
                                {body}
                            </button>
                        ) : (
                            <span className={`drama-sg-input ${ref.sent ? "" : "is-missing"}`}>{body}</span>
                        )}
                    </Tooltip>
                );
            })}
        </div>
    );
}
