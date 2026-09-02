// 资产导入（editor-shell 预设插件贡献 asset-ingest 插槽，M3.4）。
// 展示项目资产库，按来源区分「本地上传」与「项目素材」；点击资产 → makeClipFromAsset
// → dispatch addClip 加入时间线（添加到匹配 kind 的轨道末尾）。资产是
// "仅时间线作用域"直连媒体（nodeId=asset:<id>）。导入链路：uploadResourceFile →
// linkProjectAsset（后端按资源元数据合成资产记录）→ refreshAssets。

import { useEffect, useRef, useState } from "react";
import {
    Boxes,
    ChevronDown,
    ChevronRight,
    Clapperboard,
    Film,
    FolderOpen,
    HardDrive,
    Image as ImageIcon,
    Loader2,
    Music2,
    Plus,
} from "lucide-react";

import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { defaultAssetCategoryForKind } from "@/lib/asset-category";
import { makeClipFromAsset } from "@/lib/timeline/asset-ingest";
import { DEFAULT_AUDIO_TRACK_ID, DEFAULT_SUBTITLE_TRACK_ID, DEFAULT_VIDEO_TRACK_ID } from "@/lib/timeline/timeline-tracks";
import { linkProjectAsset } from "@/services/api/projects";
import { uploadResourceFile, type ResourceUploadMeta } from "@/services/api/resources";
import { resolveMediaUrl } from "@/services/file-storage";
import { probeMediaDurationMs } from "@/lib/media-metadata";
import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";


const MEDIA_ACCEPT = "video/*,audio/*,image/*";
const IMAGE_RE = /\.(png|jpe?g|webp|gif|avif)$/i;
const AUDIO_RE = /\.(mp3|wav|m4a|ogg|flac|aac)$/i;
const MEDIA_RE = /\.(mp4|mov|webm|mkv|m4v|avi)$/i;

/** 本地上传标记（assetFromUploadedResource 写入 payload.data.source）。 */
const SOURCE_UPLOADED = "uploaded";

type AssetFilter = "all" | "project" | "uploaded";

