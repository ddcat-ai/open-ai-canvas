// 素材库卡片与封面：图片/视频/音频/文本/3D 各自的封面渲染、选中态与卡片菜单。
//
// 纯展示组件，数据与操作回调由素材库页面传入。

import { Dropdown, type MenuProps } from "antd";
import type { MouseEvent } from "react";
import { AlertTriangle, AudioLines, Box, Clock3, Copy, Download, FileText, FolderOpen, MoreHorizontal, PencilLine, Play, RotateCcw, ShieldAlert, ShieldCheck, ShieldX, Trash2 } from "lucide-react";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { type AssetKind } from "@/stores/use-asset-store";
import { AssetMediaPreview } from "@/components/asset-media-preview";
import { AudioPreviewBar, CharacterAssetCover } from "@/components/assets/asset-rich-cover";
import { useAudioSampleRate } from "@/hooks/use-audio-sample-rate";
import { translate } from "@/i18n";
import { arkCertificationBadgeKey, arkCertificationExpired, type ArkLibraryProgress } from "@/lib/ark-assets";
import { assetCategoryLabel } from "@/lib/asset-category";
import { type LibraryAsset, assetKindIcons } from "./asset-library-format";
import { assetKindLabel, assetProjectLabel, assetSummary, assetSummaryDetail, formatAssetClock, formatAssetTime } from "./asset-library-format";

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
    selectionMode = false,
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
    arkProgress,
}: {
    asset: LibraryAsset;
    selected: boolean;
    isTrash?: boolean;
    retentionDays?: number;
    selectionMode?: boolean;
    onSelect: (selected: boolean, range?: boolean) => void;
    onOpen: () => void;
    onEdit: () => void;
    onCopy: (asset: LibraryAsset) => void;
    onDownload: (asset: LibraryAsset) => void;
    onRestore?: () => void;
    onArchive?: () => void;
    onDelete: () => void;
    folderOptions: Array<{ label: string; value: string }>;
    onMoveToFolder: (folderId: string) => void;
    /** 这张图片最近一次方舟认证提交；已认证的展示以素材自身的 arkCertification 为准。 */
    arkProgress?: ArkLibraryProgress;
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
    const handleCardClick = (event: MouseEvent<HTMLButtonElement>) => {
        if (selectionMode || event.shiftKey || event.ctrlKey || event.metaKey) {
            onSelect(!selected, event.shiftKey);
            return;
        }
        onOpen();
    };
    return (
        <AssetLibraryCard selected={selected}>
            <AssetCover asset={asset} selected={selected} isTrash={isTrash} onSelect={onSelect} onOpen={handleCardClick} menuItems={menuItems} arkProgress={arkProgress} />
            <button type="button" className="asset-collection-body block w-full px-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--workspace-accent)]" onClick={handleCardClick}>
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
                ) : asset.kind === "audio" ? (
                    <AudioAssetSummary asset={asset} />
                ) : (
                    <div className="asset-collection-summary mt-1 truncate tabular-nums" title={assetSummaryDetail(asset)}>
                        {summary}
                    </div>
                )}
                <div className="asset-collection-source mt-1 flex min-w-0 items-center gap-2">
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

