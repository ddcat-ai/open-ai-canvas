// 素材库卡片与封面：图片/视频/音频/文本/3D 各自的封面渲染、选中态与卡片菜单。
//
// 纯展示组件，数据与操作回调由素材库页面传入。

import { Dropdown, type MenuProps } from "antd";
import { AlertTriangle, AudioLines, Box, Copy, Download, FileText, FolderOpen, MoreHorizontal, PencilLine, Play, RotateCcw, Trash2 } from "lucide-react";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { type AssetKind } from "@/stores/use-asset-store";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AudioPlayButton, CharacterAssetCover } from "@/components/assets/asset-rich-cover";
import { assetCategoryLabel } from "@/lib/asset-category";
import { type LibraryAsset, assetKindIcons } from "./asset-library-format";
import { assetKindLabel, assetProjectLabel, assetSummary, formatAssetClock, formatAssetTime } from "./asset-library-format";

export function formatExpirationHint(updatedAt: string, retentionDays: number) {
    if (!retentionDays || retentionDays <= 0) return "永久保留";
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) return `保留 ${retentionDays} 天`;
    const expireTime = updatedTime + retentionDays * 24 * 60 * 60 * 1000;
    const remainingMs = expireTime - Date.now();
    const remainingDays = Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
    if (remainingDays <= 0) return "即将彻底清除";
    if (remainingDays === 1) return "剩余 1 天过期";
    return `剩余 ${remainingDays} 天过期`;
}

export function formatExpirationDate(updatedAt: string, retentionDays: number) {
    if (!retentionDays || retentionDays <= 0) return "永久保留";
    const updatedTime = new Date(updatedAt).getTime();
    if (!Number.isFinite(updatedTime)) return "";
    const expireDate = new Date(updatedTime + retentionDays * 24 * 60 * 60 * 1000);
    return `预计于 ${expireDate.getFullYear()}-${String(expireDate.getMonth() + 1).padStart(2, "0")}-${String(expireDate.getDate()).padStart(2, "0")} 彻底清除`;
}

export function AssetCard({
    asset,
    selected,
    isTrash = false,
    retentionDays = 30,
    onSelect,
    onOpen,
    onEdit,
    onCopy,
    onDownload,
    onRestore,
    onArchive,
    onDelete,
    folderOptions,
    onMoveToFolder,
}: {
    asset: LibraryAsset;
    selected: boolean;
    isTrash?: boolean;
    retentionDays?: number;
    onSelect: (selected: boolean) => void;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
    onRestore?: () => void;
    onArchive?: () => void;
    onDelete: () => void;
    folderOptions: Array<{ label: string; value: string }>;
    onMoveToFolder: (folderId: string) => void;
}) {
    const summary = assetSummary(asset);
    const menuItems: MenuProps["items"] = isTrash
        ? [{ key: "restore", icon: <RotateCcw className="size-3.5" />, label: "还原到素材库", onClick: onRestore }, { type: "divider" as const }, { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "彻底删除", onClick: onDelete }]
        : [
              ...(asset.kind === "text" || asset.kind === "image" ? [{ key: "edit", icon: <PencilLine className="size-3.5" />, label: "编辑", onClick: onEdit }] : []),
              ...(asset.kind === "text" ? [{ key: "copy", icon: <Copy className="size-3.5" />, label: "复制文本", onClick: () => void onCopy(asset) }] : []),
              ...(asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? [{ key: "download", icon: <Download className="size-3.5" />, label: "下载", onClick: () => onDownload(asset) }] : []),
              { key: "move", icon: <FolderOpen className="size-3.5" />, label: "移动到分类", children: folderOptions.map((folder) => ({ key: folder.value || "uncategorized", label: folder.label, onClick: () => onMoveToFolder(folder.value) })) },
              { type: "divider" as const },
              { key: "archive", icon: <Trash2 className="size-3.5 text-amber-500" />, label: "移入回收站", onClick: onArchive },
              { key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "彻底删除", onClick: onDelete },
          ];
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} isTrash={isTrash} onSelect={onSelect} onOpen={onOpen} menuItems={menuItems} />
            <button type="button" className="asset-collection-body block w-full px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={onOpen}>
                <div className="flex min-w-0 items-center justify-between gap-2">
                    <h2 className="truncate text-[var(--fs-body)] font-semibold text-foreground" title={asset.title}>
                        {asset.title}
                    </h2>
                    <span className="asset-collection-date shrink-0 tabular-nums">{formatAssetTime(asset.updatedAt)}</span>
                </div>
                {isTrash ? (
                    <div className="mt-1 flex items-center gap-1 text-[var(--fs-tiny)] font-medium text-amber-600 dark:text-amber-400" title={formatExpirationDate(asset.updatedAt, retentionDays)}>
                        <AlertTriangle className="size-3 shrink-0" />
                        <span>{formatExpirationHint(asset.updatedAt, retentionDays)}</span>
                    </div>
                ) : (
                    <div className="asset-collection-summary mt-1 truncate" title={summary}>
                        {summary}
                    </div>
                )}
                <div className="asset-collection-source mt-1 flex min-w-0 items-center gap-1.5">
                    <span className="truncate">{asset.source || "未标注来源"}</span>
                    <span aria-hidden="true">·</span>
                    <span className="truncate">{assetProjectLabel(asset)}</span>
                </div>
            </button>
        </AssetLibraryCard>
    );
}

