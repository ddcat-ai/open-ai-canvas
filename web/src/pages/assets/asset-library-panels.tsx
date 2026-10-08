// 素材库的批量操作条、空态、筛选组、详情抽屉与图片放大。

import { Button, Drawer, Tag } from "antd";
import { Box, CheckCheck, Clapperboard, Copy, Download, FileText, FileUp, Link2, Maximize2, Mic, Plus, RotateCcw, Trash2, ZoomIn, ZoomOut } from "lucide-react";
import { AudioPlayButton, CharacterAssetCover } from "@/components/assets/asset-rich-cover";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { assetCategoryLabel } from "@/lib/asset-category";
import { formatBytes } from "@/lib/image-utils";
import { useRef, useState } from "react";
import { resourceStorageLabel, resourceStorageLocation, resourceStorageTitle } from "@/lib/canvas/resource-storage-status";
import { type LibraryAsset, assetKindIcons } from "./asset-library-format";
import { isKnownAssetKind } from "./asset-library-cards";
import { assetDownloadLabel, assetKindLabel, assetProjectLabel, assetSizeLabel, formatAssetClock, formatAssetDateTime } from "./asset-library-format";

export function AssetsBatchBar({
    count,
    isTrash = false,
    allSelected,
    onSelectAll,
    onClear,
    onExport,
    onRestore,
    onArchive,
    onDelete,
}: {
    count: number;
    isTrash?: boolean;
    allSelected: boolean;
    onSelectAll: () => void;
    onClear: () => void;
    onExport: () => void;
    onRestore?: () => void;
    onArchive?: () => void;
    onDelete: () => void;
}) {
    return (
        <div className="assets-batch-bar" role="toolbar" aria-label="批量操作">
            <span className="assets-batch-count">
                已选择 <strong>{count}</strong> 个素材
            </span>
            <div className="assets-batch-actions">
                <Button size="small" icon={<CheckCheck className="size-3.5" />} disabled={allSelected} onClick={onSelectAll}>
                    全选
                </Button>
                <Button size="small" onClick={onClear}>
                    取消选择
                </Button>
                {isTrash ? (
                    <>
                        <Button size="small" type="primary" icon={<RotateCcw className="size-3.5" />} onClick={onRestore}>
                            还原已选
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                            彻底删除已选
                        </Button>
                    </>
                ) : (
                    <>
                        <Button size="small" icon={<Download className="size-3.5" />} onClick={onExport}>
                            导出
                        </Button>
                        <Button size="small" icon={<Trash2 className="size-3.5 text-amber-500" />} onClick={onArchive}>
                            移入回收站
                        </Button>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                            彻底删除
                        </Button>
                    </>
                )}
            </div>
        </div>
    );
}

export const assetsEmptyBannerFrames = [
    { src: "/short-drama-styles/retro-hong-kong.jpg", caption: "ASSET.01 · 天台重逢" },
    { src: "/short-drama-styles/cyberpunk-neon.jpg", caption: "ASSET.02 · 雨夜霓虹" },
    { src: "/short-drama-styles/suspense-noir.jpg", caption: "ASSET.03 · 暗巷追逐" },
];

export function AssetsEmptyState({ onNew, onImport, onGoCanvas }: { onNew: () => void; onImport: () => void; onGoCanvas: () => void }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    return (
        <div className="assets-empty">
            <div className="assets-empty-banner" aria-hidden="true">
                {assetsEmptyBannerFrames.map((frame, index) => (
                    <figure key={frame.caption} className={`assets-empty-banner-frame ${index === 1 ? "is-main" : index === 0 ? "is-back" : "is-front"}`}>
                        <img src={frame.src} alt="" loading="lazy" decoding="async" />
                        <span>{frame.caption}</span>
                    </figure>
                ))}
                <span className="assets-empty-banner-caption">
                    <span>{brandName}素材库</span>把每次创作的结果，留档成可复用的资产
                </span>
            </div>
            <div className="assets-empty-cards">
                <button type="button" className="assets-empty-card" onClick={onNew}>
                    <span className="assets-empty-card-icon">
                        <Plus />
                    </span>
                    <strong>新建素材</strong>
                    <span>录入提示词、说明文案，或上传图片资产。</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onImport}>
                    <span className="assets-empty-card-icon">
                        <FileUp />
                    </span>
                    <strong>导入素材包</strong>
                    <span>从素材压缩包一键恢复旧资产，继续创作。</span>
                </button>
                <button type="button" className="assets-empty-card" onClick={onGoCanvas}>
                    <span className="assets-empty-card-icon">
                        <Clapperboard />
                    </span>
                    <strong>去画布保存</strong>
                    <span>把画布上满意的镜头与画面留档进素材库。</span>
                </button>
            </div>
        </div>
    );
}