export function AssetCover({
    asset,
    selected,
    isTrash = false,
    onSelect,
    onOpen,
    menuItems,
    arkProgress,
}: {
    asset: LibraryAsset;
    selected: boolean;
    isTrash?: boolean;
    onSelect: (selected: boolean, range?: boolean) => void;
    onOpen: (event: MouseEvent<HTMLButtonElement>) => void;
    menuItems: MenuProps["items"];
    arkProgress?: ArkLibraryProgress;
}) {
    const kind = isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = kind ? assetKindIcons[kind] : FileText;
    // 音频在库内由试听条显示进度和总时长；回收站不提供试听，仍显示时长角标。
    const audioPreview = asset.kind === "audio" && !isTrash;
    const clock = asset.kind === "video" || (asset.kind === "audio" && !audioPreview) ? formatAssetClock(asset.data.durationMs) : null;
    const showPlay = asset.kind === "video";
    const isLight = asset.kind === "audio" || asset.kind === "text" || asset.kind === "model";
    // 图片和视频的画面就是预览本身，类型与分类角标只会遮挡画面；规格写在卡片摘要里。
    const visualMedia = asset.kind === "image" || asset.kind === "video";
    return (
        <AssetLibraryCardMedia className={isLight ? "assets-cover is-light" : "assets-cover"}>
            <button type="button" className="assets-cover-link" onClick={onOpen} aria-label={`查看素材：${asset.title}`}>
                {asset.kind === "audio" ? (
                    <AudioWaveCover asset={asset} />
                ) : asset.kind === "entity" && (asset.category === "environment" || asset.category === "prop") ? (
                    <div className="assets-cover-fallback">
                        <span>{assetCategoryLabel(asset.category)} · 待生成图片</span>
                    </div>
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
                {visualMedia ? null : (
                    <span className="assets-cover-badge is-kind">
                        <KindIcon />
                        {kind ? assetKindLabel(kind, asset.category) : "素材"}
                    </span>
                )}
                {isTrash ? (
                    <span className="assets-cover-badge is-category !bg-amber-500/85 !text-white">回收站</span>
                ) : asset.kind === "entity" || visualMedia ? null : (
                    <span className="assets-cover-badge is-category">{assetCategoryLabel(asset.category)}</span>
                )}
                {isTrash ? null : <ArkCoverBadge asset={asset} progress={arkProgress} />}
            </span>
            {clock ? <span className="assets-cover-clock">{clock}</span> : null}
            {audioPreview ? <AudioPreviewBar asset={asset} /> : null}
            <input
                type="checkbox"
                checked={selected}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => onSelect(event.target.checked, (event.nativeEvent as globalThis.MouseEvent).shiftKey)}
                className="assets-select-check"
                aria-label={`选择 ${asset.title}`}
            />
            <Dropdown trigger={["click"]} menu={{ items: menuItems }}>
                <button type="button" className="assets-cover-more" aria-label="更多素材操作" title="更多操作">
                    <MoreHorizontal className="size-4" />
                </button>
            </Dropdown>
        </AssetLibraryCardMedia>
    );
}

/** 方舟认证角标：已认证显示认证类型（授权过期单独标出）；认证进行中或未通过时显示进度。 */
function ArkCoverBadge({ asset, progress }: { asset: LibraryAsset; progress?: ArkLibraryProgress }) {
    const certification = asset.arkCertification;
    if (certification) {
        const expired = arkCertificationExpired(certification);
        return (
            <span className="assets-cover-badge is-ark" data-tone={expired ? "warning" : "success"}>
                {expired ? <ShieldAlert aria-hidden /> : <ShieldCheck aria-hidden />}
                {translate(arkCertificationBadgeKey(certification))}
            </span>
        );
    }
    if (!progress || progress.status === "active") return null;
    const tone = progress.status === "processing" ? "loading" : progress.status === "pending_review" ? "warning" : "error";
    const Icon = tone === "error" ? ShieldX : Clock3;
    return (
        <span className="assets-cover-badge is-ark" data-tone={tone}>
            <Icon aria-hidden />
            {translate(`library.ark.badge.${progress.status}`)}
        </span>
    );
}

/** 音频摘要：时长 + 源采样率。采样率需要读取文件头，读到之前只显示时长。 */
function AudioAssetSummary({ asset }: { asset: LibraryAsset & { kind: "audio" } }) {
    const sampleRate = useAudioSampleRate(asset.data.storageKey, asset.data.url);
    const summary = assetSummary(asset, sampleRate);
    return (
        <div className="asset-collection-summary mt-1 truncate tabular-nums" title={assetSummaryDetail(asset, sampleRate)}>
            {summary}
        </div>
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
