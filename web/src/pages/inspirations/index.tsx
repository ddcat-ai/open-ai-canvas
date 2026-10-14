import { App, Button, Dropdown, Input } from "antd";
import { ChevronDown, Download, Heart, Import, MoreHorizontal, Pencil, Plus, RotateCcw, Search, SlidersHorizontal, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { PaginationBar } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceLoadingState, WorkspaceState } from "@/components/layout/workspace-state";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { Select } from "@/components/ui/base/select";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { catalogIdOf, inspirationSourceOf, inspirationSources, type CreationInspiration, type InspirationSourceId } from "@/lib/inspirations/catalog";
import { isCustomInspiration, resolveInspirations } from "@/lib/inspirations/resolve";
import { loadInspirationCatalog, type InspirationCatalog } from "@/services/inspiration-catalog";
import { useInspirationStore } from "@/stores/use-inspiration-store";
import { useUserStore } from "@/stores/use-user-store";
import { InspirationCover, InspirationDetailModal } from "./inspiration-detail-modal";
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

export function InspirationHall({ onUse }: { onUse: (item: CreationInspiration) => void }) {
    const { message, modal } = App.useApp();
    const inspirationSourcesVisible = useUserStore((state) => state.features.inspirationSourcesVisible);

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
    const [shouldLoadCatalog, setShouldLoadCatalog] = useState(false);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const sectionRef = useRef<HTMLElement>(null);

    const [source, setSource] = useState<SourceFilter>("all");
    const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
    const [category, setCategory] = useState("all");
    const [view, setView] = useState<ViewFilter>("all");
    const [sort, setSort] = useState<SortKey>("default");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(12);

    const [detail, setDetail] = useState<CreationInspiration | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<CreationInspiration | null>(null);
    const importRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const section = sectionRef.current;
        if (!section) return;
        if (typeof IntersectionObserver === "undefined") {
            setShouldLoadCatalog(true);
            return;
        }
        const observer = new IntersectionObserver(
            ([entry]) => {
                if (!entry?.isIntersecting) return;
                setShouldLoadCatalog(true);
                observer.disconnect();
            },
            { rootMargin: "240px" },
        );
        observer.observe(section);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!shouldLoadCatalog) return;
        let cancelled = false;
        setLoadError("");
        loadInspirationCatalog()
            .then((loaded) => {
                if (!cancelled) setCatalog(loaded);
            })
            .catch((error) => {
                if (!cancelled) setLoadError(error instanceof Error ? error.message : "灵感目录加载失败");
            });
        return () => {
            cancelled = true;
        };
    }, [shouldLoadCatalog, reloadKey]);

    useEffect(() => {
        if (!inspirationSourcesVisible) setSource("all");
    }, [inspirationSourcesVisible]);

    // 筛选条件一变就回第一页，否则会停在一个已经不存在的位置上。
    useEffect(() => {
        setPage(1);
    }, [source, modeFilter, category, view, sort, debouncedSearch, pageSize]);

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

    /** 分类跟随当前来源，并纳入自建和改写后的条目。 */
    const categoryChoices = useMemo<CategoryChoice[]>(() => {
        const merged = new Map<string, { label: string; count: number }>();
        for (const item of [...resolved, ...hiddenItems]) {
            if (source !== "all" && (item.sourceId ?? "original") !== source) continue;
            const value = item.category?.trim();
            if (!value) continue;
            const current = merged.get(value);
            merged.set(value, { label: current?.label ?? categoryLabel(item), count: (current?.count ?? 0) + 1 });
        }
        return [...merged.entries()].sort((left, right) => right[1].count - left[1].count || left[1].label.localeCompare(right[1].label, "zh-Hans-CN")).map(([value, { label, count }]) => ({ value, label, count }));
    }, [categoryLabel, hiddenItems, resolved, source]);

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
        () =>
            (
                [
                    { label: "全部", value: "all" },
                    { label: "图片", value: "image" },
                    { label: "视频", value: "video" },
                    { label: "文本", value: "text" },
                ] as const
            ).map((option) => ({
                value: option.value,
                label: (
                    <>
                        <span>{option.label}</span>
                        {catalog ? <span className="inspiration-mode-count">{modeCounts[option.value].toLocaleString("zh-CN")}</span> : null}
                    </>
                ),
                title: catalog ? `${option.label} ${modeCounts[option.value]} 条` : option.label,
            })),
        [catalog, modeCounts],
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

    const lastPage = Math.max(1, Math.ceil(visible.length / pageSize));
    const currentPage = Math.min(page, lastPage);
    const paged = useMemo(() => visible.slice((currentPage - 1) * pageSize, currentPage * pageSize), [visible, currentPage, pageSize]);
    useEffect(() => {
        setPage((current) => Math.min(current, lastPage));
    }, [lastPage]);

    const handlePageChange = (next: number, size: number) => {
        setPage(next);
        setPageSize(size);
        window.requestAnimationFrame(() => {
            sectionRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        });
    };

    const handleUse = useCallback(
        (item: CreationInspiration) => {
            setDetail(null);
            onUse(item);
        },
        [onUse],
    );

    const handleCopy = useCallback(
        (text: string, label: string) => {
            void navigator.clipboard.writeText(text).then(
                () => message.success(`${label}已复制`),
                () => message.error("复制失败，请手动选中文本"),
            );
        },
        [message],
    );

    const handleDelete = useCallback(
        (item: CreationInspiration) => {
            const id = catalogIdOf(item);
            const isCustom = isCustomInspiration(id);
            modal.confirm({
                className: "workspace-modal workspace-modal-compact",
                title: isCustom ? "删除这条灵感？" : "从库中隐藏这条灵感？",
                content: isCustom ? `「${item.title}」会从本地灵感库移除，此操作不可撤销。` : `「${item.title}」来自外部目录，不能真正删除；隐藏后可用「已隐藏」视图恢复，重新导入外部目录也不会让它复现。`,
                okText: isCustom ? "删除" : "隐藏",
                okButtonProps: { danger: true },
                cancelText: "保留",
                onOk: () => {
                    removeEntry(id);
                    if (detail && catalogIdOf(detail) === id) setDetail(null);
                    message.success(isCustom ? "已删除" : "已隐藏");
                },
            });
        },
        [detail, message, modal, removeEntry],
    );

    const handleSubmit = useCallback(
        (draft: Parameters<typeof createEntry>[0]) => {
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
            setSort("default");
            setSearch("");
            setPage(1);
            message.success("灵感已创建");
        },
        [createEntry, editing, message, updateEntry],
    );

    const handleExport = useCallback(() => {
        downloadText(exportPayload(), exportFileName());
        message.success("已导出本地改动（自建条目 / 改写 / 隐藏 / 收藏）");
    }, [exportPayload, message]);

    const handleImportFile = useCallback(
        async (file: File) => {
            try {
                const result = importPayload(await file.text());
                message.success(`导入完成：新增 ${result.created}，覆盖 ${result.updated}${result.skipped ? `，跳过 ${result.skipped} 条无效数据` : ""}`);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "导入失败");
            }
        },
        [importPayload, message],
    );

    const advancedFilterCount = Number(source !== "all") + Number(category !== "all") + Number(view !== "all") + Number(sort !== "default");
    const hasFilters = Boolean(advancedFilterCount || modeFilter !== "all" || search.trim());
    const resetFilters = () => {
        setSource("all");
        setModeFilter("all");
        setCategory("all");
        setView("all");
        setSort("default");
        setSearch("");
    };

    return (
        <section ref={sectionRef} id="creation-inspirations" className="inspiration-hall" aria-labelledby="inspiration-hall-title">
            <header className="inspiration-hall-header">
                <div>
                    <h2 id="inspiration-hall-title">灵感大厅</h2>
                    <p>点开查看完整提示词，用喜欢的创意继续创作。</p>
                </div>
                <div className="inspiration-hall-actions">
                    <Button
                        disabled={!hydrated}
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setEditing(null);
                            setEditorOpen(true);
                        }}
                    >
                        新建灵感
                    </Button>
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: [
                                { key: "import", label: "导入灵感", icon: <Import className="size-4" />, disabled: !hydrated },
                                { key: "export", label: "导出本地灵感", icon: <Download className="size-4" />, disabled: !hydrated },
                            ],
                            onClick: ({ key }) => {
                                if (key === "import") importRef.current?.click();
                                if (key === "export") handleExport();
                            },
                        }}
                    >
                        <Button type="text" icon={<MoreHorizontal className="size-4" />} aria-label="更多灵感管理操作" title="更多操作" />
                    </Dropdown>
                </div>
            </header>

            <div className="inspiration-hall-toolbar">
                <SegmentedControl options={modeOptions} value={modeFilter} onChange={(value) => setModeFilter(value as ModeFilter)} ariaLabel="按创作类型筛选灵感" className="inspiration-hall-modes" />
                <Input allowClear prefix={<Search className="size-4" />} placeholder="搜索标题、描述或标签" aria-label="搜索灵感" value={search} onChange={(event) => setSearch(event.target.value)} className="inspiration-hall-search" />
                <Button type="text" icon={<SlidersHorizontal className="size-4" />} aria-expanded={filtersOpen} aria-controls="inspiration-hall-filters" onClick={() => setFiltersOpen((open) => !open)} className="inspiration-hall-filter-toggle">
                    更多筛选{advancedFilterCount ? ` · ${advancedFilterCount}` : ""}
                    <ChevronDown className={filtersOpen ? "is-open" : undefined} aria-hidden="true" />
                </Button>
                <span className="inspiration-hall-count" role="status">
                    {catalog && hydrated ? `共 ${visible.length.toLocaleString("zh-CN")} 条` : ""}
                </span>
            </div>

            {filtersOpen ? (
                <div id="inspiration-hall-filters" className="inspiration-hall-filters" role="group" aria-label="灵感进阶筛选">
                    <div className="inspiration-hall-field">
                        <span>浏览范围</span>
                        <Select options={VIEW_OPTIONS} value={view} onChange={(value) => setView(value as ViewFilter)} ariaLabel="按全部、收藏或隐藏状态筛选灵感" />
                    </div>
                    {inspirationSourcesVisible ? (
                        <div className="inspiration-hall-field">
                            <span>来源</span>
                            <Select
                                options={[
                                    { label: "全部来源", value: "all" },
                                    ...SOURCE_ORDER.filter((key) => (sourceCounts.get(key) ?? 0) > 0).map((key) => ({
                                        label: `${inspirationSources[key].name ?? inspirationSources[key].label} (${sourceCounts.get(key) ?? 0})`,
                                        value: key,
                                    })),
                                ]}
                                value={source}
                                onChange={(value) => {
                                    setSource(value as SourceFilter);
                                    setCategory("all");
                                }}
                                ariaLabel="按来源筛选灵感"
                            />
                        </div>
                    ) : null}
                    <div className="inspiration-hall-field">
                        <span>分类</span>
                        <Select
                            showSearch
                            optionFilterProp="label"
                            options={[{ label: "全部分类", value: "all" }, ...categoryChoices.map((choice) => ({ value: choice.value, label: `${choice.label} (${choice.count})` }))]}
                            value={category}
                            onChange={setCategory}
                            ariaLabel="按分类筛选灵感"
                        />
                    </div>
                    <div className="inspiration-hall-field">
                        <span>排序</span>
                        <Select options={SORT_OPTIONS} value={sort} onChange={(value) => setSort(value as SortKey)} ariaLabel="灵感排序" />
                    </div>
                    {hasFilters ? (
                        <Button type="text" icon={<RotateCcw className="size-4" />} onClick={resetFilters} className="inspiration-hall-reset">
                            重置筛选
                        </Button>
                    ) : null}
                </div>
            ) : null}

            <div className="inspiration-hall-results">
                {!shouldLoadCatalog ? (
                    <div className="inspiration-hall-deferred" aria-hidden="true" />
                ) : loadError ? (
                    <WorkspaceErrorState title="灵感目录加载失败" description={loadError} onRetry={() => setReloadKey((key) => key + 1)} />
                ) : !catalog || !hydrated ? (
                    <WorkspaceLoadingState label="正在准备灵感" rows={3} />
                ) : paged.length ? (
                    <>
                        <div className="inspiration-gallery">
                            {paged.map((item) => {
                                const id = catalogIdOf(item);
                                return (
                                    <InspirationCard
                                        key={id}
                                        item={item}
                                        favorite={favorites.includes(id)}
                                        hidden={view === "hidden"}
                                        showSources={inspirationSourcesVisible}
                                        categoryLabel={categoryLabel(item)}
                                        onOpen={() => setDetail(item)}
                                        onToggleFavorite={() => toggleFavorite(id)}
                                        onRestore={() => {
                                            restoreEntry(id);
                                            message.success("灵感已恢复显示");
                                        }}
                                        onEdit={() => {
                                            setEditing(item);
                                            setEditorOpen(true);
                                        }}
                                        onDelete={() => handleDelete(item)}
                                    />
                                );
                            })}
                        </div>
                        <PaginationBar current={currentPage} pageSize={pageSize} total={visible.length} pageSizeOptions={[12, 24, 48]} alwaysShow onChange={handlePageChange} />
                    </>
                ) : (
                    <WorkspaceState
                        icon="empty"
                        title={view === "favorites" ? "还没有收藏" : view === "hidden" ? "没有隐藏的条目" : "没有符合条件的灵感"}
                        description={view === "favorites" ? "点卡片右上角的爱心，把喜欢的创意留在这里。" : "试试其他类型、分类或关键词。"}
                        action={hasFilters ? <Button onClick={resetFilters}>重置筛选</Button> : undefined}
                    />
                )}
            </div>

            <input
                ref={importRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void handleImportFile(file);
                }}
            />
            <InspirationDetailModal
                item={detail}
                favorite={detail ? favorites.includes(catalogIdOf(detail)) : false}
                categoryLabel={categoryLabel}
                onClose={() => setDetail(null)}
                onUse={handleUse}
                onCopy={handleCopy}
                onToggleFavorite={(item) => toggleFavorite(catalogIdOf(item))}
                onEdit={(item) => {
                    setDetail(null);
                    setEditing(item);
                    setEditorOpen(true);
                }}
                onDelete={handleDelete}
            />
            <InspirationEditorModal
                open={editorOpen}
                item={editing}
                categoryOptions={categoryChoices}
                onClose={() => {
                    setEditorOpen(false);
                    setEditing(null);
                }}
                onSubmit={handleSubmit}
            />
        </section>
    );
}

