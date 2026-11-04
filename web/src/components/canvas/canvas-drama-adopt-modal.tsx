import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";
import { ArrowRight, Image as ImageIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { translate } from "@/i18n";

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
    return translate("canvasA.approval.seconds", { count: Math.round(ms / 100) / 10 });
}

export function CanvasDramaAdoptModal({ node, nodes, summary, cast, onClose, onAdopted }: CanvasDramaAdoptModalProps) {
    const { t } = useTranslation();
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
            ? t("canvasA.dramaAdopt.mediaPending")
            : t("canvasA.dramaAdopt.mediaNotStored")
        : isVideo
          ? !segment
              ? t("canvasA.dramaAdopt.chooseSegment")
              : ""
          : !targetCast
            ? t("canvasA.dramaAdopt.chooseCast")
            : "";
    const warnings = isVideo && segment ? videoWarnings(node, segment, summary.production.settings.aspectRatio).map((warning) => t(warning.key, warning.values)) : [];

    const submit = async () => {
        if (blocker || submitting) return;
        setSubmitting(true);
        try {
            if (!isVideo && targetCast) {
                const result = await setDramaCastImage(dramaId, targetCast.id, resourceId, restyle, { source: "canvas", taskId: node.metadata?.taskId });
                if (result.unchanged) message.info(t("canvasA.dramaAdopt.castUnchanged", { name: result.cast.name }));
                else message.success(result.affectedSegments ? t("canvasA.dramaAdopt.castReplacedRestyle", { name: result.cast.name, count: result.affectedSegments }) : t("canvasA.dramaAdopt.castReplaced", { name: result.cast.name }));
                onAdopted(node.id, { kind: "cast", castId: targetCast.id }, resourceId);
            } else if (isVideo && segment && episode) {
                const result = await adoptDramaSegmentVideo(dramaId, episode.id, segment.index, { resourceId, taskId: node.metadata?.taskId, cascade: cascade && !parallelVideo, expectedRevision: segment.revision });
                const label = t("canvasA.dramaAdopt.segmentLabel", { episode: episode.number, segment: segment.index + 1 });
                if (result.unchanged) {
                    message.info(t("canvasA.dramaAdopt.videoUnchanged", { label }));
                } else {
                    message.success(result.requeued ? t("canvasA.dramaAdopt.videoAdoptedRequeued", { label, count: result.requeued }) : t("canvasA.dramaAdopt.videoAdopted", { label }));
                    if (result.videoError) message.warning(result.videoError);
                    if (result.resumeError) message.warning(t("canvasA.dramaAdopt.resumeFailed", { reason: result.resumeError }));
                    else if (result.paused) message.info(t("canvasA.dramaAdopt.paused"));
                }
                onAdopted(node.id, { kind: "segment", episodeId: episode.id, segmentIndex: segment.index, segmentId: segment.id }, resourceId);
            }
            onClose();
        } catch (error) {
            if (error instanceof ApiError && error.reason === DRAMA_ERROR_REASON.segmentChanged) {
                message.warning(t("canvasA.dramaAdopt.segmentChanged"));
                void episodeQuery.refetch();
                return;
            }
            message.error(error instanceof Error && error.message ? error.message : t("canvasA.dramaAdopt.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal open centered title={t("canvasA.dramaAdopt.title")} width={520} onCancel={onClose} okText={t("canvasA.dramaAdopt.ok")} confirmLoading={submitting} okButtonProps={{ disabled: Boolean(blocker) }} onOk={() => void submit()}>
            <p className="mb-4 text-sm text-muted-foreground">{isVideo ? t("canvasA.dramaAdopt.videoIntro") : t("canvasA.dramaAdopt.imageIntro")}</p>

            {isVideo ? (
                <div className="grid gap-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        {t("canvasA.dramaAdopt.episode")}
                        <Select
                            ariaLabel={t("canvasA.dramaAdopt.chooseEpisode")}
                            appearance="field"
                            value={episodeId || undefined}
                            options={summary.episodes.map((item) => ({ value: item.id, label: t("canvasA.dramaAdopt.episodeOption", { number: item.number, title: item.title }) }))}
                            onChange={(value: string) => {
                                setEpisodeId(value);
                                setSegmentIndex(null);
                            }}
                            placeholder={t("canvasA.dramaAdopt.chooseEpisode")}
                        />
                    </label>
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        {t("canvasA.dramaAdopt.segment")}
                        <Select
                            ariaLabel={t("canvasA.dramaAdopt.chooseSegmentShort")}
                            appearance="field"
                            value={segment ? segment.index : undefined}
                            loading={episodeQuery.isLoading}
                            disabled={!segments.length}
                            options={segments.map((item) => ({ value: item.index, label: t("canvasA.dramaAdopt.segmentOption", { number: item.index + 1, title: item.title }) }))}
                            onChange={(value: number) => setSegmentIndex(value)}
                            placeholder={episodeQuery.isLoading ? t("canvasA.dramaAdopt.loadingSegments") : segments.length ? t("canvasA.dramaAdopt.chooseSegmentShort") : t("canvasA.dramaAdopt.noSegments")}
                        />
                    </label>
                    {segment && parallelVideo ? <p className="text-xs leading-5 text-muted-foreground">{t("canvasA.dramaAdopt.parallelNote")}</p> : null}
                    {segment && !parallelVideo ? (
                        <div className="grid gap-2">
                            <SegmentedControl
                                ariaLabel={t("canvasA.dramaAdopt.laterSegments")}
                                block
                                value={cascade ? "cascade" : "single"}
                                onChange={(value) => setCascade(value === "cascade")}
                                options={[
                                    { value: "single", label: t("canvasA.dramaAdopt.single") },
                                    { value: "cascade", label: t("canvasA.dramaAdopt.cascade"), disabled: !laterWithVideo },
                                ]}
                            />
                            <p className="text-xs leading-5 text-muted-foreground">
                                {cascade ? t("canvasA.dramaAdopt.cascadeNote", { count: laterWithVideo }) : laterWithVideo ? t("canvasA.dramaAdopt.singleNote") : t("canvasA.dramaAdopt.lastSegmentNote")}
                            </p>
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="grid gap-3">
                    <label className="grid gap-1 text-xs text-muted-foreground">
                        {t("canvasA.dramaAdopt.cast")}
                        <Select
                            ariaLabel={t("canvasA.dramaAdopt.chooseCastShort")}
                            appearance="field"
                            showSearch
                            optionFilterProp="label"
                            value={castId || undefined}
                            options={castOptions}
                            onChange={(value: string) => setCastId(value)}
                            placeholder={cast ? t("canvasA.dramaAdopt.castPlaceholder") : t("canvasA.dramaAdopt.loadingCast")}
                        />
                    </label>
                    {targetCast ? (
                        <div className="flex items-center gap-3">
                            <Thumb storageKey={targetCast.imageResourceId ? `resource:${targetCast.imageResourceId}` : undefined} label={t("canvasA.dramaAdopt.currentInDrama")} />
                            <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                            <Thumb storageKey={node.metadata?.storageKey} label={t("canvasA.dramaAdopt.fromCanvas")} />
                        </div>
                    ) : null}
                    {targetCast ? (
                        <Checkbox checked={restyle} onChange={(event) => setRestyle(event.target.checked)}>
                            <span className="text-sm">
                                {t("canvasA.dramaAdopt.restyle")}
                                {impactQuery.data ? <span className="ml-1 text-xs text-muted-foreground">{t("canvasA.dramaAdopt.impact", { episodes: impactQuery.data.episodes, segments: impactQuery.data.segments })}</span> : null}
                            </span>
                        </Checkbox>
                    ) : null}
                    {targetCast ? <p className="text-xs leading-5 text-muted-foreground">{restyle ? t("canvasA.dramaAdopt.restyleNote") : t("canvasA.dramaAdopt.keepNote")}</p> : null}
                </div>
            )}

            {blocker && resourceId === "" ? (
                <Callout tone="warning" className="mt-4">
                    {blocker}
                </Callout>
            ) : null}
            {warnings.length ? (
                <Callout tone="warning" className="mt-4" title={t("canvasA.dramaAdopt.confirmTitle")}>
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
    const warnings: Array<{ key: string; values?: Record<string, string | number> }> = [];
    const width = node.metadata?.naturalWidth || node.width;
    const height = node.metadata?.naturalHeight || node.height;
    const target = parseRatio(aspectRatio);
    if (target && width > 0 && height > 0 && Math.abs(width / height - target) / target > RATIO_TOLERANCE) warnings.push({ key: "canvasA.dramaAdopt.warnRatio", values: { ratio: aspectRatio } });
    if (node.metadata?.hasAudio === false) warnings.push({ key: "canvasA.dramaAdopt.warnNoAudio" });
    const planned = (segment.request.seconds || 0) * 1000 || segment.durationMs;
    const actual = node.metadata?.durationMs || 0;
    if (planned > 0 && actual > 0 && Math.abs(actual - planned) >= 1000) warnings.push({ key: "canvasA.dramaAdopt.warnDuration", values: { actual: formatSeconds(actual), planned: formatSeconds(planned) } });
    if (segment.videoStatus === "running" || segment.videoStatus === "queued") warnings.push({ key: "canvasA.dramaAdopt.warnRunning" });
    return warnings;
}

function Thumb({ storageKey, label }: { storageKey?: string; label: string }) {
    const { t } = useTranslation();
    return (
        <figure className="grid min-w-0 flex-1 gap-1">
            <span className="grid aspect-video place-items-center overflow-hidden rounded-md border border-border bg-surface-secondary text-muted-foreground">
                {storageKey ? (
                    <CachedResourceImage storageKey={storageKey} variant="thumbnail" alt={label} className="size-full object-contain" draggable={false} fallback={<ImageIcon className="size-4" />} />
                ) : (
                    <ImageIcon className="size-4" aria-label={t("canvasA.dramaAdopt.noReference")} />
                )}
            </span>
            <figcaption className="text-center text-xs text-muted-foreground">{label}</figcaption>
        </figure>
    );
}
