import { memo, useEffect, useDeferredValue, useMemo, useRef, useState } from "react";
import { AudioLines, Box, ChevronDown, Copy, Download, FolderPlus, Image, Images, MoreHorizontal, Plus, RefreshCw, Trash2, Upload, X } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { normalizeAssetCategory } from "@/lib/asset-category";
import { resourceStorageLabel } from "@/lib/canvas/resource-storage-status";
import type { Asset } from "@/stores/use-asset-store";

export type LibraryAsset = Exclude<Asset, { kind: "entity" }>;

type AssetSubTab = "material" | "character" | "prop" | "environment" | "other";

const ASSET_SUB_TABS: Array<{ id: AssetSubTab; label: string }> = [
    { id: "material", label: "素材" },
    { id: "character", label: "角色" },
    { id: "environment", label: "场景" },
    { id: "prop", label: "道具" },
    { id: "other", label: "其他" },
];

type AssetTypeFilter = "all" | "text" | "image" | "video" | "audio";

const ASSET_TYPE_CHIPS: Array<{ id: AssetTypeFilter; label: string }> = [
    { id: "all", label: "全部" },
    { id: "image", label: "图片" },
    { id: "video", label: "视频" },
    { id: "audio", label: "音频" },
    { id: "text", label: "文本" },
];

export function CanvasWorkspaceAssetPanel({ assets, onInsertAssetImage, onRefresh, onAssetAction }: {
    assets: LibraryAsset[];
    onInsertAssetImage?: (asset: LibraryAsset) => void;
    onRefresh?: () => void;
    onAssetAction?: (action: "copy" | "download" | "archive" | "delete", asset: LibraryAsset) => void;
}) {
    const [subTab, setSubTab] = useState<AssetSubTab>("material");
    const [typeFilter, setTypeFilter] = useState<AssetTypeFilter>("all");
    const [query, setQuery] = useState("");
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());
    const uploadInputRef = useRef<HTMLInputElement>(null);

    const filteredAssets = useMemo(() => {
        let result = assets.filter((asset) => normalizeAssetCategory(asset.category, "material") === subTab);
        if (typeFilter !== "all") {
            result = result.filter((asset) => asset.kind === typeFilter);
        }
        if (deferredQuery) {
            result = result.filter((asset) => [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(deferredQuery));
        }
        return result;
    }, [assets, subTab, typeFilter, deferredQuery]);

    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <Images className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">资产</span>
                <span className="tabular-nums text-foreground/32">{filteredAssets.length.toLocaleString("zh-CN")}</span>
            </header>

            <div className="sidebar-subtabs shrink-0 border-b border-border/70">
                {ASSET_SUB_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={subTab === tab.id ? "active" : ""}
                        aria-pressed={subTab === tab.id}
                        onClick={() => setSubTab(tab.id)}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="asset-filters shrink-0 border-b border-border/70 px-2 py-1.5">
                <div className="asset-type-chips">
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            selectedKeys: [typeFilter],
                            onClick: ({ key }) => setTypeFilter(key as AssetTypeFilter),
                            items: ASSET_TYPE_CHIPS.map((chip) => ({ key: chip.id, label: chip.label })),
                        }}
                    >
                        <button type="button" className="type-chip on">
                            {ASSET_TYPE_CHIPS.find((chip) => chip.id === typeFilter)?.label || "全部"}
                            <ChevronDown className="size-3 opacity-50" />
                        </button>
                    </Dropdown>
                    <span className="asset-head-actions">
                        {/* <button type="button" className="icon-btn tip-down" data-tip="新建文件夹" aria-label="新建文件夹">
                            <FolderPlus className="size-3.5" />
                        </button>
                        <button type="button" className="icon-btn tip-down" data-tip="上传素材" aria-label="上传素材" onClick={() => uploadInputRef.current?.click()}>
                            <Upload className="size-3.5" />
                        </button> */}
                        <button type="button" className="icon-btn tip-down" data-tip="刷新" aria-label="刷新" onClick={onRefresh}>
                            <RefreshCw className="size-3.5" />
                        </button>
                    </span>
                </div>
                <div className="asset-filter-row mt-1.5">
                    <input
                        className="asset-search"
                        placeholder="搜索名称/标签"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label="搜索资产"
                    />
                    {query ? (
                        <button type="button" className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" onClick={() => setQuery("")} aria-label="清空搜索">
                            <X className="size-3" />
                        </button>
                    ) : null}
                </div>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain py-1">
                {filteredAssets.length ? (
                    <div className="space-y-0.5">
                        {filteredAssets.map((asset) => (
                            <AssetListItem
                                key={asset.id}
                                asset={asset}
                                onInsert={onInsertAssetImage}
                                onAction={onAssetAction}
                            />
                        ))}
                    </div>
                ) : (
                    <WorkspaceState icon="canvas" compact title="没有匹配资产" description="换一个分类或关键词继续搜索。" />
                )}
            </div>

            <input
                ref={uploadInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => { event.target.value = ""; }}
            />
        </>
    );
}

