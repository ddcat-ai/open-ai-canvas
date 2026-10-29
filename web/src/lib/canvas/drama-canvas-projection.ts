import { nanoid } from "nanoid";

import { createCanvasNode, createStoryboardRow } from "@/lib/canvas/canvas-project-domain";
import { FRAME_HEADER_HEIGHT, FRAME_PADDING } from "@/lib/canvas/canvas-frame";
import { findAvailableGenerationGroupPosition } from "@/lib/canvas/canvas-generation-layout";
import { createDefaultTracks, DEFAULT_VIDEO_TRACK_ID } from "@/lib/timeline/timeline-tracks";
import { DRAMA_CAST_KIND_LABEL } from "@/lib/drama/drama-format";
import type { DramaCast, DramaCastKind, DramaEpisode, DramaSegment, DramaShot, DramaTake } from "@/services/api/drama";
import { CanvasNodeType, type CanvasConnection, type CanvasDramaRef, type CanvasMediaVersion, type CanvasNodeData, type CanvasVideoEditOperation, type Position, type StoryboardColumn, type StoryboardRow } from "@/types/canvas";
import type { TimelineClip, TimelineProject } from "@/types/timeline";

// 短剧 → 精修画布的投送：纯函数，只负责把短剧对象排成节点、连线与时间线；
// 素材登记、写入画布和网络请求由调用方完成。节点通过 metadata.dramaRef 回指短剧对象。

const DRAMA_CAST_ASSET_CATEGORY: Record<DramaCastKind, "character" | "prop" | "environment"> = { character: "character", prop: "prop", scene: "environment" };

/** 投送时每个对象最多带入的历史版本数；更早的版本仍在制作台的版本记录里。 */
export const DRAMA_TAKE_PROJECTION_LIMIT = 6;

const GROUP_GAP = 32;
const REF_SIZE = 160;
const REF_GAP = 16;
const PROMPT_WIDTH = 360;
const PROMPT_HEIGHT = 300;
const SCRIPT_MIN_WIDTH = 920;
const SCRIPT_HEIGHT = 360;
const CAST_WIDTH = 240;
const SEGMENT_STACK_GAP = 120;

export type DramaProjectionMedia = {
    /** 资源对应的素材记录；画布媒体节点必须带 assetId 才能保存。 */
    assetIdOf: (resourceId: string) => string | undefined;
    /** 资源文件地址；节点实际展示时按 storageKey 换取授权地址。 */
    urlOf: (resourceId: string) => string;
};

export function dramaCastAssetCategory(kind: DramaCastKind) {
    return DRAMA_CAST_ASSET_CATEGORY[kind];
}

function parseRatio(ratio: string | undefined, fallback: [number, number]): [number, number] {
    const [width, height] = (ratio || "").split(":").map(Number);
    return width > 0 && height > 0 ? [width, height] : fallback;
}

/** 按画幅给出最长边为 longest 的尺寸。 */
export function dramaMediaSize(aspectRatio: string | undefined, longest: number) {
    const [w, h] = parseRatio(aspectRatio, [9, 16]);
    return w >= h ? { width: longest, height: Math.round((longest * h) / w) } : { width: Math.round((longest * w) / h), height: longest };
}

function resourceKey(resourceId: string) {
    return `resource:${resourceId}`;
}

function translate(nodes: CanvasNodeData[], dx: number, dy: number) {
    return nodes.map((node) => ({ ...node, position: { x: node.position.x + dx, y: node.position.y + dy } }));
}

function bounds(nodes: CanvasNodeData[]) {
    if (!nodes.length) return null;
    return {
        left: Math.min(...nodes.map((node) => node.position.x)),
        top: Math.min(...nodes.map((node) => node.position.y)),
        right: Math.max(...nodes.map((node) => node.position.x + node.width)),
        bottom: Math.max(...nodes.map((node) => node.position.y + node.height)),
    };
}

function edge(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `conn-${nanoid()}`, fromNodeId, toNodeId };
}

