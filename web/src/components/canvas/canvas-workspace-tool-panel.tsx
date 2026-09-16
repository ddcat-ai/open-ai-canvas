import { memo, useEffect, useDeferredValue, useMemo, useRef, useState } from "react";
import { Eye, MoreHorizontal, Plus, Star, Trash2, Wrench, X } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { CanvasImagePreview } from "@/components/canvas/canvas-image-preview";
import { AppModal } from "@/components/ui/product/app-modal";
import { VideoPlayer } from "@/components/video-player";
import { WorkspaceState } from "@/components/layout/workspace-state";

type ToolSubTab = "style" | "effect" | "motion";

const TOOL_SUB_TABS: Array<{ id: ToolSubTab; label: string }> = [
    { id: "style", label: "风格" },
    { id: "effect", label: "特效" },
    { id: "motion", label: "运镜" },
];

// 各子 Tab 的独立标签集，与 backend internal/tools/seed/tools.json 的 tags 对齐
const SUB_TAB_TAGS: Record<Exclude<ToolSubTab, "effect">, Array<{ id: string; label: string }>> = {
    style: [
        { id: "period", label: "古装" },
        { id: "city", label: "都市" },
        { id: "decade", label: "年代" },
        { id: "life", label: "生活" },
        { id: "science_fiction", label: "科幻" },
        { id: "type", label: "类型" },
        { id: "poetic", label: "写意" },
        { id: "animation", label: "动画" },
        { id: "drawing", label: "绘画" },
        { id: "myth", label: "神话" },
    ],
    motion: [
        { id: "basic", label: "基础控制" },
        { id: "follow", label: "人物跟拍" },
        { id: "reveal", label: "揭示转场" },
        { id: "emotion", label: "情绪强化" },
        { id: "aerial", label: "空间航拍" },
    ],
};

type FeedTab = "public" | "favorites" | "recent" | "custom";

const FEED_TABS: Array<{ id: FeedTab; label: string }> = [
    { id: "public", label: "公共" },
    { id: "favorites", label: "收藏" },
    { id: "recent", label: "最近" },
    { id: "custom", label: "自定义" },
];

export type ToolPreset = {
    id: string;
    title: string;
    tag: string;
    coverUrl?: string;
    mediaUrl?: string;
    mediaType?: "image" | "video";
    description?: string;
};

type ToolAction = "insert" | "view" | "favorite" | "delete";

export type CanvasWorkspaceToolPanelProps = {
    presets?: ToolPreset[];
    onInsert?: (preset: ToolPreset) => void;
    onAction?: (action: ToolAction, preset: ToolPreset) => void;
};

const PLACEHOLDER_PRESETS: ToolPreset[] = [
    { id: "p1", title: "电影感胶片", tag: "decade", coverUrl: "https://picsum.photos/200/300", description: "Kodak Portra 400 质感" },
    { id: "p2", title: "日系清新", tag: "life", coverUrl: "https://picsum.photos/200/301", description: "低对比柔光人像" },
    { id: "p3", title: "赛博朋克霓虹", tag: "science_fiction", coverUrl: "https://picsum.photos/200/302", description: "高饱和霓虹光效" },
    { id: "p4", title: "水彩手绘", tag: "drawing", coverUrl: "https://picsum.photos/200/303", description: "透明水彩笔触" },
    { id: "p5", title: "厚涂油画", tag: "drawing", coverUrl: "https://picsum.photos/200/304", description: "印象派色彩" },
    { id: "p6", title: "吉卜力风", tag: "animation", coverUrl: "https://picsum.photos/200/305", description: "宫崎骏动画质感" },
    { id: "p7", title: "新海诚风", tag: "animation", coverUrl: "https://picsum.photos/200/306", description: "高清远景云层" },
    { id: "p8", title: "故障艺术", tag: "science_fiction", coverUrl: "https://picsum.photos/200/307", description: "RGB 偏移像素损坏" },
];

