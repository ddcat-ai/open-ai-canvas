import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { App } from "antd";
import type { SetURLSearchParams } from "react-router";

import { mediaVersionAdoptBlock, recordReplacedMediaVersion } from "@/lib/canvas/canvas-media-versions";
import { resetGenerationTaskMetadata } from "@/lib/canvas/canvas-task-state";
import {
    appendSegmentImages,
    buildDramaCastNode,
    buildDramaFinalNode,
    buildDramaSegmentGroup,
    dramaCastAssetCategory,
    dramaCastResourceIds,
    dramaFinalResourceIds,
    dramaPlacement,
    dramaReferenceSlot,
    dramaSegmentReferences,
    dramaSegmentRequiredResourceIds,
    dramaSegmentResourceIds,
    dramaSettingNodes,
    findDramaFinalNode,
    findDramaSegmentFrame,
    isDramaNodeStale,
    missingSegmentImages,
    placeDramaCastGroups,
    placeDramaGroup,
    type DramaAdoptTarget,
    type DramaCanvasPresence,
    type DramaCurrentMedia,
    type DramaProjectionMedia,
} from "@/lib/canvas/drama-canvas-projection";
import { DRAMA_CAST_KIND_LABEL, dramaCastDisplayName } from "@/lib/drama/drama-format";
import { dramaKeys } from "@/lib/drama/drama-query-keys";
import { dramaIsWorking, useDramaCast } from "@/lib/drama/use-drama-cast";
import { getDrama, getDramaEpisode, listDramaCast, listDramaTakes, type DramaCast, type DramaEpisode, type DramaEpisodeDetail, type DramaSegment, type DramaSettings, type DramaTake, type DramaTakeKind } from "@/services/api/drama";
import { ApiError } from "@/services/api/request";
import { resourceFileUrl } from "@/services/api/resources";
import { useAssetStore } from "@/stores/use-asset-store";
import {
    DRAMA_CANVAS_EDITOR_PARAM,
    DRAMA_CANVAS_FOCUS_PARAM,
    DRAMA_CANVAS_PARAM,
    ensureDramaCanvasAssets,
    parseDramaCanvasEditor,
    parseDramaCanvasFocus,
    type DramaCanvasAssetItem,
    type DramaCanvasEditor,
    type DramaCanvasFocus,
} from "@/services/drama-canvas";
import type { DramaPrevisRequest } from "@/lib/canvas/drama-previs";
import { CanvasNodeType, type CanvasConnection, type CanvasDramaRef, type CanvasNodeData, type CanvasNodeMetadata } from "@/types/canvas";

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
    connectionsRef: { current: CanvasConnection[] };
    setNodes: StateSetter<CanvasNodeData[]>;
    setConnections: StateSetter<CanvasConnection[]>;
    /** 选中并把视口移到这些节点；在资产视图时切回画布。 */
    focusNodes: (nodeIds: string[]) => void;
    openPrevis: (request: DramaPrevisRequest, editor: "previs" | "timeline") => Promise<void>;
    searchParams: URLSearchParams;
    setSearchParams: SetURLSearchParams;
};

const REFERENCED_EPISODE_LIMIT = 24;
const EMPTY_PRESENCE: DramaCanvasPresence = { cast: new Map(), segment: new Map(), final: new Map() };
// 换成短剧媒体时清掉旧媒体的派生信息，由节点重新测量。
const DERIVED_MEDIA_KEYS = ["previewContent", "mimeType", "bytes", "durationMs", "hasAudio", "waveform", "waveformVersion", "naturalWidth", "naturalHeight", "videoPreview", "imageRotation"] as const satisfies readonly (keyof CanvasNodeMetadata)[];

function combineEpisodeDetails(results: Array<UseQueryResult<DramaEpisodeDetail, Error>>) {
    return results.map((result) => result.data);
}

function castTitle(cast: Pick<DramaCast, "kind" | "name" | "lookName">) {
    return `${DRAMA_CAST_KIND_LABEL[cast.kind]} · ${dramaCastDisplayName(cast)}`;
}

/** 设定参考图的初始画幅，与制作台一致：角色按参考图方案，场景与道具统一 16:9；图片加载后节点按真实比例校正。 */
function castRatio(kind: DramaCast["kind"], settings: DramaSettings | undefined) {
    return (kind === "character" && settings?.assets?.characterRatio) || "16:9";
}

