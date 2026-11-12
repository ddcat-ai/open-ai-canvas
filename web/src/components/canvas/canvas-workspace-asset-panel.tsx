import { useEffect, useState } from "react";
import { App, Button, Modal } from "antd";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { FileText, Images, Plus, RefreshCw } from "lucide-react";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { ASSET_CATEGORY_LABELS, type AssetCategory } from "@/lib/asset-category";
import { resourceStorageLabel } from "@/lib/canvas/resource-storage-status";
import { loadAssetLibraryPage } from "@/services/user-data-sync";
import { fetchOfficialAssetReference, fetchOfficialAssets, type OfficialAsset } from "@/services/api/official-assets";
import { resolveMediaUrl } from "@/services/file-storage";
import { resourceFileUrl } from "@/services/api/resources";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";
import { CanvasCharacterReferenceModal } from "./canvas-character-reference-modal";
import { useUserStore } from "@/stores/use-user-store";
import type { Asset } from "@/stores/use-asset-store";
import { assetPickerItemsToInsertPayloads, officialAssetToInsertPayload, type InsertAssetPayload } from "./asset-picker-modal";
import { Select } from "@/components/ui/base/select";
import { CanvasWorkspacePersonalAssetPreview, personalAssetIcon } from "./canvas-workspace-personal-asset-preview";
import { CanvasWorkspaceVideoThumbnail } from "./canvas-workspace-video-thumbnail";

const categories: AssetCategory[] = ["material", "character", "environment", "prop", "other"];

function OfficialAssetPreview({ asset, onClose }: { asset: OfficialAsset | null; onClose: () => void }) {
    const reference = useQuery({
        queryKey: ["canvas-official-asset-preview", asset?.id],
        queryFn: () => fetchOfficialAssetReference(asset!.id),
        enabled: Boolean(asset),
    });
    const media = useQuery({
        queryKey: ["canvas-official-asset-preview-media", asset?.id, reference.data?.storageKey],
        queryFn: () => resolveMediaUrl(reference.data!.storageKey, ""),
        enabled: Boolean(asset && reference.data?.storageKey && (asset.mediaType === "video" || asset.mediaType === "audio")),
    });
    const playable = asset?.mediaType === "video" || asset?.mediaType === "audio";
    const loading = reference.isLoading || (playable && Boolean(reference.data?.storageKey) && media.isLoading);
    const character = reference.data?.character;
    const images = character?.representations || [];
    const cover =
        images.find((item) => item.role === "turnaround_sheet" && item.resourceId) ||
        images.find((item) => item.role === "primary" && item.resourceId) ||
        images.find((item) => item.role === "front" && item.resourceId) ||
        images.find((item) => item.resourceId);
    const characterNode: CanvasNodeData | null =
        asset?.mediaType === "entity" && character
            ? {
                  id: `official-preview-${asset.id}`,
                  type: CanvasNodeType.Text,
                  title: reference.data?.title || asset.title,
                  position: { x: 0, y: 0 },
                  width: 0,
                  height: 0,
                  metadata: {
                      officialAssetId: asset.id,
                      characterName: reference.data?.title || asset.title,
                      characterDefinition: character.definition,
                      characterCoverUrl: cover?.resourceId ? resourceFileUrl(cover.resourceId) : asset.coverStorageKey,
                      characterVoiceName: character.voice?.profile?.name,
                      characterVoiceSampleResourceId: character.voice?.profile?.sampleResourceId,
                  },
              }
            : null;
    if (characterNode) return <CanvasCharacterReferenceModal node={characterNode} open onClose={onClose} />;
    return (
        <Modal open={Boolean(asset)} title={asset?.title || "素材预览"} footer={null} onCancel={onClose} destroyOnHidden>
            {asset && loading ? <p role="status">正在加载素材…</p> : null}
            {asset && (reference.isError || media.isError || (playable && media.isSuccess && !media.data)) ? <p role="alert">无法加载素材，请检查文件是否可访问。</p> : null}
            {asset && reference.data && asset.mediaType === "entity" && !character ? <p role="alert">角色卡资料不完整，无法预览详情。</p> : null}
            {asset && reference.data && asset.mediaType === "image" ? (
                <div className="flex min-h-32 justify-center">
                    <CachedResourceImage
                        src={reference.data.storageKey || asset.coverStorageKey}
                        storageKey={reference.data.storageKey || asset.coverStorageKey}
                        alt={asset.title}
                        eager
                        className="max-h-[65vh] max-w-full object-contain"
                        fallback={<p role="alert">图片资源不可用</p>}
                    />
                </div>
            ) : null}
            {asset && media.data && asset.mediaType === "video" ? <video aria-label={asset.title} controls playsInline preload="metadata" src={media.data} className="max-h-[65vh] max-w-full" /> : null}
            {asset && media.data && asset.mediaType === "audio" ? <audio aria-label={asset.title} controls preload="metadata" src={media.data} className="w-full" /> : null}
            {asset && reference.data && !loading && !reference.data.storageKey && asset.mediaType !== "entity" ? <p role="alert">素材资源不可用</p> : null}
        </Modal>
    );
}

