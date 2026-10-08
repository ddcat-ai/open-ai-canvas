import { App, Button, Dropdown, Input } from "antd";
import { Download, Heart, Import, MoreHorizontal, Pencil, Plus, RotateCcw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { catalogIdOf, inspirationSourceOf, inspirationSources, type CreationInspiration, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { fillablePrompt, isCustomInspiration, resolveInspirations } from "@/lib/inspirations/resolve";
import { loadInspirationCatalog, type InspirationCatalog } from "@/services/inspiration-catalog";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { InspirationDetailModal } from "./inspiration-detail-modal";
import { InspirationEditorModal, type InspirationCategoryChoice } from "./inspiration-editor-modal";
import "./inspirations.css";

type SourceFilter = "all" | InspirationSourceId;
type ViewFilter = "all" | "favorites" | "hidden";
type ModeFilter = "all" | CreationInspiration["mode"];
type SortKey = "default" | "title";
/** 分类标签比编辑器里的选项多一个条目数，用于在标签上显示数量。 */
type CategoryChoice = InspirationCategoryChoice & { count: number };

/** 来源筛选的顺序。必须覆盖 inspirationSources 里全部有内容的来源，漏掉就会有条目筛不到。 */
const SOURCE_ORDER: InspirationSourceId[] = ["original", "chatgpt-prompts", "seedance", "haohaoxue", "youmind"];
const VIEW_OPTIONS: { label: string; value: ViewFilter }[] = [
    { label: "全部", value: "all" },
    { label: "收藏", value: "favorites" },
    { label: "已隐藏", value: "hidden" },
];
const SORT_OPTIONS = [
    { label: "默认顺序", value: "default" },
    { label: "按标题", value: "title" },
];

/** 导出文件名带上日期，重复导出不会互相覆盖。 */
function exportFileName() {
    return `yingce-inspirations-${new Date().toISOString().slice(0, 10)}.json`;
}

function downloadText(text: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
}

export default function InspirationsPage() {
    const { message, modal } = App.useApp();
    const navigate = useNavigate();

    const custom = useInspirationStore((state) => state.custom);
    const overrides = useInspirationStore((state) => state.overrides);
    const hidden = useInspirationStore((state) => state.hidden);
    const favorites = useInspirationStore((state) => state.favorites);
    const hydrated = useInspirationStore((state) => state.hydrated);
    const createEntry = useInspirationStore((state) => state.createEntry);
    const updateEntry = useInspirationStore((state) => state.updateEntry);
    const removeEntry = useInspirationStore((state) => state.removeEntry);
    const restoreEntry = useInspirationStore((state) => state.restoreEntry);
    const toggleFavorite = useInspirationStore((state) => state.toggleFavorite);
    const exportPayload = useInspirationStore((state) => state.exportPayload);
    const importPayload = useInspirationStore((state) => state.importPayload);

    const [catalog, setCatalog] = useState<InspirationCatalog | null>(null);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);

    const [source, setSource] = useState<SourceFilter>("all");
    const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
    const [category, setCategory] = useState("all");
    const [view, setView] = useState<ViewFilter>("all");
    const [sort, setSort] = useState<SortKey>("default");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(24);

    const [detail, setDetail] = useState<CreationInspiration | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<CreationInspiration | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        let cancelled = false;
        setLoadError("");
        loadInspirationCatalog()
            .then((loaded) => { if (!cancelled) setCatalog(loaded); })
            .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : "灵感目录加载失败"); });
        return () => { cancelled = true; };
    }, [reloadKey]);

    // 筛选条件一变就回第一页，否则会停在一个已经不存在的位置上。
    useEffect(() => { setPage(1); }, [source, modeFilter, category, view, sort, debouncedSearch, pageSize]);

    const overlay = useMemo(() => ({ custom, overrides, hidden }), [custom, hidden, overrides]);
    const resolved = useMemo(() => (catalog ? resolveInspirations(catalog.entries, overlay) : []), [catalog, overlay]);

    /** 隐藏态在合成结果里已经滤掉了，单独还原一份给「已隐藏」视图。 */
    const hiddenItems = useMemo(() => {
        if (!catalog) return [];
        const hiddenSet = new Set(hidden);
        return catalog.entries.filter((item) => hiddenSet.has(catalogIdOf(item)));
    }, [catalog, hidden]);

    const categoryLabels = useMemo(() => {
        const map = new Map<string, Map<string, string>>();
        for (const [sourceId, options] of Object.entries(catalog?.categoriesBySource ?? {})) {
            map.set(sourceId, new Map(options.map((option) => [option.id, option.label])));
        }
        return map;
    }, [catalog]);

    const categoryLabel = useCallback(
        (item: CreationInspiration) => {
            const code = item.category?.trim();
            if (!code) return "未分类";
            return categoryLabels.get(item.sourceId ?? "original")?.get(code) ?? code;
        },
        [categoryLabels],
    );

    /** 分类标签跟随来源：选了某个来源就不该再出现别的来源的分类。 */
    const categoryChoices = useMemo<CategoryChoice[]>(() => {
        if (!catalog) return [];
        const sources = source === "all" ? SOURCE_ORDER : [source];
        const merged = new Map<string, { label: string; count: number }>();
        for (const sourceId of sources) {
            for (const option of catalog.categoriesBySource[sourceId] ?? []) {
                const current = merged.get(option.id);
                merged.set(option.id, { label: option.label, count: (current?.count ?? 0) + option.count });
            }
        }
        return [...merged.entries()]
            .sort((left, right) => right[1].count - left[1].count || left[1].label.localeCompare(right[1].label, "zh-Hans-CN"))
            .map(([value, { label, count }]) => ({ value, label, count }));
    }, [catalog, source]);

    const sourceCounts = useMemo(() => {
        const counts = new Map<SourceFilter, number>();
        counts.set("all", resolved.length + hiddenItems.length);
        for (const item of [...resolved, ...hiddenItems]) {
            const key = item.sourceId ?? "original";
            counts.set(key, (counts.get(key) ?? 0) + 1);
        }
        return counts;
    }, [resolved, hiddenItems]);

    /** 图片 / 视频 / 文本是库里的两大主类（文本较少），按当前视图与来源统计数量。 */
    const modeCounts = useMemo(() => {
        const counts: Record<ModeFilter, number> = { all: 0, image: 0, video: 0, text: 0 };
        const pool = view === "hidden" ? hiddenItems : resolved;
        const favoriteSet = new Set(favorites);
        for (const item of pool) {
            if (view === "favorites" && !favoriteSet.has(catalogIdOf(item))) continue;
            if (source !== "all" && (item.sourceId ?? "original") !== source) continue;
            counts.all += 1;
            counts[item.mode] += 1;
        }
        return counts;
    }, [view, resolved, hiddenItems, favorites, source]);

    const modeOptions = useMemo(
        () => [
            { label: `全部 ${modeCounts.all}`, value: "all" as ModeFilter },
            { label: `图片 ${modeCounts.image}`, value: "image" as ModeFilter },
            { label: `视频 ${modeCounts.video}`, value: "video" as ModeFilter },
            { label: `文本 ${modeCounts.text}`, value: "text" as ModeFilter },
        ],
        [modeCounts],
    );

    const visible = useMemo(() => {
        const pool = view === "hidden" ? hiddenItems : resolved;
        const keyword = debouncedSearch.trim().toLowerCase();
        const favoriteSet = new Set(favorites);
        const filtered = pool.filter((item) => {
            if (view === "favorites" && !favoriteSet.has(catalogIdOf(item))) return false;
            if (source !== "all" && (item.sourceId ?? "original") !== source) return false;
            if (modeFilter !== "all" && item.mode !== modeFilter) return false;
            if (category !== "all" && (item.category?.trim() ?? "") !== category) return false;
            if (!keyword) return true;
            const haystack = [item.title, item.description, item.category, categoryLabel(item), ...(item.tags ?? [])].join(" ").toLowerCase();
            return haystack.includes(keyword);
        });
        if (sort === "title") return [...filtered].sort((left, right) => left.title.localeCompare(right.title, "zh-Hans-CN"));
        return filtered;
    }, [view, resolved, hiddenItems, debouncedSearch, favorites, source, modeFilter, category, sort, categoryLabel]);

    const paged = useMemo(() => visible.slice((page - 1) * pageSize, page * pageSize), [visible, page, pageSize]);

    const handleUse = useCallback((item: CreationInspiration) => {
        navigate("/create", { state: { inspirationPrompt: fillablePrompt(item), inspirationMode: item.mode } });
    }, [navigate]);

    const handleCopy = useCallback((text: string, label: string) => {
        void navigator.clipboard.writeText(text).then(
            () => message.success(`${label}已复制`),
            () => message.error("复制失败，请手动选中文本"),
        );
    }, [message]);

    const handleDelete = useCallback((item: CreationInspiration) => {
        const id = catalogIdOf(item);
        const isCustom = isCustomInspiration(id);
        modal.confirm({
            className: "workspace-modal workspace-modal-compact",
            title: isCustom ? "删除这条灵感？" : "从库中隐藏这条灵感？",
            content: isCustom
                ? `「${item.title}」会从本地灵感库移除，此操作不可撤销。`
                : `「${item.title}」来自外部目录，不能真正删除；隐藏后可用「已隐藏」视图恢复，重新导入外部目录也不会让它复现。`,
            okText: isCustom ? "删除" : "隐藏",
            okButtonProps: { danger: true },
            cancelText: "保留",
            onOk: () => {
                removeEntry(id);
                if (detail && catalogIdOf(detail) === id) setDetail(null);
                message.success(isCustom ? "已删除" : "已隐藏");
            },
        });
    }, [detail, message, modal, removeEntry]);

    const handleSubmit = useCallback((draft: Parameters<typeof createEntry>[0]) => {
        if (editing) {
            updateEntry(catalogIdOf(editing), draft);
            message.success("已保存修改");
            setDetail((current) => (current && catalogIdOf(current) === catalogIdOf(editing) ? { ...current, ...draft } : current));
            setEditing(null);
            return;
        }
        createEntry(draft);
        // 新建后把筛选整体清掉：自建条目的来源固定是「原创」、分类也常和当前筛选不符，
        // 不清的话用户刚点完"创建"却看不到自己建的东西。
        setSource("all");
        setModeFilter("all");
        setCategory("all");
        setView("all");
        setSearch("");
        message.success("灵感已创建");
    }, [createEntry, editing, message, updateEntry]);

    const handleExport = useCallback(() => {
        downloadText(exportPayload(), exportFileName());
        message.success("已导出本地改动（自建条目 / 改写 / 隐藏 / 收藏）");
    }, [exportPayload, message]);

    const handleImportFile = useCallback(async (file: File) => {
        try {
            const result = importPayload(await file.text());
            message.success(`导入完成：新增 ${result.created}，覆盖 ${result.updated}${result.skipped ? `，跳过 ${result.skipped} 条无效数据` : ""}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入失败");
        }
    }, [importPayload, message]);

    const headerActions = (
        <>
            <Button icon={<Import className="size-4" />} onClick={() => importRef.current?.click()}>导入</Button>
            <Button icon={<Download className="size-4" />} onClick={handleExport}>导出</Button>
            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => { setEditing(null); setEditorOpen(true); }}>新建灵感</Button>
            <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    // 同一个文件连续导入两次也要触发，所以每次都清空 value。
                    event.target.value = "";
                    if (file) void handleImportFile(file);
                }}
            />
        </>
    );

    const total = catalog ? resolved.length + hiddenItems.length : 0;

    return (
        <WorkspacePage>
            <PageHeader
                title="灵感库"
                description={`${total} 条提示词，按来源、分类和创作类型挑，点开可以一键带去创作页`}
                actions={headerActions}
            />

            {loadError ? (
                <WorkspaceErrorState title="灵感目录加载失败" description={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
            ) : !catalog || !hydrated ? (
                <WorkspaceLoadingState label="正在加载灵感目录" detail="首次进入需要拉取全量目录，之后会走浏览器缓存" rows={4} />
            ) : (
                <div className="mt-4 flex flex-col gap-4">
                    {/* 图片 / 视频 / 文本是两大主类，放在最上面做一级筛选。 */}
                    <div className="flex flex-wrap items-center gap-3">
                        <SegmentedControl options={modeOptions} value={modeFilter} onChange={(value) => setModeFilter(value as ModeFilter)} ariaLabel="按创作类型筛选" />
                        <span className="text-xs text-foreground/50">共 {visible.length} 条</span>
                    </div>

                    {/* 分类标签是二级筛选：一眼看到库里都有什么，点一下就能缩小范围。 */}
                    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="按分类筛选">
                        <button type="button" className="inspiration-chip" aria-pressed={category === "all"} onClick={() => setCategory("all")}>
                            全部分类
                            <span className="inspiration-chip-count">{source === "all" ? resolved.length : (sourceCounts.get(source) ?? 0)}</span>
                        </button>
                        {categoryChoices.slice(0, 16).map((choice) => (
                            <button
                                key={choice.value}
                                type="button"
                                className="inspiration-chip"
                                aria-pressed={category === choice.value}
                                onClick={() => setCategory(category === choice.value ? "all" : choice.value)}
                            >
                                {choice.label}
                                <span className="inspiration-chip-count">{choice.count}</span>
                            </button>
                        ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <Input
                            allowClear
                            prefix={<Search className="size-4 text-foreground/40" />}
                            placeholder="搜标题、描述或标签"
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            className="max-w-xs"
                        />
                        <SegmentedControl options={VIEW_OPTIONS} value={view} onChange={(value) => setView(value as ViewFilter)} />
                        <Select
                            options={[
                                { label: `全部来源 (${resolved.length})`, value: "all" },
                                ...SOURCE_ORDER.filter((key) => (sourceCounts.get(key) ?? 0) > 0).map((key) => ({
                                    label: `${inspirationSources[key].name ?? inspirationSources[key].label} (${sourceCounts.get(key) ?? 0})`,
                                    value: key,
                                })),
                            ]}
                            value={source}
                            onChange={(value) => { setSource(value as SourceFilter); setCategory("all"); }}
                            className="w-52"
                        />
                        <Select options={SORT_OPTIONS} value={sort} onChange={(value) => setSort(value as SortKey)} className="w-32" />
                        <span className="text-xs text-foreground/50">共 {visible.length} 条</span>
                    </div>

                    {paged.length ? (
                        <div className="inspiration-gallery">
                            {paged.map((item) => {
                                const id = catalogIdOf(item);
                                const favorite = favorites.includes(id);
                                return (
                                    <article
                                        key={id}
                                        className="inspiration-card"
                                        tabIndex={0}
                                        role="button"
                                        onClick={() => setDetail(item)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                event.preventDefault();
                                                setDetail(item);
                                            }
                                        }}
                                    >
                                        <div className="inspiration-card-cover">
                                            <img src={item.image} alt="" loading="lazy" decoding="async" referrerPolicy="no-referrer" />
                                            <span className="inspiration-card-source">{inspirationSourceOf(item).label}</span>
                                            <div className="inspiration-card-actions">
                                                <Tooltip title={favorite ? "取消收藏" : "收藏"}>
                                                    <button type="button" className="inspiration-card-action" aria-pressed={favorite} onClick={(event) => { event.stopPropagation(); toggleFavorite(id); }}>
                                                        <Heart className="size-3.5" fill={favorite ? "currentColor" : "none"} />
                                                    </button>
                                                </Tooltip>
                                                {view === "hidden" ? (
                                                    <Tooltip title="恢复显示">
                                                        <button type="button" className="inspiration-card-action" onClick={(event) => { event.stopPropagation(); restoreEntry(id); }}>
                                                            <RotateCcw className="size-3.5" />
                                                        </button>
                                                    </Tooltip>
                                                ) : (
                                                    <Dropdown
                                                        trigger={["click"]}
                                                        menu={{
                                                            items: [
                                                                { key: "edit", icon: <Pencil className="size-3.5" />, label: "编辑" },
                                                                { key: "delete", icon: <Trash2 className="size-3.5" />, label: isCustomInspiration(id) ? "删除" : "隐藏", danger: true },
                                                            ],
                                                            onClick: ({ key, domEvent }) => {
                                                                domEvent.stopPropagation();
                                                                if (key === "edit") { setEditing(item); setEditorOpen(true); }
                                                                if (key === "delete") handleDelete(item);
                                                            },
                                                        }}
                                                    >
                                                        <button type="button" className="inspiration-card-action" aria-label="更多操作" onClick={(event) => event.stopPropagation()}>
                                                            <MoreHorizontal className="size-3.5" />
                                                        </button>
                                                    </Dropdown>
                                                )}
                                            </div>
                                        </div>
                                        <div className="inspiration-card-body">
                                            <h3 className="inspiration-card-title">{item.title}</h3>
                                            <p className="inspiration-card-desc">{item.description}</p>
                                            <div className="inspiration-card-tags">
                                                <span className="inspiration-chip">{categoryLabel(item)}</span>
                                                {item.ratio ? <span className="inspiration-chip">{item.ratio}</span> : null}
                                                {item.credit ? <span className="inspiration-chip">{item.credit}</span> : null}
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>
                    ) : (
                        <WorkspaceState
                            icon="empty"
                            title={view === "favorites" ? "还没有收藏" : view === "hidden" ? "没有隐藏的条目" : "没有符合条件的灵感"}
                            description={view === "favorites" ? "在卡片右上角点一下爱心，收藏的灵感会集中在这里。" : "换个来源、分类或关键词再试试。"}
                        />
                    )}

                    <PaginationBar current={page} pageSize={pageSize} total={visible.length} onChange={(next, size) => { setPage(next); setPageSize(size); }} />
                </div>
            )}

            <InspirationDetailModal
                item={detail}
                favorite={detail ? favorites.includes(catalogIdOf(detail)) : false}
                categoryLabel={categoryLabel}
                onClose={() => setDetail(null)}
                onUse={handleUse}
                onCopy={handleCopy}
                onToggleFavorite={(item) => toggleFavorite(catalogIdOf(item))}
                onEdit={(item) => { setDetail(null); setEditing(item); setEditorOpen(true); }}
                onDelete={handleDelete}
            />

            <InspirationEditorModal
                open={editorOpen}
                item={editing}
                categoryOptions={categoryChoices}
                onClose={() => { setEditorOpen(false); setEditing(null); }}
                onSubmit={handleSubmit}
            />
        </WorkspacePage>
    );
}
