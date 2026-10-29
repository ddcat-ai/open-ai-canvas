import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { ArrowRight, Image as ImageIcon } from "lucide-react";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { Checkbox } from "@/components/ui/base/checkbox";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import { defaultDramaAdoptTarget, type DramaAdoptTarget } from "@/lib/canvas/drama-canvas-projection";
import { DRAMA_CAST_KIND_LABEL } from "@/lib/drama/drama-format";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { adoptDramaSegmentVideo, DRAMA_ERROR_REASON, getDramaCastImpact, getDramaEpisode, setDramaCastImage, type DramaCast, type DramaSegment, type DramaSummary } from "@/services/api/drama";
import { ApiError } from "@/services/api/request";
import { resourceIdFromStorageKey } from "@/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

// 画布 → 短剧的唯一写入口：把画布上的图片采用为设定参考图，或把视频采用为剧情段视频，写成短剧的一个新版本。

type CanvasDramaAdoptModalProps = {
    node: CanvasNodeData;
    nodes: CanvasNodeData[];
    summary: DramaSummary;
    cast: DramaCast[] | undefined;
    onClose: () => void;
    onAdopted: (nodeId: string, target: DramaAdoptTarget, resourceId: string) => void;
};

const CAST_KIND_ORDER: DramaCast["kind"][] = ["character", "scene", "prop"];
// 画幅相差超过 3% 才提示，避免编码取整带来的误报。
const RATIO_TOLERANCE = 0.03;

function parseRatio(value: string | undefined) {
    const [width, height] = (value || "").split(":").map(Number);
    return width > 0 && height > 0 ? width / height : 0;
}

function formatSeconds(ms: number) {
    return `${Math.round(ms / 100) / 10} 秒`;
}