function InspirationCard({
    item,
    favorite,
    hidden,
    showSources,
    categoryLabel,
    onOpen,
    onToggleFavorite,
    onRestore,
    onEdit,
    onDelete,
}: {
    item: CreationInspiration;
    favorite: boolean;
    hidden: boolean;
    showSources: boolean;
    categoryLabel: string;
    onOpen: () => void;
    onToggleFavorite: () => void;
    onRestore: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const [menuOpen, setMenuOpen] = useState(false);
    const favoriteLabel = favorite ? "取消收藏" : "收藏";
    return (
        <article className="inspiration-card">
            <button type="button" className="inspiration-card-open" aria-label={`查看灵感：${item.title}`} aria-haspopup="dialog" onClick={onOpen}>
                <span className="inspiration-card-cover">
                    <InspirationCover key={item.image} image={item.image} />
                    {showSources ? <span className="inspiration-card-source">{inspirationSourceOf(item)?.label ?? "未标注来源"}</span> : null}
                </span>
                <span className="inspiration-card-body">
                    <strong className="inspiration-card-title">{item.title}</strong>
                    <span className="inspiration-card-desc">{item.description}</span>
                    <span className="inspiration-card-tags">
                        <span className="inspiration-chip">{categoryLabel}</span>
                        {item.ratio ? <span className="inspiration-chip">{item.ratio}</span> : null}
                        {showSources && item.credit ? <span className="inspiration-chip">{item.credit}</span> : null}
                    </span>
                </span>
            </button>
            <div className={`inspiration-card-actions${favorite || menuOpen ? " is-visible" : ""}`}>
                <Tooltip title={favoriteLabel}>
                    <button type="button" data-icon-only className="inspiration-card-action" aria-label={`${favoriteLabel}：${item.title}`} aria-pressed={favorite} onClick={onToggleFavorite}>
                        <span aria-hidden="true">
                            <Heart className="size-3.5" fill={favorite ? "currentColor" : "none"} />
                        </span>
                    </button>
                </Tooltip>
                {hidden ? (
                    <Tooltip title="恢复显示">
                        <button type="button" data-icon-only className="inspiration-card-action" aria-label={`恢复显示：${item.title}`} onClick={onRestore}>
                            <span aria-hidden="true">
                                <RotateCcw className="size-3.5" />
                            </span>
                        </button>
                    </Tooltip>
                ) : (
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        open={menuOpen}
                        onOpenChange={setMenuOpen}
                        menu={{
                            items: [
                                { key: "edit", icon: <Pencil className="size-3.5" />, label: "编辑", onClick: onEdit },
                                { key: "delete", icon: <Trash2 className="size-3.5" />, label: isCustomInspiration(catalogIdOf(item)) ? "删除" : "隐藏", danger: true, onClick: onDelete },
                            ],
                        }}
                    >
                        <button type="button" data-icon-only className="inspiration-card-action" aria-label={`更多灵感操作：${item.title}`} aria-haspopup="menu" aria-expanded={menuOpen}>
                            <span aria-hidden="true">
                                <MoreHorizontal className="size-3.5" />
                            </span>
                        </button>
                    </Dropdown>
                )}
            </div>
        </article>
    );
}

export default InspirationHall;
