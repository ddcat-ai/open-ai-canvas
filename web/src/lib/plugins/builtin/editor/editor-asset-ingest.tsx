// 资产导入（editor-shell 预设插件贡献 asset-ingest 插槽，M3.4）。
// 展示项目资产库，点击资产 → makeClipFromAsset → dispatch addClip 加入时间线
// （添加到匹配 kind 的轨道末尾）。资产是"仅时间线作用域"直连媒体（nodeId=asset:<id>）。

import { useEffect, useState } from "react";
import { Clapperboard, Film, Image as ImageIcon, Music2 } from "lucide-react";

import { useEditorHostContext, useEditorStoreContext } from "@/components/editor/editor-context";
import { makeClipFromAsset } from "@/lib/timeline/asset-ingest";
import { DEFAULT_AUDIO_TRACK_ID, DEFAULT_SUBTITLE_TRACK_ID, DEFAULT_VIDEO_TRACK_ID } from "@/lib/timeline/timeline-tracks";
import { resolveMediaUrl } from "@/services/file-storage";
import type { ProjectAsset } from "@/services/api/projects";
import type { TimelineProject } from "@/types/timeline";

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
    if (!url) return <div className="grid size-10 place-items-center text-foreground/35"><AssetIcon mediaType={asset.mediaType} /></div>;
    return <img src={url} alt="" className="size-10 rounded object-cover" />;
}

export function EditorAssetIngest() {
    const { assets } = useEditorHostContext();
    const { project, dispatch } = useEditorStoreContext();
    const [added, setAdded] = useState<string | null>(null);

    if (!project) return null;

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

    return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--workspace-surface)]">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-border/60 px-3">
                <span className="text-xs font-medium text-foreground/75">素材库</span>
                <span className="text-xs text-foreground/40">{assets.length}</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
                {assets.length === 0 ? (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                        <p className="text-xs text-foreground/45">项目暂无资产</p>
                        <p className="max-w-[180px] text-[11px] leading-relaxed text-foreground/35">素材库资产可点击加入时间线</p>
                    </div>
                ) : (
                    <ul className="space-y-1">
                        {assets.map((asset) => (
                            <li key={asset.id}>
                                <button
                                    type="button"
                                    onClick={() => addToTimeline(asset)}
                                    className={`flex w-full items-center gap-2.5 rounded-md border px-2 py-1.5 text-left transition-colors ${
                                        added === asset.id
                                            ? "border-[var(--workspace-accent)] bg-[var(--workspace-accent)]/15"
                                            : "border-transparent hover:border-border/60 hover:bg-foreground/4"
                                    }`}
                                >
                                    <AssetThumb asset={asset} />
                                    <div className="min-w-0 flex-1">
                                        <div className="truncate text-xs text-foreground/85">{asset.title || asset.storageKey}</div>
                                        <div className="text-[10px] uppercase text-foreground/40">{asset.mediaType}</div>
                                    </div>
                                    <span className="text-[10px] text-foreground/35">加入</span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