export function CanvasDramaAdoptModal({ node, nodes, summary, cast, onClose, onAdopted }: CanvasDramaAdoptModalProps) {
    const { message } = App.useApp();
    const dramaId = summary.project.id;
    const isVideo = node.type === CanvasNodeType.Video;
    const resourceId = resourceIdFromStorageKey(node.metadata?.storageKey);
    const fallback = defaultDramaAdoptTarget(node, nodes);
    const firstEpisode = summary.episodes.find((episode) => episode.stats.segments > 0) || summary.episodes[0];
    const [castId, setCastId] = useState(fallback?.kind === "cast" ? fallback.castId : "");
    const [episodeId, setEpisodeId] = useState(fallback?.kind === "segment" ? fallback.episodeId : firstEpisode?.id || "");
    const [segmentIndex, setSegmentIndex] = useState<number | null>(fallback?.kind === "segment" ? fallback.segmentIndex : null);
    const [restyle, setRestyle] = useState(false);
    const [cascade, setCascade] = useState(false);
    const [submitting, setSubmitting] = useState(false);

    const episodeQuery = useQuery({
        queryKey: dramaKeys.episode(dramaId, episodeId),
        queryFn: ({ signal }) => getDramaEpisode(dramaId, episodeId, signal),
        enabled: isVideo && Boolean(episodeId),
    });
    const impactQuery = useQuery({
        queryKey: dramaKeys.castImpact(dramaId, castId),
        queryFn: ({ signal }) => getDramaCastImpact(dramaId, castId, signal),
        enabled: !isVideo && Boolean(castId),
    });
    const segments = useMemo(() => [...(episodeQuery.data?.segments || [])].sort((left, right) => left.index - right.index), [episodeQuery.data?.segments]);
    const segment = segmentIndex === null ? undefined : segments.find((item) => item.index === segmentIndex);
    const episode = summary.episodes.find((item) => item.id === episodeId);
    const targetCast = cast?.find((item) => item.id === castId);
    const laterWithVideo = segment ? segments.filter((item) => item.index > segment.index && item.videoResourceId).length : 0;
    // 并行出片的段不以上一段尾帧为首帧，换掉本段不影响后续段，不提供级联重生成。
    const parallelVideo = summary.production.settings.videoContinuity === "parallel";

    const castOptions = useMemo(
        () =>
            CAST_KIND_ORDER.map((kind) => ({
                label: DRAMA_CAST_KIND_LABEL[kind],
                options: (cast || [])
                    .filter((item) => item.kind === kind)
                    .sort((left, right) => left.position - right.position)
                    .map((item) => ({ value: item.id, label: item.name })),
            })).filter((group) => group.options.length),
        [cast],
    );

    const blocker = !resourceId
        ? node.metadata?.fileUpload === "uploading" || node.metadata?.status === "loading"
            ? "媒体还在生成或上传，完成后再采用。"
            : "这个节点的媒体没有保存在服务端（例如外部链接），无法采用。可以先上传到画布再试。"
        : isVideo
          ? !segment
              ? "请选择要替换的剧情段。"
              : ""
          : !targetCast
            ? "请选择要替换参考图的设定。"
            : "";
    const warnings = isVideo && segment ? videoWarnings(node, segment, summary.production.settings.aspectRatio) : [];

    const submit = async () => {
        if (blocker || submitting) return;
        setSubmitting(true);
        try {
            if (!isVideo && targetCast) {
                const result = await setDramaCastImage(dramaId, targetCast.id, resourceId, restyle, { source: "canvas", taskId: node.metadata?.taskId });
                if (result.unchanged) message.info(`「${result.cast.name}」已在使用这张图`);
                else message.success(result.affectedSegments ? `已替换「${result.cast.name}」的参考图，${result.affectedSegments} 个剧情段视频将重新生成` : `已替换「${result.cast.name}」的参考图并锁定`);
                onAdopted(node.id, { kind: "cast", castId: targetCast.id }, resourceId);
            } else if (isVideo && segment && episode) {
                const result = await adoptDramaSegmentVideo(dramaId, episode.id, segment.index, { resourceId, taskId: node.metadata?.taskId, cascade: cascade && !parallelVideo, expectedRevision: segment.revision });
                const label = `第 ${episode.number} 集第 ${segment.index + 1} 段`;
                if (result.unchanged) {
                    message.info(`${label}已在使用这个视频`);
                } else {
                    message.success(result.requeued ? `已采用为${label}的视频，后续 ${result.requeued} 段已重新排队生成` : `已采用为${label}的视频`);
                    if (result.videoError) message.warning(result.videoError);
                    if (result.resumeError) message.warning(`后续段已排队，但制作没能继续：${result.resumeError}`);
                    else if (result.paused) message.info("制作已暂停：继续制作后会重新合成这一集的成片");
                }
                onAdopted(node.id, { kind: "segment", episodeId: episode.id, segmentIndex: segment.index, segmentId: segment.id }, resourceId);
            }
            onClose();
        } catch (error) {
            if (error instanceof ApiError && error.reason === DRAMA_ERROR_REASON.segmentChanged) {
                message.warning("剧情段刚被修改，已刷新，请确认后再采用");
                void episodeQuery.refetch();
                return;
            }
            message.error(error instanceof Error && error.message ? error.message : "采用失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal open centered title="采用到短剧" width={520} onCancel={onClose} okText="采用" confirmLoading={submitting} okButtonProps={{ disabled: Boolean(blocker) }} onOk={() => void submit()}>
            <p className="mb-4 text-sm text-muted-foreground">{isVideo ? "把这个视频设为剧情段的当前视频；短剧原来的视频保留在版本记录里。" : "把这张图设为设定的参考图并锁定；原来的参考图保留在版本记录里。"}</p>

            {isVideo ? (
                <div className="grid gap-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        分集
                        <Select
                            ariaLabel="选择分集"
                            appearance="field"
                            value={episodeId || undefined}
                            options={summary.episodes.map((item) => ({ value: item.id, label: `第 ${item.number} 集 · ${item.title}` }))}
                            onChange={(value: string) => {
                                setEpisodeId(value);
                                setSegmentIndex(null);
                            }}
                            placeholder="选择分集"
                        />
                    </label>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        剧情段
                        <Select
                            ariaLabel="选择剧情段"
                            appearance="field"
                            value={segment ? segment.index : undefined}
                            loading={episodeQuery.isLoading}
                            disabled={!segments.length}
                            options={segments.map((item) => ({ value: item.index, label: `第 ${item.index + 1} 段 · ${item.title}` }))}
                            onChange={(value: number) => setSegmentIndex(value)}
                            placeholder={episodeQuery.isLoading ? "正在读取剧情段…" : segments.length ? "选择剧情段" : "这一集还没有剧情段"}
                        />
                    </label>
                    {segment && parallelVideo ? <p className="text-xs leading-5 text-muted-foreground">本作品按并行出片生成，各段互不依赖，只替换本段。</p> : null}
                    {segment && !parallelVideo ? (
                        <div className="grid gap-2">
                            <SegmentedControl
                                ariaLabel="后续剧情段"
                                block
                                value={cascade ? "cascade" : "single"}
                                onChange={(value) => setCascade(value === "cascade")}
                                options={[
                                    { value: "single", label: "只换本段" },
                                    { value: "cascade", label: "后续段也重新生成", disabled: !laterWithVideo },
                                ]}
                            />
                            <p className="text-xs leading-5 text-muted-foreground">
                                {cascade
                                    ? `后续已生成视频的 ${laterWithVideo} 段会以新视频的尾帧作首帧重新生成，衔接更自然，会产生额外花费。`
                                    : laterWithVideo
                                      ? "后续段保持不变；下一段的首帧仍是原视频的尾帧，衔接处可能有跳变。"
                                      : "这是最后一个已生成视频的剧情段，后续段不受影响。"}
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="grid gap-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        设定
                        <Select
                            ariaLabel="选择设定"
                            appearance="field"
                            showSearch
                            optionFilterProp="label"
                            value={castId || undefined}
                            options={castOptions}
                            onChange={(value: string) => setCastId(value)}
                            placeholder={cast ? "选择角色、场景或道具" : "正在读取设定…"}
                        />
                    </label>
                    {targetCast ? (
                        <div className="flex items-center gap-3">
                            <Thumb storageKey={targetCast.imageResourceId ? `resource:${targetCast.imageResourceId}` : undefined} label="短剧当前" />
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <Thumb storageKey={node.metadata?.storageKey} label="画布这张" />
                        </div>
                    ) : null}
                    {targetCast ? (
                        <Checkbox checked={restyle} onChange={(event) => setRestyle(event.target.checked)}>
                            <span className="text-sm">
                                让引用它的剧情段视频重新生成
                                {impactQuery.data ? (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                        （{impactQuery.data.episodes} 集 · {impactQuery.data.segments} 段）
                                    </span>
                                ) : null}
                            </span>
                        </Checkbox>
                    ) : null}
                    {targetCast ? <p className="text-xs leading-5 text-muted-foreground">{restyle ? "这些段的视频会标记过期，重新生成时按新参考图出画面，会产生额外花费。" : "已生成的剧情段视频保持不变，之后新生成的段使用新参考图。"}</p> : null}
                </div>
            )}

            {blocker && resourceId === "" ? (
                <Callout tone="warning" className="mt-4">
                    {blocker}
                </Callout>
            ) : null}
            {warnings.length ? (
                <Callout tone="warning" className="mt-4" title="采用前请确认">
                    <ul className="grid list-disc gap-0.5 pl-4">
                        {warnings.map((warning) => (
                            <li key={warning}>{warning}</li>
                        ))}
                    </ul>
                </Callout>
            ) : null}
        </AppModal>
    );
}

/** 采用视频前的提示：画幅、音轨、时长与本段是否正在生成。只提示，不阻止。 */
function videoWarnings(node: CanvasNodeData, segment: DramaSegment, aspectRatio: string) {
    const warnings: string[] = [];
    const width = node.metadata?.naturalWidth || node.width;
    const height = node.metadata?.naturalHeight || node.height;
    const target = parseRatio(aspectRatio);
    if (target && width > 0 && height > 0 && Math.abs(width / height - target) / target > RATIO_TOLERANCE) warnings.push(`画幅与短剧（${aspectRatio}）不一致，合成成片时画面会被缩放适配。`);
    if (node.metadata?.hasAudio === false) warnings.push("这个视频没有音轨，成片里本段将没有对白与音效。");
    const planned = (segment.request.seconds || 0) * 1000 || segment.durationMs;
    const actual = node.metadata?.durationMs || 0;
    if (planned > 0 && actual > 0 && Math.abs(actual - planned) >= 1000) warnings.push(`视频时长 ${formatSeconds(actual)}，本段原计划 ${formatSeconds(planned)}，成片会按实际时长拼接。`);
    if (segment.videoStatus === "running" || segment.videoStatus === "queued") warnings.push("本段视频正在生成；采用后，在途的生成结果只进入版本记录，不会覆盖采用的视频。");
    return warnings;
}

function Thumb({ storageKey, label }: { storageKey?: string; label: string }) {
    return (
        <figure className="grid min-w-0 flex-1 gap-1">
            <span className="grid aspect-video place-items-center overflow-hidden rounded-md border border-border bg-surface-secondary text-muted-foreground">
                {storageKey ? (
                    <CachedResourceImage storageKey={storageKey} variant="thumbnail" alt={label} className="size-full object-contain" draggable={false} fallback={<ImageIcon className="size-4" />} />
                ) : (
                    <ImageIcon className="size-4" aria-label="暂无参考图" />
                )}
            </span>
            <figcaption className="text-center text-xs text-muted-foreground">{label}</figcaption>
        </figure>
    );
}