export function isKnownAssetKind(kind: unknown): kind is AssetKind {
    return kind === "image" || kind === "video" || kind === "audio" || kind === "model" || kind === "text" || kind === "entity";
}

export function AssetCover({ asset, selected, isTrash = false, onSelect, onOpen, menuItems }: { asset: LibraryAsset; selected: boolean; isTrash?: boolean; onSelect: (selected: boolean) => void; onOpen: () => void; menuItems: MenuProps["items"] }) {
    const kind = isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = kind ? assetKindIcons[kind] : FileText;
    const clock = asset.kind === "video" || asset.kind === "audio" ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={`查看素材：${asset.title}`}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "entity" ? (
                    <CharacterAssetCover asset={asset} />
                ) : asset.kind === "text" ? (
                    <TextCover asset={asset} />
                ) : asset.kind === "model" ? (
                    <ModelCover asset={asset} />
                ) : (
                    <AssetMediaPreview
                        asset={asset}
                        alt={asset.title}
                        className="assets-cover-media"
                        fallback={
                            <div className="assets-cover-fallback">
                                <KindIcon className="size-7" />
                            </div>
                        }
                    />
                )}
                <span className="assets-cover-vignette" aria-hidden="true" />
                {showPlay ? (
                    <span className="assets-cover-play">
                        <Play className="size-4" />
                    </span>
                ) : null}
            </button>
            <span className="assets-cover-badges">
                <span className="assets-cover-badge is-kind">
                    <KindIcon />
                    {kind ? assetKindLabel(kind) : "素材"}
                </span>
                {isTrash ? <span className="assets-cover-badge is-category !bg-amber-500/85 !text-white">回收站</span> : asset.kind === "entity" ? null : <span className="assets-cover-badge is-category">{assetCategoryLabel(asset.category)}</span>}
                {asset.portraitCertified ? <span className="assets-cover-badge is-category">人像认证</span> : null}
            </span>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            {asset.kind === "audio" && !isTrash ? <AudioPlayButton asset={asset} className="absolute bottom-2 left-2" /> : null}
            <input type="checkbox" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelect(event.target.checked)} className="assets-select-check" aria-label={`选择 ${asset.title}`} />
            <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                <button type="button" className="assets-cover-more" aria-label="更多素材操作" title="更多操作">
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </AssetLibraryCardMedia>
    );
}

export function AudioWaveCover({ asset }: { asset: LibraryAsset & { kind: "audio" } }) {
    const bars = audioWaveBars(asset.id);
    return (
        <div className="assets-cover-wave" aria-hidden="true">
            {bars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
            ))}
            <AudioLines className="assets-cover-wave-glyph" />
        </div>
    );
}

export function TextCover({ asset }: { asset: LibraryAsset & { kind: "text" } }) {
    return (
        <div className="assets-cover-text">
            <p>{asset.data.content || "空白文本素材"}</p>
        </div>
    );
}

export function ModelCover({ asset }: { asset: LibraryAsset & { kind: "model" } }) {
    return (
        <div className="assets-cover-model">
            <Box />
            <span>{asset.data.fileName}</span>
        </div>
    );
}

export function audioWaveBars(seed: string) {
    let hash = 0;
    for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    const bars: number[] = [];
    for (let index = 0; index < 26; index += 1) {
        hash = (hash * 9301 + 49297) % 233280;
        const random = hash / 233280;
        const envelope = 0.35 + 0.65 * Math.abs(Math.sin(index * 0.55 + 1.2));
        bars.push(Math.round((0.18 + 0.82 * random * envelope) * 100));
    }
    return bars;
}
