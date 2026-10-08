import { Input } from "antd";
import { Check, ImagePlus, Loader2, Pause, Play, Search, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { getResourceAccess, resolveResourceAccessURL, resourceIdFromStorageKey } from "@/services/api/resources";
import { loadAssetLibraryPage } from "@/services/user-data-sync";
import type { AudioAsset, ImageAsset } from "@/stores/use-asset-store";

const PAGE_SIZE = { image: 18, audio: 20 } as const;

/** 素材库分页查询：只保留已同步到云端、可被角色卡绑定的素材，滚到底部自动加载下一页。 */
function useCharacterMediaPages<K extends "image" | "audio">(kind: K, keyword: string) {
    const query = useDebouncedValue(keyword.trim(), 250);
    const pages = useInfiniteQuery({
        queryKey: ["character-media-library", kind, query],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) => loadAssetLibraryPage({ page: pageParam, pageSize: PAGE_SIZE[kind], kind, status: "active", query: query || undefined, signal }),
        getNextPageParam: (page, all) => (all.reduce((count, item) => count + item.assets.length, 0) < page.total ? all.length + 1 : undefined),
    });
    const items = (pages.data?.pages.flatMap((page) => page.assets) || []).filter(
        (asset): asset is K extends "image" ? ImageAsset : AudioAsset => asset.kind === kind && Boolean(resourceIdFromStorageKey((asset as ImageAsset | AudioAsset).data.storageKey)),
    );
    const sentinelRef = useRef<HTMLDivElement>(null);
    const { hasNextPage, isFetchingNextPage, fetchNextPage } = pages;
    useEffect(() => {
        const target = sentinelRef.current;
        if (!target || !hasNextPage || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
            },
            { rootMargin: "160px" },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
    return { items, query, loading: pages.isLoading, loadingMore: isFetchingNextPage, sentinelRef };
}

function SearchField({ value, placeholder, onChange }: { value: string; placeholder: string; onChange: (value: string) => void }) {
    return <Input allowClear variant="filled" value={value} prefix={<Search className="size-3.5 text-foreground/40" />} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />;
}

function FilePicker({ accept, onFile, children }: { accept: string; onFile: (file: File) => void; children: (open: () => void) => ReactNode }) {
    const inputRef = useRef<HTMLInputElement>(null);
    return (
        <>
            {children(() => inputRef.current?.click())}
            <input
                ref={inputRef}
                type="file"
                accept={accept}
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) onFile(file);
                }}
            />
        </>
    );
}

function ListState({ loading, empty, loadingMore }: { loading: boolean; empty: string; loadingMore: boolean }) {
    if (loading) return <p className="py-10 text-center text-xs text-foreground/40">正在读取素材库</p>;
    if (empty) return <p className="py-10 text-center text-xs leading-5 text-foreground/40">{empty}</p>;
    return loadingMore ? <p className="py-4 text-center text-xs text-foreground/40">正在加载更多</p> : null;
}

/** 同一资源在当前画布上有节点时，用节点名（用户改过的名字）代替素材库里的默认标题。 */
export type CanvasMediaTitles = ReadonlyMap<string, string>;

/** 形象选择：缩略图网格，点选即绑定；第一格为本地上传。 */
export function CharacterImageLibrary({ currentResourceId, busyKey, canvasTitles, onPick, onUpload }: { currentResourceId: string; canvasTitles?: CanvasMediaTitles; busyKey: string; onPick: (resourceId: string) => void; onUpload: (file: File) => void }) {
    const [keyword, setKeyword] = useState("");
    const { items, query, loading, loadingMore, sentinelRef } = useCharacterMediaPages("image", keyword);
    return (
        <div className="space-y-4">
            <SearchField value={keyword} placeholder="搜索素材库图片" onChange={setKeyword} />
            <div className="grid grid-cols-3 gap-2.5">
                <FilePicker accept="image/*" onFile={onUpload}>
                    {(open) => (
                        <button
                            type="button"
                            onClick={open}
                            disabled={Boolean(busyKey)}
                            className="grid aspect-[3/4] place-items-center rounded-lg border border-dashed border-foreground/15 text-foreground/45 outline-none transition-colors hover:border-foreground/35 hover:text-foreground/75 focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] disabled:cursor-wait"
                        >
                            <span className="flex flex-col items-center gap-2 text-xs">{busyKey === "upload" ? <Loader2 className="size-5 animate-spin" /> : <ImagePlus className="size-5 stroke-[1.5]" />}上传本地图片</span>
                        </button>
                    )}
                </FilePicker>
                {items.map((asset) => {
                    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
                    const current = resourceId === currentResourceId;
                    const busy = busyKey === resourceId;
                    const title = canvasTitles?.get(resourceId) || asset.title;
                    return (
                        <button
                            key={asset.id}
                            type="button"
                            title={title}
                            aria-pressed={current}
                            disabled={Boolean(busyKey) || current}
                            onClick={() => onPick(resourceId)}
                            className={`group relative aspect-[3/4] overflow-hidden rounded-lg bg-foreground/[.05] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] disabled:cursor-default ${current ? "ring-2 ring-[var(--workspace-accent)] ring-offset-2 ring-offset-background" : ""}`}
                        >
                            <CachedResourceImage
                                storageKey={asset.data.storageKey}
                                src={asset.coverUrl}
                                variant="thumbnail"
                                alt={title}
                                className="h-full w-full object-cover transition-transform duration-300 [transition-timing-function:cubic-bezier(.16,1,.3,1)] group-hover:scale-[1.04] motion-reduce:transition-none"
                            />
                            <span className="pointer-events-none absolute inset-x-0 bottom-0 translate-y-1 bg-gradient-to-t from-black/75 to-transparent px-2 pb-1.5 pt-6 text-left text-[11px] text-white opacity-0 transition duration-200 group-hover:translate-y-0 group-hover:opacity-100">
                                <span className="block truncate">{title}</span>
                            </span>
                            {current ? (
                                <span className="absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-[var(--workspace-accent)] text-background">
                                    <Check className="size-3" />
                                </span>
                            ) : null}
                            {busy ? (
                                <span className="absolute inset-0 grid place-items-center bg-black/45 text-white">
                                    <Loader2 className="size-5 animate-spin" />
                                </span>
                            ) : null}
                        </button>
                    );
                })}
            </div>
            <ListState loading={loading} loadingMore={loadingMore} empty={!loading && !items.length ? (query ? "没有匹配的图片" : "素材库里还没有图片，可以直接上传本地图片") : ""} />
            <div ref={sentinelRef} />
        </div>
    );
}