function mediaNode(type: CanvasNodeType.Image | CanvasNodeType.Video, title: string, resourceId: string | undefined, media: DramaProjectionMedia, extra: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    const node = createCanvasNode(
        type,
        { x: 0, y: 0 },
        {
            ...extra,
            ...(resourceId ? { content: media.urlOf(resourceId), storageKey: resourceKey(resourceId), assetId: media.assetIdOf(resourceId), status: "success" as const } : { status: "idle" as const }),
        },
    );
    node.title = title;
    return node;
}

/** 历史版本映射为节点媒体版本：同一资源只保留最新一条，版本号沿用短剧的版本号。 */
export function dramaTakeVersions(takes: DramaTake[] | undefined, currentResourceId: string | undefined, media: DramaProjectionMedia, kind: "image" | "video"): Pick<NonNullable<CanvasNodeData["metadata"]>, "mediaVersions" | "currentMediaVersionId"> {
    const seen = new Set<string>();
    const usable = (takes || [])
        .filter((take) => {
            if (!take.resourceId || seen.has(take.resourceId) || !media.assetIdOf(take.resourceId)) return false;
            seen.add(take.resourceId);
            return true;
        })
        .slice(0, DRAMA_TAKE_PROJECTION_LIMIT);
    if (usable.length < 2) return {};
    const versions: CanvasMediaVersion[] = usable
        .map((take) => ({
            id: `drama-take-${take.id}`,
            number: take.version,
            createdAt: take.createdAt,
            source: take.source === "upload" ? ("upload" as const) : ("generate" as const),
            media: {
                content: media.urlOf(take.resourceId),
                storageKey: resourceKey(take.resourceId),
                assetId: media.assetIdOf(take.resourceId),
                ...(kind === "video" && take.durationMs ? { durationMs: take.durationMs } : {}),
            },
            ...(take.prompt ? { generation: { prompt: take.prompt } } : {}),
        }))
        .sort((left, right) => left.number - right.number);
    const current = versions.find((version) => version.media.storageKey === (currentResourceId ? resourceKey(currentResourceId) : ""));
    return { mediaVersions: versions, currentMediaVersionId: current?.id };
}

/** 节点自身或所在剧情段框上的短剧绑定。 */
export function dramaRefOf(node: CanvasNodeData | undefined, nodes: CanvasNodeData[]): CanvasDramaRef | undefined {
    if (!node) return undefined;
    if (node.metadata?.dramaRef) return node.metadata.dramaRef;
    const parent = node.parentId ? nodes.find((item) => item.id === node.parentId) : undefined;
    return parent?.metadata?.dramaRef;
}

/** 设定节点：优先返回独立放置的那个（不在剧情段框里的参考图副本）。 */
export function findDramaCastNode(nodes: CanvasNodeData[], castId: string) {
    const matches = nodes.filter((node) => node.metadata?.dramaRef?.kind === "cast" && node.metadata.dramaRef.id === castId);
    return matches.find((node) => !node.parentId) || matches[0];
}

export function findDramaSegmentFrame(nodes: CanvasNodeData[], segmentId: string) {
    return nodes.find((node) => node.type === CanvasNodeType.Frame && node.metadata?.dramaRef?.kind === "segment" && node.metadata.dramaRef.id === segmentId);
}

export function findDramaSegmentVideoNode(nodes: CanvasNodeData[], segmentId: string) {
    return nodes.find((node) => node.type === CanvasNodeType.Video && node.metadata?.dramaRef?.kind === "segment" && node.metadata.dramaRef.id === segmentId);
}

export function findDramaFinalNode(nodes: CanvasNodeData[], episodeId: string) {
    return nodes.find((node) => node.metadata?.dramaRef?.kind === "final" && node.metadata.dramaRef.id === episodeId);
}

/** 投送一个设定需要登记素材的资源：当前参考图与最近的历史版本。 */
export function dramaCastResourceIds(cast: DramaCast, takes?: DramaTake[]) {
    return unique([cast.imageResourceId, ...(takes || []).slice(0, DRAMA_TAKE_PROJECTION_LIMIT).map((take) => take.resourceId)]);
}

