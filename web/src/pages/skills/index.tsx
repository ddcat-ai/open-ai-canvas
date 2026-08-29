import { App, Button, Dropdown, Input, Select, Tooltip } from "antd";
import { Boxes, Check, Clapperboard, Heart, Library, LoaderCircle, Megaphone, MoreHorizontal, Palette, Plus, Puzzle, Search, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ListToolbar, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories, formatSkillCount, groupSkills, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { addSkill, deleteSkill, getSkill, likeSkill, listSkills, removeSkill, syncSkill, unlikeSkill, type Skill, type SkillCategory, type SkillScope, type SkillSort } from "@/services/api/skills";

const scopeOptions = [
    { label: "技能广场", value: "public", icon: Sparkles },
    { label: "我的技能", value: "mine", icon: Library },
    { label: "我创建的", value: "created", icon: UserRound },
    { label: "我的收藏", value: "favorites", icon: Heart },
];

/* 分类图标映射：画廊卡片顶部的图标块，未知分类回退 Boxes。 */
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

export default function SkillsPage() {
    const { message, modal } = App.useApp();
    const [scope, setScope] = useState<SkillScope>("public");
    const [sort, setSort] = useState<SkillSort>("popular");
    const [search, setSearch] = useState("");
    const debouncedSearch = useDebouncedValue(search, 250);
    const [tag, setTag] = useState("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [categories, setCategories] = useState<SkillCategory[]>(fallbackSkillCategories);
    const [total, setTotal] = useState(0);
    const [counts, setCounts] = useState<Partial<Record<SkillScope, number>>>({});
    const tabsRef = useRef<HTMLDivElement>(null);
    const indicatorRef = useRef<HTMLSpanElement>(null);
    useLayoutEffect(() => {
        const tabs = tabsRef.current;
        const indicator = indicatorRef.current;
        const active = tabs?.querySelector<HTMLButtonElement>('[aria-selected="true"]');
        if (!tabs || !indicator || !active) return;
        indicator.style.left = `${active.offsetLeft}px`;
        indicator.style.width = `${active.offsetWidth}px`;
    }, [scope, counts]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        listSkills({ page, page_size: pageSize, scope, sort, search: debouncedSearch || undefined, tag: tag === "all" ? undefined : tag })
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.total_count);
                setCounts((prev) => ({ ...prev, [scope]: result.total_count }));
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
    }, [debouncedSearch, page, pageSize, reloadKey, scope, sort, tag]);

    const groupedSkills = useMemo(() => groupSkills(skills, categories), [categories, skills]);
    const filtersActive = Boolean(search || tag !== "all" || sort !== "popular");
    const resetFilters = useCallback(() => { setSearch(""); setTag("all"); setSort("popular"); setPage(1); }, []);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skill_id);
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
            const result = skill.instruction ? { skill } : await getSkill(skill.skill_id);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能读取失败");
        }
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => item.skill_id === next.skill_id ? { ...item, ...next, instruction: next.instruction || item.instruction } : item));
        setActiveSkill((current) => current?.skill_id === next.skill_id ? { ...current, ...next, instruction: next.instruction || current.instruction } : current);
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.is_owner) return;
        setMutatingID(skill.skill_id);
        try {
            const result = skill.is_added ? await removeSkill(skill.skill_id) : await addSkill(skill.skill_id);
            patchSkill(result.skill);
            message.success(result.skill.is_added ? "已加入我的技能" : "已从我的技能移除");
            if (scope === "mine" && !result.skill.is_added) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skill_id);
        try {
            const result = skill.is_like ? await unlikeSkill(skill.skill_id) : await likeSkill(skill.skill_id);
            patchSkill(result.skill);
            message.success(result.skill.is_like ? "已收藏" : "已取消收藏");
            if (scope === "favorites" && !result.skill.is_like) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏状态更新失败");
        } finally {
            setMutatingID("");
        }
    };

    const synchronizeSkill = async (skill: Skill) => {
        setMutatingID(skill.skill_id);
        try {
            const result = await syncSkill(skill.skill_id);
            patchSkill(result.skill);
            message.success(result.skill.version_id === skill.version_id ? "已是最新版本" : "已同步最新版本");
            reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "GitHub 技能同步失败");
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: `删除“${skill.skill_name}”？`,
            content: "删除后，其他用户将无法继续使用该技能，已有加入和收藏关系也会一并移除。",
            okText: "删除技能",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkill(skill.skill_id);
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

    return (
        <>
            <WorkspacePage className="library-page skills-library-page" grid>
                <section className="skills-hero" aria-labelledby="skills-hero-title">
                    <div className="skills-hero-inner">
                        <span className="skills-hero-badge"><Sparkles className="size-3.5" />技能广场</span>
                        <h1 id="skills-hero-title" className="skills-hero-title">技能库</h1>
                        <p className="skills-hero-description">把常用的提示词、角色设定和创作方法收进自己的工具架。</p>
                        <span className="skills-hero-meta">{total} 个技能</span>
                    </div>
                </section>

                <ListToolbar className="library-toolbar skills-toolbar mt-7" active={filtersActive} onReset={resetFilters}>
                    <div className="skills-tabs" ref={tabsRef} role="tablist" aria-label="技能库范围">
                        <span className="skills-tabs-indicator" ref={indicatorRef} aria-hidden="true" />
                        {scopeOptions.map((option) => {
                            const Icon = option.icon;
                            const active = scope === option.value;
                            const count = counts[option.value as SkillScope];
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className={`skills-tab${active ? " is-active" : ""}`}
                                    onClick={() => { setScope(option.value as SkillScope); setPage(1); }}
                                >
                                    <Icon className="size-4" />
                                    <span>{option.label}</span>
                                    {count !== undefined ? <span className="skills-tab-count">{count}</span> : null}
                                </button>
                            );
                        })}
                    </div>

                        <Input className="min-w-0 sm:!w-56" prefix={<Search className="size-4 text-foreground/38" />} value={search} allowClear placeholder="搜索技能或作者" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                        <Select className="w-28" value={tag} options={[{ value: "all", label: "全部分类" }, ...categories]} onChange={(value) => { setTag(value); setPage(1); }} />
                        <Select className="w-24" value={sort} options={sortOptions} onChange={(value) => { setSort(value); setPage(1); }} />
                </ListToolbar>

                {loading && !skills.length ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : groupedSkills.length ? (
                    <div key={`${scope}-${page}`} className="skills-scope-panel space-y-9 py-6">
                        {groupedSkills.map((group) => {
                            const GroupIcon = categoryIconOf(group.value);
                            return (
                                <section key={group.value} aria-labelledby={`skill-category-${group.value}`}>
                                    <div className="mb-3 flex items-center justify-between px-0.5">
                                        <h2 id={`skill-category-${group.value}`} className="flex items-center gap-2 text-base font-semibold text-foreground/75">
                                            <span className="skill-group-icon"><GroupIcon /></span>
                                            {group.label}
                                        </h2>
                                        <span className="text-[var(--fs-label)] text-foreground/32">{group.skills.length} 个</span>
                                    </div>
                                    <div className="library-grid skill-library-grid">
                                        {groupedSkills[0] === group ? <button type="button" className="library-create-card" onClick={() => setInstallOpen(true)}><span className="library-create-cover"><Plus className="size-8" /></span><span className="library-create-title">安装技能</span><span className="library-create-meta">上传 MD / ZIP 或连接 GitHub</span></button> : null}
                                        {group.skills.map((skill, index) => <SkillCard key={skill.skill_id} skill={skill} categories={categories} loading={mutatingID === skill.skill_id} style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }} onOpen={() => void openSkill(skill)} onAdd={() => void toggleAdded(skill)} onLike={() => void toggleLiked(skill)} onEdit={() => void openEditor(skill)} onDelete={() => confirmDelete(skill)} />)}
                                    </div>
                                </section>
                            );
                        })}
                    </div>
                ) : (
                    <WorkspaceState
                        compact
                        className="min-h-[188px]"
                        icon="skills"
                        title={filtersActive ? "没有找到匹配技能" : scope === "created" ? "还没有创建技能" : scope === "public" ? "技能广场还是空的" : "这里还没有技能"}
                        description={filtersActive ? "换个关键词或分类试试。" : scope === "favorites" ? "收藏的公开技能会显示在这里。" : scope === "mine" ? "从技能广场加入后会显示在这里。" : "创建并公开第一个技能，其他用户就能直接加入使用。"}
                        action={filtersActive
                            ? <Button onClick={() => { setSearch(""); setTag("all"); setSort("popular"); setPage(1); }}>清除筛选</Button>
                            : (scope === "created" || scope === "public")
                              ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>
                              : undefined}
                    />
                )}

                <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
            </WorkspacePage>

            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skill_id)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} onSync={(skill) => void synchronizeSkill(skill)} />
            <SkillInstallModal open={installOpen} onClose={() => setInstallOpen(false)} onInstalled={(skill) => { setInstallOpen(false); setActiveSkill(skill); reload(); }} onManualCreate={() => { setInstallOpen(false); void openEditor(); }} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}