/** 共用一个播放器试听，避免每行一个原生控件把列表挤乱。 */
function useAudition() {
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const [playing, setPlaying] = useState("");
    useEffect(() => () => audioRef.current?.pause(), []);
    const toggle = async (resourceId: string, storageKey?: string) => {
        const audio = audioRef.current || (audioRef.current = new Audio());
        if (playing === resourceId) {
            audio.pause();
            setPlaying("");
            return;
        }
        audio.pause();
        setPlaying(resourceId);
        try {
            audio.src = resolveResourceAccessURL((await getResourceAccess(storageKey, "display", "playback")).url);
            audio.onended = () => setPlaying("");
            await audio.play();
        } catch {
            setPlaying("");
        }
    };
    return { playing, toggle };
}

/** 声音选择：列表 + 单击试听，右侧“使用”即绑定。 */
export function CharacterVoiceLibrary({
    currentResourceId,
    busyKey,
    canvasTitles,
    onPick,
    onUpload,
}: {
    currentResourceId: string;
    canvasTitles?: CanvasMediaTitles;
    busyKey: string;
    onPick: (resourceId: string, title: string) => void;
    onUpload: (file: File) => void;
}) {
    const [keyword, setKeyword] = useState("");
    const { items, query, loading, loadingMore, sentinelRef } = useCharacterMediaPages("audio", keyword);
    const { playing, toggle } = useAudition();
    return (
        <div className="space-y-4">
            <div className="flex gap-2">
                <div className="min-w-0 flex-1">
                    <SearchField value={keyword} placeholder="搜索素材库音频" onChange={setKeyword} />
                </div>
                <FilePicker accept="audio/*" onFile={onUpload}>
                    {(open) => (
                        <button
                            type="button"
                            onClick={open}
                            disabled={Boolean(busyKey)}
                            aria-label="上传本地音频"
                            title="上传本地音频"
                            className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.05] text-foreground/60 outline-none transition-colors hover:bg-foreground/[.09] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] disabled:cursor-wait"
                        >
                            {busyKey === "upload" ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
                        </button>
                    )}
                </FilePicker>
            </div>
            <ul className="divide-y divide-border/60">
                {items.map((asset) => {
                    const resourceId = resourceIdFromStorageKey(asset.data.storageKey);
                    const current = resourceId === currentResourceId;
                    const seconds = asset.data.durationMs ? Math.round(asset.data.durationMs / 1000) : 0;
                    const title = canvasTitles?.get(resourceId) || asset.title;
                    return (
                        <li key={asset.id} className="group flex items-center gap-3 py-2.5">
                            <button
                                type="button"
                                onClick={() => void toggle(resourceId, asset.data.storageKey)}
                                aria-label={`${playing === resourceId ? "暂停" : "试听"} ${title}`}
                                className={`grid size-8 shrink-0 place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] ${playing === resourceId ? "bg-[var(--workspace-accent)] text-background" : "bg-foreground/[.06] text-foreground/70 hover:bg-foreground/[.1]"}`}
                            >
                                {playing === resourceId ? <Pause className="size-3.5" /> : <Play className="size-3.5 translate-x-px" />}
                            </button>
                            <span className="min-w-0 flex-1">
                                <span className="block truncate text-[13px] font-medium">{title}</span>
                                <span className="text-[11px] text-foreground/40">{seconds ? `${seconds} 秒` : "音频"}</span>
                            </span>
                            {current ? (
                                <span className="inline-flex items-center gap-1 text-xs font-medium text-foreground/70">
                                    <Check className="size-3.5" />
                                    使用中
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    disabled={Boolean(busyKey)}
                                    onClick={() => onPick(resourceId, title)}
                                    className="rounded-md px-2.5 py-1 text-xs font-medium text-foreground/55 opacity-0 outline-none transition hover:bg-foreground/[.07] hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-[var(--workspace-accent)] group-hover:opacity-100 disabled:cursor-wait"
                                >
                                    {busyKey === resourceId ? <Loader2 className="size-3.5 animate-spin" /> : "使用"}
                                </button>
                            )}
                        </li>
                    );
                })}
            </ul>
            <ListState loading={loading} loadingMore={loadingMore} empty={!loading && !items.length ? (query ? "没有匹配的音频" : "素材库里还没有音频，可以直接上传本地音频") : ""} />
            <div ref={sentinelRef} />
        </div>
    );
}