export function CanvasWorkspaceToolPanel({ presets = PLACEHOLDER_PRESETS, onInsert, onAction }: CanvasWorkspaceToolPanelProps) {
    const [subTab, setSubTab] = useState<ToolSubTab>("style");
    const [feedTab, setFeedTab] = useState<FeedTab>("public");
    const [tagFilter, setTagFilter] = useState("");
    const [query, setQuery] = useState("");
    const [previewPreset, setPreviewPreset] = useState<ToolPreset | null>(null);
    const deferredQuery = useDeferredValue(query.trim().toLowerCase());

    const tagChips = useMemo(() => {
        const tags = subTab === "style" ? SUB_TAB_TAGS.style : subTab === "motion" ? SUB_TAB_TAGS.motion : [];
        return [{ id: "", label: "全部" }, ...tags];
    }, [subTab]);

    const filteredPresets = useMemo(() => {
        let result = presets;
        if (tagFilter) {
            result = result.filter((p) => p.tag === tagFilter);
        }
        if (deferredQuery) {
            result = result.filter((p) => p.title.toLowerCase().includes(deferredQuery) || p.description?.toLowerCase().includes(deferredQuery));
        }
        return result;
    }, [presets, tagFilter, deferredQuery]);

    const subTabLabel = TOOL_SUB_TABS.find((t) => t.id === subTab)?.label || "";
    const feedTabLabel = FEED_TABS.find((t) => t.id === feedTab)?.label || "";

    return (
        <>
            <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-2.5">
                <Wrench className="size-3.5 shrink-0" />
                <span className="truncate text-xs font-semibold">工具</span>
                <span className="tabular-nums text-foreground/32">{filteredPresets.length.toLocaleString("zh-CN")}</span>
            </header>

            <div className="sidebar-subtabs shrink-0 border-b border-border/70">
                {TOOL_SUB_TABS.map((tab) => (
                    <button
                        key={tab.id}
                        type="button"
                        className={subTab === tab.id ? "active" : ""}
                        aria-pressed={subTab === tab.id}
                        onClick={() => { setSubTab(tab.id); setTagFilter(""); }}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            <div className="asset-filters shrink-0 border-b border-border/70 px-2 py-1.5">
                <div className="col-feed-tabs">
                    {FEED_TABS.map((tab) => (
                        <button
                            key={tab.id}
                            type="button"
                            className={`col-feed-tab${feedTab === tab.id ? " on" : ""}`}
                            aria-pressed={feedTab === tab.id}
                            onClick={() => setFeedTab(tab.id)}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <span className="asset-head-actions">
                        <button type="button" className="icon-btn tip-down" data-tip={`新建${subTabLabel}`} aria-label={`新建${subTabLabel}`}>
                            <Plus className="size-3.5" />
                        </button>
                    </span>
                </div>
                <div className="asset-filter-row mt-1.5">
                    <input
                        className="asset-search"
                        placeholder="搜索名称/标签"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        aria-label="搜索工具"
                    />
                    {query ? (
                        <button type="button" className="grid size-5 shrink-0 place-items-center rounded text-foreground/32 hover:bg-surface-hover hover:text-foreground" onClick={() => setQuery("")} aria-label="清空搜索">
                            <X className="size-3" />
                        </button>
                    ) : null}
                </div>
                <div className="col-tag-filter mt-1.5">
                    {tagChips.map((tag) => (
                        <button
                            key={tag.id || "all"}
                            type="button"
                            className={`col-tag-chip${tagFilter === tag.id ? " on" : ""}`}
                            aria-pressed={tagFilter === tag.id}
                            onClick={() => setTagFilter(tag.id)}
                        >
                            {tag.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
                {filteredPresets.length ? (
                    <div className="grid grid-cols-2 gap-1.5">
                        {filteredPresets.map((preset) => (
                            <ToolPresetCard
                                key={preset.id}
                                preset={preset}
                                feedTabLabel={feedTabLabel}
                                onInsert={onInsert}
                                onAction={onAction}
                                onView={setPreviewPreset}
                            />
                        ))}
                    </div>
                ) : (
                    <WorkspaceState icon="canvas" compact title="没有匹配工具" description="换一个分类或关键词继续搜索。" />
                )}
            </div>

            {previewPreset ? (
                previewPreset.mediaType === "video" && previewPreset.mediaUrl ? (
                    <AppModal flush open title={previewPreset.title} onCancel={() => setPreviewPreset(null)} footer={null} width="min(1200px, calc(100vw - 32px))">
                        <VideoPlayer src={previewPreset.mediaUrl} title={previewPreset.title || "视频预览"} className="max-h-[84vh] max-w-full bg-black" />
                    </AppModal>
                ) : previewPreset.coverUrl ? (
                    <CanvasImagePreview src={previewPreset.mediaUrl || previewPreset.coverUrl} alt={previewPreset.title} onClose={() => setPreviewPreset(null)} />
                ) : null
            ) : null}
        </>
    );
}

const ToolPresetCard = memo(function ToolPresetCard({ preset, feedTabLabel, onInsert, onAction, onView }: { preset: ToolPreset; feedTabLabel: string; onInsert?: (preset: ToolPreset) => void; onAction?: (action: ToolAction, preset: ToolPreset) => void; onView?: (preset: ToolPreset) => void }) {
    const [failed, setFailed] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);
    const commonStyle = { borderColor: "color-mix(in srgb, var(--foreground) 9%, transparent)", background: "color-mix(in srgb, var(--foreground) 5%, transparent)" };

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
        items.push({ key: "insert", icon: <Plus className="size-3.5" />, label: "插入画布", onClick: () => onInsert?.(preset) });
        items.push({ key: "view", icon: <Eye className="size-3.5" />, label: "查看", onClick: () => onView?.(preset) });
        items.push({ type: "divider" as const });
        items.push({ key: "favorite", icon: <Star className="size-3.5" />, label: "收藏", onClick: () => onAction?.("favorite", preset) });
        items.push({ type: "divider" as const });
        items.push({ key: "delete", danger: true, icon: <Trash2 className="size-3.5" />, label: "删除", onClick: () => onAction?.("delete", preset) });
        return items;
    }, [preset, onInsert, onAction]);

    return (
        <div
            ref={rootRef}
            className="group relative flex flex-col gap-1 rounded-[var(--r-md)] border p-1.5 text-left transition-[background-color] hover:bg-[var(--surface-hover)] focus-within:ring-2 focus-within:ring-primary/35"
            style={commonStyle}
            onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true); }}
        >
            <div className="relative aspect-[4/3] w-full overflow-hidden rounded-[var(--r-sm)] border" style={commonStyle}>
                {preset.coverUrl && !failed ? (
                    <img src={preset.coverUrl} alt="" loading="lazy" decoding="async" className="asset-thumb h-full w-full object-cover" onError={() => setFailed(true)} />
                ) : (
                    <div className="grid h-full w-full place-items-center text-foreground/30">
                        <Wrench className="size-4" />
                    </div>
                )}
                {/* 左上角标签 */}
                <span className="absolute left-1 top-1 rounded-[var(--r-sm)] bg-black/40 px-1.5 py-0.5 text-[9px] font-medium leading-3 text-white backdrop-blur-sm">
                    {feedTabLabel}
                </span>
                {/* 右上角操作按钮 */}
                <span className="absolute right-1 top-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                        type="button"
                        className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55"
                        aria-label="查看"
                        title="查看"
                        onClick={(e) => { e.stopPropagation(); onView?.(preset); }}
                    >
                        <Eye className="size-3" />
                    </button>
                    <button
                        type="button"
                        className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55"
                        aria-label="收藏"
                        title="收藏"
                        onClick={(e) => { e.stopPropagation(); onAction?.("favorite", preset); }}
                    >
                        <Star className="size-3" />
                    </button>
                    <Dropdown trigger={["click"]} menu={{ items: menuItems }} open={menuOpen} onOpenChange={setMenuOpen} autoAdjustOverflow>
                        <button
                            type="button"
                            className="grid size-5 place-items-center rounded-[var(--r-sm)] bg-black/40 text-white backdrop-blur-sm hover:bg-black/55"
                            aria-label="更多操作"
                            title="更多"
                            onClick={(e) => { e.stopPropagation(); }}
                        >
                            <MoreHorizontal className="size-3" />
                        </button>
                    </Dropdown>
                </span>
            </div>
            <span className="truncate text-[11px] font-medium leading-4 text-foreground">{preset.title}</span>
            {preset.description ? <span className="truncate text-[10px] leading-3 text-foreground/40">{preset.description}</span> : null}
        </div>
    );
});
