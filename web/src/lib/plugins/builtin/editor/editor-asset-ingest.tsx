// 资产导入（editor-shell 预设插件贡献 asset-ingest 插槽，M3.4）。
// 展示项目资产库，按来源区分「本地上传」与「项目素材」；点击资产 → makeClipFromAsset
// → dispatch addClip 加入时间线（添加到匹配 kind 的轨道末尾）。资产是
// "仅时间线作用域"直连媒体（nodeId=asset:<id>）。导入链路：uploadResourceFile →
// linkProjectAsset（后端按资源元数据合成资产记录）→ refreshAssets。

import { useEffect, useRef, useState } from "react";
import { Boxes, ChevronDown, ChevronRight, Clapperboard, Film, FolderOpen, HardDrive, Image as ImageIcon, Loader2, Music2, Plus } from "lucide-react";

import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { defaultAssetCategoryForKind } from "@/lib/asset-category";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import { makeClipFromAsset } from "@/lib/timeline/asset-ingest";
import { DEFAULT_AUDIO_TRACK_ID, DEFAULT_SUBTITLE_TRACK_ID, DEFAULT_VIDEO_TRACK_ID } from "@/lib/timeline/timeline-tracks";
import { linkProjectAsset } from "@/services/api/projects";
import { uploadResourceFile, type ResourceUploadMeta } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";


const MEDIA_ACCEPT = "video/*,audio/*,image/*";
/** 库内重复判定用的归一键（文件名+媒体类型）。 */
function assetDedupeKey(title: string | undefined, mediaType: string): string {
    return `${(title || "").trim().toLowerCase()}|${mediaType}`;
}
/** 毫秒 → m:ss 时长文案。 */
function formatDurationMs(ms: number | undefined): string {
    if (!ms || ms <= 0) return "";
    const total = Math.round(ms / 1000);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac|aac)$/i;
const MEDIA_RE = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

/** 本地上传标记与画布产物标记（assetFromUploadedResource 写入 payload.data.source）。 */
const SOURCE_UPLOADED = "uploaded";
const SOURCE_CANVAS = "canvas";

type AssetFilter = "all" | "project" | "uploaded" | "canvas";

const FILTER_TABS: { id: AssetFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "project", label: "项目素材" },
    { id: "uploaded", label: "本地上传" },
    { id: "canvas", label: "画布素材" },
];

/** 按 MIME 与扩展名推断媒体 kind；非媒体文件返回 null。 */
function kindFromFile(file: File): "image" | "video" | "audio" | null {
    if (file.type.startsWith("video/")) return "video";
    if (file.type.startsWith("audio/")) return "audio";
    if (file.type.startsWith("image/")) return "image";
    if (IMAGE_RE.test(file.name)) return "image";
    if (AUDIO_RE.test(file.name)) return "audio";
    if (MEDIA_RE.test(file.name)) return "video";
    return null;
}

function trackIdForKind(kind: string, project: TimelineProject): string {
    const track = project.tracks.find((t) => t.kind === kind);
    if (track) return track.id;
    if (kind === "video" || kind === "image") return project.tracks.find((t) => t.kind === "video")?.id ?? DEFAULT_VIDEO_TRACK_ID;
    if (kind === "audio") return project.tracks.find((t) => t.kind === "audio")?.id ?? DEFAULT_AUDIO_TRACK_ID;
    return DEFAULT_SUBTITLE_TRACK_ID;
}

function trackEndMs(project: TimelineProject, trackId: string): number {
    return project.clips.filter((c) => c.trackId === trackId).reduce((max, c) => Math.max(max, c.startMs + c.durationMs), 0);
}

function AssetIcon({ mediaType }: { mediaType: string }) {
    const cls = "size-4";
    if (mediaType === "video") return <Film className={cls} />;
    if (mediaType === "audio") return <Music2 className={cls} />;
    if (mediaType === "image") return <ImageIcon className={cls} />;
    return <Clapperboard className={cls} />;
}

/** 列表行小缩略图：图片媒体显示真实画面；视频/音频无法在 <img> 解码，
 *  统一渲染类型色块+图标占位（不再出现破图），视频缩略图由展开卡片提供。 */