/** 投送成片需要登记素材的资源：当前成片与最近的历史成片。 */
export function dramaFinalResourceIds(episode: Pick<DramaEpisode, "finalResourceId">, takes?: DramaTake[]) {
    return unique([episode.finalResourceId, ...(takes || []).slice(0, DRAMA_TAKE_PROJECTION_LIMIT).map((take) => take.resourceId)]);
}

/** 剧情段投送时必须可用的资源：参考图编号与首帧决定了画布上的生成输入，缺一张就不能照原样投送。 */
export function dramaSegmentRequiredResourceIds(segment: DramaSegment) {
    return unique([...segment.request.references.filter((reference) => reference.sent).map((reference) => reference.resourceId), segment.request.firstFrameResourceId, segment.videoResourceId]);
}

/** 投送一个剧情段需要登记素材的资源：实际发送的参考图、首帧、当前视频与最近的历史版本。 */
export function dramaSegmentResourceIds(segment: DramaSegment, takes?: DramaTake[]) {
    return unique([...dramaSegmentRequiredResourceIds(segment), ...(takes || []).slice(0, DRAMA_TAKE_PROJECTION_LIMIT).map((take) => take.resourceId)]);
}

function unique(values: Array<string | undefined>) {
    return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

/** 新内容的落点：同一集已有剧情段时接在其下方，否则放在现有内容右侧；再避开已有节点。 */
export function dramaPlacement(nodes: CanvasNodeData[], size: { width: number; height: number }, anchor: { kind: "cast" | "segment" | "final"; episodeId?: string }): Position {
    const topLevel = nodes.filter((node) => !node.parentId);
    const area = bounds(topLevel);
    let preferred: Position = area ? { x: area.right + 240, y: area.top } : { x: 0, y: 0 };
    if (anchor.kind === "cast") {
        const casts = topLevel.filter((node) => node.metadata?.dramaRef?.kind === "cast");
        const lastCast = casts.sort((left, right) => left.position.y + left.height - (right.position.y + right.height)).at(-1);
        preferred = lastCast ? { x: lastCast.position.x, y: lastCast.position.y + lastCast.height + 48 } : area ? { x: area.left - size.width - 240, y: area.top } : { x: 0, y: 0 };
    } else if (anchor.episodeId) {
        const sameEpisode = topLevel.filter((node) => node.metadata?.dramaRef?.episodeId === anchor.episodeId || (anchor.kind === "final" && node.metadata?.dramaRef?.kind === "final" && node.metadata.dramaRef.id === anchor.episodeId));
        const last = sameEpisode.sort((left, right) => left.position.y + left.height - (right.position.y + right.height)).at(-1);
        if (last) preferred = { x: last.position.x, y: last.position.y + last.height + SEGMENT_STACK_GAP };
    }
    return findAvailableGenerationGroupPosition(nodes, preferred, size);
}

/** 设定参考图节点：带外观描述作提示词，历史参考图作为节点版本，可直接在画布上重新生成或编辑。 */
export function buildDramaCastNode(input: { projectId: string; cast: DramaCast; ratio?: string; takes?: DramaTake[]; media: DramaProjectionMedia; topLeft: Position }): CanvasNodeData {
    const { cast, media } = input;
    const size = dramaMediaSize(input.ratio || "16:9", CAST_WIDTH * 1.3);
    const prompt = [cast.appearance, cast.kind === "character" && cast.voiceInstructions ? `声线：${cast.voiceInstructions}` : ""].filter(Boolean).join("\n");
    const node = mediaNode(CanvasNodeType.Image, `${DRAMA_CAST_KIND_LABEL[cast.kind]} · ${cast.name}`, cast.imageResourceId, media, {
        prompt,
        composerContent: prompt,
        assetCategory: DRAMA_CAST_ASSET_CATEGORY[cast.kind],
        dramaRef: { projectId: input.projectId, kind: "cast", id: cast.id, baseResourceId: cast.imageResourceId || undefined },
        ...dramaTakeVersions(input.takes, cast.imageResourceId, media, "image"),
    });
    return { ...node, position: input.topLeft, width: size.width, height: size.height };
}

const SEGMENT_SCRIPT_COLUMNS: StoryboardColumn[] = ["shotNumber", "durationSeconds", "plotDescription", "dialogue", "shotSize", "camera", "videoMotionPrompt"];

function shotRow(shot: DramaShot, index: number, castById: Map<string, DramaCast>): StoryboardRow {
    const castIds = parseIds(shot.castIdsJson);
    return createStoryboardRow(index + 1, {
        id: `drama-shot:${shot.id}`,
        durationSeconds: Math.max(1, Math.round(shot.durationMs / 1000)),
        plotDescription: shot.action || shot.imagePrompt,
        dialogue: shot.dialogue ? `${shot.speaker || "旁白"}：${shot.dialogue}` : "",
        characters: castIds
            .map((id) => castById.get(id))
            .filter((cast): cast is DramaCast => Boolean(cast))
            .map((cast) => ({ characterName: cast.name })),
        shotSize: shot.shotSize,
        camera: shot.camera,
        imageGenerationPrompt: shot.imagePrompt,
        videoMotionPrompt: shot.videoPrompt,
    });
}

function parseIds(raw: string | undefined) {
    try {
        const value: unknown = JSON.parse(raw || "[]");
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
        return [];
    }
}

const SEGMENT_OPERATION: Record<string, CanvasVideoEditOperation> = { image_to_video: "image_to_video", reference_to_video: "reference_to_video", text_to_video: "text_to_video" };

/** 剧情段的完整发送提示词：系统追加的参考图说明在前，正文在后。 */
export function dramaSegmentPrompt(segment: DramaSegment) {
    return [segment.request.header, segment.videoPrompt]
        .map((part) => part?.trim())
        .filter(Boolean)
        .join("\n\n");
}

/**
 * 剧情段框：参考图（按“参考图N”顺序连到视频）、首帧（上一段尾帧）、当前视频与历史版本、本段镜头表，
 * 以及只读的短剧提示词副本。视频节点自带完整提示词，可直接在画布上换首尾帧、延长或重新生成后采用回短剧。
 */
export function buildDramaSegmentGroup(input: {
    projectId: string;
    episode: Pick<DramaEpisode, "id" | "number">;
    segment: DramaSegment;
    shots: DramaShot[];
    castById: Map<string, DramaCast>;
    aspectRatio: string;
    takes?: DramaTake[];
    media: DramaProjectionMedia;
}) {
    const { segment, media } = input;
    const ref: CanvasDramaRef = { projectId: input.projectId, kind: "segment", id: segment.id, episodeId: input.episode.id, segmentIndex: segment.index, baseResourceId: segment.videoResourceId || undefined };
    const prompt = dramaSegmentPrompt(segment);
    const contentTop = FRAME_HEADER_HEIGHT + FRAME_PADDING;
    let x = FRAME_PADDING;
    const children: CanvasNodeData[] = [];
    const connections: CanvasConnection[] = [];

    const promptNode = createCanvasNode(CanvasNodeType.Text, { x: 0, y: 0 }, { content: prompt, status: "success", fontSize: 13 });
    promptNode.title = `第 ${segment.index + 1} 段 · 短剧提示词（参考）`;
    children.push({ ...promptNode, position: { x, y: contentTop }, width: PROMPT_WIDTH, height: PROMPT_HEIGHT });
    x += PROMPT_WIDTH + GROUP_GAP;

    const references = segment.request.references.filter((reference) => reference.sent && reference.resourceId);
    const columns = references.length > 1 ? 2 : 1;
    const referenceNodes = references.map((reference, index) => {
        const cast = input.castById.get(reference.castId);
        const node = mediaNode(CanvasNodeType.Image, `${reference.label} · ${reference.name}`, reference.resourceId, media, {
            assetCategory: DRAMA_CAST_ASSET_CATEGORY[reference.kind],
            dramaRef: { projectId: input.projectId, kind: "cast", id: reference.castId, baseResourceId: cast?.imageResourceId || reference.resourceId },
        });
        return { ...node, position: { x: x + (index % columns) * (REF_SIZE + REF_GAP), y: contentTop + Math.floor(index / columns) * (REF_SIZE + REF_GAP) }, width: REF_SIZE, height: REF_SIZE };
    });
    const referenceRows = Math.ceil(references.length / columns);
    const referencesHeight = referenceRows ? referenceRows * REF_SIZE + (referenceRows - 1) * REF_GAP : 0;
    if (referenceNodes.length) {
        children.push(...referenceNodes);
        x += columns * REF_SIZE + (columns - 1) * REF_GAP + GROUP_GAP;
    }

    let firstFrameNode: CanvasNodeData | undefined;
    if (segment.request.firstFrameResourceId) {
        const size = dramaMediaSize(input.aspectRatio, 288);
        const node = mediaNode(CanvasNodeType.Image, `首帧 · 第 ${segment.index} 段尾帧`, segment.request.firstFrameResourceId, media, { assetCategory: "material" });
        firstFrameNode = { ...node, position: { x, y: contentTop }, width: size.width, height: size.height };
        children.push(firstFrameNode);
        x += size.width + GROUP_GAP;
    }

    const videoSize = dramaMediaSize(input.aspectRatio, 480);
    const seconds = segment.videoSeconds || segment.request.seconds || Math.round(segment.durationMs / 1000);
    const videoNode = mediaNode(CanvasNodeType.Video, `第 ${segment.index + 1} 段 · 视频`, segment.videoResourceId, media, {
        prompt,
        composerContent: prompt,
        generationMode: "video",
        videoEditOperation: SEGMENT_OPERATION[segment.request.operation] || "text_to_video",
        videoStartFrameNodeId: firstFrameNode?.id,
        seconds: seconds ? String(seconds) : undefined,
        ...(segment.videoResourceId && segment.videoSeconds ? { durationMs: segment.videoSeconds * 1000 } : {}),
        assetCategory: "material",
        dramaRef: ref,
        ...dramaTakeVersions(input.takes, segment.videoResourceId, media, "video"),
    });
    children.push({ ...videoNode, position: { x, y: contentTop }, width: videoSize.width, height: videoSize.height });
    x += videoSize.width;

    // 连线顺序就是参考图编号：先按短剧“参考图N”顺序连参考图，首帧最后连，避免首帧挤占编号。
    for (const node of referenceNodes) connections.push(edge(node.id, videoNode.id));
    if (firstFrameNode) connections.push(edge(firstFrameNode.id, videoNode.id));

    const rowWidth = x - FRAME_PADDING;
    const rowHeight = Math.max(PROMPT_HEIGHT, referencesHeight, firstFrameNode?.height || 0, videoSize.height);
    const segmentShots = input.shots.filter((shot) => shot.segmentIndex === segment.index);
    const scriptWidth = Math.max(rowWidth, SCRIPT_MIN_WIDTH);
    if (segmentShots.length) {
        const script = createCanvasNode(
            CanvasNodeType.Script,
            { x: 0, y: 0 },
            {
                storyboard: { rows: segmentShots.map((shot, index) => shotRow(shot, index, input.castById)), visibleColumns: SEGMENT_SCRIPT_COLUMNS, referenceNodeIds: [] },
            },
        );
        script.title = `第 ${segment.index + 1} 段 · 镜头表`;
        children.push({ ...script, position: { x: FRAME_PADDING, y: contentTop + rowHeight + GROUP_GAP }, width: scriptWidth, height: SCRIPT_HEIGHT });
    }
    const width = FRAME_PADDING * 2 + Math.max(rowWidth, segmentShots.length ? scriptWidth : 0);
    const height = contentTop + rowHeight + (segmentShots.length ? GROUP_GAP + SCRIPT_HEIGHT : 0) + FRAME_PADDING;
    const frame = createCanvasNode(
        CanvasNodeType.Frame,
        { x: 0, y: 0 },
        {
            workflowTitle: "剧情段",
            frame: { collapsed: false, expandedWidth: width, expandedHeight: height },
            dramaRef: ref,
        },
    );
    frame.title = `第 ${input.episode.number} 集 · 第 ${segment.index + 1} 段 · ${segment.title}`;
    const framed: CanvasNodeData = { ...frame, position: { x: 0, y: 0 }, width, height };
    return {
        nodes: [framed, ...children.map((node) => ({ ...node, parentId: framed.id }))],
        connections,
        frameId: framed.id,
        videoNodeId: videoNode.id,
        size: { width, height },
    };
}

/** 把在原点构建的一组节点平移到 topLeft。 */
export function placeDramaGroup(nodes: CanvasNodeData[], topLeft: Position) {
    const area = bounds(nodes);
    return area ? translate(nodes, topLeft.x - area.left, topLeft.y - area.top) : nodes;
}

/** 成片节点：成片视频与历史成片版本；剪辑在画布时间线里进行。 */
export function buildDramaFinalNode(input: {
    projectId: string;
    episode: Pick<DramaEpisode, "id" | "number" | "title" | "finalResourceId" | "durationMs">;
    aspectRatio: string;
    takes?: DramaTake[];
    media: DramaProjectionMedia;
    topLeft: Position;
}): CanvasNodeData {
    const size = dramaMediaSize(input.aspectRatio, 540);
    const node = mediaNode(CanvasNodeType.Video, `第 ${input.episode.number} 集成片 · ${input.episode.title}`, input.episode.finalResourceId, input.media, {
        assetCategory: "material",
        ...(input.episode.durationMs ? { durationMs: input.episode.durationMs } : {}),
        dramaRef: { projectId: input.projectId, kind: "final", id: input.episode.id, baseResourceId: input.episode.finalResourceId || undefined },
        ...dramaTakeVersions(input.takes, input.episode.finalResourceId, input.media, "video"),
    });
    return { ...node, position: input.topLeft, width: size.width, height: size.height };
}

/**
 * 一集的剪辑时间线：各剧情段当前视频按顺序首尾相接，时长与成片合成一致（videoSeconds）。
 * 没有视频的段跳过并返回段号，由调用方提示。
 */
export function buildDramaEpisodeTimeline(input: { episode: Pick<DramaEpisode, "number">; segments: DramaSegment[]; media: DramaProjectionMedia }): { timeline: TimelineProject; skipped: number[]; resourceIds: string[] } {
    const clips: TimelineClip[] = [];
    const skipped: number[] = [];
    const resourceIds: string[] = [];
    let cursor = 0;
    for (const segment of input.segments) {
        const resourceId = segment.videoResourceId;
        const assetId = resourceId ? input.media.assetIdOf(resourceId) : undefined;
        const durationMs = (segment.videoSeconds || segment.request.seconds || 0) * 1000;
        if (!resourceId || !assetId || durationMs <= 0 || (segment.videoStatus !== "ready" && segment.videoStatus !== "stale")) {
            skipped.push(segment.index + 1);
            continue;
        }
        resourceIds.push(resourceId);
        const title = `第 ${input.episode.number} 集 · 第 ${segment.index + 1} 段`;
        clips.push({
            id: `asset:${assetId}:${segment.index}`,
            kind: "video",
            nodeId: `asset:${assetId}`,
            trackId: DEFAULT_VIDEO_TRACK_ID,
            startMs: cursor,
            durationMs,
            sourceStartMs: 0,
            sourceDurationMs: durationMs,
            volume: 1,
            title,
            directMedia: { id: assetId, assetId, kind: "video", title, storageKey: resourceKey(resourceId), url: input.media.urlOf(resourceId), durationMs },
        });
        cursor += durationMs;
    }
    return { timeline: { version: 2, tracks: createDefaultTracks(), clips, durationMs: cursor, updatedAt: new Date().toISOString() }, skipped, resourceIds };
}

/** 画布上已有的短剧对象（设定按 castId、剧情段按 segmentId、成片按 episodeId）；值表示短剧侧是否已有更新的版本。 */
export type DramaCanvasPresence = {
    cast: ReadonlyMap<string, boolean>;
    segment: ReadonlyMap<string, boolean>;
    final: ReadonlyMap<string, boolean>;
};

export type DramaCurrentMedia = {
    castImage: (castId: string) => string | undefined | null;
    segmentVideo: (segmentId: string) => string | undefined | null;
    finalVideo: (episodeId: string) => string | undefined | null;
};

/**
 * 短剧侧是否已更新：短剧当前资源与投送时不同，且与节点正在显示的媒体也不同。
 * 未加载到短剧数据（null）时不判断，避免误报。
 */
export function isDramaNodeStale(node: CanvasNodeData, current: DramaCurrentMedia) {
    const ref = node.metadata?.dramaRef;
    if (!ref || node.type === CanvasNodeType.Frame) return false;
    const latest = ref.kind === "cast" ? current.castImage(ref.id) : ref.kind === "segment" ? current.segmentVideo(ref.id) : current.finalVideo(ref.id);
    if (latest === null || !latest) return false;
    const shown = node.metadata?.storageKey?.startsWith("resource:") ? node.metadata.storageKey.slice("resource:".length) : "";
    return latest !== (ref.baseResourceId || "") && latest !== shown;
}

export type DramaAdoptTarget = { kind: "cast"; castId: string } | { kind: "segment"; episodeId: string; segmentIndex: number; segmentId: string };

/** 节点默认的采用目标：图片按设定绑定，视频按所在剧情段；无绑定时返回 null，由用户选择。 */
export function defaultDramaAdoptTarget(node: CanvasNodeData, nodes: CanvasNodeData[]): DramaAdoptTarget | null {
    const ref = dramaRefOf(node, nodes);
    if (!ref) return null;
    if (node.type === CanvasNodeType.Image && ref.kind === "cast") return { kind: "cast", castId: ref.id };
    if (node.type === CanvasNodeType.Video && ref.kind === "segment" && ref.episodeId && ref.segmentIndex !== undefined) return { kind: "segment", episodeId: ref.episodeId, segmentIndex: ref.segmentIndex, segmentId: ref.id };
    return null;
}

/**
 * 画布分镜脚本 → 短剧自动制作的分镜原文：输出 {"shots":[...]} JSON，字段与服务端分镜导入一致，
 * 服务端直接转录，不经过文本模型；台词按“名字：台词”拆出说话人。
 */
export function canvasStoryboardToDramaSource(node: CanvasNodeData): { text: string; shotCount: number } | null {
    const rows = node.metadata?.storyboard?.rows || [];
    // 旧画布或 Agent 写入的行可能缺字段，统一按空串处理。
    const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
    const shots = rows
        .map((row) => {
            const dialogue = text(row.dialogue);
            const speakerMatch = dialogue.match(/^([^：:\n]{1,20})[：:]\s*([\s\S]+)$/);
            const characters = (row.characters || []).map((item) => text(item.characterName)).filter(Boolean);
            const shot: Record<string, unknown> = {
                action: text(row.plotDescription),
                imagePrompt: text(row.imageGenerationPrompt),
                videoPrompt: [row.videoMotionPrompt, row.motion].map(text).filter(Boolean).join("；"),
                shotSize: text(row.shotSize),
                camera: text(row.camera),
                durationSeconds: row.durationSeconds > 0 ? row.durationSeconds : undefined,
                characters: characters.length ? characters : undefined,
                speaker: speakerMatch ? speakerMatch[1].trim() : undefined,
                dialogue: speakerMatch ? speakerMatch[2].trim() : dialogue || undefined,
            };
            return Object.fromEntries(Object.entries(shot).filter(([, value]) => value !== undefined && value !== ""));
        })
        .filter((shot) => shot.action || shot.dialogue || shot.imagePrompt);
    if (!shots.length) return null;
    return { text: JSON.stringify({ shots }), shotCount: shots.length };
}
