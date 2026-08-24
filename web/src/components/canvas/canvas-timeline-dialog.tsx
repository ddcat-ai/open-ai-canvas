// 二期：多轨时间线编辑弹窗。
// 数据源是项目级 TimelineProject：视频/音频节点自动入轨，字幕条目转字幕片段。
// 交互：拖拽移动片段（吸附播放头/片段边缘）、左右边缘裁剪、删除、播放头跳转。

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { App, Button, Dropdown, Input, InputNumber, Modal, Progress, Tooltip } from "antd";
import { Captions, Clapperboard, FolderOpen, Library, Lock, LockOpen, Maximize2, MoreHorizontal, Music2, Plus, Scissors, Trash2, Upload, Video, Wand2, ZoomIn, ZoomOut } from "lucide-react";
import { saveAs } from "file-saver";

import { CanvasTimelineRuler } from "./canvas-timeline-ruler";
import { CanvasTimelinePreview } from "./canvas-timeline-preview";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { buildTimelineFromNodes, isNodeInTimeline, syncTimelineSubtitleClips } from "@/lib/timeline/timeline-build";
import { canPlaceAt, clampClipDurationByNeighbors, findNearestAvailablePlacement } from "@/lib/timeline/timeline-placement";
import { computeSnap } from "@/lib/timeline/timeline-snap";
import { DEFAULT_AUDIO_TRACK_ID, DEFAULT_VIDEO_TRACK_ID, normalizeTimelineProject } from "@/lib/timeline/timeline-tracks";
import { formatTimelineTime, getTimelineTrackWidth, getFitTimelineZoom, zoomIn, zoomOut } from "@/lib/timeline/timeline-view";
import { exportTimelineToMp4 } from "@/lib/timeline/timeline-export";
import type { TimelineRenderSource } from "@/lib/timeline/timeline-to-ffmpeg";
import type { CanvasNodeData } from "@/types/canvas";
import type { SrtEntry, TimelineClip, TimelineDirectMedia, TimelineProject } from "@/types/timeline";
import { useTranslation } from "react-i18next";

const MIN_CLIP_DURATION_MS = 100;
const TRACK_ROW_HEIGHT = 52;
const SNAP_THRESHOLD_PX = 8;
const BASE_PX_PER_SECOND = 96;

type CanvasTimelineDialogProps = {
    node: CanvasNodeData;
    open: boolean;
    nodes: CanvasNodeData[];
    timeline: TimelineProject | null;
    onClose: () => void;
    onOpenSubtitleDialog?: (nodeId: string) => void;
    onSave: (timeline: TimelineProject) => void;
    onSaveSubtitles: (nodeId: string, entries: SrtEntry[]) => void;
    /** 打开项目素材库选择器（由页面层接线） */
    onOpenAssetLibrary?: () => void;
    /** 打开项目资产库选择器（由页面层接线） */
    onOpenProjectAssets?: () => void;
    /** 上传本地音视频并返回直连媒体描述（仅时间线作用域，不创建画布节点） */
    onUploadLocalFiles?: (files: File[]) => Promise<TimelineDirectMedia[]>;
    /** 页面层持有：素材库/上传创建节点后，调用该引用把节点加入时间线草稿 */
    addNodeToTimelineRef?: MutableRefObject<((node: CanvasNodeData) => void) | null>;
    /** 页面层持有：素材库/项目资产直连媒体（不落画布）入轨通道 */
    addMediaToTimelineRef?: MutableRefObject<((media: TimelineDirectMedia) => void) | null>;
    /** 把合成结果保存为新视频节点放回画布（页面层接线） */
    onCreateAssembledNode?: (blob: Blob, title: string) => Promise<CanvasNodeData | null>;
};

type ClipDragMode = "move" | "trim-start" | "trim-end";

type DragState =
    | { mode: "move"; clipId: string; startClientX: number; originalStartMs: number }
    | { mode: "trim-start"; clipId: string; startClientX: number; originalStartMs: number; originalDurationMs: number; originalSourceStartMs: number }
    | { mode: "trim-end"; clipId: string; startClientX: number; originalStartMs: number; originalDurationMs: number }
    | null;