function AssetThumb({ asset }: { asset: ProjectAsset }) {
    const isImage = asset.mediaType === "image";
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!isImage || !asset.storageKey) return;
        let alive = true;
        resolveMediaUrl(asset.storageKey)
            .then((resolved) => alive && setUrl(resolved ?? null))
            .catch(() => alive && setUrl(null));
        return () => {
            alive = false;
        };
    }, [asset.storageKey, isImage]);
    if (url) {
        return (
            <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--director-control-hover)]">
                <img src={url} alt="" className="size-full object-cover" />
            </div>
        );
    }
    const kind =
        asset.mediaType === "video"
            ? { icon: <Film className="size-4" />, tone: "text-[var(--director-accent)]", tile: "bg-[var(--director-accent)]/15" }
            : asset.mediaType === "audio"
              ? { icon: <Music2 className="size-4" />, tone: "text-[var(--director-dock-fg)]/70", tile: "bg-[var(--director-control-hover)]" }
              : { icon: <ImageIcon className="size-4" />, tone: "text-[var(--director-dock-fg)]/60", tile: "bg-[var(--director-control-hover)]" };
    return (
        <div className={`grid size-9 shrink-0 place-items-center overflow-hidden rounded-md ${kind.tile}`}>
            <span className={kind.tone}>{kind.icon}</span>
        </div>
    );
}

/** 尝试用 <video> 抓取视频首帧作为封面 dataURL；失败返回 null（保持图标占位）。 */
function useVideoPoster(url: string | null): string | null {
    const [poster, setPoster] = useState<string | null>(null);
    useEffect(() => {
        if (!url) {
            setPoster(null);
            return;
        }
        let alive = true;
        const video = document.createElement("video");
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        video.src = url;
        const seekToHead = () => {
            if (!alive || video.readyState < 1) return;
            try {
                video.currentTime = Math.min(0.05, Number.isFinite(video.duration) ? video.duration : 0.05);
            } catch {
                /* 忽略跨域/编解码异常 */
            }
        };
        const grabFrame = () => {
            if (!alive || video.readyState < 2 || video.videoWidth === 0) return;
            try {
                const canvas = document.createElement("canvas");
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext("2d");
                if (!ctx) return;
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
                if (dataUrl.length > 100) setPoster(dataUrl);
            } catch {
                /* canvas 跨域污染等：放弃自动封面 */
            }
        };
        video.addEventListener("loadeddata", seekToHead);
        video.addEventListener("seeked", grabFrame);
        return () => {
            alive = false;
            video.removeAttribute("src");
            video.load();
        };
    }, [url]);
    return poster;
}

/** 展开卡片预览：图片直接展示；视频给出自动首帧封面 + 原生播放器；音频为说明。 */
function MediaPreview({ asset }: { asset: ProjectAsset }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        if (!asset.storageKey) return;
        let alive = true;
        resolveMediaUrl(asset.storageKey)
            .then((resolved) => alive && setUrl(resolved ?? null))
            .catch(() => alive && setUrl(null));
        return () => {
            alive = false;
        };
    }, [asset.storageKey]);
    const poster = useVideoPoster(asset.mediaType === "video" ? url : null);
    if (asset.mediaType === "image") {
        return url ? <img src={url} alt="" className="h-28 w-full rounded-md object-cover" /> : <div className="h-28 animate-pulse rounded-md bg-[var(--director-control-hover)]" />;
    }
    if (asset.mediaType === "video") {
        return (
            <div className="relative overflow-hidden rounded-md bg-black">
                <video
                    src={url ?? undefined}
                    poster={poster ?? undefined}
                    preload="metadata"
                    controls
                    playsInline
                    className="aspect-video w-full"
                />
                {!url ? <div className="aspect-video w-full animate-pulse bg-[var(--director-control-hover)]" /> : null}
            </div>
        );
    }
    return (
        <div className="flex h-16 items-center justify-center gap-2 rounded-md bg-[var(--director-control-hover)] text-[var(--director-dock-fg)]/60">
            <Music2 className="size-4" />
            <span className="text-[10px]">音频素材 · 点击下方按钮加入时间线</span>
        </div>
    );
}

