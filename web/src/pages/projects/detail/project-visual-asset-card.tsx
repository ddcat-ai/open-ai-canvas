import { Button, Dropdown, Popconfirm } from "antd";
import { Image as ImageIcon, MoveRight, Sparkles, Trash2 } from "lucide-react";
import { AssetLibraryCard, AssetLibraryCardMedia } from "@/components/assets/asset-library-card";
import { CachedResourceImage } from "@/components/cached-resource-image";
import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";
import type { ProjectAsset } from "@/services/api/projects";
import { categoryLabel } from "./shared";

export function ProjectVisualAssetCard({
    asset,
    generating,
    busy,
    folderItems,
    onOpen,
    onGenerate,
    onBind,
    onMove,
    onRemove,
}: {
    asset: ProjectAsset;
    generating: boolean;
    busy: boolean;
    folderItems: Array<{ key: string; label: string }>;
    onOpen: () => void;
    onGenerate: () => void;
    onBind: () => void;
    onMove: (folderId: string) => void;
    onRemove: () => void;
}) {
    const resourceId = asset.mediaType === "image" ? resourceIdFromStorageKey(asset.storageKey) : "";
    const description = typeof asset.visual?.definition.description === "string" ? asset.visual.definition.description : "";
    return (
        <AssetLibraryCard className="project-asset-library-card">
            <AssetLibraryCardMedia className="relative aspect-[4/3] overflow-hidden bg-foreground/[.05]">
                <button type="button" className="project-asset-media-button" onClick={onOpen} aria-label={`查看${categoryLabel(asset.category)}：${asset.title}`}>
                    {resourceId ? (
                        <CachedResourceImage storageKey={asset.storageKey} src={resourceFileUrl(resourceId)} alt={asset.title} className="h-full w-full object-contain" />
                    ) : (
                        <div className="grid h-full place-content-center justify-items-center gap-2 text-foreground/40">
                            <ImageIcon className="size-9" />
                            <span className="text-xs">待生成图片</span>
                        </div>
                    )}
                </button>
                <div className="pointer-events-none absolute inset-x-2 top-2 flex justify-between gap-2 text-[var(--fs-micro)] text-white">
                    <span className="rounded bg-black/60 px-1.5 py-0.5">
                        {categoryLabel(asset.category)} · v{asset.versionCount}
                    </span>
                    <span className="rounded bg-black/60 px-1.5 py-0.5">{resourceId ? "图片已就绪" : "待生成图片"}</span>
                </div>
            </AssetLibraryCardMedia>
            <div className="p-3">
                <button type="button" className="w-full truncate text-left text-sm font-semibold" onClick={onOpen}>
                    {asset.title}
                </button>
                <p className="mt-2 line-clamp-2 min-h-9 text-[var(--fs-label)] leading-[18px] text-foreground/55">{description || "查看资产设定与提示词"}</p>
                <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-border/60 pt-2">
                    <Button size="small" icon={<Sparkles className="size-3.5" />} loading={generating} disabled={busy} onClick={onGenerate}>
                        {resourceId ? "重新生成" : "生成图片"}
                    </Button>
                    <Button size="small" icon={<ImageIcon className="size-3.5" />} disabled={generating || busy} onClick={onBind}>
                        绑定图片
                    </Button>
                    <Dropdown trigger={["click"]} menu={{ selectedKeys: [asset.folderId || ""], items: folderItems, onClick: ({ key }) => onMove(key) }}>
                        <Button type="text" size="small" disabled={generating || busy} icon={<MoveRight className="size-3.5" />} aria-label={`移动 ${asset.title}`} />
                    </Dropdown>
                    <Popconfirm title="移出项目资产？" description="已有镜头引用时无法移出。" okText="移出" cancelText="取消" onConfirm={onRemove}>
                        <Button type="text" danger size="small" disabled={generating} loading={busy} icon={<Trash2 className="size-3.5" />} aria-label={`移出 ${asset.title}`} />
                    </Popconfirm>
                </div>
            </div>
        </AssetLibraryCard>
    );
}