export function CanvasTimelineDialog({
    node,
    open,
    nodes,
    timeline,
    onClose,
    onOpenSubtitleDialog,
    onSave,
    onSaveSubtitles,
    onOpenAssetLibrary,
    onOpenProjectAssets,
    onUploadLocalFiles,
    addNodeToTimelineRef,
    addMediaToTimelineRef,
    onCreateAssembledNode,
}: CanvasTimelineDialogProps) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [draft, setDraft] = useState<TimelineProject>(() => buildTimelineFromNodes([]));
    const [playheadMs, setPlayheadMs] = useState(0);
    const [zoomLevel, setZoomLevel] = useState(1);
    const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [previewPlaying, setPreviewPlaying] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [exportPercent, setExportPercent] = useState(0);
    const [exportDetail, setExportDetail] = useState("");
    const dragRef = useRef<DragState>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const trackAreaRef = useRef<HTMLDivElement>(null);
    const uploadInputRef = useRef<HTMLInputElement>(null);
    const toolbarRef = useRef<HTMLDivElement>(null);
    const addGroupProbeRef = useRef<HTMLDivElement>(null);
    const moreBtnRef = useRef<HTMLSpanElement>(null);

    const initializedRef = useRef(false);

    // 打开弹窗：优先复用项目时间线，否则从画布节点自动构建；播放头定位到触发节点片段。
    // 仅首次打开时构建草稿：素材上传/素材库插入会触发 nodes 变化，不能因此重建草稿丢弃编辑。
    useEffect(() => {
        if (!open) {
            initializedRef.current = false;
            return;
        }
        if (initializedRef.current) return;
        initializedRef.current = true;
        const base = timeline ? normalizeTimelineProject(timeline) : buildTimelineFromNodes(nodes);
        const next = timeline ? syncTimelineSubtitleClips(base, nodes) : base;
        setDraft(next);
        setPlayheadMs(0);
        setZoomLevel(1);
        setSelectedClipId(null);
        setPreviewPlaying(false);
        const triggerClip = next.clips.find((clip) => clip.nodeId === node.id);
        if (triggerClip) setPlayheadMs(triggerClip.startMs);
    }, [open, node.id, nodes, timeline]);

    const pxPerMs = (BASE_PX_PER_SECOND / 1_000) * zoomLevel;
    const durationMs = Math.max(1_000, draft.durationMs);
    const [viewportWidth, setViewportWidth] = useState(900);
    const trackWidth = useMemo(() => getTimelineTrackWidth(durationMs, zoomLevel, viewportWidth), [durationMs, zoomLevel, viewportWidth]);

    useEffect(() => {
        if (!open) return;
        const measure = () => {
            setViewportWidth(trackAreaRef.current?.clientWidth || 900);
        };
        measure();
        const observer = new ResizeObserver(measure);
        if (trackAreaRef.current) observer.observe(trackAreaRef.current);
        return () => observer.disconnect();
    }, [open]);

    // 工具栏自适应：按钮总数过多或容器变窄时，把「添加素材/上传本地/素材库/项目资产」收进「更多」菜单，
    // 工具栏保持单行不换行；容器变宽后自动恢复内联展示。
    // 素材组用隐藏探针测量自然宽度，展开/收起两种形态下算出的核心区宽度一致，判定不随当前状态震荡。
    const [addGroupCollapsed, setAddGroupCollapsed] = useState(false);
    const toolbarObserverRef = useRef<ResizeObserver | null>(null);
    const measureToolbar = useCallback(() => {
        const el = toolbarRef.current;
        const probe = addGroupProbeRef.current;
        if (!el || !probe) return;
        const addGroupWidth = probe.offsetWidth;
        const shownAddWidth = addGroupCollapsed ? (moreBtnRef.current?.offsetWidth ?? 56) : addGroupWidth;
        const expandedWidth = el.scrollWidth - shownAddWidth + addGroupWidth;
        setAddGroupCollapsed(expandedWidth > el.clientWidth + 2);
    }, [addGroupCollapsed]);
    const ensureToolbarObserved = useCallback(() => {
        const el = toolbarRef.current;
        if (!el || toolbarObserverRef.current) return;
        const observer = new ResizeObserver(measureToolbar);
        toolbarObserverRef.current = observer;
        observer.observe(el);
        measureToolbar();
    }, [measureToolbar]);
    useEffect(() => {
        if (!open) return;
        // AntD Modal 内容经门户延迟挂载，首次 effect 时 toolbarRef 可能为空；
        // afterOpenChange 兜底确保动画结束后一定完成测量与观察。
        ensureToolbarObserved();
        return () => {
            toolbarObserverRef.current?.disconnect();
            toolbarObserverRef.current = null;
        };
    }, [open, ensureToolbarObserved]);

    const applyDraft = (updater: (current: TimelineProject) => TimelineProject) => {
        setDraft((current) => {
            const next = updater(current);
            const endMs = next.clips.reduce((max, clip) => Math.max(max, clip.startMs + clip.durationMs), 0);
            return { ...next, durationMs: Math.max(endMs, 1_000) };
        });
    };

    const updateClip = (clipId: string, patch: Partial<TimelineClip>) => {
        applyDraft((current) => ({
            ...current,
            clips: current.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
        }));
    };

    const updateSelectedMediaNumbers = (patch: Partial<TimelineClip>) => {
        if (!selectedClipId) return;
        updateClip(selectedClipId, patch);
    };

    const moveClip = (clipId: string, candidateStartMs: number) => {
        const clip = draft.clips.find((item) => item.id === clipId);
        if (!clip) return;
        const snapped = snapEnabled
            ? computeSnap({
                  candidateMs: candidateStartMs,
                  playheadMs,
                  clips: draft.clips,
                  excludeClipId: clipId,
                  pxPerMs,
                  thresholdPx: SNAP_THRESHOLD_PX,
                  enabled: true,
              })
            : { snappedMs: candidateStartMs, targets: [] };
        const nextStartMs = Math.max(0, Math.round(snapped.snappedMs));
        const result = canPlaceAt({
            trackId: clip.trackId,
            startMs: nextStartMs,
            durationMs: clip.durationMs,
            excludeClipId: clipId,
            clips: draft.clips,
        });
        if (!result.ok) return;
        updateClip(clipId, { startMs: nextStartMs });
    };

    // 裁剪统一基于拖动起点快照计算，避免“当前值 + 累计 delta”造成的漂移与越界。
    const trimClipStart = (clipId: string, deltaMs: number, original: { startMs: number; durationMs: number; sourceStartMs: number }) => {
        const clip = draft.clips.find((item) => item.id === clipId);
        if (!clip) return;
        const rightEdgeMs = original.startMs + original.durationMs;
        // 向左延长最多到源文件起点：时间轴起点不能早于 original.start - sourceStart。
        const minStartMs = clip.sourceStartMs === undefined ? 0 : Math.max(0, original.startMs - original.sourceStartMs);
        const newStartMs = Math.max(minStartMs, Math.min(rightEdgeMs - MIN_CLIP_DURATION_MS, original.startMs + deltaMs));
        const newDurationMs = rightEdgeMs - newStartMs;
        // 源内裁剪：sourceStart 必须落在 [0, sourceDuration - newDuration]，右缘不越源。
        const sourceDurationMs = clip.sourceDurationMs;
        let sourceStartMs = original.sourceStartMs + (newStartMs - original.startMs);
        if (sourceDurationMs !== undefined) {
            sourceStartMs = Math.max(0, Math.min(Math.max(0, sourceDurationMs - newDurationMs), sourceStartMs));
        }
        const collision = canPlaceAt({
            trackId: clip.trackId,
            startMs: newStartMs,
            durationMs: newDurationMs,
            excludeClipId: clipId,
            clips: draft.clips,
        });
        if (!collision.ok) return;
        updateClip(clipId, {
            startMs: Math.round(newStartMs),
            durationMs: Math.round(newDurationMs),
            ...(clip.sourceStartMs !== undefined ? { sourceStartMs: Math.round(sourceStartMs) } : {}),
        });
    };

    const trimClipEnd = (clipId: string, deltaMs: number, original: { startMs: number; durationMs: number }) => {
        const clip = draft.clips.find((item) => item.id === clipId);
        if (!clip) return;
        const maxDurationMs = clip.sourceDurationMs !== undefined && clip.sourceStartMs !== undefined ? Math.max(0, clip.sourceDurationMs - clip.sourceStartMs) : undefined;
        const maxDuration = clampClipDurationByNeighbors({
            clipId,
            startMs: original.startMs,
            requestedDurationMs: original.durationMs + deltaMs,
            trackId: clip.trackId,
            clips: draft.clips,
            maxDurationMs,
        });
        const newDurationMs = Math.max(MIN_CLIP_DURATION_MS, maxDuration);
        updateClip(clipId, { durationMs: Math.round(newDurationMs) });
    };

    const handleClipPointerDown = (event: React.PointerEvent<HTMLDivElement>, clipId: string, mode: ClipDragMode) => {
        const clip = draft.clips.find((item) => item.id === clipId);
        if (!clip) return;
        event.preventDefault();
        event.stopPropagation();
        (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
        setSelectedClipId(clipId);
        if (mode === "move") {
            dragRef.current = { mode, clipId, startClientX: event.clientX, originalStartMs: clip.startMs };
        } else if (mode === "trim-start") {
            dragRef.current = {
                mode,
                clipId,
                startClientX: event.clientX,
                originalStartMs: clip.startMs,
                originalDurationMs: clip.durationMs,
                originalSourceStartMs: clip.sourceStartMs || 0,
            };
        } else {
            dragRef.current = { mode, clipId, startClientX: event.clientX, originalStartMs: clip.startMs, originalDurationMs: clip.durationMs };
        }
    };

    const handleClipPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
        const drag = dragRef.current;
        if (!drag) return;
        if (!event.isPrimary) return;
        const deltaMs = Math.round((event.clientX - drag.startClientX) / Math.max(pxPerMs, 1e-6));
        if (drag.mode === "move") {
            moveClip(drag.clipId, drag.originalStartMs + deltaMs);
        } else if (drag.mode === "trim-start") {
            trimClipStart(drag.clipId, deltaMs, {
                startMs: drag.originalStartMs,
                durationMs: drag.originalDurationMs,
                sourceStartMs: drag.originalSourceStartMs,
            });
        } else {
            trimClipEnd(drag.clipId, deltaMs, {
                startMs: drag.originalStartMs,
                durationMs: drag.originalDurationMs,
            });
        }
    };

    const handleClipPointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
        dragRef.current = null;
        try {
            (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
        } catch {
            // 指针已释放或未捕获时忽略
        }
    };

    const deleteSelectedClip = () => {
        if (!selectedClipId) {
            message.info(t("canvas:click-to-select-a-segment-first"));
            return;
        }
        applyDraft((current) => ({
            ...current,
            clips: current.clips.filter((clip) => clip.id !== selectedClipId),
        }));
        setSelectedClipId(null);
    };

    const removeClip = (clipId: string) => {
        applyDraft((current) => ({
            ...current,
            clips: current.clips.filter((clip) => clip.id !== clipId),
        }));
        if (selectedClipId === clipId) setSelectedClipId(null);
    };

    const addNodeToTimeline = (targetNode: CanvasNodeData) => {
        const kind = targetNode.type === "video" ? "video" : targetNode.type === "audio" ? "audio" : null;
        if (!kind) return;
        const trackId = kind === "video" ? DEFAULT_VIDEO_TRACK_ID : DEFAULT_AUDIO_TRACK_ID;
        const targetTrack = draft.tracks.find((track) => track.id === trackId);
        if (!targetTrack || targetTrack.locked) {
            message.warning(kind === "video" ? t("canvas:the-video-track-is-locked-or-missing") : t("canvas:the-audio-track-is-locked-or-missing"));
            return;
        }
        const durationMs = targetNode.metadata?.durationMs && targetNode.metadata.durationMs > 0 ? Math.round(targetNode.metadata.durationMs) : 4_000;
        const placement = findNearestAvailablePlacement({
            targetStartMs: playheadMs,
            durationMs,
            trackId,
            clips: draft.clips,
        });
        // 找不到可用空隙时（目标位置冲突且无足够间隙）回退到轨道末尾追加，避免片段重叠破坏后续放置/导出。
        const startMs = placement.fits ? placement.startMs : draft.clips.filter((item) => item.trackId === trackId).reduce((max, item) => Math.max(max, item.startMs + item.durationMs), 0);
        const clip: TimelineClip = {
            id: `clip-${targetNode.id}-${Date.now()}`,
            kind,
            nodeId: targetNode.id,
            trackId,
            startMs,
            durationMs,
            title: targetNode.title || (kind === "video" ? t("canvas:video-segments") : t("canvas:audio-segments")),
            sourceStartMs: 0,
            sourceDurationMs: durationMs,
            ...(kind === "audio" ? { volume: 1, fadeInMs: 0, fadeOutMs: 0 } : {}),
        };
        applyDraft((current) => ({ ...current, clips: [...current.clips, clip] }));
        setSelectedClipId(clip.id);
        message.success(t("canvas:added-param-to-the-timeline", { title: clip.title }));
    };

    // 把“添加节点”能力暴露给页面层（素材库/本地上传创建节点后回填到草稿）。
    useEffect(() => {
        if (!addNodeToTimelineRef) return;
        addNodeToTimelineRef.current = addNodeToTimeline;
        return () => {
            addNodeToTimelineRef.current = null;
        };
    }, [addNodeToTimeline, addNodeToTimelineRef]);

    // 直连媒体（仅时间线作用域，不落画布）：素材库/项目资产/本地上传直接入轨。
    const addDirectMediaToTimeline = (media: TimelineDirectMedia) => {
        const kind = media.kind === "video" ? "video" : media.kind === "audio" ? "audio" : null;
        if (!kind) {
            message.info(t("canvas:image-text-assets-cannot-join-the-timeline-directly-yet-add-them-as-canv"));
            return;
        }
        const trackId = kind === "video" ? DEFAULT_VIDEO_TRACK_ID : DEFAULT_AUDIO_TRACK_ID;
        const targetTrack = draft.tracks.find((track) => track.id === trackId);
        if (!targetTrack || targetTrack.locked) {
            message.warning(kind === "video" ? t("canvas:the-video-track-is-locked-or-missing") : t("canvas:the-audio-track-is-locked-or-missing"));
            return;
        }
        const durationMs = media.durationMs && media.durationMs > 0 ? Math.round(media.durationMs) : 4_000;
        const placement = findNearestAvailablePlacement({
            targetStartMs: playheadMs,
            durationMs,
            trackId,
            clips: draft.clips,
        });
        const clip: TimelineClip = {
            id: `clip-media-${media.id}-${Date.now()}`,
            kind,
            nodeId: `timeline-media-${media.id}-${Date.now()}`,
            trackId,
            startMs: placement.startMs,
            durationMs,
            title: media.title || (kind === "video" ? t("canvas:video-segments") : t("canvas:audio-segments")),
            sourceStartMs: 0,
            sourceDurationMs: durationMs,
            directMedia: media,
            ...(kind === "audio" ? { volume: 1, fadeInMs: 0, fadeOutMs: 0 } : {}),
        };
        applyDraft((current) => ({ ...current, clips: [...current.clips, clip] }));
        setSelectedClipId(clip.id);
        message.success(t("canvas:added-param-to-the-timeline", { title: clip.title }));
    };

    // 把“直连媒体入轨”能力暴露给页面层（时间线作用域插入不重复落画布）。
    useEffect(() => {
        if (!addMediaToTimelineRef) return;
        addMediaToTimelineRef.current = addDirectMediaToTimeline;
        return () => {
            addMediaToTimelineRef.current = null;
        };
    }, [addDirectMediaToTimeline, addMediaToTimelineRef]);

    // 播放头处分割：把视频/音频片段切成两段，右段源内起点整体后移，保持源文件内容连续。
    const splitClipAtPlayhead = () => {
        const clip = draft.clips.find((item) => (item.kind === "video" || item.kind === "audio") && playheadMs > item.startMs && playheadMs < item.startMs + item.durationMs);
        if (!clip) {
            message.info(t("canvas:move-the-playhead-inside-a-segment-before-splitting"));
            return;
        }
        const cutMs = playheadMs - clip.startMs;
        if (cutMs < MIN_CLIP_DURATION_MS || clip.durationMs - cutMs < MIN_CLIP_DURATION_MS) {
            message.warning(t("canvas:split-point-is-too-close-to-the-segment-edge"));
            return;
        }
        const left: TimelineClip = { ...clip, id: `${clip.id}-left-${Date.now()}`, durationMs: Math.round(cutMs) };
        const right: TimelineClip = {
            ...clip,
            id: `${clip.id}-right-${Date.now()}`,
            startMs: playheadMs,
            durationMs: Math.round(clip.durationMs - cutMs),
            sourceStartMs: (clip.sourceStartMs || 0) + Math.round(cutMs),
            sourceDurationMs: clip.sourceDurationMs !== undefined ? Math.max(0, Math.round(clip.sourceDurationMs - cutMs)) : Math.round(clip.durationMs - cutMs),
        };
        applyDraft((current) => ({ ...current, clips: [...current.clips.filter((item) => item.id !== clip.id), left, right] }));
        setSelectedClipId(left.id);
        message.success(t("canvas:segment-split-at-playhead"));
    };

    const handleLocalUpload = async (files: FileList | null) => {
        const list = files ? Array.from(files) : [];
        if (!list.length) return;
        if (!onUploadLocalFiles) {
            message.warning(t("canvas:local-upload-not-wired-up-yet"));
            return;
        }
        const medias = await onUploadLocalFiles(list);
        for (const media of medias) addDirectMediaToTimeline(media);
    };

    const handleSave = () => {
        // 互通修复：时间线草稿只在打开时初始化，期间节点字幕可能在字幕弹窗中被清空（或节点数据被外部更新）。
        // 保存前以节点当前字幕为准做定向校准：节点字幕已为空时，剔除草稿残留的旧字幕片段并回写空数组，
        // 避免「清空后重开视频节点旧字幕复活」；节点仍有字幕时保留草稿内用户的时间线编辑（拖动/删减/文本）。
        const clearedSubtitleNodeIds = new Set(nodes.filter((item) => (item.metadata?.subtitleEntries?.length ?? 0) === 0).map((item) => item.id));
        const base = normalizeTimelineProject({ ...draft, updatedAt: new Date().toISOString() });
        const reconciledClips = clearedSubtitleNodeIds.size ? base.clips.filter((clip) => !(clip.kind === "subtitle" && clearedSubtitleNodeIds.has(clip.nodeId))) : base.clips;
        const normalized = normalizeTimelineProject({ ...base, clips: reconciledClips });
        onSave(normalized);
        // 整合方向：时间线字幕片段与节点字幕互通。保存时按视频节点回写 subtitleEntries（含空数组）。
        // 回写集合 = 项目时间线原有字幕节点 ∪ 校准后仍有字幕片段的节点 ∪ 节点当前仍有字幕数据的节点：
        // 覆盖“首次打开时间线（项目尚无 timeline）时删除字幕片段”这类 timeline 为空导致的漏回写，
        // 保证删除全部字幕片段后节点字幕被同步清空，重开视频节点不再显示旧字幕。
        const previousSubtitleNodeIds = new Set((timeline?.clips || []).filter((clip) => clip.kind === "subtitle").map((clip) => clip.nodeId));
        const nextSubtitleNodeIds = new Set(normalized.clips.filter((clip) => clip.kind === "subtitle").map((clip) => clip.nodeId));
        const nodeSubtitleNodeIds = new Set(nodes.filter((item) => (item.metadata?.subtitleEntries?.length ?? 0) > 0).map((item) => item.id));
        const subtitleNodeIds = new Set([...previousSubtitleNodeIds, ...nextSubtitleNodeIds, ...nodeSubtitleNodeIds]);
        subtitleNodeIds.forEach((subNodeId) => {
            onSaveSubtitles(subNodeId, buildSubtitleEntriesForNode(subNodeId, normalized));
        });
        message.success(t("canvas:timeline-saved"));
        onClose();
    };

    // 组装导出：把当前草稿按片段顺序合成一个 MP4 Blob（导出下载与生成新片段共用）。
    const runExport = async (): Promise<Blob> => {
        const videoClips = draft.clips.filter((clip) => clip.kind === "video");
        if (!videoClips.length) throw new Error(t("canvas:no-video-clips-to-export"));
        const sources: TimelineRenderSource[] = [];
        for (const clip of videoClips) {
            const sourceNode = nodes.find((item) => item.id === clip.nodeId);
            const media = clip.directMedia;
            if (!sourceNode && !media) continue;
            sources.push({
                nodeId: clip.nodeId,
                fileName: "input-" + sources.length + ".mp4",
                durationMs: clip.sourceDurationMs || clip.durationMs,
                storageKey: sourceNode?.metadata?.storageKey || media?.storageKey,
                url: sourceNode?.metadata?.content || media?.url || undefined,
            });
        }
        if (!sources.length) throw new Error(t("canvas:no-exportable-video-assets"));
        setExporting(true);
        setExportPercent(0);
        setExportDetail(t("canvas:ready-to-export"));
        try {
            return await exportTimelineToMp4(normalizeTimelineProject(draft), sources, {
                onProgress: ({ percent, detail }) => {
                    setExportPercent(percent);
                    setExportDetail(detail);
                },
            });
        } finally {
            setExporting(false);
            setExportPercent(0);
            setExportDetail("");
        }
    };

    const handleExport = async () => {
        try {
            const blob = await runExport();
            saveAs(blob, (node.title || t("canvas:final-cut")) + ".mp4");
            message.success(t("canvas:final-cut-exported"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:export-failed"));
        }
    };

    // 组装能力闭环：合成结果不落地下载，而是作为新视频节点放回画布，可继续编辑字幕与样式。
    const handleCreateAssembledNode = async () => {
        if (!onCreateAssembledNode) {
            message.warning(t("canvas:save-back-to-canvas-not-wired-up-yet"));
            return;
        }
        try {
            const blob = await runExport();
            const created = await onCreateAssembledNode(blob, (node.title || t("canvas:final-cut")) + t("canvas:new-segment"));
            if (created) message.success(t("canvas:new-video-segment-generated-and-placed-on-canvas-continue-editing-subtit"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("canvas:failed-to-generate-segment"));
        }
    };

    const addableNodes = nodes.filter((item) => (item.type === "video" || item.type === "audio") && Boolean(item.metadata?.content || item.metadata?.storageKey) && !isNodeInTimeline(item.id, draft));

    const selectedSubtitleClip = selectedClipId ? draft.clips.find((clip) => clip.id === selectedClipId && clip.kind === "subtitle") || null : null;
    const selectedMediaClip = selectedClipId ? draft.clips.find((clip) => clip.id === selectedClipId && (clip.kind === "video" || clip.kind === "audio")) || null : null;
    const selectedMediaRightEdgeMs = selectedMediaClip ? selectedMediaClip.startMs + selectedMediaClip.durationMs : 0;
    const selectedMediaMinStartMs = selectedMediaClip ? (selectedMediaClip.sourceStartMs ? Math.max(0, selectedMediaClip.startMs - selectedMediaClip.sourceStartMs) : 0) : 0;
    const selectedMediaMaxStartMs = selectedMediaClip ? Math.max(selectedMediaMinStartMs, selectedMediaRightEdgeMs - MIN_CLIP_DURATION_MS) : 0;
    const selectedMediaSourceDurationMs = selectedMediaClip?.sourceDurationMs;
    const selectedMediaMaxDurationMs = selectedMediaSourceDurationMs !== undefined ? Math.max(MIN_CLIP_DURATION_MS, selectedMediaSourceDurationMs) : 3_600_000;
    const selectedMediaMaxSourceStartMs = selectedMediaSourceDurationMs !== undefined ? Math.max(0, selectedMediaSourceDurationMs - (selectedMediaClip?.durationMs || 0)) : 3_600_000;
    const hasVideoClips = draft.clips.some((clip) => clip.kind === "video");

    // 时间线全局时间 → 视频节点本地时间：以该节点视频片段起点为 0 基准重建 SrtEntry。
    // source 传保存时校准后的时间线（normalized）：节点字幕已清空时直接回写空数组，
    // 避免草稿残留的旧字幕片段把节点上已清空的字幕重新写回。
    const buildSubtitleEntriesForNode = (subNodeId: string, source: TimelineProject = draft): SrtEntry[] => {
        const currentNode = nodes.find((item) => item.id === subNodeId);
        if ((currentNode?.metadata?.subtitleEntries?.length ?? 0) === 0) return [];
        const videoClip = source.clips.find((clip) => clip.nodeId === subNodeId && clip.kind === "video");
        const baseMs = videoClip?.startMs ?? 0;
        return source.clips
            .filter((clip) => clip.nodeId === subNodeId && clip.kind === "subtitle" && Boolean(clip.text))
            .sort((a, b) => a.startMs - b.startMs)
            .map((clip, index) => ({
                index: index + 1,
                startMs: Math.max(0, Math.round(clip.startMs - baseMs)),
                endMs: Math.max(0, Math.round(clip.startMs + clip.durationMs - baseMs)),
                text: (clip.text || "").trim(),
            }));
    };

    const trackLabel = (trackId: string) => draft.tracks.find((track) => track.id === trackId)?.label || trackId;
    const renderTrackRow = (trackId: string, label: string) => {
        const clips = draft.clips.filter((clip) => clip.trackId === trackId).sort((a, b) => a.startMs - b.startMs);
        return (
            <div key={trackId} className="relative border-b" style={{ height: TRACK_ROW_HEIGHT, borderColor: theme.timeline.trackBorder, background: theme.timeline.trackFill }}>
                {clips.map((clip) => {
                    const isSelected = clip.id === selectedClipId;
                    const left = Math.round(clip.startMs * pxPerMs);
                    const width = Math.max(8, Math.round(clip.durationMs * pxPerMs));
                    const isSubtitle = clip.kind === "subtitle";
                    const clipFill = isSubtitle ? theme.timeline.clipSubtitle : clip.kind === "audio" ? theme.timeline.clipAudio : theme.timeline.clipVideo;
                    return (
                        <div
                            key={clip.id}
                            className={`absolute top-1 flex h-[calc(100%-8px)] cursor-grab touch-none select-none items-center overflow-hidden rounded-md border text-xs leading-none active:cursor-grabbing`}
                            style={{
                                left,
                                width,
                                background: isSelected ? theme.accent.primary : clipFill,
                                borderColor: isSelected ? theme.timeline.clipSelectedBorder : theme.timeline.trackBorder,
                                color: isSelected ? theme.accent.onPrimary : theme.node.text,
                            }}
                            onPointerDown={(event) => handleClipPointerDown(event, clip.id, "move")}
                            onPointerMove={handleClipPointerMove}
                            onPointerUp={handleClipPointerUp}
                            onPointerCancel={handleClipPointerUp}
                            onClick={(event) => event.stopPropagation()}
                            title={`${clip.title || label} · ${formatTimelineTime(clip.startMs)}~${formatTimelineTime(clip.startMs + clip.durationMs)}`}
                        >
                            {!isSubtitle ? (
                                <div
                                    className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize opacity-0 hover:opacity-100"
                                    style={{ background: theme.timeline.handle }}
                                    onPointerDown={(event) => handleClipPointerDown(event, clip.id, "trim-start")}
                                />
                            ) : null}
                            <span className="pointer-events-none min-w-0 flex-1 truncate px-2">{clip.title || trackLabel(clip.trackId)}</span>
                            {!isSubtitle ? (
                                <div className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize opacity-0 hover:opacity-100" style={{ background: theme.timeline.handle }} onPointerDown={(event) => handleClipPointerDown(event, clip.id, "trim-end")} />
                            ) : null}
                        </div>
                    );
                })}
                <div className="pointer-events-none absolute inset-y-0" style={{ left: Math.round(playheadMs * pxPerMs), width: 2, background: theme.timeline.playhead }} />
            </div>
        );
    };

    const title = (
        <div className="flex min-w-0 items-center gap-2.5 pr-10">
            <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                <Clapperboard className="size-4" />
            </span>
            <div className="min-w-0">
                <div className="truncate text-[var(--fs-heading-lg)] font-semibold leading-6 tracking-[-0.02em]">{t("canvas:multi-track-timeline-2")}</div>
                <div className="truncate text-xs opacity-45">{t("canvas:phase-2-track-editing-and-media-arrangement-2")}</div>
            </div>
        </div>
    );

    return (
        <Modal
            className="canvas-timeline-dialog"
            title={title}
            open={open}
            centered
            footer={null}
            width={1160}
            destroyOnHidden
            onCancel={onClose}
            afterOpenChange={(visible) => {
                if (visible) ensureToolbarObserved();
            }}
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0 } }}
        >
            <div className="flex h-[min(76vh,760px)] min-h-[420px] flex-col text-sm" style={{ color: theme.node.text }}>
                <div ref={toolbarRef} className="flex flex-nowrap items-center gap-2 overflow-hidden border-b px-4 py-3" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                    <span className="min-w-24 rounded-md border px-2 py-1 text-xs font-semibold tabular-nums" style={{ borderColor: theme.toolbar.border, background: theme.node.fill, color: theme.accent.primary }}>
                        {formatTimelineTime(playheadMs)}
                    </span>
                    <Tooltip title={snapEnabled ? t("canvas:disable-snapping") : t("canvas:enable-snapping")}>
                        <Button size="small" icon={<Scissors className="size-3.5" />} onClick={() => setSnapEnabled((value) => !value)}>
                            {snapEnabled ? t("canvas:snap-on") : t("canvas:snap-off")}
                        </Button>
                    </Tooltip>
                    <Button size="small" icon={<ZoomOut className="size-3.5" />} onClick={() => setZoomLevel((value) => zoomOut(value))} />
                    <Button size="small" icon={<ZoomIn className="size-3.5" />} onClick={() => setZoomLevel((value) => zoomIn(value))} />
                    <Button size="small" icon={<Maximize2 className="size-3.5" />} onClick={() => setZoomLevel(getFitTimelineZoom(durationMs, viewportWidth))}>
                        {t("canvas:fit-2")}
                    </Button>
                    {addGroupCollapsed ? (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomLeft"
                            menu={{
                                items: [
                                    ...(addableNodes.length
                                        ? [
                                              {
                                                  key: "add",
                                                  label: t("canvas:add-media-5"),
                                                  icon: <Plus className="size-3.5" />,
                                                  children: addableNodes.map((item) => ({
                                                      key: item.id,
                                                      label: (
                                                          <span className="inline-flex max-w-56 items-center gap-2 truncate">
                                                              {item.type === "video" ? <Video className="size-3.5" /> : <Music2 className="size-3.5" />}
                                                              {item.title || t("canvas:untitled-media")}
                                                          </span>
                                                      ),
                                                      onClick: () => addNodeToTimeline(item),
                                                  })),
                                              },
                                          ]
                                        : []),
                                    { key: "upload", label: t("canvas:upload-local-files-5"), icon: <Upload className="size-3.5" />, onClick: () => uploadInputRef.current?.click() },
                                    { key: "library", label: t("canvas:asset-library-5"), icon: <Library className="size-3.5" />, disabled: !onOpenAssetLibrary, onClick: () => onOpenAssetLibrary?.() },
                                    { key: "assets", label: t("canvas:project-assets-7"), icon: <FolderOpen className="size-3.5" />, disabled: !onOpenProjectAssets, onClick: () => onOpenProjectAssets?.() },
                                ],
                            }}
                        >
                            <span ref={moreBtnRef}>
                                <Button size="small" icon={<MoreHorizontal className="size-3.5" />}>
                                    {t("canvas:more-2")}
                                </Button>
                            </span>
                        </Dropdown>
                    ) : (
                        <>
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomLeft"
                                disabled={!addableNodes.length}
                                menu={{
                                    items: addableNodes.map((item) => ({
                                        key: item.id,
                                        label: (
                                            <span className="inline-flex max-w-56 items-center gap-2 truncate">
                                                {item.type === "video" ? <Video className="size-3.5" /> : <Music2 className="size-3.5" />}
                                                {item.title || t("canvas:untitled-media")}
                                            </span>
                                        ),
                                        onClick: () => addNodeToTimeline(item),
                                    })),
                                }}
                            >
                                <Button size="small" icon={<Plus className="size-3.5" />} disabled={!addableNodes.length}>
                                    {t("canvas:add-media-5")}
                                </Button>
                            </Dropdown>
                            <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => uploadInputRef.current?.click()}>
                                {t("canvas:upload-local-files-5")}
                            </Button>
                            <Button size="small" icon={<Library className="size-3.5" />} disabled={!onOpenAssetLibrary} onClick={() => onOpenAssetLibrary?.()}>
                                {t("canvas:asset-library-5")}
                            </Button>
                            <Button size="small" icon={<FolderOpen className="size-3.5" />} disabled={!onOpenProjectAssets} onClick={() => onOpenProjectAssets?.()}>
                                {t("canvas:project-assets-7")}
                            </Button>
                        </>
                    )}
                    <div ref={addGroupProbeRef} aria-hidden="true" className="invisible pointer-events-none absolute left-0 top-0 flex items-center gap-2">
                        <Dropdown trigger={["click"]} placement="bottomLeft" disabled={!addableNodes.length} menu={{ items: [] }}>
                            <Button size="small" icon={<Plus className="size-3.5" />}>
                                {t("canvas:add-media-5")}
                            </Button>
                        </Dropdown>
                        <Button size="small" icon={<Upload className="size-3.5" />}>
                            {t("canvas:upload-local-files-5")}
                        </Button>
                        <Button size="small" icon={<Library className="size-3.5" />}>
                            {t("canvas:asset-library-5")}
                        </Button>
                        <Button size="small" icon={<FolderOpen className="size-3.5" />}>
                            {t("canvas:project-assets-7")}
                        </Button>
                    </div>
                    <input
                        ref={uploadInputRef}
                        type="file"
                        accept="video/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav"
                        multiple
                        className="hidden"
                        onChange={(event) => {
                            void handleLocalUpload(event.target.files);
                            event.target.value = "";
                        }}
                    />
                    <Button size="small" icon={<Scissors className="size-3.5" />} onClick={splitClipAtPlayhead}>
                        {t("canvas:split-2")}
                    </Button>
                    <div className="ml-auto flex items-center gap-2">
                        <Button size="small" type="primary" icon={<Clapperboard className="size-3.5" />} loading={exporting} disabled={!hasVideoClips} onClick={() => void handleExport()}>
                            {t("canvas:export-final-cut-2")}
                        </Button>
                        <Button size="small" icon={<Wand2 className="size-3.5" />} loading={exporting} disabled={!hasVideoClips} onClick={() => void handleCreateAssembledNode()}>
                            {t("canvas:generate-new-segment-2")}
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedClipId} onClick={deleteSelectedClip}>
                            {t("canvas:delete-segment-2")}
                        </Button>
                        <Button size="small" disabled={!draft.clips.length} onClick={onClose}>
                            {t("canvas:cancel-11")}
                        </Button>
                        <Button size="small" type="primary" disabled={!draft.clips.length} onClick={handleSave}>
                            {t("canvas:save-3")}
                        </Button>
                    </div>
                </div>

                <CanvasTimelinePreview clips={draft.clips} nodes={nodes} playheadMs={playheadMs} playing={previewPlaying} theme={theme} onTogglePlay={() => setPreviewPlaying((value) => !value)} onPlayheadChange={setPlayheadMs} />

                <div className="flex min-h-0 flex-1">
                    <div className="flex w-44 shrink-0 flex-col border-r" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                        <div className="shrink-0 border-b" style={{ height: 32, borderColor: theme.toolbar.border }} />
                        {draft.tracks
                            .slice()
                            .sort((a, b) => a.order - b.order)
                            .map((track) => (
                                <div key={track.id} className="flex items-center gap-2 border-b px-3" style={{ height: TRACK_ROW_HEIGHT, borderColor: theme.toolbar.border }}>
                                    <span className="grid size-6 shrink-0 place-items-center rounded-md text-xs font-semibold" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                        {track.kind === "video" ? "V" : track.kind === "audio" ? "A" : "S"}
                                    </span>
                                    <span className="min-w-0 flex-1 truncate text-xs">{track.label}</span>
                                    {track.locked ? <Lock className="size-3 opacity-40" /> : <LockOpen className="size-3 opacity-40" />}
                                </div>
                            ))}
                    </div>

                    <div ref={trackAreaRef} className="thin-scrollbar min-w-0 flex-1 overflow-auto" data-canvas-no-zoom>
                        <div ref={scrollRef} style={{ width: trackWidth }} className="min-h-full">
                            <CanvasTimelineRuler
                                pxPerMs={pxPerMs}
                                durationMs={durationMs}
                                playheadMs={playheadMs}
                                width={trackWidth}
                                theme={theme}
                                onSeek={(ms) => {
                                    setPreviewPlaying(false);
                                    setPlayheadMs(ms);
                                }}
                            />
                            {draft.tracks
                                .slice()
                                .sort((a, b) => a.order - b.order)
                                .map((track) => renderTrackRow(track.id, track.label))}
                        </div>
                    </div>
                </div>

                {exporting ? (
                    <div className="border-t px-4 py-2" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                        <Progress percent={exportPercent} size="small" format={() => exportDetail} />
                    </div>
                ) : null}

                {selectedSubtitleClip ? (
                    <div className="border-t px-4 py-2.5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                        <div className="mb-1.5 flex items-center gap-2 text-xs">
                            <span className="font-semibold" style={{ color: theme.accent.primary }}>
                                {t("canvas:subtitle-editor-4")}
                            </span>
                            <span className="opacity-45">{t("canvas:saving-writes-subtitle-data-back-to-the-linked-video-node-2")}</span>
                            {onOpenSubtitleDialog ? (
                                <Button size="small" className="ml-auto" icon={<Captions className="size-3.5" />} onClick={() => onOpenSubtitleDialog(selectedSubtitleClip.nodeId)}>
                                    {t("canvas:fine-editing-srt-highlights-style-2")}
                                </Button>
                            ) : null}
                        </div>
                        <div className="flex items-start gap-3">
                            <Input.TextArea
                                autoSize={{ minRows: 1, maxRows: 3 }}
                                value={selectedSubtitleClip.text || ""}
                                placeholder={t("canvas:subtitle-text")}
                                className="flex-1"
                                onChange={(event) => updateClip(selectedSubtitleClip.id, { text: event.target.value })}
                            />
                            <div className="flex shrink-0 items-center gap-1.5 text-xs">
                                <InputNumber size="small" min={0} step={100} value={selectedSubtitleClip.startMs} onChange={(startMs) => updateClip(selectedSubtitleClip.id, { startMs: startMs ?? 0 })} className="w-28" />
                                <span className="opacity-40">→</span>
                                <InputNumber
                                    size="small"
                                    min={0}
                                    step={100}
                                    value={selectedSubtitleClip.startMs + selectedSubtitleClip.durationMs}
                                    onChange={(endMs) => updateClip(selectedSubtitleClip.id, { durationMs: Math.max(MIN_CLIP_DURATION_MS, (endMs ?? 0) - selectedSubtitleClip.startMs) })}
                                    className="w-28"
                                />
                                <span className="opacity-40">{t("canvas:ms-2")}</span>
                            </div>
                        </div>
                    </div>
                ) : null}

                {selectedMediaClip ? (
                    <div className="border-t px-4 py-2.5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                        <div className="mb-1.5 flex items-center gap-2 text-xs">
                            <span className="font-semibold" style={{ color: theme.accent.primary }}>
                                {t("canvas:segment-editor-2")}
                            </span>
                            <span className="min-w-0 flex-1 truncate opacity-45">{selectedMediaClip.title || trackLabel(selectedMediaClip.trackId)}</span>
                            <Button size="small" icon={<Scissors className="size-3.5" />} onClick={splitClipAtPlayhead}>
                                {t("canvas:split-at-playhead-2")}
                            </Button>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                            <span className="opacity-50">{t("canvas:start-6")}</span>
                            <InputNumber
                                size="small"
                                min={selectedMediaMinStartMs}
                                max={selectedMediaMaxStartMs}
                                step={100}
                                className="w-28"
                                value={selectedMediaClip.startMs}
                                onChange={(value) => updateSelectedMediaNumbers({ startMs: Math.max(selectedMediaMinStartMs, Math.min(selectedMediaMaxStartMs, value ?? selectedMediaClip.startMs)) })}
                            />
                            <span className="opacity-50">{t("canvas:duration-5")}</span>
                            <InputNumber
                                size="small"
                                min={MIN_CLIP_DURATION_MS}
                                max={selectedMediaMaxDurationMs}
                                step={100}
                                className="w-28"
                                value={selectedMediaClip.durationMs}
                                onChange={(value) => updateSelectedMediaNumbers({ durationMs: Math.max(MIN_CLIP_DURATION_MS, Math.min(selectedMediaMaxDurationMs, value ?? selectedMediaClip.durationMs)) })}
                            />
                            <span className="opacity-50">{t("canvas:source-in-point-2")}</span>
                            <InputNumber
                                size="small"
                                min={0}
                                max={selectedMediaMaxSourceStartMs}
                                step={100}
                                className="w-28"
                                value={selectedMediaClip.sourceStartMs ?? 0}
                                onChange={(value) => updateSelectedMediaNumbers({ sourceStartMs: Math.max(0, Math.min(selectedMediaMaxSourceStartMs, value ?? (selectedMediaClip.sourceStartMs || 0))) })}
                            />
                            <span className="opacity-50">{t("canvas:source-out-point-2")}</span>
                            <span className="tabular-nums" style={{ color: theme.accent.primary }}>
                                {formatTimelineTime((selectedMediaClip.sourceStartMs || 0) + selectedMediaClip.durationMs)}
                            </span>
                            <span className="ml-auto hidden opacity-45 sm:inline">{t("canvas:fine-tune-with-numeric-trim-split-at-playhead-drag-handles-for-quick-cut-2")}</span>
                        </div>
                    </div>
                ) : null}

                <div className="flex items-center gap-3 border-t px-4 py-2.5" style={{ borderColor: theme.toolbar.border, background: theme.toolbar.panel }}>
                    <span className="text-xs opacity-60">
                        {t("canvas:total-duration-2")} {formatTimelineTime(durationMs)} · {draft.clips.length} {t("canvas:segments-5")} {draft.tracks.length} {t("canvas:tracks-3")}
                    </span>
                    <span className="ml-auto truncate text-xs opacity-45">{t("canvas:drag-segments-to-move-trim-from-edges-subtitle-segments-come-from-the-vi-2")}</span>
                </div>
            </div>
        </Modal>
    );
}
