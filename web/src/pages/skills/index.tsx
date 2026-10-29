import { CollectionToolbar } from "@/components/layout/collection-toolbar";
import { AppModal } from "@/components/ui/product/app-modal";
import { App, Button, Dropdown, Input } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";

import { Boxes, Check, ChevronDown, ChevronRight, Clapperboard, FolderInput, FolderPlus, Globe2, Heart, Library, LoaderCircle, Lock, Megaphone, MoreHorizontal, Palette, Pencil, Plus, Puzzle, Search, ShoppingBag, Sparkles, Trash2, UserRound, Users, Info, LayoutGrid, Store } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";

import { PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { cn } from "@/lib/utils";
import { fallbackSkillCategories, formatSkillCount, skillAccent, skillCategoryLabel, skillGlyph } from "@/pages/skills/skill-catalog";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { addSkill, createSkillLibraryCategory, deleteSkill, deleteSkillLibraryCategory, getSkill, likeSkill, listSkillLibraryCategories, listSkills, removeSkill, setSkillLibraryCategory, syncSkill, unlikeSkill, type Skill, type SkillCategory, type SkillLibraryCategory, type SkillLibraryCategoryList, type SkillScope, type SkillSort } from "@/services/api/skills";
import { useUserStore } from "@/stores/use-user-store";
import { Select } from "@/components/ui/base/select";
import { useSkillCuration, curationQuery, curationIcon, effectiveCurationRoot } from "@/components/skills/skill-curation-browser";
import { SkillRecommendationsModal } from "@/components/skills/skill-recommendations-modal";

const scopeOptions: { label: string; value: SkillScope; icon: LucideIcon }[] = [
    { label: "技能广场", value: "public", icon: Store },
    { label: "我的技能", value: "mine", icon: Library },
    { label: "我创建的", value: "created", icon: UserRound },
    { label: "我的收藏", value: "favorites", icon: Heart },
];

/* 分类图标映射：左侧导航里的分类图标，未知分类回退 Boxes。 */
const categoryIcons: Record<string, LucideIcon> = {
    drama: Clapperboard,
    ecommerce: ShoppingBag,
    creative: Palette,
    social: Megaphone,
    others: Puzzle,
};
const categoryIconOf = (value: string) => categoryIcons[value] ?? Boxes;

const sortOptions: { label: string; value: SkillSort }[] = [
    { label: "最多加入", value: "popular" },
    { label: "最新发布", value: "new" },
    { label: "最近更新", value: "updated" },
];

/**
 * 技能库：左侧一条导航（范围 → 当前范围下的分类），右侧是结果标题、搜索排序和卡片网格。
 * 范围切换会清空分类筛选，避免切到「我的技能」后仍带着广场分类这类看不见的过滤条件。
 */
export default function SkillsPage() {
    const { curation, error: curationError, retry: retryCuration } = useSkillCuration();
    const [platformCategory, setPlatformCategory] = useState("");
    const { message, modal } = App.useApp();
    const navigate = useNavigate();
    const [scope, setScope] = useState<SkillScope>("public");
    const [sort, setSort] = useState<SkillSort>("popular");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [tag, setTag] = useState("all");
    useEffect(() => { if (curation?.enabled) setTag("all"); }, [curation?.enabled]);
    const [libraryCategoryId, setLibraryCategoryId] = useState("all");
    const [libraryCategoryList, setLibraryCategoryList] = useState<SkillLibraryCategoryList | null>(null);
    const [libraryCategoryError, setLibraryCategoryError] = useState("");
    const [categoryEditorOpen, setCategoryEditorOpen] = useState(false);
    const [categoryName, setCategoryName] = useState("");
    const [categoryScope, setCategoryScope] = useState<"personal" | "platform">("personal");
    const [categorySaving, setCategorySaving] = useState(false);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [scopeCounts, setScopeCounts] = useState<Partial<Record<SkillScope, number>>>({});
    const [countsKey, setCountsKey] = useState(0);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [recommendationsOpen, setRecommendationsOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);
    const isAdmin = useUserStore((state) => state.user?.role === "admin");
    const isLibraryScope = scope === "mine" || scope === "created";
    const libraryCategoryScope = scope === "created" ? "created" : "mine";

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);
    const refreshCounts = useCallback(() => setCountsKey((value) => value + 1), []);
    const selectScope = (next: SkillScope) => {
        setScope(next);
        setTag("all");
        setPlatformCategory("");
        setLibraryCategoryId("all");
        setPage(1);
    };
    const selectMarketplaceCategory = (categoryId: string, nextPlatformCategory = "") => {
        setTag(categoryId);
        setPlatformCategory(nextPlatformCategory);
        setPage(1);
    };
    const selectLibraryCategory = (categoryId: string) => {
        setLibraryCategoryId(categoryId);
        setPage(1);
    };

    /* 平台策展分类失效（被停用或策展关闭）时回到「全部」，原先由下拉选择器承担的校验移到这里。 */
    useEffect(() => {
        if (!platformCategory) return;
        const valid = platformCategory === "__uncategorized__"
            || (platformCategory.startsWith("root:") ? curation?.roots?.some((root) => root.id === platformCategory.slice(5)) : curation?.categories.some((item) => item.id === platformCategory));
        if (!curation?.enabled || !valid) {
            setPlatformCategory("");
            setPage(1);
        }
    }, [curation, platformCategory]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        const libraryFilter = isLibraryScope
            ? libraryCategoryId === "__uncategorized__"
                ? { libraryUncategorized: true }
                : libraryCategoryId !== "all" ? { libraryCategoryId } : {}
            : {};
        listSkills({ page, pageSize, scope, sort, search: debouncedSearch || undefined, tag: !isLibraryScope && tag !== "all" ? tag : undefined, ...libraryFilter, ...(isLibraryScope ? {} : curationQuery(curation, platformCategory)) })
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.totalCount);
                if (result.categories.length) setCategories(result.categories);
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setTotal(0);
                setLoadError(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, isLibraryScope, libraryCategoryId, page, pageSize, reloadKey, scope, sort, tag, curation, platformCategory]);

    /* 范围计数：每个范围只取 1 条记录读 totalCount，与当前搜索/分类无关，写操作后刷新。 */
    useEffect(() => {
        let cancelled = false;
        void Promise.allSettled(scopeOptions.map((option) => listSkills({ scope: option.value, page: 1, pageSize: 1 }))).then((results) => {
            if (cancelled) return;
            const next: Partial<Record<SkillScope, number>> = {};
            results.forEach((result, index) => {
                if (result.status === "fulfilled") next[scopeOptions[index].value] = result.value.totalCount;
            });
            setScopeCounts(next);
        });
        return () => { cancelled = true; };
    }, [reloadKey, countsKey]);

    useEffect(() => {
        let cancelled = false;
        setLibraryCategoryError("");
        listSkillLibraryCategories(libraryCategoryScope)
            .then((result) => { if (!cancelled) setLibraryCategoryList(result); })
            .catch((error) => {
                if (!cancelled) {
                    setLibraryCategoryList(null);
                    setLibraryCategoryError(error instanceof Error ? error.message : "技能库分类加载失败");
                }
            });
        return () => { cancelled = true; };
    }, [libraryCategoryScope, reloadKey]);

    const curationRoots = curation?.enabled ? (curation.roots || []).filter((root) => root.enabled !== false) : [];
    const browseCategories: (SkillCategory & { iconKey?: string })[] = curation?.enabled ? curationRoots.map((root) => ({ value: root.id, label: root.name, iconKey: root.iconKey })) : categories;
    const activeCurationCategory = curation?.enabled && platformCategory && !platformCategory.startsWith("root:") && platformCategory !== "__uncategorized__" ? curation.categories.find((item) => item.id === platformCategory) : undefined;
    const activeCurationRootId = platformCategory.startsWith("root:") ? platformCategory.slice(5) : activeCurationCategory?.rootTag || "";
    const libraryCategories = libraryCategoryList?.categories ?? [];
    const scopeLabel = scopeOptions.find((option) => option.value === scope)?.label || "技能";
    const viewLabel = isLibraryScope
        ? libraryCategoryId === "all" ? scopeLabel : libraryCategoryId === "__uncategorized__" ? "未分类" : libraryCategories.find((category) => category.id === libraryCategoryId)?.name || "分类"
        : curation?.enabled && platformCategory
          ? platformCategory === "__uncategorized__"
              ? "未细分"
              : [curationRoots.find((root) => root.id === activeCurationRootId)?.name, activeCurationCategory?.name].filter(Boolean).join(" / ") || "分类"
          : tag !== "all" ? skillCategoryLabel(tag, categories) : scopeLabel;
    const categoryFiltered = isLibraryScope ? libraryCategoryId !== "all" : Boolean(platformCategory) || tag !== "all";
    const filtersActive = Boolean(search || categoryFiltered || sort !== "popular");
    const resetFilters = useCallback(() => { setSearch(""); setTag("all"); setPlatformCategory(""); setLibraryCategoryId("all"); setSort("popular"); setPage(1); }, []);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skillId);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能详情加载失败");
            setActiveSkill(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const openEditor = async (skill?: Skill) => {
        if (!skill) {
            setEditingSkill(null);
            setEditorOpen(true);
            return;
        }
        try {
            const result = skill.instruction ? { skill } : await getSkill(skill.skillId);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能读取失败");
        }
    };

    const openWorkbench = (skill: Skill) => {
        setActiveSkill(null);
        navigate(`/skills/${encodeURIComponent(skill.skillId)}/edit`);
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => item.skillId === next.skillId ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setActiveSkill((current) => current?.skillId === next.skillId ? { ...current, ...next, instruction: next.instruction || current.instruction } : current);
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.isOwner) return;
        setMutatingID(skill.skillId);
        try {
            const result = skill.isAdded ? await removeSkill(skill.skillId) : await addSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isAdded ? "已加入我的技能" : "已从我的技能移除");
            if (scope === "mine") reload();
            else refreshCounts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = skill.isLike ? await unlikeSkill(skill.skillId) : await likeSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.isLike ? "已收藏" : "已取消收藏");
            if (scope === "favorites" && !result.skill.isLike) reload();
            else refreshCounts();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const synchronizeSkill = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            const result = await syncSkill(skill.skillId);
            patchSkill(result.skill);
            message.success(result.skill.versionId === skill.versionId ? "已是最新版本" : "已同步最新版本");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "GitHub 技能同步失败");
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: `删除“${skill.skillName}”？`,
            content: "删除后，其他用户将无法继续使用该技能，已有加入和收藏关系也会一并移除。",
            okText: "删除技能",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkill(skill.skillId);
                    setActiveSkill(null);
                    message.success("技能已删除");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "技能删除失败");
                    throw error;
                }
            },
        });
    };

    const saveLibraryCategory = async () => {
        const name = categoryName.trim();
        if (!name) {
            message.error("请输入分类名称");
            return;
        }
        setCategorySaving(true);
        try {
            await createSkillLibraryCategory({ name, scope: isAdmin ? categoryScope : "personal" });
            message.success("技能库分类已创建");
            setCategoryEditorOpen(false);
            setCategoryName("");
            setLibraryCategoryId("all");
            setPage(1);
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "分类创建失败");
        } finally {
            setCategorySaving(false);
        }
    };

    const confirmDeleteLibraryCategory = (category: SkillLibraryCategory) => {
        modal.confirm({
            title: `删除分类“${category.name}”？`,
            content: "删除分类只会解除技能与该分类的关联，不会删除技能本身。",
            okText: "删除分类",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkillLibraryCategory(category.id);
                    if (libraryCategoryId === category.id) setLibraryCategoryId("all");
                    message.success("分类已删除，技能仍保留在技能库中");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "分类删除失败");
                    throw error;
                }
            },
        });
    };

    const assignLibraryCategory = async (skill: Skill, categoryId: string) => {
        setMutatingID(skill.skillId);
        try {
            const result = await setSkillLibraryCategory(skill.skillId, categoryId);
            patchSkill(result.skill);
            message.success(categoryId ? "技能已归类" : "已取消技能归类");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能归类失败");
        } finally {
            setMutatingID("");
        }
    };

    const openCategoryEditor = () => { setCategoryName(""); setCategoryScope("personal"); setCategoryEditorOpen(true); };

    const renderSkillCard = (skill: Skill) => {
        const rootId = curation?.enabled ? effectiveCurationRoot(skill, curation) : "";
        const rootLabel = rootId ? curationRoots.find((root) => root.id === rootId)?.name : undefined;
        return (
            <SkillCard
                key={skill.skillId}
                skill={skill}
                accentKey={rootId && rootId !== "__unassigned__" ? rootId : skill.tag}
                categoryLabel={!isLibraryScope && !categoryFiltered ? rootLabel || skillCategoryLabel(skill.tag, categories) : undefined}
                libraryCategories={libraryCategories}
                canCategorize={isLibraryScope}
                loading={mutatingID === skill.skillId}
                onOpen={() => void openSkill(skill)}
                onAdd={() => void toggleAdded(skill)}
                onLike={() => void toggleLiked(skill)}
                onEdit={() => void openEditor(skill)}
                onOpenWorkbench={() => openWorkbench(skill)}
                onDelete={() => confirmDelete(skill)}
                onSetLibraryCategory={(categoryId) => void assignLibraryCategory(skill, categoryId)}
            />
        );
    };

    const skillContent = loading && !skills.length ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : skills.length ? (
        <div className={cn("skill-tile-grid", loading && "is-refreshing")} aria-busy={loading}>
            {skills.map(renderSkillCard)}
        </div>
    ) : (
        <WorkspaceState
            compact
            className="min-h-[188px]"
            icon="skills"
            title={filtersActive ? (search.trim() ? `没有找到与“${search.trim()}”相关的技能` : "没有符合筛选条件的技能") : scope === "created" ? "还没有创建技能" : scope === "public" ? "技能广场还是空的" : "这里还没有技能"}
            description={filtersActive ? "换一个关键词或分类，或清除筛选后查看全部。" : scope === "favorites" ? "收藏的公开技能会显示在这里。" : scope === "mine" ? "从技能广场加入后会显示在这里。" : "创建并公开第一个技能，其他用户就能直接加入使用。"}
            action={filtersActive
                ? <Button onClick={resetFilters}>清除筛选</Button>
                : scope === "mine"
                  ? <Button onClick={() => selectScope("public")}>去技能广场</Button>
                  : (scope === "created" || scope === "public")
                    ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>
                    : undefined}
        />
    );

    const railItem = ({ key, label, icon: Icon, count, active, nested = false, onClick }: { key: string; label: string; icon?: LucideIcon; count?: number; active: boolean; nested?: boolean; onClick: () => void }) => (
        <button key={key} type="button" className={cn("skills-rail-item", nested && "is-nested")} aria-pressed={active} onClick={onClick}>
            {Icon ? <Icon aria-hidden="true" /> : null}
            <span className="skills-rail-item-label">{label}</span>
            {count !== undefined ? <span className="skills-rail-count">{formatSkillCount(count)}</span> : null}
        </button>
    );

    const marketplaceAllActive = tag === "all" && !platformCategory;

    return (
        <>
            <WorkspacePage className="library-page skills-library-page" grid>
                <PageHeader title="技能库" description="把提示词、角色设定和创作方法，变成随时可用的能力。" />

                <div className="skills-browser">
                    <aside className="skills-rail" aria-label="技能导航">
                        <nav className="skills-rail-group" aria-label="技能范围">
                            {scopeOptions.map((option) => railItem({ key: option.value, label: option.label, icon: option.icon, count: scopeCounts[option.value], active: scope === option.value, onClick: () => selectScope(option.value) }))}
                        </nav>

                        {!isLibraryScope ? (
                            <section className="skills-rail-section" aria-labelledby="skills-rail-categories">
                                <div className="skills-rail-heading"><span id="skills-rail-categories" className="collection-filter-label">分类</span></div>
                                {curationError ? <div className="skills-rail-error" role="alert">{curationError}<Button type="link" size="small" onClick={retryCuration}>重试</Button></div> : null}
                                <div className="skills-rail-group">
                                    {railItem({ key: "all", label: "全部", icon: LayoutGrid, active: marketplaceAllActive, onClick: () => selectMarketplaceCategory("all") })}
                                    {browseCategories.map((category) => {
                                        const Icon = curation?.enabled ? curationIcon(category.iconKey) : categoryIconOf(category.value);
                                        if (!curation?.enabled) return railItem({ key: category.value, label: category.label, icon: Icon, count: category.count, active: tag === category.value, onClick: () => selectMarketplaceCategory(category.value) });
                                        const children = activeCurationRootId === category.value ? curation.categories.filter((item) => item.rootTag === category.value && item.enabled !== false) : [];
                                        return [
                                            railItem({ key: category.value, label: category.label, icon: Icon, active: platformCategory === `root:${category.value}`, onClick: () => selectMarketplaceCategory("all", `root:${category.value}`) }),
                                            ...children.map((child) => railItem({ key: child.id, label: child.name, nested: true, active: platformCategory === child.id, onClick: () => selectMarketplaceCategory("all", child.id) })),
                                        ];
                                    })}
                                    {curation?.enabled ? railItem({ key: "__uncategorized__", label: "未细分", icon: FolderInput, active: platformCategory === "__uncategorized__", onClick: () => selectMarketplaceCategory("all", "__uncategorized__") }) : null}
                                </div>
                            </section>
                        ) : (
                            <section className="skills-rail-section" aria-labelledby="skills-rail-library">
                                <div className="skills-rail-heading">
                                    <span id="skills-rail-library" className="collection-filter-label">我的分类</span>
                                    <Tooltip title="新建分类">
                                        <button type="button" className="product-icon-button skills-rail-add" aria-label="新建技能库分类" onClick={openCategoryEditor}><FolderPlus /></button>
                                    </Tooltip>
                                </div>
                                {libraryCategoryError ? <div className="skills-rail-error" role="alert">{libraryCategoryError}<Button type="link" size="small" onClick={reload}>重试</Button></div> : null}
                                <div className="skills-rail-group">
                                    {railItem({ key: "all", label: "全部", icon: Library, count: libraryCategoryList?.totalCount, active: libraryCategoryId === "all", onClick: () => selectLibraryCategory("all") })}
                                    {railItem({ key: "__uncategorized__", label: "未分类", icon: FolderInput, count: libraryCategoryList?.uncategorizedCount, active: libraryCategoryId === "__uncategorized__", onClick: () => selectLibraryCategory("__uncategorized__") })}
                                    {libraryCategories.map((category) => (
                                        <div key={category.id} className="skills-rail-row">
                                            {railItem({ key: category.id, label: category.name, icon: category.scope === "platform" ? Globe2 : FolderInput, count: category.count, active: libraryCategoryId === category.id, onClick: () => selectLibraryCategory(category.id) })}
                                            {category.scope === "personal" || isAdmin ? (
                                                <button type="button" className="product-icon-button skills-rail-delete" aria-label={`删除分类${category.name}`} title="删除分类" onClick={() => confirmDeleteLibraryCategory(category)}>
                                                    <Trash2 aria-hidden="true" />
                                                </button>
                                            ) : null}
                                        </div>
                                    ))}
                                    {!libraryCategories.length && libraryCategoryList ? (
                                        <button type="button" className="skills-rail-item is-hint" onClick={openCategoryEditor}>
                                            <Plus aria-hidden="true" />
                                            <span className="skills-rail-item-label">新建分类整理技能</span>
                                        </button>
                                    ) : null}
                                </div>
                            </section>
                        )}
                    </aside>

                    <section className="skills-results" aria-labelledby="skills-results-title">
                        <div className="skills-results-header">
                            <div className="skills-results-title">
                                {viewLabel !== scopeLabel ? (
                                    <>
                                        <button type="button" className="skills-results-scope" onClick={() => selectScope(scope)}>{scopeLabel}</button>
                                        <ChevronRight className="skills-results-separator" aria-hidden="true" />
                                    </>
                                ) : null}
                                <h2 id="skills-results-title">{viewLabel}</h2>
                                <span className="app-projects-header-meta">{loading && !skills.length ? "—" : `${total} 个`}</span>
                            </div>
                            <CollectionToolbar label="搜索与排序技能" active={filtersActive} onReset={resetFilters} trailing={<><Button icon={<Sparkles className="size-4" />} onClick={() => setRecommendationsOpen(true)}>按行业推荐</Button><Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button></>}>
                                <Input className="min-w-0 sm:!w-56" prefix={<Search />} value={search} allowClear placeholder="搜索技能或作者" aria-label="搜索技能或作者" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                                <Select aria-label="技能排序" className="w-28" value={sort} options={sortOptions} onChange={(value) => { setSort(value); setPage(1); }} />
                            </CollectionToolbar>
                        </div>
                        {skillContent}
                        <PaginationBar current={page} pageSize={pageSize} total={total} itemLabel="个" pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
                    </section>
                </div>
            </WorkspacePage>

            <AppModal
                open={categoryEditorOpen}
                title={(
                    <div className="skills-library-category-title">
                        <span className="skills-library-category-title-icon"><FolderPlus className="size-4" aria-hidden="true" /></span>
                        <span>
                            <small>技能库整理</small>
                            <strong>新建分类</strong>
                        </span>
                    </div>
                )}
                className="library-modal skills-library-category-modal"
                width="min(480px, calc(100vw - 32px))"
                centered
                okText="创建分类"
                cancelText="取消"
                okButtonProps={{ disabled: !categoryName.trim() }}
                confirmLoading={categorySaving}
                onOk={() => void saveLibraryCategory()}
                onCancel={() => setCategoryEditorOpen(false)}
                destroyOnHidden
            >
                <div className="skills-library-category-editor">
                    <div className="skills-library-category-field">
                        <label htmlFor="skills-library-category-name">分类名称</label>
                        <Input id="skills-library-category-name" autoFocus maxLength={64} showCount value={categoryName} onChange={(event) => setCategoryName(event.target.value)} onPressEnter={() => void saveLibraryCategory()} placeholder="例如：角色设定、分镜、宣发" />
                        <span className="skills-library-category-field-hint">最多 64 个字符；名称不能与当前可用分类重名。</span>
                    </div>
                    {isAdmin ? (
                        <div className="skills-library-category-scope">
                            <span className="skills-library-category-field-label">分类范围</span>
                            <div className="skills-library-category-scope-options" role="group" aria-label="分类范围">
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "personal" ? " is-active" : ""}`} aria-pressed={categoryScope === "personal"} onClick={() => setCategoryScope("personal")}>
                                    <span className="skills-library-category-scope-icon"><UserRound className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>个人分类</strong><small>仅你自己可见和使用</small></span>
                                    {categoryScope === "personal" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                                <button type="button" className={`skills-library-category-scope-option${categoryScope === "platform" ? " is-active" : ""}`} aria-pressed={categoryScope === "platform"} onClick={() => setCategoryScope("platform")}>
                                    <span className="skills-library-category-scope-icon"><Globe2 className="size-4" aria-hidden="true" /></span>
                                    <span className="skills-library-category-scope-copy"><strong>平台分类</strong><small>所有用户可见、可分配</small></span>
                                    {categoryScope === "platform" ? <Check className="skills-library-category-scope-check size-4" aria-hidden="true" /> : null}
                                </button>
                            </div>
                        </div>
                    ) : null}
                    <div className={`skills-library-category-note${categoryScope === "platform" && isAdmin ? " is-platform" : ""}`}>
                        <Info className="size-4" aria-hidden="true" />
                        <p>{categoryScope === "platform" && isAdmin
                            ? "平台分类对所有用户可见、可分配，并可用于各自的技能库和画布 Agent；不会替换技能广场分类。"
                            : "个人分类只影响你的技能库和画布 Agent。短剧影视、电商营销是技能广场的共享分类，可在左侧“技能广场”下的分类中筛选。"}</p>
                    </div>
                </div>
            </AppModal>
            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skillId)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} onOpenWorkbench={openWorkbench} onSync={(skill) => void synchronizeSkill(skill)} />
            <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={(skill) => { setInstallOpen(false); setActiveSkill(skill); reload(); }} onManualCreate={() => { setInstallOpen(false); void openEditor(); }} />
            <SkillRecommendationsModal open={recommendationsOpen} onClose={() => setRecommendationsOpen(false)} onInstalled={(installed) => { if (installed.length) { reload(); refreshCounts(); } }} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}

/**
 * 技能卡：分类色字形 tile + 名称（最多两行）+ 作者行，两行简介，底部是带标签的统计
 * （likeCount = 收藏数，addedCount = 加入技能库的人数）。
 * 整卡由名称按钮的伸展点击区打开详情；右上角常显紧凑的加入开关，编辑/更多在底部 hover 出现。
 */
function SkillCard({ skill, accentKey, categoryLabel, libraryCategories, canCategorize, loading, onOpen, onAdd, onLike, onEdit, onOpenWorkbench, onDelete, onSetLibraryCategory }: { skill: Skill; accentKey: string; categoryLabel?: string; libraryCategories: SkillLibraryCategory[]; canCategorize: boolean; loading: boolean; onOpen: () => void; onAdd: () => void; onLike: () => void; onEdit: () => void; onOpenWorkbench: () => void; onDelete: () => void; onSetLibraryCategory: (categoryId: string) => void }) {
    const currentLibraryCategory = libraryCategories.find((category) => category.id === skill.libraryCategoryId);
    const libraryCategoryLabel = currentLibraryCategory?.name || (skill.libraryCategoryId ? "已归类" : "未分类");
    const author = skill.effectiveUser.name || "未知用户";
    const workbenchLabel = skill.sourceType === "github" ? "在工作台查看" : "在工作台编辑";
    const likeLabel = `${skill.isLike ? "取消收藏" : "收藏"}，${skill.likeCount} 人已收藏`;
    const menuItems = [
        { key: "detail", label: "查看详情" },
        ...(skill.isOwner
            ? [
                  { key: "workbench", label: workbenchLabel },
                  { key: "edit", label: "编辑技能信息" },
                  { type: "divider" as const },
                  { key: "delete", label: "删除技能", danger: true },
              ]
            : [{ key: "toggle-added", label: skill.isAdded ? "从我的技能移除" : "加入我的技能", disabled: loading }]),
    ];
    return (
        <article className={cn("product-collection-card skill-tile", skill.isAdded && "is-added")} data-accent={skillAccent(accentKey)}>
            <div className="skill-tile-head">
                <span className="skill-tile-glyph" aria-hidden="true">{skillGlyph(skill.skillName)}</span>
                <div className="skill-tile-heading">
                    <h3 className="skill-tile-name">
                        <button type="button" className="skill-tile-open" title={skill.skillName} onClick={onOpen}><span className="skill-tile-name-text">{skill.skillName}</span></button>
                    </h3>
                    <div className="skill-tile-byline">
                        <span className="skill-tile-author" title={`作者：${author}`}>{author}</span>
                        {canCategorize ? (
                            <Dropdown
                                trigger={["click"]}
                                menu={{
                                    selectable: true,
                                    selectedKeys: [skill.libraryCategoryId || "__uncategorized__"],
                                    items: [
                                        { key: "__uncategorized__", label: "未分类" },
                                        ...libraryCategories.map((category) => ({ key: category.id, label: category.name })),
                                    ],
                                    onClick: ({ key }) => onSetLibraryCategory(key === "__uncategorized__" ? "" : key),
                                }}
                            >
                                <button type="button" className="skill-tile-chip is-picker" aria-label={`设置技能分类，当前为${libraryCategoryLabel}`} title="设置技能库分类" disabled={loading}>
                                    <FolderInput aria-hidden="true" />
                                    <span>{libraryCategoryLabel}</span>
                                    <ChevronDown aria-hidden="true" />
                                </button>
                            </Dropdown>
                        ) : categoryLabel ? (
                            <span className="skill-tile-chip">{categoryLabel}</span>
                        ) : null}
                        {skill.isPrivate ? (
                            <Tooltip title="仅自己可见">
                                <span className="skill-tile-private" role="img" aria-label="仅自己可见"><Lock aria-hidden="true" /></span>
                            </Tooltip>
                        ) : null}
                    </div>
                </div>
            </div>

            <p className="skill-tile-description">{skill.description || "暂无技能简介"}</p>

            <div className="skill-tile-footer">
                <Tooltip title={likeLabel}>
                    <button type="button" disabled={loading} className="skill-tile-stat is-like" aria-pressed={skill.isLike} aria-label={likeLabel} onClick={onLike}>
                        <Heart aria-hidden="true" />
                        <span>{formatSkillCount(skill.likeCount)}</span>
                    </button>
                </Tooltip>
                <span className="skill-tile-stat" title={`${skill.addedCount} 人已加入技能库`}>
                    <Users aria-hidden="true" />
                    <span>{formatSkillCount(skill.addedCount)} 人加入</span>
                </span>
                {/* 次要操作：hover / focus-within 显示，触屏常显；菜单展开时保持可见。 */}
                <div className="skill-tile-actions">
                    {skill.isOwner ? (
                        <Tooltip title={workbenchLabel}>
                            <button type="button" className="product-icon-button skill-tile-edit" aria-label={`${workbenchLabel}：${skill.skillName}`} onClick={onOpenWorkbench}>
                                <Pencil />
                            </button>
                        </Tooltip>
                    ) : null}
                    <Dropdown
                        trigger={["click"]}
                        placement="bottomRight"
                        menu={{
                            items: menuItems,
                            onClick: ({ key }) => key === "detail" ? onOpen() : key === "workbench" ? onOpenWorkbench() : key === "edit" ? onEdit() : key === "delete" ? onDelete() : onAdd(),
                        }}
                    >
                        <button type="button" className="product-icon-button skill-tile-more" aria-label={`${skill.skillName} 更多操作`} title="更多操作">
                            <MoreHorizontal />
                        </button>
                    </Dropdown>
                </div>
            </div>

            {/* 加入状态是持久业务状态，常显：未加入为细线 +，已加入为安静的对勾。作者本人的技能不需要加入。 */}
            {skill.isOwner ? null : (
                <div className="skill-tile-corner">
                    <Tooltip title={skill.isAdded ? "已加入我的技能，点击移除" : "加入我的技能"}>
                        <button type="button" className="skill-tile-add" aria-pressed={skill.isAdded} aria-label={skill.isAdded ? `从我的技能移除 ${skill.skillName}` : `加入我的技能 ${skill.skillName}`} disabled={loading} onClick={onAdd}>
                            {loading ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : skill.isAdded ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
                            <span>{skill.isAdded ? "已加入" : "加入"}</span>
                        </button>
                    </Tooltip>
                </div>
            )}
        </article>
    );
}

function SkillSkeleton() {
    return (
        <div className="skill-tile-grid" aria-busy="true" aria-label="正在加载技能">
            {Array.from({ length: 8 }, (_, index) => <div key={index} className="skill-tile-skeleton" />)}
        </div>
    );
}