function segmentLabel(episode: Pick<DramaEpisode, "number">, segment: Pick<DramaSegment, "index">) {
    return `第 ${episode.number} 集 · 第 ${segment.index + 1} 段`;
}

function segmentAssetItems(episode: Pick<DramaEpisode, "number">, segment: DramaSegment, takes: DramaTake[], castById: Map<string, DramaCast>): DramaCanvasAssetItem[] {
    const label = segmentLabel(episode, segment);
    const items: DramaCanvasAssetItem[] = dramaSegmentReferences(segment, castById).map((reference) => ({
        resourceId: reference.resourceId,
        title: reference.kind === "image" ? reference.name : castTitle({ kind: reference.kind, name: reference.name }),
        category: reference.kind === "image" ? "material" : dramaCastAssetCategory(reference.kind),
    }));
    if (segment.request.firstFrameResourceId) items.push({ resourceId: segment.request.firstFrameResourceId, title: `${label} · 首帧`, category: "material" });
    for (const resourceId of dramaSegmentResourceIds(segment, takes)) {
        if (!items.some((item) => item.resourceId === resourceId)) items.push({ resourceId, title: `${label} · 视频`, category: "material" });
    }
    return items;
}

/** 把节点媒体换成短剧的资源：原媒体先进入版本历史，任务绑定解除，避免任务同步把节点改回去。 */
function withDramaMedia(node: CanvasNodeData, resourceId: string, assetId: string, ref: CanvasDramaRef): CanvasNodeData {
    const metadata: CanvasNodeMetadata = resetGenerationTaskMetadata(node.metadata, "success");
    for (const key of DERIVED_MEDIA_KEYS) delete metadata[key];
    const next: CanvasNodeData = { ...node, metadata: { ...metadata, content: resourceFileUrl(resourceId), storageKey: `resource:${resourceId}`, assetId, dramaRef: ref } };
    return recordReplacedMediaVersion(node, next, "generate");
}