const AssetListItem = memo(function AssetListItem({ asset, onInsert, onAction }: { asset: LibraryAsset; onInsert?: (asset: LibraryAsset) => void; onAction?: (action: "copy" | "download" | "archive" | "delete", asset: LibraryAsset) => void }) {
    const [failed, setFailed] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const storageLabel = asset.kind !== "text" ? resourceStorageLabel(asset.data.storageKey) : "";
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };
    const imgClass = "h-9 w-11 rounded-[var(--r-sm)] border object-cover";

    useEffect(() => {
        if (!menuOpen) return;
        const handler = (e: PointerEvent) => {
            const target = e.target instanceof Element ? e.target : null;
            if (target && !rootRef.current?.contains(target) && !target.closest(".ant-dropdown")) {
                setMenuOpen(false);
            }
        };
        document.addEventListener("pointerdown", handler, true);
        return () => document.removeEventListener("pointerdown", handler, true);
    }, [menuOpen]);

    const menuItems: MenuProps["items"] = useMemo(() => {
        const items: NonNullable<MenuProps["items"]> = [];
        items.push({ key: "insert", icon: <Plus className="size-3.5" />, label: "插入画布", onClick: () => onInsert?.(asset) });
        if (asset.kind === "text") {
            items.push({ key: "copy", icon: <Copy className="size-3.5" />, label: "复制文本", onClick: () => onAction?.("copy", asset) });
        }
        if (asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model") {
            items.push({ key: "download", icon: <Download className="size-3.5" />, label: "下载", onClick: () => onAction?.("download", asset) });
        }
        items.push({ type: "divider" as const });
        items.push({ key: "archive", icon: <Trash2 className="size-3.5 text-amber-500" />, label: "移入回收站", onClick: () => onAction?.("archive", asset) });
        items.push({ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "彻底删除", onClick: () => onAction?.("delete", asset) });
        return items;
    }, [asset, onInsert, onAction]);

    return (
        <div
            ref={rootRef}
            className="group relative grid w-full grid-cols-[44px_minmax(0,1fr)] items-center gap-2 rounded-[var(--r-md)] px-2 py-1.5 text-left transition-[background-color] hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-primary/35"
            style={{ contentVisibility: "auto", containIntrinsicSize: "48px" }}
        >
            <div
                className="grid h-9 w-11 shrink-0 place-items-center overflow-hidden rounded-[var(--r-sm)] border"
                style={commonStyle}
                aria-hidden="true"
            >
                {asset.kind === "image" ? (
                    (asset.coverUrl || asset.data.dataUrl) && !failed ? (
                        <img src={asset.coverUrl || asset.data.dataUrl} alt="" width={44} height={36} loading="lazy" decoding="async" className={imgClass} style={commonStyle} onError={() => setFailed(true)} />
                    ) : (
                        <Image className="size-3.5 text-foreground/45" />
                    )
                ) : asset.kind === "video" ? (
                    asset.coverUrl && !failed ? (
                        <img src={asset.coverUrl} alt="" width={44} height={36} loading="lazy" decoding="async" className={imgClass} style={commonStyle} onError={() => setFailed(true)} />
                    ) : (
                        <CanvasVideoIcon className="size-3.5 text-foreground/45" />
                    )
                ) : asset.kind === "text" ? (
                    <span aria-hidden="true" className="line-clamp-3 w-full px-1 py-0.5 text-[7px] leading-[10px] text-foreground/55">{asset.data.content || "空白文本"}</span>
                ) : asset.kind === "audio" ? (
                    <AudioLines className="size-3.5 text-foreground/45" />
                ) : (
                    <Box className="size-3.5 text-foreground/45" />
                )}
            </div>
            <div className="min-w-0 self-center flex-1">
                <span className="block truncate text-xs font-medium leading-4 text-foreground" title={asset.title}>{asset.title}</span>
                <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[10px] leading-3 text-foreground/40">
                    <span className="truncate">{storageLabel}</span>
                    {asset.tags?.length ? <span className="truncate" title={asset.tags.join(", ")}>· {asset.tags[0]}</span> : null}
                </span>
            </div>
            <Dropdown trigger={["click"]} menu={{ items: menuItems }} open={menuOpen} onOpenChange={setMenuOpen}>
                <button
                    type="button"
                    className="asset-more absolute right-1 top-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover:opacity-100"
                    aria-label="更多操作"
                    title="更多"
                >
                    <MoreHorizontal className="size-3.5" />
                </button>
            </Dropdown>
        </div>
    );
});

export function CanvasVideoIcon({ className }: { className?: string }) {
    return (
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
            <rect x="2" y="6" width="14" height="12" rx="2" />
            <path d="m22 8-6 4 6 4V8Z" />
        </svg>
    );
}
