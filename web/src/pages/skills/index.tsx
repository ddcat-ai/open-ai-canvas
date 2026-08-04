import { App, Button, Dropdown, Input, Select, Tooltip } from "antd";
import { Check, Heart, Library, LoaderCircle, MoreHorizontal, Plus, RotateCcw, Search, Sparkles, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PaginationBar, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories, formatSkillCount, groupSkills } from "@/pages/skills/skill-catalog";
import { SkillDetailDrawer } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { addSkill, deleteSkill, getSkill, likeSkill, listSkills, removeSkill, unlikeSkill, type Skill, type SkillCategory, type SkillScope, type SkillSort } from "@/services/api/skills";

const scopeOptions = [
    { label: "技能广场", value: "public", icon: Sparkles },
    { label: "我的技能", value: "mine", icon: Library },
    { label: "我创建的", value: "created", icon: UserRound },
    { label: "我的收藏", value: "favorites", icon: Heart },
];

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
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
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
            <WorkspacePage>
                <PageHeader icon="skills" title="技能库" meta={<span className="text-xs text-foreground/45">{total} 个技能</span>} actions={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openEditor()}>创建技能</Button>} />

                <div className="mt-1 flex flex-col border-b border-border/75 xl:flex-row xl:items-end xl:justify-between">
                    <nav className="thin-scrollbar -mb-px flex min-w-0 overflow-x-auto" aria-label="技能库范围" role="tablist">
                        {scopeOptions.map((option) => {
                            const Icon = option.icon;
                            const active = scope === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    className={`relative inline-flex h-12 shrink-0 items-center gap-2 border-b-2 px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${active ? "border-foreground font-medium text-foreground" : "border-transparent text-foreground/48 hover:text-foreground/76"}`}
                                    onClick={() => { setScope(option.value as SkillScope); setPage(1); }}
                                >
                                    <Icon className="size-4" />
                                    {option.label}
                                </button>
                            );
                        })}
                    </nav>

                    <div className="flex min-w-0 flex-wrap items-center gap-2 py-2.5 xl:flex-nowrap xl:justify-end">
                        <Input className="w-full sm:!w-72" prefix={<Search className="size-4 text-foreground/38" />} value={search} allowClear placeholder="搜索技能或作者" onChange={(event) => { setSearch(event.target.value); setPage(1); }} />
                        <Select className="w-[136px]" value={tag} options={[{ value: "all", label: "全部分类" }, ...categories]} onChange={(value) => { setTag(value); setPage(1); }} />
                        <Select className="w-[124px]" value={sort} options={sortOptions} onChange={(value) => { setSort(value); setPage(1); }} />
                        {filtersActive ? (
                            <Tooltip title="重置筛选">
                                <Button type="text" aria-label="重置筛选" icon={<RotateCcw className="size-4" />} onClick={() => { setSearch(""); setTag("all"); setSort("popular"); setPage(1); }} />
                            </Tooltip>
                        ) : null}
                    </div>
                </div>

                {loading ? <SkillSkeleton /> : loadError ? <WorkspaceErrorState compact description={loadError} onRetry={reload} /> : groupedSkills.length ? (
                    <div className="space-y-9 py-6">
                        {groupedSkills.map((group) => (
                            <section key={group.value} aria-labelledby={`skill-category-${group.value}`}>
                                <div className="mb-3 flex items-baseline justify-between px-0.5">
                                    <h2 id={`skill-category-${group.value}`} className="text-sm font-medium text-foreground/62">{group.label}</h2>
                                    <span className="text-[var(--fs-label)] text-foreground/32">{group.skills.length} 个</span>
                                </div>
                                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                                    {group.skills.map((skill) => <SkillCard key={skill.skill_id} skill={skill} loading={mutatingID === skill.skill_id} onOpen={() => void openSkill(skill)} onAdd={() => void toggleAdded(skill)} onLike={() => void toggleLiked(skill)} onEdit={() => void openEditor(skill)} onDelete={() => confirmDelete(skill)} />)}
                                </div>
                            </section>
                        ))}
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
                              ? <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openEditor()}>创建技能</Button>
                              : undefined}
                    />
                )}

                <PaginationBar current={page} pageSize={pageSize} total={total} pageSizeOptions={[20, 40, 80]} onChange={(nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); }} />
            </WorkspacePage>

            <SkillDetailDrawer skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingID === activeSkill.skill_id)} categories={categories} onClose={() => setActiveSkill(null)} onAdd={(skill) => void toggleAdded(skill)} onLike={(skill) => void toggleLiked(skill)} onEdit={(skill) => void openEditor(skill)} />
            <SkillEditorDrawer open={editorOpen} skill={editingSkill} onClose={() => setEditorOpen(false)} onSaved={(skill) => { setEditorOpen(false); setEditingSkill(null); setActiveSkill(skill); reload(); }} />
        </>
    );
}

function SkillCard({ skill, loading, onOpen, onAdd, onLike, onEdit, onDelete }: { skill: Skill; loading: boolean; onOpen: () => void; onAdd: () => void; onLike: () => void; onEdit: () => void; onDelete: () => void }) {
    return (
        <article className="flex h-[178px] min-w-0 flex-col rounded-md border border-border/55 bg-[color:var(--workspace-surface-strong)] p-4 transition-[border-color,box-shadow,background-color] duration-200 hover:border-border hover:bg-[color:var(--workspace-surface)] hover:shadow-sm">
            <div className="flex min-h-8 items-start gap-3">
                <button type="button" className="min-w-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}>
                    <h3 className="line-clamp-1 text-[var(--fs-body-lg)] font-semibold leading-6">{skill.skill_name}</h3>
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
                        <button type="button" aria-label="技能操作" className="-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-foreground/42 transition-colors hover:bg-foreground/[.06] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : (
                    <Tooltip title={`${skill.is_added ? "从我的技能移除" : "加入我的技能"} · ${formatSkillCount(skill.added_count)} 人已加入`}>
                        <button type="button" disabled={loading} aria-label={skill.is_added ? "从我的技能移除" : "加入我的技能"} className={`-mr-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait ${skill.is_added ? "bg-foreground/[.08] text-foreground" : "text-foreground/70 hover:bg-foreground/[.07] hover:text-foreground"}`} onClick={onAdd}>
                            {loading ? <LoaderCircle className="size-4 animate-spin" /> : skill.is_added ? <Check className="size-4" /> : <Plus className="size-4" />}
                        </button>
                    </Tooltip>
                )}
            </div>
            <button type="button" className="mt-1 min-h-0 flex-1 rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={onOpen}>
                <p className="line-clamp-3 text-xs leading-5 text-foreground/52">{skill.description || "暂无技能简介"}</p>
            </button>
            <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-border/45 pt-3 text-[var(--fs-label)] text-foreground/42">
                <button type="button" disabled={loading} className="inline-flex shrink-0 items-center gap-1 rounded-sm transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait" aria-label={skill.is_like ? "取消收藏" : "收藏"} onClick={onLike}>
                    <Heart className={`size-3.5 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />
                    <span>{formatSkillCount(skill.like_count)}</span>
                </button>
                <span className="truncate">来自 · {skill.effective_user.name || "未知用户"}</span>
                {skill.is_private ? <span className="ml-auto shrink-0 text-foreground/55">仅自己</span> : null}
            </div>
        </article>
    );
}

function SkillSkeleton() {
    return <div className="grid grid-cols-1 gap-3 py-6 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">{Array.from({ length: 8 }, (_, index) => <div key={index} className="h-[178px] animate-pulse rounded-md border border-border/45 bg-foreground/[.035]" />)}</div>;
}