export function AssetFilterGroup({
    title,
    options,
    value,
    counts,
    onChange,
    className = "",
}: {
    title: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    counts: Map<string, number>;
    onChange: (value: string) => void;
    className?: string;
}) {
    return (
        <div className={`collection-filter-group ${className}`}>
            <span className="collection-filter-label">{title}</span>
            <div className="collection-filter-options">
                {options.map((option) => {
                    const active = value === option.value;
                    return (
                        <button key={option.value} type="button" aria-pressed={active} className={`assets-filter-item ${active ? "is-active" : ""}`} onClick={() => onChange(option.value)}>
                            <span className="assets-filter-item-label">{option.label}</span>
                            <span className="assets-filter-count">{counts.get(option.value) || 0}</span>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

const CHARACTER_PROFILE_FIELDS: Array<[string, string]> = [
    ["role", "剧情身份"],
    ["appearance", "外貌特征"],
    ["physique", "体型姿态"],
    ["clothing", "服装造型"],
    ["personality", "性格气质"],
    ["props", "标志道具"],
    ["consistencyPrompt", "一致性要求"],
    ["voiceLanguage", "语言口音"],
    ["voiceAge", "声音年龄感"],
    ["voiceTimbre", "音色气质"],
];

/** 素材档案里的角色卡：立绘主视觉 + 声音试听 + 已填写的设定，只读；编辑在画布角色卡里完成。 */
function CharacterArchive({ asset }: { asset: Extract<LibraryAsset, { kind: "entity" }> }) {
    const definition = asset.data.definition;
    const aliases = Array.isArray(definition.aliases) ? definition.aliases.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
    const rows = CHARACTER_PROFILE_FIELDS.map(([key, label]) => [label, typeof definition[key] === "string" ? (definition[key] as string).trim() : ""] as const).filter(([, value]) => value);
    const voiceAsset = asset.data.voiceSampleStorageKey
        ? ({
              id: `${asset.id}:voice`,
              kind: "audio",
              title: asset.data.voiceName || "角色声音",
              coverUrl: "",
              tags: [],
              createdAt: asset.createdAt,
              updatedAt: asset.updatedAt,
              data: { url: "", storageKey: asset.data.voiceSampleStorageKey, bytes: 0, mimeType: "audio/mpeg" },
          } satisfies Extract<LibraryAsset, { kind: "audio" }>)
        : null;
    return (
        <div className="space-y-5">
            <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--r-xl)]">
                <CharacterAssetCover asset={asset} size="hero" />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 px-5 pb-4">
                    <div className="text-[10px] font-medium uppercase tracking-[.24em] text-white/55">Character{asset.data.version ? ` · v${asset.data.version}` : ""}</div>
                    {aliases.length ? <div className="mt-1 truncate text-xs text-white/70">又名 {aliases.join("、")}</div> : null}
                </div>
            </div>
            <div className="flex items-center gap-3 rounded-[var(--r-lg)] bg-foreground/[.04] px-4 py-3">
                {voiceAsset ? (
                    <AudioPlayButton asset={voiceAsset} className="shrink-0" />
                ) : (
                    <span className="grid size-9 shrink-0 place-items-center rounded-full bg-foreground/[.06] text-foreground/40">
                        <Mic className="size-4" />
                    </span>
                )}
                <span className="min-w-0">
                    <span className="block text-[11px] text-foreground/45">声音</span>
                    <span className="block truncate text-sm font-medium">{asset.data.voiceName || "未绑定声音"}</span>
                </span>
                <span className={`ml-auto shrink-0 text-xs ${asset.data.visualStatus === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground/45"}`}>{asset.data.visualStatus === "ready" ? "形象就绪" : "形象待完善"}</span>
            </div>
            {rows.length ? (
                <dl className="divide-y divide-border/60 border-y border-border/60">
                    {rows.map(([label, value]) => (
                        <div key={label} className="grid grid-cols-[84px_minmax(0,1fr)] gap-3 py-3 text-sm leading-6">
                            <dt className="text-foreground/45">{label}</dt>
                            <dd className="whitespace-pre-wrap text-foreground/85">{value}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <p className="text-sm text-foreground/45">还没有填写角色设定，可在画布上打开角色卡补充。</p>
            )}
        </div>
    );
}

export function AssetDrawer({ asset, onClose, onCopy, onDownload }: { asset: LibraryAsset | null; onClose: () => void; onCopy: (asset: LibraryAsset) => void; onDownload: (asset: LibraryAsset) => void }) {
    const facts = asset ? assetArchiveFacts(asset) : [];
    const kind = asset && isKnownAssetKind(asset.kind) ? asset.kind : undefined;
    const KindIcon = asset ? (kind ? assetKindIcons[kind] : FileText) : Clapperboard;
    return (
        <Drawer className="library-drawer" title="素材档案" open={Boolean(asset)} size="large" onClose={onClose}>
            {asset ? (
                <div className="space-y-4">
                    <div className="asset-archive-header">
                        <span className="asset-archive-header-icon">
                            <KindIcon />
                        </span>
                        <div className="min-w-0">
                            <h2 className="asset-archive-title">{asset.title}</h2>
                            <p className="asset-archive-subtitle">
                                {assetCategoryLabel(asset.category)} · {formatAssetDateTime(asset.createdAt)} 创建
                            </p>
                        </div>
                    </div>
                    {asset.kind === "entity" ? (
                        <CharacterArchive asset={asset} />
                    ) : (
                        <div className="asset-archive-preview">
                            {asset.kind === "text" ? (
                                <div className="asset-archive-preview-note">{asset.data.content}</div>
                            ) : asset.kind === "audio" ? (
                                <div className="asset-archive-audio">
                                    <audio src={asset.data.url} controls />
                                </div>
                            ) : asset.kind === "model" ? (
                                <div className="asset-archive-preview-model">
                                    <Box />
                                    <span>
                                        {asset.data.fileName} · {formatBytes(asset.data.bytes)}
                                    </span>
                                </div>
                            ) : asset.kind === "video" ? (
                                <video src={asset.data.url} controls className="asset-archive-preview-media" />
                            ) : (
                                <AssetImageZoom asset={asset} />
                            )}
                        </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                        {(asset.tags || []).map((tag) => (
                            <Tag key={tag} className="m-0">
                                {tag}
                            </Tag>
                        ))}
                        {asset.arkAssetId ? (
                            <Tag className="m-0" color="geekblue" title="火山方舟素材 ID，生成视频时可直接 asset:// 引用">
                                方舟 {asset.arkAssetId}
                            </Tag>
                        ) : null}
                        <StorageTag asset={asset} />
                    </div>
                    <div className="asset-archive-facts">
                        {facts.map((fact) => (
                            <div key={fact.label} className="asset-archive-fact">
                                <span className="asset-archive-fact-label">{fact.label}</span>
                                <span className="asset-archive-fact-value" title={fact.value}>
                                    {fact.value}
                                </span>
                            </div>
                        ))}
                    </div>
                    <div className="asset-archive-link">
                        <Link2 />
                        <span>所属项目</span>
                        <strong>{assetProjectLabel(asset)}</strong>
                    </div>
                    {asset.note ? (
                        <div className="asset-archive-section">
                            <span className="asset-archive-section-title">备注</span>
                            <p className="asset-archive-section-body">{asset.note}</p>
                        </div>
                    ) : null}
                    <div className="asset-archive-actions">
                        {asset.kind === "text" ? (
                            <Button type="primary" icon={<Copy className="size-4" />} onClick={() => onCopy(asset)}>
                                复制文本
                            </Button>
                        ) : null}
                        {asset.kind === "image" || asset.kind === "video" || asset.kind === "audio" || asset.kind === "model" ? (
                            <Button type="primary" icon={<Download className="size-4" />} onClick={() => onDownload(asset)}>
                                {assetDownloadLabel(asset)}
                            </Button>
                        ) : null}
                    </div>
                </div>
            ) : null}
        </Drawer>
    );
}

export function AssetImageZoom({ asset }: { asset: LibraryAsset & { kind: "image" } }) {
    const [scale, setScale] = useState(1);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
    const reset = () => {
        setScale(1);
        setOffset({ x: 0, y: 0 });
    };
    return (
        <div
            className="asset-zoom-viewer"
            onWheel={(event) => {
                event.preventDefault();
                setScale((value) => Math.min(4, Math.max(0.25, value * (event.deltaY < 0 ? 1.12 : 0.89))));
            }}
            onPointerDown={(event) => {
                if (scale <= 1) return;
                event.currentTarget.setPointerCapture(event.pointerId);
                dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
            }}
            onPointerMove={(event) => {
                const drag = dragRef.current;
                if (!drag) return;
                setOffset({ x: drag.ox + event.clientX - drag.x, y: drag.oy + event.clientY - drag.y });
            }}
            onPointerUp={() => {
                dragRef.current = null;
            }}
            onPointerCancel={() => {
                dragRef.current = null;
            }}
        >
            <img src={asset.coverUrl || asset.data.dataUrl} alt={asset.title} loading="lazy" decoding="async" className="asset-archive-preview-media asset-zoom-image" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} />
            <div className="asset-zoom-controls" data-canvas-no-zoom>
                <button type="button" title="缩小" aria-label="缩小" onClick={() => setScale((value) => Math.max(0.25, value / 1.25))}>
                    <ZoomOut className="size-4" />
                </button>
                <button type="button" title="恢复适应" aria-label="恢复适应" onClick={reset}>
                    {Math.round(scale * 100)}%
                </button>
                <button type="button" title="放大" aria-label="放大" onClick={() => setScale((value) => Math.min(4, value * 1.25))}>
                    <ZoomIn className="size-4" />
                </button>
                <button type="button" title="查看原图尺寸" aria-label="查看原图尺寸" onClick={() => setScale(1)}>
                    <Maximize2 className="size-4" />
                </button>
            </div>
        </div>
    );
}

export function assetArchiveFacts(asset: LibraryAsset) {
    const facts: Array<{ label: string; value: string }> = [
        { label: "类型", value: assetKindLabel(asset.kind) },
        { label: "分类", value: assetCategoryLabel(asset.category) },
    ];
    if (asset.kind === "image" || asset.kind === "video") {
        facts.push({ label: "尺寸", value: assetSizeLabel(asset.data.width, asset.data.height) });
    }
    if (asset.kind === "video" || asset.kind === "audio") {
        facts.push({ label: "时长", value: formatAssetClock(asset.data.durationMs) || "未知" });
    }
    if (asset.kind !== "text" && asset.kind !== "entity") {
        facts.push({ label: "大小", value: formatBytes(asset.data.bytes) });
        facts.push({ label: "格式", value: asset.data.mimeType });
        facts.push({ label: "存储", value: resourceStorageLabel(asset.data.storageKey) });
    }
    if (asset.kind !== "entity" || asset.source) facts.push({ label: "来源", value: asset.source || "未标注" });
    facts.push({ label: "创建", value: formatAssetDateTime(asset.createdAt) });
    facts.push({ label: "更新", value: formatAssetDateTime(asset.updatedAt) });
    return facts;
}

export function StorageTag({ asset }: { asset: LibraryAsset }) {
    if (asset.kind !== "image" && asset.kind !== "video" && asset.kind !== "audio" && asset.kind !== "model") return null;
    const location = resourceStorageLocation(asset.data.storageKey);
    const color = location === "oss" ? "green" : location === "local" ? "gold" : "default";
    return (
        <Tag color={color} className="m-0 text-[var(--fs-label)]" title={resourceStorageTitle(asset.data.storageKey)}>
            {resourceStorageLabel(asset.data.storageKey)}
        </Tag>
    );
}