function SourceBadge({ source }: { source: string }) {
    const uploaded = source === SOURCE_UPLOADED;
    const canvas = source === SOURCE_CANVAS;
    return (
        <span
            className={`rounded px-1 py-px text-[9px] leading-none ${
                uploaded || canvas
                    ? "bg-[var(--director-control-hover)] text-[var(--director-dock-fg-strong)]"
                    : "bg-[var(--director-control-hover)] text-[var(--director-dock-fg)]/70"
            }`}
        >
            {uploaded ? "本地上传" : canvas ? "画布素材" : "项目素材"}
        </span>
    );
}

export function EditorAssetIngest() {
    const { projectId, assets, refreshAssets } = useEditorHostContext();
    const { project, dispatch } = useEditorStoreContext();
    const [added, setAdded] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [importNote, setImportNote] = useState<string | null>(null);
    useEffect(() => {
        if (!importNote) return;
        const timer = window.setTimeout(() => setImportNote(null), 3200);
        return () => window.clearTimeout(timer);
    }, [importNote]);
    const [dragOver, setDragOver] = useState(false);

    const [filter, setFilter] = useState<AssetFilter>("all");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [openGroups, setOpenGroups] = useState<{ uploaded: boolean; project: boolean; canvas: boolean }>({ uploaded: true, project: true, canvas: true });
    const inputRef = useRef<HTMLInputElement | null>(null);
    const lastAddKey = useRef<string | null>(null);
    const lastAddAt = useRef(0);

    if (!project) return null;

    const importFiles = async (fileList: FileList | File[]) => {
        const media = Array.from(fileList)
            .map((file) => ({ file, kind: kindFromFile(file) }))
            .filter((x): x is { file: File; kind: "image" | "video" | "audio" } => x.kind !== null);
        if (media.length === 0) {
            setImportError("仅支持视频、音频与图片文件");
            return;
        }
        setImporting(true);
        setImportError(null);
        setImportNote(null);
        let okCount = 0;
        let firstErrorMsg: string | null = null;
        const failedNames: string[] = [];
        try {
            // 去重：同名同类型视为同一素材。库内已有或本批内重复的跳过，避免
            // 再次上传同一大文件生成重复 asset（历史上重复导入会把素材堆积成多条）。
            const seen = new Set<string>();
            const toImport = media.filter(({ file, kind }) => {
                const key = assetDedupeKey(file.name, kind);
                const known = assets.some((a) => assetDedupeKey(a.title, a.mediaType) === key);
                const duplicated = seen.has(key);
                seen.add(key);
                return !known && !duplicated;
            });
            const skipped = media.length - toImport.length;
            // 逐文件导入：单文件失败不中断整批，汇总失败数提示。
            const linkedIds: string[] = [];
            for (const { file, kind } of toImport) {
                try {
                    // 上传前探测真实时长（视频/音频），随 meta 入库供时间线片段使用。
                    const durationMs = await probeMediaDurationMs(file);
                    const resource = await uploadResourceFile(file, kind, durationMs !== undefined ? { durationMs } : undefined);
                    if (resource.status === "failed") {
                        failedNames.push(file.name);
                        if (!firstErrorMsg) firstErrorMsg = resource.error ? `「${file.name}」${resource.error}` : null;
                        continue;
                    }
                    let linked = false;
                    try {
                        await linkProjectAsset(projectId, { assetId: resource.id, category: defaultAssetCategoryForKind(kind), title: file.name });
                        linked = true;
                    } catch {
                        // 链接偶发失败（网络抖动/后端竞态）时重试一次，避免资源已入库却未挂到项目下。
                        linked = await linkProjectAsset(projectId, { assetId: resource.id, category: defaultAssetCategoryForKind(kind), title: file.name })
                            .then(() => true)
                            .catch(() => false);
                    }
                    if (!linked) {
                        // 两次挂载都失败（asset 可能已创建但未挂上项目）：不删除，提示重试——重试走幂等路径可补挂。
                        failedNames.push(file.name);
                        if (!firstErrorMsg) firstErrorMsg = `「${file.name}」已上传但挂载到项目失败，请重试`;
                        continue;
                    }
                    okCount += 1;
                    linkedIds.push(resource.id);
                } catch (err) {
                    failedNames.push(file.name);
                    const detail = extractApiMessage(err);
                    if (!firstErrorMsg) firstErrorMsg = detail ? `「${file.name}」${detail}` : `「${file.name}」导入失败`;
                }
            }
            if (okCount > 0) {
                // 刷新后校验本次挂载的素材是否都出现在列表里；若单次刷新因网络抖动
                // 或后端提交延迟而拿不到最新结果，立即再刷新一次，避免列表停留在旧快照。
                const firstList = await refreshAssets();
                if (firstList && linkedIds.some((id) => !firstList.some((asset) => asset.id === id))) {
                    await refreshAssets();
                }
                setImportNote(skipped > 0 ? `已导入 ${okCount} 个，跳过 ${skipped} 个重复文件` : `已导入 ${okCount} 个媒体`);
            } else if (skipped > 0 && failedNames.length === 0) {
                setImportNote(`媒体库中已有同名素材，跳过 ${skipped} 个重复文件`);
            }
            if (firstErrorMsg) {
                setImportError(firstErrorMsg);
            } else if (failedNames.length > 0) {
                const failedText = failedNames.length === 1 ? `「${failedNames[0]}」` : `${failedNames.length} 个文件`;
                setImportError(`${failedText}导入失败，请重试`);
            }
        } finally {
            setImporting(false);
        }
    };

    // 双击“添加到时间线”会连续 dispatch 两次，产生两个同一素材的相邻片段；用时间戳守卫拦截 1.5s 内的重复添加。
    const addToTimeline = (asset: ProjectAsset) => {
        const now = Date.now();
        if (lastAddKey.current === asset.id && now - lastAddAt.current < 1500) return;
        lastAddKey.current = asset.id;
        lastAddAt.current = now;
        const kind = asset.mediaType === "video" ? "video" : asset.mediaType === "audio" ? "audio" : asset.mediaType === "image" ? "image" : null;
        if (!kind) return;
        const trackId = trackIdForKind(kind, project);
        const startMs = trackEndMs(project, trackId);
        const clip = makeClipFromAsset(asset, {
            trackId,
            startMs,
            defaultDurationMs: kind === "image" ? 3_000 : 5_000,
        });
        if (!clip) return;
        dispatch({ op: "addClip", payload: { clip } });
        setAdded(asset.id);
        setTimeout(() => setAdded(null), 1200);
    };

    const uploadedAssets = assets.filter((a) => a.source === SOURCE_UPLOADED);
    const canvasAssets = assets.filter((a) => a.source === SOURCE_CANVAS);
    const projectAssets = assets.filter((a) => a.source !== SOURCE_UPLOADED && a.source !== SOURCE_CANVAS);
    const groups: { id: "uploaded" | "project" | "canvas"; label: string; icon: typeof HardDrive; items: ProjectAsset[] }[] = [
        { id: "uploaded", label: "本地上传", icon: HardDrive, items: uploadedAssets },
        { id: "canvas", label: "画布素材", icon: Boxes, items: canvasAssets },
        { id: "project", label: "项目素材", icon: Boxes, items: projectAssets },
    ];
    const visibleGroups = groups.filter((g) => filter === "all" || g.id === filter);
    const totalCount = assets.length;

    return (
        <div
            className={`flex h-full min-h-0 flex-col bg-[var(--director-sequencer-surface)] ${dragOver ? "ring-2 ring-inset ring-[var(--director-accent)]" : ""}`}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                void importFiles(e.dataTransfer.files);
            }}
        >
            {/* 标题行：媒体库 + 导入按钮 */}
            <div className="flex items-center gap-1.5 p-2 pb-1">
                <input
                    ref={inputRef}
                    type="file"
                    accept={MEDIA_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(e) => {
                        if (e.target.files) void importFiles(e.target.files);
                        e.target.value = "";
                    }}
                />
                <span className="text-xs font-semibold text-[var(--director-dock-fg-strong)]">媒体库</span>
                <span className="rounded-full bg-[var(--director-control-hover)] px-1.5 text-[9px] tabular-nums text-[var(--director-dock-fg)]/70">{totalCount}</span>
                <div className="flex-1" />
                <button
                    type="button"
                    disabled={importing}
                    onClick={() => inputRef.current?.click()}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-dashed border-[var(--director-sequencer-border)] px-2.5 text-[11px] font-medium text-[var(--director-dock-fg-strong)] transition-colors hover:border-[var(--director-accent)] hover:bg-[var(--director-control-hover)] disabled:cursor-not-allowed disabled:opacity-60"
                >
                    {importing ? <Loader2 className="size-3.5 animate-spin" /> : <FolderOpen className="size-3.5" />}
                    {importing ? "导入中…" : "导入媒体"}
                </button>
            </div>

            {/* 来源筛选：全部 / 项目素材 / 本地上传 */}
            <div className="flex items-center gap-0.5 px-2 pb-1">
                {FILTER_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        aria-pressed={filter === tab.id}
                        onClick={() => setFilter(tab.id)}
                        className={`h-6 rounded-md px-2 text-[10px] transition-colors ${
                            filter === tab.id
                                ? "bg-[var(--director-dock-active-surface)] text-[var(--director-dock-fg-strong)]"
                                : "text-[var(--director-dock-fg)] hover:bg-[var(--director-control-hover)]"
                        }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {importError ? <p className="px-2 pb-1 text-[10px] text-[var(--director-danger)]">{importError}</p> : null}
            {importNote ? <p className="px-2 pb-1 text-[10px] text-[var(--director-success)]">{importNote}</p> : null}

            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
                {assets.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <p className="text-xs text-[var(--director-dock-fg)]/60">项目暂无资产</p>
                        <p className="max-w-[180px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">点击上方导入媒体，或将文件拖入此区域</p>
                    </div>
                ) : visibleGroups.every((g) => g.items.length === 0) ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <p className="text-xs text-[var(--director-dock-fg)]/60">
                            {filter === "uploaded" ? "暂无本地上传的媒体" : filter === "canvas" ? "暂无画布素材，请先在画布工作台生成分镜/预演" : filter === "project" ? "暂无项目素材" : "项目暂无资产"}
                        </p>
                        <p className="max-w-[180px] text-[11px] leading-relaxed text-[var(--director-dock-fg)]/45">点击上方导入媒体，或将文件拖入此区域</p>
                    </div>
                ) : (
                    <div className="flex flex-col gap-1">
                        {visibleGroups.map((group) => {
                            if (group.items.length === 0) return null;
                            const open = openGroups[group.id];
                            return (
                                <div key={group.id} className="flex flex-col">
                                    <button
                                        type="button"
                                        aria-expanded={open}
                                        onClick={() => setOpenGroups((s) => ({ ...s, [group.id]: !open }))}
                                        className="group flex h-7 w-full items-center gap-1.5 rounded-md px-1 text-left transition-colors hover:bg-[var(--director-control-hover)]"
                                    >
                                        <span
                                            className={`grid size-4 shrink-0 place-items-center rounded-[5px] transition-colors ${
                                                open ? "bg-[var(--director-accent)]/15 text-[var(--director-accent)]" : "bg-[var(--director-control-hover)] text-[var(--director-dock-fg)]/55 group-hover:text-[var(--director-dock-fg-strong)]"
                                            }`}
                                        >
                                            <ChevronRight className={`size-3 transition-transform duration-150 ease-out ${open ? "rotate-90" : ""}`} />
                                        </span>
                                        <group.icon className={`size-3.5 shrink-0 transition-colors ${open ? "text-[var(--director-accent)]" : "text-[var(--director-dock-fg)]/60"}`} />
                                        <span className="truncate text-[11px] font-medium text-[var(--director-dock-fg-strong)]">{group.label}</span>
                                        <span className="ml-auto rounded-full bg-[var(--director-control-hover)] px-1.5 text-[9px] tabular-nums text-[var(--director-dock-fg)]/70">{group.items.length}</span>
                                    </button>
                                    {open ? (
                                        <ul className="flex flex-col">
                                            {group.items.map((asset) => {
                                                const expanded = expandedId === asset.id;
                                                const source = asset.source || "";
                                                return (
                                                    <li key={asset.id}>
                                                        <button
                                                            type="button"
                                                            aria-expanded={expanded}
                                                            onClick={() => setExpandedId(expanded ? null : asset.id)}
                                                            title={asset.title || asset.storageKey}
                                                            className={`group flex w-full items-center gap-2 rounded-md px-1 py-[3px] text-left transition-colors ${
                                                                added === asset.id ? "bg-[var(--director-accent)]/15" : "hover:bg-[var(--director-control-hover)]"
                                                            }`}
                                                        >
                                                            <AssetThumb asset={asset} />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-[11px] text-[var(--director-dock-fg-strong)]">{asset.title || asset.storageKey}</span>
                                                                <span className="mt-0.5 flex items-center gap-1 text-[9px] text-[var(--director-dock-fg)]/60">
                                                                    <span className="uppercase">{asset.mediaType}</span>
                                                                    {asset.durationMs ? <span className="tabular-nums opacity-80">{formatDurationMs(asset.durationMs)}</span> : null}
                                                                    <SourceBadge source={source} />
                                                                </span>
                                                            </span>
                                                            <span
                                                                className={`grid size-5 shrink-0 place-items-center rounded-[5px] transition-colors ${
                                                                    expanded ? "bg-[var(--director-accent)]/15 text-[var(--director-accent)]" : "text-[var(--director-dock-fg)]/40 group-hover:text-[var(--director-dock-fg)]/80"
                                                                }`}
                                                            >
                                                                <ChevronDown className={`size-3.5 transition-transform duration-150 ease-out ${expanded ? "rotate-180" : ""}`} />
                                                            </span>
                                                        </button>
                                                        {expanded ? (
                                                                <div className="mx-1 mb-1 ml-10 rounded-md bg-[var(--director-control-hover)] p-2">

                                                                <MediaPreview asset={asset} />
                                                                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                                                    <dt className="text-[var(--director-dock-fg)]/60">媒体类型</dt>
                                                                    <dd className="truncate text-right capitalize text-[var(--director-dock-fg-strong)]">{asset.mediaType}</dd>
                                                                    <dt className="text-[var(--director-dock-fg)]/60">分类</dt>
                                                                    <dd className="truncate text-right text-[var(--director-dock-fg-strong)]">{asset.category}</dd>
                                                                    <dt className="text-[var(--director-dock-fg)]/60">来源</dt>
                                                                     <dd className="text-right text-[var(--director-dock-fg-strong)]">{source === SOURCE_UPLOADED ? "本地上传" : source === SOURCE_CANVAS ? "画布素材" : "项目素材"}</dd>
                                                                    {asset.durationMs ? (
                                                                        <>
                                                                            <dt className="text-[var(--director-dock-fg)]/60">时长</dt>
                                                                            <dd className="text-right tabular-nums text-[var(--director-dock-fg-strong)]">{formatDurationMs(asset.durationMs)}</dd>
                                                                        </>
                                                                    ) : null}
                                                                </dl>
                                                                {asset.previewText ? <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[var(--director-dock-fg)]/60">{asset.previewText}</p> : null}
                                                                <button
                                                                    type="button"
                                                                    onClick={() => addToTimeline(asset)}
                                                                    className="mt-2 flex h-7 w-full items-center justify-center gap-1 rounded-md bg-[var(--director-accent)] text-[11px] font-medium text-[var(--director-on-accent)] transition-colors hover:bg-[var(--director-accent-hover)]"
                                                                >
                                                                    <Plus className="size-3.5" />
                                                                    添加到时间线
                                                                </button>
                                                            </div>
                                                        ) : null}
                                                    </li>
                                                );
                                            })}
                                        </ul>
                                    ) : null}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/** 从 Axios 错误中提取后端业务信息（{ code, data, msg } 的 msg），无则返回 null。 */
function extractApiMessage(err: unknown): string | null {
    if (typeof err !== "object" || err === null) return null;
    const anyErr = err as { response?: { data?: { msg?: string } } };
    const msg = anyErr.response?.data?.msg;
    if (typeof msg === "string" && msg.trim()) return msg.trim();
    return null;
}