function SkillCard({ skill, categories, loading, style, onOpen, onAdd, onLike, onEdit, onDelete }: { skill: Skill; categories: SkillCategory[]; loading: boolean; style?: CSSProperties; onOpen: () => void; onAdd: () => void; onLike: () => void; onEdit: () => void; onDelete: () => void }) {
    const CategoryIcon = categoryIconOf(skill.tag);
    return (
        <article style={style} className={`library-card library-card-surface skill-library-card group${skill.is_added ? " is-selected is-added" : ""}`}>
            <span className="library-icon-tile skill-card-icon" aria-hidden="true"><CategoryIcon /></span>
            <div className="skill-card-top">
                <button type="button" className="skill-card-title-button" onClick={onOpen}>
                    <h3>{skill.skill_name}</h3>
                </button>
                {skill.is_owner ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "edit", label: "编辑技能" },
                                { key: "delete", label: "删除技能", danger: true },
                            ],
                            onClick: ({ key }) => key === "edit" ? onEdit() : onDelete(),
                        }}
                    >
                        <button type="button" aria-label="技能操作" className="skill-card-more">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
            </div>
            <button type="button" className="skill-card-description" onClick={onOpen}>
                <p>{skill.description || "暂无技能简介"}</p>
            </button>
            <div className="skill-card-footer">
                <button type="button" disabled={loading} className="skill-card-like" aria-label={skill.is_like ? "取消收藏" : "收藏"} onClick={onLike}>
                    <Heart className={`size-3.5 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />
                    <span>{formatSkillCount(skill.like_count)}</span>
                </button>
                <span className="skill-card-author">{skill.effective_user.name || "未知用户"}</span>
                <span className="skill-card-tag">{skillCategoryLabel(skill.tag, categories)}</span>
                {skill.is_private ? <span className="skill-card-flag">仅自己</span> : null}
            </div>
            {/* 加入是这个页面的主行为，给它完整的按钮 + 文案 + 已加入人数，不再藏在角落的加号里。 */}
            {skill.is_owner
                ? <div className="skill-card-action"><span className="skill-card-owner-flag">我创建的</span><span className="skill-card-added-count">{formatSkillCount(skill.added_count)} 人已加入</span></div>
                : (
                    <div className="skill-card-action">
                        <button type="button" disabled={loading} aria-pressed={skill.is_added} className={`skill-card-join${skill.is_added ? " is-added" : ""}`} onClick={onAdd}>
                            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : skill.is_added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                            <span>{skill.is_added ? "已加入" : "加入我的技能库"}</span>
                        </button>
                        <Tooltip title={`${formatSkillCount(skill.added_count)} 人已加入`}><span className="skill-card-added-count">{formatSkillCount(skill.added_count)}</span></Tooltip>
                    </div>
                )}
        </article>
    );
}

function SkillSkeleton() {
    return <div className="library-grid skill-library-grid py-6">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[260px] animate-pulse rounded-[var(--r-xl)] bg-foreground/[.035]" />)}</div>;
}