export function CanvasWorkspaceAssetPanel({ onInsert, onManage, onProjectAssets }: { onInsert: (payloads: InsertAssetPayload[]) => Promise<unknown>; onManage: () => void; onProjectAssets?: () => void }) {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const hydrated = useUserStore((state) => state.hydrated);
    const [category, setCategory] = useState<AssetCategory>("material");
    const [source, setSource] = useState<"personal" | "official">("personal");
    const [kind, setKind] = useState("all");
    const [input, setInput] = useState("");
    const [search, setSearch] = useState("");
    const [previewAsset, setPreviewAsset] = useState<Asset | null>(null);
    const [previewOfficialAsset, setPreviewOfficialAsset] = useState<OfficialAsset | null>(null);
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
    const officialQuery = useInfiniteQuery({
        queryKey: ["canvas-workspace-official-assets", userId, category, kind, search],
        initialPageParam: 1,
        queryFn: ({ signal, pageParam }) =>
            fetchOfficialAssets(
                {
                    page: pageParam,
                    pageSize: 40,
                    q: search || undefined,
                    mediaType: kind === "image" || kind === "video" ? kind : "all",
                    category,
                },
                signal,
            ),
        getNextPageParam: (page) => (page.hasMore ? page.page + 1 : undefined),
        enabled: Boolean(userId) && hydrated && source === "official",
    });
    const assets = query.data?.pages.flatMap((page) => page.assets) ?? [];
    const officialAssets = officialQuery.data?.pages.flatMap((page) => page.items) ?? [];
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
    const insertOfficial = async (asset: OfficialAsset) => {
        if (inserting) return;
        setInserting(asset.id);
        try {
            await onInsert([await officialAssetToInsertPayload(asset)]);
            message.success("官方素材已直接引用到画布");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "插入官方素材失败");
        } finally {
            setInserting(null);
        }
    };
    const displayedTotal = source === "official" ? (officialQuery.data?.pages[0]?.total ?? 0) : (query.data?.pages[0]?.total ?? 0);
    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                <Images className="size-4" />
                <strong className="text-sm">资产</strong>
                <span className="text-muted-foreground">{displayedTotal}</span>
            </header>
            <div className="sidebar-subtabs border-b border-border p-2" role="tablist" aria-label="资产来源">
                <button type="button" className={source === "personal" ? "active" : ""} aria-selected={source === "personal"} role="tab" onClick={() => setSource("personal")}>
                    个人资产
                </button>
                <button type="button" className={source === "official" ? "active" : ""} aria-selected={source === "official"} role="tab" onClick={() => setSource("official")}>
                    官方素材
                </button>
            </div>
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
                    <Button
                        type="text"
                        aria-label="刷新资产"
                        loading={source === "official" ? officialQuery.isFetching : query.isFetching}
                        icon={<RefreshCw className="size-4" />}
                        onClick={() => void (source === "official" ? officialQuery.refetch() : query.refetch())}
                    />
                </div>
                <input className="w-full rounded-md border border-border bg-transparent px-2 py-2 text-sm" aria-label="搜索资产名称或标签" placeholder="搜索名称/标签" value={input} onChange={(event) => setInput(event.target.value)} />
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {!userId ? (
                    <p className="p-3 text-sm">登录后查看资产。</p>
                ) : (source === "official" ? officialQuery.isPending : query.isPending) ? (
                    <p role="status" className="p-3 text-sm">
                        正在加载资产…
                    </p>
                ) : null}
                {(source === "official" ? officialQuery.isError : query.isError) ? (
                    <div role="alert" className="p-3 text-sm">
                        资产读取失败，已加载的内容仍保留。<Button onClick={() => void (source === "official" ? officialQuery.refetch() : query.refetch())}>重试</Button>
                    </div>
                ) : null}
                {source === "official"
                    ? officialAssets.map((asset) => {
                          return (
                              <div key={asset.id} className="group flex items-center gap-2 rounded-md p-2 hover:bg-surface-hover">
                                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`预览素材：${asset.title}`} onClick={() => setPreviewOfficialAsset(asset)}>
                                      <span className="grid h-11 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border">
                                          {asset.mediaType === "video" ? (
                                              <CanvasWorkspaceVideoThumbnail coverStorageKey={asset.coverStorageKey} videoStorageKey={asset.coverStorageKey} />
                                          ) : (
                                              <CachedResourceImage src={asset.coverStorageKey} storageKey={asset.coverStorageKey} alt="" className="h-full w-full object-cover" fallback={<FileText className="size-4 text-muted-foreground" />} />
                                          )}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm" title={asset.title}>
                                              {asset.title}
                                          </span>
                                          <span className="block truncate text-xs text-muted-foreground">{{ video: "视频", audio: "音频", entity: "角色卡", image: "图片" }[asset.mediaType]} · 官方素材</span>
                                      </span>
                                  </button>
                                  <Button
                                      type="text"
                                      size="small"
                                      aria-label={`插入画布：${asset.title}`}
                                      title="插入画布"
                                      disabled={Boolean(inserting)}
                                      loading={inserting === asset.id}
                                      icon={<Plus className="size-4" />}
                                      onClick={() => void insertOfficial(asset)}
                                  />
                              </div>
                          );
                      })
                    : assets.map((asset) => {
                          const insertable = ["image", "video", "audio", "text"].includes(asset.kind);
                          const KindIcon = personalAssetIcon(asset.kind);
                          const coverStorageKey = asset.kind === "entity" ? asset.data.coverStorageKey : asset.kind === "image" ? asset.data.storageKey : undefined;
                          const cover = asset.coverUrl || (asset.kind === "image" ? asset.data.dataUrl : "") || coverStorageKey || "";
                          return (
                              <div key={asset.id} className="group flex items-center gap-2 rounded-md p-2 hover:bg-surface-hover">
                                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" aria-label={`预览素材：${asset.title}`} onClick={() => setPreviewAsset(asset)}>
                                      <span className="grid h-11 w-14 shrink-0 place-items-center overflow-hidden rounded-md border border-border">
                                          {asset.kind === "video" ? (
                                              <CanvasWorkspaceVideoThumbnail cover={asset.coverUrl && asset.coverUrl !== asset.data.url ? asset.coverUrl : undefined} videoStorageKey={asset.data.storageKey} videoUrl={asset.data.url} />
                                          ) : (
                                              <CachedResourceImage src={cover} storageKey={coverStorageKey} alt="" className="h-full w-full object-cover" fallback={<KindIcon className="size-4 text-muted-foreground" />} />
                                          )}
                                      </span>
                                      <span className="min-w-0 flex-1">
                                          <span className="block truncate text-sm" title={asset.title}>
                                              {asset.title}
                                          </span>
                                          <span className="block truncate text-xs text-muted-foreground">
                                              {asset.kind === "entity" ? "角色卡" : resourceStorageLabel("storageKey" in asset.data ? asset.data.storageKey : undefined)}
                                              {asset.tags?.length ? ` · ${asset.tags[0]}` : ""}
                                          </span>
                                      </span>
                                  </button>
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
                {(source === "official" ? officialQuery.isSuccess && !officialAssets.length : query.isSuccess && !assets.length) ? <WorkspaceState icon="canvas" compact title="没有匹配的资产" description="换个分类或搜索条件试试。" /> : null}
                {(source === "official" ? officialQuery.hasNextPage : query.hasNextPage) ? (
                    <Button block loading={source === "official" ? officialQuery.isFetchingNextPage : query.isFetchingNextPage} onClick={() => void (source === "official" ? officialQuery.fetchNextPage() : query.fetchNextPage())}>
                        加载更多
                    </Button>
                ) : null}
            </div>
            <CanvasWorkspacePersonalAssetPreview asset={previewAsset} onClose={() => setPreviewAsset(null)} />
            <OfficialAssetPreview asset={previewOfficialAsset} onClose={() => setPreviewOfficialAsset(null)} />
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
