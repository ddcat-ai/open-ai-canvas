import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { App } from "antd";
import type { SetURLSearchParams } from "react-router";

import { mediaVersionAdoptBlock, recordReplacedMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import {
    buildDramaCastNode,
    buildDramaEpisodeTimeline,
    buildDramaFinalNode,
    buildDramaSegmentGroup,
    dramaCastAssetCategory,
    dramaCastResourceIds,
    dramaFinalResourceIds,
    dramaPlacement,
    dramaSegmentRequiredResourceIds,
    dramaSegmentResourceIds,
    findDramaFinalNode,
    findDramaSegmentFrame,
    isDramaNodeStale,
    placeDramaGroup,
    type DramaAdoptTarget,
    type DramaCanvasPresence,
    type DramaCurrentMedia,
    type DramaProjectionMedia,
} from "@/lib/canvas/drama-canvas-projection";
import { DRAMA_CAST_KIND_LABEL } from "@/lib/drama/drama-format";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { getDrama, getDramaEpisode, listDramaCast, listDramaTakes, type DramaCast, type DramaEpisode, type DramaEpisodeDetail, type DramaSegment, type DramaSettings, type DramaSummary, type DramaTake, type DramaTakeKind } from "@/services/api/drama";
import { ApiError } from "@/services/api/request";
import { resourceFileUrl } from "@/services/api/resources";
import { DRAMA_CANVAS_FOCUS_PARAM, DRAMA_CANVAS_PARAM, ensureDramaCanvasAssets, parseDramaCanvasFocus, type DramaCanvasAssetItem, type DramaCanvasFocus } from "@/services/drama-canvas";
import { CanvasNodeType, type CanvasConnection, type CanvasDramaRef, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";
import type { TimelineProject } from "@/types/timeline";

// 精修画布的短剧模式：画布关联短剧作品时，按需把设定、剧情段、成片投送到画布，
// 标出短剧侧已更新的节点，并维护“采用到短剧”弹窗。短剧是事实源，这里不做双向自动同步。

type StateSetter<T> = (update: T | ((current: T) => T)) => void;

export type UseCanvasDramaInput = {
    canvasId: string;
    /** 画布关联的短剧作品 ID；未关联或未开放短剧时为空。 */
    dramaId: string;
    projectLoaded: boolean;
    nodes: CanvasNodeData[];
    nodesRef: { current: CanvasNodeData[] };
    setNodes: StateSetter<CanvasNodeData[]>;
    setConnections: StateSetter<CanvasConnection[]>;
    timeline: TimelineProject | undefined;
    saveTimeline: (timeline: TimelineProject) => void;
    openTimeline: (anchorNodeId: string) => void;
    /** 选中并把视口移到这些节点；在资产视图时切回画布。 */
    focusNodes: (nodeIds: string[]) => void;
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
};

const REFERENCED_EPISODE_LIMIT = 24;
const EMPTY_PRESENCE: DramaCanvasPresence = { cast: new Map(), segment: new Map(), final: new Map() };
// 换成短剧媒体时清掉旧媒体的派生信息，由节点重新测量。
const DERIVED_MEDIA_KEYS = ["previewContent", "mimeType", "bytes", "durationMs", "hasAudio", "waveform", "waveformVersion", "naturalWidth", "naturalHeight", "videoPreview", "imageRotation"] as const satisfies readonly (keyof CanvasNodeMetadata)[];

function dramaRunning(summary: DramaSummary | undefined) {
    return Boolean(summary && (summary.production.status === "running" || (summary.jobCounts.running || 0) > 0));
}

function combineEpisodeDetails(results: Array<UseQueryResult<DramaEpisodeDetail, Error>>) {
    return results.map((result) => result.data);
}

function castTitle(cast: Pick<DramaCast, "kind" | "name">) {
    return `${DRAMA_CAST_KIND_LABEL[cast.kind]} · ${cast.name}`;
}

/** 设定参考图的初始画幅，与制作台一致：角色按参考图方案，场景与道具统一 16:9；图片加载后节点按真实比例校正。 */
function castRatio(kind: DramaCast["kind"], settings: DramaSettings | undefined) {
    return (kind === "character" && settings?.assets?.characterRatio) || "16:9";
}

function segmentLabel(episode: Pick<DramaEpisode, "number">, segment: Pick<DramaSegment, "index">) {
    return `第 ${episode.number} 集 · 第 ${segment.index + 1} 段`;
}

function segmentAssetItems(episode: Pick<DramaEpisode, "number">, segment: DramaSegment, takes: DramaTake[]): DramaCanvasAssetItem[] {
    const label = segmentLabel(episode, segment);
    const items: DramaCanvasAssetItem[] = segment.request.references
        .filter((reference) => reference.sent && reference.resourceId)
        .map((reference) => ({ resourceId: reference.resourceId!, title: castTitle(reference), category: dramaCastAssetCategory(reference.kind) }));
    if (segment.request.firstFrameResourceId) items.push({ resourceId: segment.request.firstFrameResourceId, title: `${label} · 首帧`, category: "material" });
    for (const resourceId of dramaSegmentResourceIds(segment, takes)) {
        if (!items.some((item) => item.resourceId === resourceId)) items.push({ resourceId, title: `${label} · 视频`, category: "material" });
    }
    return items;
}

/** 独立放置的设定节点；剧情段框里的参考图副本不算投送过的设定。 */
function standaloneCastNode(nodes: CanvasNodeData[], castId: string) {
    return nodes.find((node) => !node.parentId && node.metadata?.dramaRef?.kind === "cast" && node.metadata.dramaRef.id === castId);
}

/** 把节点媒体换成短剧的资源：原媒体先进入版本历史，任务绑定解除，避免任务同步把节点改回去。 */
function withDramaMedia(node: CanvasNodeData, resourceId: string, assetId: string, ref: CanvasDramaRef): CanvasNodeData {
    const metadata: CanvasNodeMetadata = resetGenerationTaskMetadata(node.metadata, "success");
    for (const key of DERIVED_MEDIA_KEYS) delete metadata[key];
    const next: CanvasNodeData = { ...node, metadata: { ...metadata, content: resourceFileUrl(resourceId), storageKey: `resource:${resourceId}`, assetId, dramaRef: ref } };
    return recordReplacedMediaVersion(node, next, "generate");
}

export function useCanvasDrama(input: UseCanvasDramaInput) {
    const { canvasId, dramaId, projectLoaded, nodes, nodesRef, setNodes, setConnections, searchParams, setSearchParams } = input;
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();

    const summaryQuery = useQuery({
        queryKey: dramaKeys.summary(dramaId),
        queryFn: ({ signal }) => getDrama(dramaId, signal),
        enabled: Boolean(dramaId),
        // 关联的不是自动制作短剧（404）或无权访问时不重试，画布按普通关联画布处理。
        retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && count < 2,
        refetchInterval: (query) => (dramaRunning(query.state.data) ? 15_000 : 60_000),
        refetchOnWindowFocus: true,
    });
    const summary = dramaId ? summaryQuery.data : undefined;
    const active = Boolean(summary);
    const running = dramaRunning(summary);

    const castQuery = useQuery({
        queryKey: dramaKeys.cast(dramaId),
        queryFn: ({ signal }) => listDramaCast(dramaId, signal),
        enabled: active,
        refetchInterval: running ? 20_000 : false,
    });
    const castList = active ? castQuery.data?.cast : undefined;

    // 画布上出现过的剧情段所在的集：只为这些集读取详情，用来判断段视频是否在短剧侧更新过。
    const referencedEpisodeKey = useMemo(() => {
        const ids = new Set<string>();
        for (const node of nodes) {
            const ref = node.metadata?.dramaRef;
            if (ref?.projectId === dramaId && ref.kind === "segment" && ref.episodeId) ids.add(ref.episodeId);
        }
        return [...ids].sort().slice(0, REFERENCED_EPISODE_LIMIT).join(",");
    }, [dramaId, nodes]);
    const episodeDetails = useQueries({
        queries: (referencedEpisodeKey ? referencedEpisodeKey.split(",") : []).map((episodeId) => ({
            queryKey: dramaKeys.episode(dramaId, episodeId),
            queryFn: ({ signal }: { signal: AbortSignal }) => getDramaEpisode(dramaId, episodeId, signal),
            enabled: active,
            staleTime: 30_000,
            refetchInterval: running ? 20_000 : (false as const),
        })),
        combine: combineEpisodeDetails,
    });

    const current = useMemo<DramaCurrentMedia>(() => {
        const castImages = castList ? new Map(castList.map((cast) => [cast.id, cast.imageResourceId || ""])) : null;
        const segmentVideos = new Map<string, string>();
        for (const detail of episodeDetails) for (const segment of detail?.segments || []) segmentVideos.set(segment.id, segment.videoResourceId || "");
        const finals = summary ? new Map(summary.episodes.map((episode) => [episode.id, episode.finalResourceId || ""])) : null;
        return {
            castImage: (id) => (castImages ? castImages.get(id) || "" : null),
            segmentVideo: (id) => segmentVideos.get(id) ?? null,
            finalVideo: (id) => (finals ? finals.get(id) || "" : null),
        };
    }, [castList, episodeDetails, summary]);

    // 集合内容不变时保持引用不变：节点经 Context 读取，引用变化会让所有节点重渲染。
    const staleKey = useMemo(
        () =>
            active
                ? nodes
                      .filter((node) => node.metadata?.dramaRef?.projectId === dramaId && isDramaNodeStale(node, current))
                      .map((node) => node.id)
                      .join("\n")
                : "",
        [active, current, dramaId, nodes],
    );
    const staleNodeIds = useMemo<ReadonlySet<string>>(() => new Set(staleKey ? staleKey.split("\n") : []), [staleKey]);

    const presenceKey = useMemo(() => {
        if (!active) return "";
        const lines: string[] = [];
        for (const node of nodes) {
            const ref = node.metadata?.dramaRef;
            if (!ref || ref.projectId !== dramaId) continue;
            if (ref.kind === "cast" && node.parentId) continue;
            if (ref.kind === "segment" && node.type !== CanvasNodeType.Frame && node.type !== CanvasNodeType.Video) continue;
            lines.push(`${ref.kind}:${ref.id}:${staleNodeIds.has(node.id) ? 1 : 0}`);
        }
        return lines.sort().join("\n");
    }, [active, dramaId, nodes, staleNodeIds]);
    const presence = useMemo<DramaCanvasPresence>(() => {
        if (!presenceKey) return EMPTY_PRESENCE;
        const result = { cast: new Map<string, boolean>(), segment: new Map<string, boolean>(), final: new Map<string, boolean>() };
        for (const line of presenceKey.split("\n")) {
            const [kind, id, stale] = line.split(":") as [keyof DramaCanvasPresence, string, string];
            result[kind].set(id, Boolean(result[kind].get(id)) || stale === "1");
        }
        return result;
    }, [presenceKey]);

    // 异步投送完成时读取最新的页面回调与短剧设置，避免沿用发起时的旧闭包。
    const latest = useRef({ input, summary, current });
    latest.current = { input, summary, current };

    const [busyKey, setBusyKey] = useState<string | null>(null);
    const busyRef = useRef<string | null>(null);
    const run = useCallback(
        async (key: string, failure: string, task: () => Promise<void>) => {
            if (busyRef.current) {
                message.info("上一次投送还在进行，请稍候");
                return;
            }
            busyRef.current = key;
            setBusyKey(key);
            try {
                await task();
            } catch (error) {
                message.error(error instanceof Error && error.message ? error.message : failure);
            } finally {
                busyRef.current = null;
                setBusyKey(null);
            }
        },
        [message],
    );

    const focus = useCallback((nodeIds: string[]) => latest.current.input.focusNodes(nodeIds), []);
    const fetchEpisode = useCallback((episodeId: string) => queryClient.fetchQuery({ queryKey: dramaKeys.episode(dramaId, episodeId), queryFn: ({ signal }) => getDramaEpisode(dramaId, episodeId, signal), staleTime: 0 }), [dramaId, queryClient]);
    const fetchCast = useCallback(() => queryClient.fetchQuery({ queryKey: dramaKeys.cast(dramaId), queryFn: ({ signal }) => listDramaCast(dramaId, signal), staleTime: 5_000 }).then((data) => data.cast), [dramaId, queryClient]);
    const fetchTakes = useCallback(
        (ownerId: string, kind: DramaTakeKind) => queryClient.fetchQuery({ queryKey: dramaKeys.takes(dramaId, kind, ownerId), queryFn: ({ signal }) => listDramaTakes(dramaId, ownerId, kind, signal), staleTime: 5_000 }).then((data) => data.takes),
        [dramaId, queryClient],
    );
    /** 登记素材；required 里的资源缺失时中止投送，历史版本缺失只少带一个版本。 */
    const registerMedia = useCallback(
        async (items: DramaCanvasAssetItem[], required: string[]): Promise<DramaProjectionMedia> => {
            const assetIds = await ensureDramaCanvasAssets(dramaId, items);
            if (required.some((resourceId) => !assetIds.has(resourceId))) throw new Error("部分参考图或视频已不可用（可能已删除），请在制作台检查后再投送");
            return { assetIdOf: (resourceId) => assetIds.get(resourceId), urlOf: resourceFileUrl };
        },
        [dramaId],
    );
    const invalidate = useCallback(
        (episodeId?: string) => {
            void queryClient.invalidateQueries({ queryKey: dramaKeys.summary(dramaId), exact: true });
            void queryClient.invalidateQueries({ queryKey: dramaKeys.cast(dramaId) });
            void queryClient.invalidateQueries({ queryKey: ["drama", dramaId, "takes"] });
            if (episodeId) void queryClient.invalidateQueries({ queryKey: dramaKeys.episode(dramaId, episodeId) });
        },
        [dramaId, queryClient],
    );

    const projectCast = useCallback(
        async (castId: string) => {
            const placed = standaloneCastNode(nodesRef.current, castId);
            if (placed) return focus([placed.id]);
            await run(`cast:${castId}`, "设定投送失败", async () => {
                const [allCast, takes] = await Promise.all([fetchCast(), fetchTakes(castId, "cast")]);
                const cast = allCast.find((item) => item.id === castId);
                if (!cast) throw new Error("这个设定已被删除");
                const items = dramaCastResourceIds(cast, takes).map((resourceId) => ({ resourceId, title: castTitle(cast), category: dramaCastAssetCategory(cast.kind) }));
                const media = await registerMedia(items, cast.imageResourceId ? [cast.imageResourceId] : []);
                const existing = standaloneCastNode(nodesRef.current, castId);
                if (existing) return focus([existing.id]);
                const draft = buildDramaCastNode({ projectId: dramaId, cast, ratio: castRatio(cast.kind, latest.current.summary?.production.settings), takes, media, topLeft: { x: 0, y: 0 } });
                const node = { ...draft, position: dramaPlacement(nodesRef.current, draft, { kind: "cast" }) };
                setNodes((items) => [...items, node]);
                focus([node.id]);
            });
        },
        [dramaId, fetchCast, fetchTakes, focus, nodesRef, registerMedia, run, setNodes],
    );

    /** 把若干剧情段排成段框：同一集接在已有段框下方，参考图连线按短剧的参考图编号。 */
    const placeSegments = useCallback(
        (detail: DramaEpisodeDetail, segments: DramaSegment[], takesList: DramaTake[][], allCast: DramaCast[], media: DramaProjectionMedia) => {
            const castById = new Map(allCast.map((cast) => [cast.id, cast]));
            const aspectRatio = latest.current.summary?.production.settings.aspectRatio || "9:16";
            let working = nodesRef.current;
            const added: CanvasNodeData[] = [];
            const connections: CanvasConnection[] = [];
            const frameIds: string[] = [];
            segments.forEach((segment, index) => {
                const group = buildDramaSegmentGroup({ projectId: dramaId, episode: detail.episode, segment, shots: detail.shots, castById, aspectRatio, takes: takesList[index], media });
                const placed = placeDramaGroup(group.nodes, dramaPlacement(working, group.size, { kind: "segment", episodeId: detail.episode.id }));
                working = [...working, ...placed];
                added.push(...placed);
                connections.push(...group.connections);
                frameIds.push(group.frameId);
            });
            setNodes((items) => [...items, ...added]);
            setConnections((items) => [...items, ...connections]);
            return frameIds;
        },
        [dramaId, nodesRef, setConnections, setNodes],
    );

    const projectSegment = useCallback(
        (episodeId: string, segmentIndex: number) =>
            run(`segment:${episodeId}:${segmentIndex}`, "剧情段投送失败", async () => {
                const detail = await fetchEpisode(episodeId);
                const segment = detail.segments.find((item) => item.index === segmentIndex);
                if (!segment) throw new Error("这个剧情段不存在，可能已重新改编");
                const existing = findDramaSegmentFrame(nodesRef.current, segment.id);
                if (existing) return focus([existing.id]);
                const [allCast, takes] = await Promise.all([fetchCast(), fetchTakes(segment.id, "video")]);
                const media = await registerMedia(segmentAssetItems(detail.episode, segment, takes), dramaSegmentRequiredResourceIds(segment));
                const raced = findDramaSegmentFrame(nodesRef.current, segment.id);
                if (raced) return focus([raced.id]);
                focus(placeSegments(detail, [segment], [takes], allCast, media));
            }),
        [fetchCast, fetchEpisode, fetchTakes, focus, nodesRef, placeSegments, registerMedia, run],
    );

    const projectEpisode = useCallback(
        (episodeId: string) =>
            run(`episode:${episodeId}`, "整集投送失败", async () => {
                const detail = await fetchEpisode(episodeId);
                if (!detail.segments.length) throw new Error("这一集还没有剧情段，剧本和分镜完成后再投送");
                const ordered = [...detail.segments].sort((left, right) => left.index - right.index);
                const missing = ordered.filter((segment) => !findDramaSegmentFrame(nodesRef.current, segment.id));
                if (missing.length) {
                    const [allCast, takesList] = await Promise.all([fetchCast(), Promise.all(missing.map((segment) => fetchTakes(segment.id, "video")))]);
                    const media = await registerMedia(
                        missing.flatMap((segment, index) => segmentAssetItems(detail.episode, segment, takesList[index])),
                        missing.flatMap((segment) => dramaSegmentRequiredResourceIds(segment)),
                    );
                    const pending = missing.map((segment, index) => ({ segment, takes: takesList[index] })).filter(({ segment }) => !findDramaSegmentFrame(nodesRef.current, segment.id));
                    placeSegments(
                        detail,
                        pending.map((item) => item.segment),
                        pending.map((item) => item.takes),
                        allCast,
                        media,
                    );
                    if (pending.length) message.success(`已投送第 ${detail.episode.number} 集的 ${pending.length} 个剧情段`);
                }
                focus(ordered.map((segment) => findDramaSegmentFrame(nodesRef.current, segment.id)?.id).filter((id): id is string => Boolean(id)));
            }),
        [fetchCast, fetchEpisode, fetchTakes, focus, message, nodesRef, placeSegments, registerMedia, run],
    );

    /** 成片节点；requireMedia=false 时允许没有成片的占位节点（剪辑时间线需要一个承载节点）。 */
    const buildFinal = useCallback(
        async (episodeId: string, requireMedia: boolean) => {
            const { episode } = await fetchEpisode(episodeId);
            if (requireMedia && !episode.finalResourceId) throw new Error("这一集还没有成片");
            const takes = episode.finalResourceId ? await fetchTakes(episode.id, "final") : [];
            const title = `第 ${episode.number} 集成片 · ${episode.title}`;
            const media = await registerMedia(
                dramaFinalResourceIds(episode, takes).map((resourceId) => ({ resourceId, title, category: "material" })),
                episode.finalResourceId ? [episode.finalResourceId] : [],
            );
            const draft = buildDramaFinalNode({ projectId: dramaId, episode, aspectRatio: latest.current.summary?.production.settings.aspectRatio || "9:16", takes, media, topLeft: { x: 0, y: 0 } });
            return { ...draft, position: dramaPlacement(nodesRef.current, draft, { kind: "final", episodeId: episode.id }) };
        },
        [dramaId, fetchEpisode, fetchTakes, nodesRef, registerMedia],
    );

    const projectFinal = useCallback(
        async (episodeId: string) => {
            const placed = findDramaFinalNode(nodesRef.current, episodeId);
            if (placed) return focus([placed.id]);
            await run(`final:${episodeId}`, "成片投送失败", async () => {
                const node = await buildFinal(episodeId, true);
                const existing = findDramaFinalNode(nodesRef.current, episodeId);
                if (existing) return focus([existing.id]);
                setNodes((items) => [...items, node]);
                focus([node.id]);
            });
        },
        [buildFinal, focus, nodesRef, run, setNodes],
    );

    /** 把一集的剧情段视频按成片顺序载入画布时间线，在画布里精剪；时间线只有一条，已有内容需确认后替换。 */
    const openEpisodeCut = useCallback(
        (episodeId: string) =>
            run(`cut:${episodeId}`, "载入剪辑失败", async () => {
                const detail = await fetchEpisode(episodeId);
                const usable = detail.segments.filter((segment) => segment.videoResourceId && (segment.videoStatus === "ready" || segment.videoStatus === "stale"));
                if (!usable.length) throw new Error("这一集还没有可剪辑的剧情段视频");
                const media = await registerMedia(
                    usable.map((segment) => ({ resourceId: segment.videoResourceId!, title: `${segmentLabel(detail.episode, segment)} · 视频`, category: "material" })),
                    [],
                );
                const { timeline, skipped } = buildDramaEpisodeTimeline({ episode: detail.episode, segments: [...detail.segments].sort((left, right) => left.index - right.index), media });
                if (!timeline.clips.length) throw new Error("这一集的剧情段视频暂时不可用");
                const existingClips = latest.current.input.timeline?.clips.length || 0;
                if (existingClips) {
                    const confirmed = await modal.confirm({
                        title: `用第 ${detail.episode.number} 集替换画布时间线？`,
                        content: `画布时间线里已有 ${existingClips} 个片段，载入后整条时间线会被替换。已导出的视频不受影响。`,
                        okText: "替换并载入",
                        cancelText: "保留现有时间线",
                    });
                    if (!confirmed) return;
                }
                let anchor = findDramaFinalNode(nodesRef.current, episodeId);
                if (!anchor) {
                    const created = await buildFinal(episodeId, false);
                    anchor = findDramaFinalNode(nodesRef.current, episodeId) || created;
                    if (anchor === created) setNodes((items) => [...items, created]);
                }
                latest.current.input.saveTimeline(timeline);
                latest.current.input.openTimeline(anchor.id);
                if (skipped.length) message.warning(`第 ${skipped.join("、")} 段还没有可用视频，未放进时间线`);
            }),
        [buildFinal, fetchEpisode, message, modal, nodesRef, registerMedia, run, setNodes],
    );

    /** 短剧侧已更新：把节点换成短剧当前的媒体，画布上原来的版本留在版本历史里。 */
    const refreshNode = useCallback(
        (node: CanvasNodeData) =>
            run(`refresh:${node.id}`, "同步短剧最新版本失败", async () => {
                const ref = node.metadata?.dramaRef;
                if (!ref) return;
                const now = latest.current.current;
                const resourceId = ref.kind === "cast" ? now.castImage(ref.id) : ref.kind === "segment" ? now.segmentVideo(ref.id) : now.finalVideo(ref.id);
                if (!resourceId) throw new Error("短剧侧还没有可同步的媒体");
                const block = mediaVersionAdoptBlock(nodesRef.current.find((item) => item.id === node.id));
                if (block === "missing") return;
                if (block === "locked") throw new Error("节点已锁定，解锁后再同步");
                if (block === "loading") throw new Error("节点正在生成或上传，完成后再同步");
                const media = await registerMedia([{ resourceId, title: node.title, category: node.metadata?.assetCategory }], [resourceId]);
                const target = nodesRef.current.find((item) => item.id === node.id);
                if (!target) return;
                const next = withDramaMedia(target, resourceId, media.assetIdOf(resourceId)!, { ...ref, baseResourceId: resourceId });
                setNodes((items) => items.map((item) => (item.id === target.id ? next : item)));
                message.success("已同步短剧最新版本，原来的画面保留在版本历史里");
            }),
        [message, nodesRef, registerMedia, run, setNodes],
    );

    const [adoptNodeId, setAdoptNodeId] = useState<string | null>(null);
    const openAdopt = useCallback((node: CanvasNodeData) => setAdoptNodeId(node.id), []);
    const closeAdopt = useCallback(() => setAdoptNodeId(null), []);
    /** 采用成功：节点绑定到采用目标，短剧侧当前版本就是它，不再提示“短剧侧已更新”。 */
    const markAdopted = useCallback(
        (nodeId: string, target: DramaAdoptTarget, resourceId: string) => {
            const ref: CanvasDramaRef =
                target.kind === "cast"
                    ? { projectId: dramaId, kind: "cast", id: target.castId, baseResourceId: resourceId }
                    : { projectId: dramaId, kind: "segment", id: target.segmentId, episodeId: target.episodeId, segmentIndex: target.segmentIndex, baseResourceId: resourceId };
            setNodes((items) => items.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, dramaRef: ref } } : item)));
            invalidate(target.kind === "segment" ? target.episodeId : undefined);
        },
        [dramaId, invalidate, setNodes],
    );

    const dispatchFocus = (target: DramaCanvasFocus) => {
        switch (target.kind) {
            case "cast":
                return projectCast(target.castId);
            case "segment":
                return projectSegment(target.episodeId, target.segmentIndex);
            case "episode":
                return projectEpisode(target.episodeId);
            case "final":
                return projectFinal(target.episodeId);
            case "cut":
                return openEpisodeCut(target.episodeId);
        }
    };

    // 从制作台跳来时 URL 带着短剧与要投送的对象：短剧数据就绪后执行一次，随后清掉参数，刷新页面不重复投送。
    const dramaParam = searchParams.get(DRAMA_CANVAS_PARAM);
    const focusParam = searchParams.get(DRAMA_CANVAS_FOCUS_PARAM);
    const handledFocusRef = useRef("");
    const summaryFailed = summaryQuery.isError;
    useEffect(() => {
        if (!projectLoaded || (!dramaParam && !focusParam)) return;
        const key = `${canvasId}|${dramaParam || ""}|${focusParam || ""}`;
        if (handledFocusRef.current === key) return;
        const mismatch = Boolean(dramaParam && dramaParam !== dramaId);
        if (!mismatch && !summaryFailed && !summary) return;
        handledFocusRef.current = key;
        setSearchParams(
            (currentParams) => {
                const next = new URLSearchParams(currentParams);
                next.delete(DRAMA_CANVAS_PARAM);
                next.delete(DRAMA_CANVAS_FOCUS_PARAM);
                next.delete("view");
                return next;
            },
            { replace: true },
        );
        if (mismatch) {
            message.warning("这张画布没有关联这部短剧，已打开画布本身");
            return;
        }
        if (summaryFailed) {
            message.warning("短剧数据读取失败，可稍后在左侧短剧侧栏重新投送");
            return;
        }
        const focusTarget = parseDramaCanvasFocus(focusParam);
        if (focusTarget) void dispatchFocus(focusTarget);
        // 投送函数只在这一次执行时读取；handledFocusRef 保证同一组参数只处理一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasId, dramaId, dramaParam, focusParam, message, projectLoaded, setSearchParams, summary, summaryFailed]);

    return {
        dramaId,
        active,
        summary,
        loadFailed: Boolean(dramaId) && summaryFailed,
        cast: castList,
        presence,
        staleNodeIds,
        busyKey,
        projectCast,
        projectSegment,
        projectEpisode,
        projectFinal,
        openEpisodeCut,
        refreshNode,
        adoptNodeId,
        openAdopt,
        closeAdopt,
        markAdopted,
    };
}

export type CanvasDramaController = ReturnType<typeof useCanvasDrama>;
