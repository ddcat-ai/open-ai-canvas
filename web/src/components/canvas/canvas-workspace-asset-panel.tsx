import { useEffect, useState } from "react";
import { App, Button } from "antd";
import { useInfiniteQuery } from "@tanstack/react-query";
import { FileText, Images, Plus, RefreshCw } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { ASSET_CATEGORY_LABELS, type AssetCategory } from "@/lib/asset-category";
import { resourceStorageLabel } from "@/lib/canvas/resource-storage-status";
import { loadAssetLibraryPage } from "@/services/user-data-sync";
import { useUserStore } from "@/stores/use-user-store";
import type { Asset } from "@/stores/use-asset-store";
import { assetPickerItemsToInsertPayloads, type InsertAssetPayload } from "./asset-picker-modal";
import { Select } from "@/components/ui/base/select";

const categories: AssetCategory[] = ["material", "character", "environment", "prop", "other"];
export function CanvasWorkspaceAssetPanel({ onInsert, onManage, onProjectAssets }: { onInsert: (payloads: InsertAssetPayload[]) => Promise<unknown>; onManage: () => void; onProjectAssets?: () => void }) {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const [category, setCategory] = useState<AssetCategory>("material");
    const [kind, setKind] = useState("all");
    const [input, setInput] = useState("");
    const [search, setSearch] = useState("");
    const [inserting, setInserting] = useState<string | null>(null);
    useEffect(() => {
        const timer = window.setTimeout(() => setSearch(input.trim()), 250);
        return () => window.clearTimeout(timer);
    }, [input]);
    const query = useInfiniteQuery({
        queryKey: ["canvas-workspace-assets", userId, category, kind, search],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) => loadAssetLibraryPage({ page: pageParam, pageSize: 40, category, kind: kind === "all" ? undefined : kind, status: "active", query: search, signal }),
        getNextPageParam: (page, pages) => (pages.reduce((count, item) => count + item.assets.length, 0) < page.total ? pages.length + 1 : undefined),
        enabled: Boolean(userId) && hydrated,
    });
    const assets = query.data?.pages.flatMap((page) => page.assets) ?? [];
    const insert = async (asset: Asset) => {
        if (inserting) return;
        setInserting(asset.id);
        try {
            const payloads = assetPickerItemsToInsertPayloads([asset.id], [{ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: asset.kind, asset }]);
            await onInsert(payloads);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "插入素材失败");
        } finally {
            setInserting(null);
        }
    };
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                <Images className="size-4" />
                <strong className="text-sm">资产</strong>
                <span className="text-muted-foreground">{query.data?.pages[0]?.total ?? 0}</span>
            </header>
            <div className="sidebar-subtabs border-b border-border p-2">
                {categories.map((id) => (
                    <button key={id} type="button" className={category === id ? "active" : ""} aria-pressed={category === id} onClick={() => setCategory(id)}>
                        {ASSET_CATEGORY_LABELS[id]}
                    </button>
                ))}
            </div>
            <div className="space-y-2 border-b border-border p-3">
                <div className="flex items-center justify-between gap-2">
                    <Select
                        aria-label="素材类型"
                        value={kind}
                        onChange={setKind}
                        options={[
                            { value: "all", label: "全部" },
                            { value: "image", label: "图片" },
                            { value: "video", label: "视频" },
                            { value: "audio", label: "音频" },
                            { value: "text", label: "文本" },
                        ]}
                    />
                    <Button type="text" aria-label="刷新资产" loading={query.isFetching} icon={<RefreshCw className="size-4" />} onClick={() => void query.refetch()} />
                </div>
                <input className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm" aria-label="搜索资产名称或标签" placeholder="搜索名称/标签" value={input} onChange={(event) => setInput(event.target.value)} />
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {!userId ? (
                    <p className="p-3 text-sm">登录后查看资产。</p>
                ) : query.isPending ? (
                    <p role="status" className="p-3 text-sm">
                        正在加载资产…
                    </p>
                ) : null}
                {query.isError ? (
                    <div role="alert" className="p-3 text-sm">
                        资产读取失败，已加载的内容仍保留。<Button onClick={() => void query.refetch()}>重试</Button>
                    </div>
                ) : null}
                {assets.map((asset) => {
                    const insertable = ["image", "video", "audio", "text"].includes(asset.kind);
                    const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "");
                    return (
                        <div key={asset.id} className="group flex items-center gap-2 rounded-md p-2 hover:bg-surface-hover">
                            <div className="grid h-11 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border">
                                <CachedResourceImage src={cover} storageKey={asset.kind === "image" ? asset.data.storageKey : undefined} alt="" className="h-full w-full object-cover" fallback={<FileText className="size-4 text-muted-foreground" />} />
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-sm" title={asset.title}>
                                    {asset.title}
                                </div>
                                <div className="truncate text-xs text-muted-foreground">
                                    {resourceStorageLabel("storageKey" in asset.data ? asset.data.storageKey : undefined)}
                                    {asset.tags?.length ? ` · ${asset.tags[0]}` : ""}
                                </div>
                            </div>
                            <Button
                                type="text"
                                size="small"
                                aria-label={`插入画布：${asset.title}`}
                                title={insertable ? "插入画布" : "此类型请在素材库中查看"}
                                disabled={!insertable || Boolean(inserting)}
                                loading={inserting === asset.id}
                                icon={<Plus className="size-4" />}
                                onClick={() => void insert(asset)}
                            />
                        </div>
                    );
                })}
                {query.isSuccess && !assets.length ? <WorkspaceState icon="canvas" compact title="没有匹配的资产" description="换个分类或搜索条件试试。" /> : null}
                {query.hasNextPage ? (
                    <Button block loading={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
                        加载更多
                    </Button>
                ) : null}
            </div>
            <footer className="flex shrink-0 gap-2 border-t border-border p-2">
                <Button size="small" onClick={onManage}>
                    管理素材
                </Button>
                {onProjectAssets ? (
                    <Button size="small" onClick={onProjectAssets}>
                        项目素材
                    </Button>
                ) : null}
            </footer>
        </>
    );
}