export function useCanvasDrama(input: UseCanvasDramaInput) {
    const { canvasId, dramaId, projectLoaded, nodes, nodesRef, connectionsRef, setNodes, setConnections, searchParams, setSearchParams } = input;
    const { message } = App.useApp();
    const queryClient = useQueryClient();

    const summaryQuery = useQuery({
        queryKey: dramaKeys.summary(dramaId),
        queryFn: ({ signal }) => getDrama(dramaId, signal),
        enabled: Boolean(dramaId),
        // 关联的不是自动制作短剧（404）或无权访问时不重试，画布按普通关联画布处理。
        retry: (count, error) => !(error instanceof ApiError && (error.status === 404 || error.status === 403)) && count < 2,
        refetchInterval: (query) => (dramaIsWorking(query.state.data) ? 4_000 : 60_000),
        refetchOnWindowFocus: true,
    });
    const summary = dramaId ? summaryQuery.data : undefined;
    const active = Boolean(summary);
    const running = dramaIsWorking(summary);
    const castQuery = useDramaCast(active ? dramaId : "", summary);
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
        const settings = dramaSettingNodes(nodes, dramaId);
        const lines: string[] = [];
        for (const node of nodes) {
            const ref = node.metadata?.dramaRef;
            if (!ref || ref.projectId !== dramaId) continue;
            if (ref.kind === "cast" && settings.get(ref.id) !== node) continue;
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
    const activeCanvas = useRef("");
    useEffect(() => {
        activeCanvas.current = canvasId;
        return () => {
            activeCanvas.current = "";
        };
    }, [canvasId]);

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
    const fetchCast = useCallback(() => queryClient.fetchQuery({ queryKey: dramaKeys.cast(dramaId), queryFn: ({ signal }) => listDramaCast(dramaId, signal), staleTime: 0 }).then((data) => data.cast), [dramaId, queryClient]);
    const fetchTakes = useCallback(
        (ownerId: string, kind: DramaTakeKind) => queryClient.fetchQuery({ queryKey: dramaKeys.takes(dramaId, kind, ownerId), queryFn: ({ signal }) => listDramaTakes(dramaId, ownerId, kind, signal), staleTime: 0 }).then((data) => data.takes),
        [dramaId, queryClient],
    );
    /** 登记素材；required 里的资源缺失时中止投送，历史版本缺失只少带一个版本。 */
    const registerMedia = useCallback(
        async (items: DramaCanvasAssetItem[], required: string[]): Promise<DramaProjectionMedia> => {
            const assetIds = await ensureDramaCanvasAssets(dramaId, items);
            if (required.some((resourceId) => !assetIds.has(resourceId))) throw new Error("部分参考图或视频已不可用（可能已删除），请在制作台检查后再投送");
            const sizes = new Map(useAssetStore.getState().assets.flatMap((asset) => (asset.kind === "image" && asset.data.width > 0 && asset.data.height > 0 ? [[asset.id, { width: asset.data.width, height: asset.data.height }] as const] : [])));
            return { assetIdOf: (resourceId) => assetIds.get(resourceId), urlOf: resourceFileUrl, imageSizeOf: (resourceId) => sizes.get(assetIds.get(resourceId) || "") };
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
        async (castId?: string) => {
            const placed = castId && dramaSettingNodes(nodesRef.current, dramaId).get(castId);
            if (placed) return focus([placed.id]);
            await run(castId ? `cast:${castId}` : "settings", "设定投送失败", async () => {
                const allCast = await fetchCast();
                const stillOpen = () => activeCanvas.current === canvasId && latest.current.input.dramaId === dramaId;
                if (!stillOpen()) return;
                const settings = dramaSettingNodes(nodesRef.current, dramaId);
                const selected = allCast.filter((cast) => (castId ? cast.id === castId : Boolean(cast.imageResourceId)));
                if (castId && !selected.length) throw new Error("这个设定已被删除");
                const missing = selected.filter((cast) => !settings.has(cast.id));
                if (!missing.length) {
                    const existing = castId && settings.get(castId);
                    if (existing) focus([existing.id]);
                    return;
                }
                const takes = new Map<string, DramaTake[]>();
                // 批量打开时只读取有历史版本的设定，限制同时发起的版本查询。
                const versioned = missing.filter((cast) => castId || cast.imageVersion > 1);
                for (let offset = 0; offset < versioned.length; offset += 8) {
                    await Promise.all(versioned.slice(offset, offset + 8).map(async (cast) => takes.set(cast.id, await fetchTakes(cast.id, "cast"))));
                    if (!stillOpen()) return;
                }
                const items = missing.flatMap((cast) => dramaCastResourceIds(cast, takes.get(cast.id)).map((resourceId) => ({ resourceId, title: castTitle(cast), category: dramaCastAssetCategory(cast.kind) })));
                const media = await registerMedia(items, castId && missing[0]?.imageResourceId ? [missing[0].imageResourceId] : []);
                if (!stillOpen()) return;
                const available = missing.filter((cast) => !cast.imageResourceId || media.assetIdOf(cast.imageResourceId));
                const drafts = available.map((cast) => ({
                    cast,
                    node: buildDramaCastNode({ projectId: dramaId, cast, ratio: castRatio(cast.kind, latest.current.summary?.production.settings), takes: takes.get(cast.id), media, topLeft: { x: 0, y: 0 } }),
                }));
                const before = nodesRef.current;
                const next = placeDramaCastGroups(before, dramaId, drafts);
                if (next !== before) setNodes(next);
                const onCanvas = dramaSettingNodes(next, dramaId);
                if (castId) {
                    const target = onCanvas.get(castId);
                    if (target) focus([target.id]);
                } else if (next !== before) {
                    focus([...new Set(available.map((cast) => onCanvas.get(cast.id)?.parentId).filter((id): id is string => Boolean(id)))]);
                }
                if (available.length < missing.length) message.warning(`${missing.length - available.length} 张设定参考图不可用，请在制作台检查后重试`);
            });
        },
        [canvasId, dramaId, fetchCast, fetchTakes, focus, message, nodesRef, registerMedia, run, setNodes],
    );

    /** 仅在显式打开时投送。已有段框复用原节点、连线和版本，后台轮询只刷新素材数据。 */
    const projectSegments = useCallback(
        async (detail: DramaEpisodeDetail, segments: DramaSegment[]) => {
            const allCast = await fetchCast();
            const castById = new Map(allCast.map((cast) => [cast.id, cast]));
            const missingBySegment = new Map<string, Set<string>>();
            const pending = segments.filter((segment) => {
                const frame = findDramaSegmentFrame(nodesRef.current, segment.id);
                if (!frame) return true;
                const slots = missingSegmentImages(nodesRef.current, frame, segment, castById);
                missingBySegment.set(segment.id, slots);
                return slots.size > 0;
            });
            if (!pending.length) return;
            const takesList = await Promise.all(pending.map((segment) => (missingBySegment.has(segment.id) ? [] : fetchTakes(segment.id, "video"))));
            const items = pending.flatMap((segment, index) => {
                const all = segmentAssetItems(detail.episode, segment, takesList[index], castById);
                const slots = missingBySegment.get(segment.id);
                if (!slots) return all;
                const ids = new Set(
                    dramaSegmentReferences(segment, castById)
                        .filter((ref) => slots.has(dramaReferenceSlot(ref)))
                        .map((ref) => ref.resourceId),
                );
                if (slots.has("first") && segment.request.firstFrameResourceId) ids.add(segment.request.firstFrameResourceId);
                return all.filter((item) => ids.has(item.resourceId));
            });
            const required = pending.flatMap((segment) => (missingBySegment.has(segment.id) ? [] : dramaSegmentRequiredResourceIds(segment)));
            const media = await registerMedia(items, required);
            if (activeCanvas.current !== canvasId || latest.current.input.dramaId !== dramaId) return;
            const aspectRatio = latest.current.summary?.production.settings.aspectRatio || "9:16";
            let working = nodesRef.current;
            let connections = connectionsRef.current;
            pending.forEach((segment, index) => {
                const group = buildDramaSegmentGroup({ projectId: dramaId, episode: detail.episode, segment, shots: detail.shots, castById, aspectRatio, takes: takesList[index], media });
                const frame = findDramaSegmentFrame(working, segment.id);
                if (frame) {
                    const next = appendSegmentImages(working, connections, frame, segment, group, missingSegmentImages(working, frame, segment, castById));
                    working = next.nodes;
                    connections = next.connections;
                    return;
                }
                const placed = placeDramaGroup(group.nodes, dramaPlacement(working, group.size, { kind: "segment", episodeId: detail.episode.id }));
                working = [...working, ...placed];
                connections = [...connections, ...group.connections];
            });
            if (working !== nodesRef.current) setNodes(working);
            if (connections !== connectionsRef.current) setConnections(connections);
            if (pending.some((segment) => dramaSegmentReferences(segment, castById).some((ref) => (!missingBySegment.has(segment.id) || missingBySegment.get(segment.id)?.has(dramaReferenceSlot(ref))) && !media.assetIdOf(ref.resourceId))))
                message.warning("部分参考图已不可用，可在制作台检查后重新打开");
        },
        [canvasId, connectionsRef, dramaId, fetchCast, fetchTakes, message, nodesRef, registerMedia, setConnections, setNodes],
    );

    const projectSegment = useCallback(
        (episodeId: string, segmentIndex: number, editor: DramaCanvasEditor = "canvas") =>
            run(`${editor === "canvas" ? "segment" : editor}:${episodeId}:${segmentIndex}`, "剧情段投送失败", async () => {
                const ensureCurrentCanvas = () => {
                    if (latest.current.input.canvasId !== canvasId || latest.current.input.dramaId !== dramaId) throw new Error("画布已切换，请重新打开剧情段");
                };
                const detail = await fetchEpisode(episodeId);
                ensureCurrentCanvas();
                const segment = detail.segments.find((item) => item.index === segmentIndex);
                if (!segment) throw new Error("这个剧情段不存在，可能已重新改编");
                await projectSegments(detail, [segment]);
                ensureCurrentCanvas();
                const frameId = findDramaSegmentFrame(nodesRef.current, segment.id)?.id;
                if (!frameId) return;
                focus([frameId]);
                if (editor !== "canvas") {
                    const source = nodesRef.current.find((node) => node.type === CanvasNodeType.Video && node.metadata?.workflowKind !== "shot" && node.metadata?.dramaRef?.kind === "segment" && node.metadata.dramaRef.id === segment.id);
                    if (!source) throw new Error("本段的画布视频节点已被删除，请先重新投送本段");
                    const aspectRatio = latest.current.summary?.production.settings.aspectRatio;
                    if (!aspectRatio) throw new Error("作品画幅未就绪，请刷新制作台后重试");
                    await latest.current.input.openPrevis({ episode: detail.episode, segment, shots: detail.shots, aspectRatio, sourceNodeId: source.id }, editor);
                }
            }),
        [canvasId, dramaId, fetchEpisode, focus, nodesRef, projectSegments, run],
    );

    const projectEpisode = useCallback(
        (episodeId: string) =>
            run(`episode:${episodeId}`, "整集投送失败", async () => {
                const detail = await fetchEpisode(episodeId);
                if (!detail.segments.length) throw new Error("这一集还没有剧情段，剧本和分镜完成后再投送");
                const ordered = [...detail.segments].sort((left, right) => left.index - right.index);
                await projectSegments(detail, ordered);
                if (activeCanvas.current !== canvasId || latest.current.input.dramaId !== dramaId) return;
                focus(ordered.map((segment) => findDramaSegmentFrame(nodesRef.current, segment.id)?.id).filter((id): id is string => Boolean(id)));
            }),
        [canvasId, dramaId, fetchEpisode, focus, nodesRef, projectSegments, run],
    );

    /** 成片投送只接收已生成的视频。 */
    const buildFinal = useCallback(
        async (episodeId: string) => {
            const { episode } = await fetchEpisode(episodeId);
            if (!episode.finalResourceId) throw new Error("这一集还没有成片");
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
                const node = await buildFinal(episodeId);
                const existing = findDramaFinalNode(nodesRef.current, episodeId);
                if (existing) return focus([existing.id]);
                setNodes((items) => [...items, node]);
                focus([node.id]);
            });
        },
        [buildFinal, focus, nodesRef, run, setNodes],
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
            setNodes((items) => items.map((item) => (item.id === nodeId ? { ...item, metadata: { ...item.metadata, dramaRef: ref.kind === "cast" ? { ...ref, castRole: item.metadata?.dramaRef?.castRole } : ref } } : item)));
            invalidate(target.kind === "segment" ? target.episodeId : undefined);
        },
        [dramaId, invalidate, setNodes],
    );

    const dispatchFocus = (target: DramaCanvasFocus, editor: DramaCanvasEditor) => {
        switch (target.kind) {
            case "cast":
                return projectCast(target.castId);
            case "segment":
                return projectSegment(target.episodeId, target.segmentIndex, editor);
            case "episode":
                return projectEpisode(target.episodeId);
            case "final":
                return projectFinal(target.episodeId);
        }
    };

    // 从制作台跳来时 URL 带着短剧与要投送的对象：短剧数据就绪后执行一次，随后清掉参数，刷新页面不重复投送。
    const dramaParam = searchParams.get(DRAMA_CANVAS_PARAM);
    const focusParam = searchParams.get(DRAMA_CANVAS_FOCUS_PARAM);
    const editorParam = searchParams.get(DRAMA_CANVAS_EDITOR_PARAM);
    const handledFocusRef = useRef("");
    const summaryFailed = summaryQuery.isError;
    useEffect(() => {
        if (!dramaParam && !focusParam) {
            handledFocusRef.current = "";
            return;
        }
        if (!projectLoaded) return;
        const key = `${canvasId}|${dramaParam || ""}|${focusParam || ""}|${editorParam || ""}`;
        if (handledFocusRef.current === key) return;
        const mismatch = Boolean(dramaParam && dramaParam !== dramaId);
        if (!mismatch && !summaryFailed && !summary) return;
        handledFocusRef.current = key;
        setSearchParams(
            (currentParams) => {
                const next = new URLSearchParams(currentParams);
                next.delete(DRAMA_CANVAS_PARAM);
                next.delete(DRAMA_CANVAS_FOCUS_PARAM);
                next.delete(DRAMA_CANVAS_EDITOR_PARAM);
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
        const editor = parseDramaCanvasEditor(editorParam);
        if (!editor || (focusParam !== null && !focusTarget) || (editor !== "canvas" && focusTarget?.kind !== "segment")) {
            message.warning("精修入口无效，请从制作台选择剧情段后重试");
            return;
        }
        if (focusTarget) void dispatchFocus(focusTarget, editor);
        else void projectCast();
        // 投送函数只在这一次执行时读取；handledFocusRef 保证同一组参数只处理一次。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [canvasId, dramaId, dramaParam, editorParam, focusParam, message, projectLoaded, setSearchParams, summary, summaryFailed]);

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
        refreshNode,
        adoptNodeId,
        openAdopt,
        closeAdopt,
        markAdopted,
    };
}

export type CanvasDramaController = ReturnType<typeof useCanvasDrama>;