const FILTER_TABS: { id: AssetFilter; label: string }[] = [
    { id: "all", label: "全部" },
    { id: "project", label: "项目素材" },
    { id: "uploaded", label: "本地上传" },
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

/** 列表行小缩略图：有 storageKey 时加载真实媒体，否则类型图标占位。 */
function AssetThumb({ asset }: { asset: ProjectAsset }) {
    const [url, setUrl] = useState<string | null>(null);
    useEffect(() => {
        let alive = true;
        if (asset.storageKey) {
            resolveMediaUrl(asset.storageKey)
                .then((resolved) => alive && setUrl(resolved ?? null))
                .catch(() => alive && setUrl(null));
        }
        return () => {
            alive = false;
        };
    }, [asset.storageKey]);
    return (
        <div className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-md bg-[var(--director-control-hover)]">
            {url ? (
                <img src={url} alt="" className="size-full object-cover" />
            ) : (
                <div className="text-[var(--director-dock-fg)]/50">
                    <AssetIcon mediaType={asset.mediaType} />
                </div>
            )}
        </div>
    );
}

function SourceBadge({ source }: { source: string }) {
    const uploaded = source === SOURCE_UPLOADED;
    return (
        <span
            className={`rounded px-1 py-px text-[9px] leading-none ${
                uploaded
                    ? "bg-[var(--director-control-hover)] text-[var(--director-dock-fg-strong)]"
                    : "bg-[var(--director-control-hover)] text-[var(--director-dock-fg)]/70"
            }`}
        >
            {uploaded ? "本地上传" : "项目素材"}
        </span>
    );
}

export function EditorAssetIngest() {
    const { projectId, assets, refreshAssets } = useEditorHostContext();
    const { project, dispatch } = useEditorStoreContext();
    const [added, setAdded] = useState<string | null>(null);
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [filter, setFilter] = useState<AssetFilter>("all");
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [openGroups, setOpenGroups] = useState<{ uploaded: boolean; project: boolean }>({ uploaded: true, project: true });
    const inputRef = useRef<HTMLInputElement | null>(null);

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
        let failed = 0;
        try {
            // 逐文件导入：单文件失败不中断整批，汇总失败数提示。
            for (const { file, kind } of media) {
                try {
                    // 上传前探测真实时长（视频/音频），随 meta 入库供时间线片段使用。
                    const durationMs = await probeMediaDurationMs(file);
                    const resource = await uploadResourceFile(file, kind, durationMs !== undefined ? { durationMs } : undefined);
                    if (resource.status === "failed") {
                        failed += 1;
                        setImportError(resource.error || `「${file.name}」上传失败`);
                        continue;
                    }
                    await linkProjectAsset(projectId, { assetId: resource.id, category: defaultAssetCategoryForKind(kind), title: file.name });
                } catch (err) {
                    failed += 1;
                    const detail = extractApiMessage(err);
                    setImportError(detail ? `「${file.name}」${detail}` : `「${file.name}」导入失败`);
                }
            }
            if (failed === 0) await refreshAssets();
        } finally {
            setImporting(false);
        }
    };

    const addToTimeline = (asset: ProjectAsset) => {
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
    const projectAssets = assets.filter((a) => a.source !== SOURCE_UPLOADED);
    const groups: { id: "uploaded" | "project"; label: string; icon: typeof HardDrive; items: ProjectAsset[] }[] = [
        { id: "uploaded", label: "本地上传", icon: HardDrive, items: uploadedAssets },
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

            <div className="director-scroll min-h-0 flex-1 overflow-y-auto p-1.5">
                {assets.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <p className="text-xs text-[var(--director-dock-fg)]/60">项目暂无资产</p>
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
                                        className="flex w-full items-center gap-1 rounded-md px-1 py-1 text-left transition-colors hover:bg-[var(--director-control-hover)]"
                                    >
                                        <ChevronRight className={`size-3.5 shrink-0 text-[var(--director-dock-fg)]/50 transition-transform ${open ? "rotate-90" : ""}`} />
                                        <group.icon className="size-3.5 text-[var(--director-dock-fg)]/70" />
                                        <span className="text-[11px] font-medium text-[var(--director-dock-fg-strong)]">{group.label}</span>
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
                                                            className={`flex w-full items-center gap-2 rounded-md px-1 py-1 text-left transition-colors ${
                                                                added === asset.id ? "bg-[var(--director-accent)]/15" : "hover:bg-[var(--director-control-hover)]"
                                                            }`}
                                                        >
                                                            <AssetThumb asset={asset} />
                                                            <span className="min-w-0 flex-1">
                                                                <span className="block truncate text-[11px] text-[var(--director-dock-fg-strong)]">{asset.title || asset.storageKey}</span>
                                                                <span className="mt-0.5 flex items-center gap-1">
                                                                    <span className="text-[9px] uppercase text-[var(--director-dock-fg)]/60">{asset.mediaType}</span>
                                                                    <SourceBadge source={source} />
                                                                </span>
                                                            </span>
                                                            <ChevronDown className={`size-3.5 shrink-0 text-[var(--director-dock-fg)]/50 transition-transform ${expanded ? "rotate-180" : ""}`} />
                                                        </button>
                                                        {expanded ? (
                                                            <div className="mx-1 mb-1 ml-10 rounded-md bg-[var(--director-control-hover)] p-2">
                                                                <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                                                                    <dt className="text-[var(--director-dock-fg)]/60">媒体类型</dt>
                                                                    <dd className="truncate text-right capitalize text-[var(--director-dock-fg-strong)]">{asset.mediaType}</dd>
                                                                    <dt className="text-[var(--director-dock-fg)]/60">分类</dt>
                                                                    <dd className="truncate text-right text-[var(--director-dock-fg-strong)]">{asset.category}</dd>
                                                                    <dt className="text-[var(--director-dock-fg)]/60">来源</dt>
                                                                    <dd className="text-right text-[var(--director-dock-fg-strong)]">{source === SOURCE_UPLOADED ? "本地上传" : "项目素材"}</dd>
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
