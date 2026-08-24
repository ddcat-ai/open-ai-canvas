import { App, Button, Dropdown, Input, Select, Tooltip } from "antd";
import { Boxes, Check, Clapperboard, Heart, Library, LoaderCircle, Megaphone, MoreHorizontal, Palette, Plus, Puzzle, Search, ShoppingBag, Sparkles, UserRound } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";

import { ListToolbar, PaginationBar, PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { fallbackSkillCategories, formatSkillCount, groupSkills, skillCategoryLabel } from "@/pages/skills/skill-catalog";
import { SkillDetailDrawer } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { addSkill, deleteSkill, getSkill, likeSkill, listSkills, removeSkill, unlikeSkill, type Skill, type SkillCategory, type SkillScope, type SkillSort } from "@/services/api/skills";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const scopeOptions = [
    { label: t("skills:skill-gallery-2"), value: "public", icon: Sparkles },
    { label: t("skills:my-skills"), value: "mine", icon: Library },
    { label: t("skills:created-by-me-2"), value: "created", icon: UserRound },
    { label: t("skills:my-favorites"), value: "favorites", icon: Heart },
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

const categoryLocaleKeys: Record<string, string> = {
    drama: "short-drama-and-film",
    ecommerce: "e-commerce-marketing",
    creative: "creative-design",
    social: "social-media-content",
    others: "other",
};

const sortOptions: { label: string; value: SkillSort }[] = [
    { label: t("skills:up-to"), value: "popular" },
    { label: t("skills:newest"), value: "new" },
    { label: t("skills:recently-updated"), value: "updated" },
];

export default function SkillsPage() {
    const { t } = useTranslation("canvas");
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
                setLoadError(error instanceof Error ? error.message : t("skills:failed-to-load-skills"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [debouncedSearch, page, pageSize, reloadKey, scope, sort, tag]);

    const localizedCategories = useMemo(() => categories.map((category) => ({ ...category, label: categoryLocaleKeys[category.value] ? t(`skills:${categoryLocaleKeys[category.value]}`) : category.label })), [categories, t]);
    const groupedSkills = useMemo(() => groupSkills(skills, localizedCategories), [localizedCategories, skills]);
    const filtersActive = Boolean(search || tag !== "all" || sort !== "popular");
    const resetFilters = useCallback(() => {
        setSearch("");
        setTag("all");
        setSort("popular");
        setPage(1);
    }, []);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skill_id);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("skills:failed-to-load-skill-details"));
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
            message.error(error instanceof Error ? error.message : t("skills:failed-to-read-skill"));
        }
    };

    const patchSkill = (next: Skill) => {
        setSkills((items) => items.map((item) => (item.skill_id === next.skill_id ? { ...item, ...next, instruction: next.instruction || item.instruction } : item)));
        setActiveSkill((current) => (current?.skill_id === next.skill_id ? { ...current, ...next, instruction: next.instruction || current.instruction } : current));
    };

    const toggleAdded = async (skill: Skill) => {
        if (skill.is_owner) return;
        setMutatingID(skill.skill_id);
        try {
            const result = skill.is_added ? await removeSkill(skill.skill_id) : await addSkill(skill.skill_id);
            patchSkill(result.skill);
            message.success(result.skill.is_added ? t("skills:added-to-my-skills") : t("skills:removed-from-my-skills"));
            if (scope === "mine" && !result.skill.is_added) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("skills:failed-to-update-skill-status"));
        } finally {
            setMutatingID("");
        }
    };

    const toggleLiked = async (skill: Skill) => {
        setMutatingID(skill.skill_id);
        try {
            const result = skill.is_like ? await unlikeSkill(skill.skill_id) : await likeSkill(skill.skill_id);
            patchSkill(result.skill);
            message.success(result.skill.is_like ? t("skills:favorited") : t("skills:favorite-removed"));
            if (scope === "favorites" && !result.skill.is_like) reload();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("skills:failed-to-update-favorite-status"));
        } finally {
            setMutatingID("");
        }
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: t("skills:delete-param", { skill_name: skill.skill_name }),
            content: t("skills:once-deleted-other-users-can-no-longer-use-this-skill-existing-adoptions"),
            okText: t("skills:delete-skill"),
            okButtonProps: { danger: true },
            cancelText: t("skills:cancel"),
            onOk: async () => {
                try {
                    await deleteSkill(skill.skill_id);
                    setActiveSkill(null);
                    message.success(t("skills:skill-deleted"));
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("skills:failed-to-delete-skill"));
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
                        <span className="skills-hero-badge">
                            <Sparkles className="size-3.5" />
                            {t("skills:skill-gallery-2")}
                        </span>
                        <h1 id="skills-hero-title" className="skills-hero-title">
                            {t("skills:skill-library")}
                        </h1>
                        <p className="skills-hero-description">{t("skills:keep-your-favorite-prompts-character-profiles-and-creative-methods-on-yo")}</p>
                        <span className="skills-hero-meta">
                            {total} {t("skills:skills")}
                        </span>
                    </div>
                </section>

                <ListToolbar className="library-toolbar skills-toolbar mt-7" active={filtersActive} onReset={resetFilters}>
                    <div className="skills-tabs" ref={tabsRef} role="tablist" aria-label={t("skills:skill-library-scope")}>
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
                                    onClick={() => {
                                        setScope(option.value as SkillScope);
                                        setPage(1);
                                    }}
                                >
                                    <Icon className="size-4" />
                                    <span>{option.label}</span>
                                    {count !== undefined ? <span className="skills-tab-count">{count}</span> : null}
                                </button>
                            );
                        })}
                    </div>

                    <Input
                        className="min-w-0 sm:!w-56"
                        prefix={<Search className="size-4 text-foreground/38" />}
                        value={search}
                        allowClear
                        placeholder={t("skills:search-skills-or-authors")}
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                    <Select
                        className="w-28"
                        value={tag}
                        options={[{ value: "all", label: t("skills:all-categories") }, ...localizedCategories]}
                        onChange={(value) => {
                            setTag(value);
                            setPage(1);
                        }}
                    />
                    <Select
                        className="w-24"
                        value={sort}
                        options={sortOptions}
                        onChange={(value) => {
                            setSort(value);
                            setPage(1);
                        }}
                    />
                </ListToolbar>

                {loading && !skills.length ? (
                    <SkillSkeleton />
                ) : loadError ? (
                    <WorkspaceErrorState compact description={loadError} onRetry={reload} />
                ) : groupedSkills.length ? (
                    <div key={`${scope}-${page}`} className="skills-scope-panel space-y-9 py-6">
                        {groupedSkills.map((group) => {
                            const GroupIcon = categoryIconOf(group.value);
                            return (
                                <section key={group.value} aria-labelledby={`skill-category-${group.value}`}>
                                    <div className="mb-3 flex items-center justify-between px-0.5">
                                        <h2 id={`skill-category-${group.value}`} className="flex items-center gap-2 text-base font-semibold text-foreground/75">
                                            <span className="skill-group-icon">
                                                <GroupIcon />
                                            </span>
                                            {group.label}
                                        </h2>
                                        <span className="text-[var(--fs-label)] text-foreground/32">
                                            {group.skills.length} {t("skills:item")}
                                        </span>
                                    </div>
                                    <div className="library-grid skill-library-grid">
                                        {groupedSkills[0] === group ? (
                                            <button type="button" className="library-create-card" onClick={() => void openEditor()}>
                                                <span className="library-create-cover">
                                                    <Plus className="size-8" />
                                                </span>
                                                <span className="library-create-title">{t("skills:create-skill-3")}</span>
                                                <span className="library-create-meta">{t("skills:turn-a-workflow-into-a-reusable-capability")}</span>
                                            </button>
                                        ) : null}
                                        {group.skills.map((skill, index) => (
                                            <SkillCard
                                                key={skill.skill_id}
                                                skill={skill}
                                                categories={localizedCategories}
                                                loading={mutatingID === skill.skill_id}
                                                style={{ animationDelay: `${Math.min(index, 10) * 45}ms` }}
                                                onOpen={() => void openSkill(skill)}
                                                onAdd={() => void toggleAdded(skill)}
                                                onLike={() => void toggleLiked(skill)}
                                                onEdit={() => void openEditor(skill)}
                                                onDelete={() => confirmDelete(skill)}
                                            />
                                        ))}
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
                        title={filtersActive ? t("skills:no-matching-skills") : scope === "created" ? t("skills:no-skills-created-yet") : scope === "public" ? t("skills:the-gallery-is-still-empty") : t("skills:nothing-here-yet")}
                        description={
                            filtersActive
                                ? t("skills:try-a-different-keyword-or-category")
                                : scope === "favorites"
                                  ? t("skills:public-skills-you-favorite-appear-here")
                                  : scope === "mine"
                                    ? t("skills:skills-you-adopt-from-the-gallery-appear-here")
                                    : t("skills:publish-the-first-skill-and-others-can-adopt-it-right-away")
                        }
                        action={
                            filtersActive ? (
                                <Button
                                    onClick={() => {
                                        setSearch("");
                                        setTag("all");
                                        setSort("popular");
                                        setPage(1);
                                    }}
                                >
                                    {t("skills:clear-filters")}
                                </Button>
                            ) : scope === "created" || scope === "public" ? (
                                <Button type="primary" icon={<Plus className="size-4" />} onClick={() => void openEditor()}>
                                    {t("skills:create-skill-3")}
                                </Button>
                            ) : undefined
                        }
                    />
                )}

                <PaginationBar
                    current={page}
                    pageSize={pageSize}
                    total={total}
                    pageSizeOptions={[20, 40, 80]}
                    onChange={(nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    }}
                />
            </WorkspacePage>

            <SkillDetailDrawer
                skill={activeSkill}
                loading={detailLoading}
                mutating={Boolean(activeSkill && mutatingID === activeSkill.skill_id)}
                categories={localizedCategories}
                onClose={() => setActiveSkill(null)}
                onAdd={(skill) => void toggleAdded(skill)}
                onLike={(skill) => void toggleLiked(skill)}
                onEdit={(skill) => void openEditor(skill)}
            />
            <SkillEditorDrawer
                open={editorOpen}
                skill={editingSkill}
                onClose={() => setEditorOpen(false)}
                onSaved={(skill) => {
                    setEditorOpen(false);
                    setEditingSkill(null);
                    setActiveSkill(skill);
                    reload();
                }}
            />
        </>
    );
}

function SkillCard({
    skill,
    categories,
    loading,
    style,
    onOpen,
    onAdd,
    onLike,
    onEdit,
    onDelete,
}: {
    skill: Skill;
    categories: SkillCategory[];
    loading: boolean;
    style?: CSSProperties;
    onOpen: () => void;
    onAdd: () => void;
    onLike: () => void;
    onEdit: () => void;
    onDelete: () => void;
}) {
    const { t } = useTranslation("canvas");
    const CategoryIcon = categoryIconOf(skill.tag);
    return (
        <article style={style} className={`library-card library-card-surface skill-library-card group${skill.is_added ? " is-selected is-added" : ""}`}>
            <span className="library-icon-tile skill-card-icon" aria-hidden="true">
                <CategoryIcon />
            </span>
            <div className="skill-card-top">
                <button type="button" className="skill-card-title-button" onClick={onOpen}>
                    <h3>{skill.skill_name}</h3>
                </button>
                {skill.is_owner ? (
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "edit", label: t("skills:edit-skill") },
                                { key: "delete", label: t("skills:delete-skill"), danger: true },
                            ],
                            onClick: ({ key }) => (key === "edit" ? onEdit() : onDelete()),
                        }}
                    >
                        <button type="button" aria-label={t("skills:skill-actions")} className="skill-card-more">
                            <MoreHorizontal className="size-4" />
                        </button>
                    </Dropdown>
                ) : null}
            </div>
            <button type="button" className="skill-card-description" onClick={onOpen}>
                <p>{skill.description || t("skills:no-description-yet")}</p>
            </button>
            <div className="skill-card-footer">
                <button type="button" disabled={loading} className="skill-card-like" aria-label={skill.is_like ? t("skills:unfavorite") : t("skills:favorite")} onClick={onLike}>
                    <Heart className={`size-3.5 ${skill.is_like ? "fill-current text-rose-500" : ""}`} />
                    <span>{formatSkillCount(skill.like_count)}</span>
                </button>
                <span className="skill-card-author">{skill.effective_user.name || t("skills:unknown-user")}</span>
                <span className="skill-card-tag">{skillCategoryLabel(skill.tag, categories)}</span>
                {skill.is_private ? <span className="skill-card-flag">{t("skills:private")}</span> : null}
            </div>
            {/* 加入是这个页面的主行为，给它完整的按钮 + 文案 + 已加入人数，不再藏在角落的加号里。 */}
            {skill.is_owner ? (
                <div className="skill-card-action">
                    <span className="skill-card-owner-flag">{t("skills:created-by-me-2")}</span>
                    <span className="skill-card-added-count">
                        {formatSkillCount(skill.added_count)} {t("skills:users-joined")}
                    </span>
                </div>
            ) : (
                <div className="skill-card-action">
                    <button type="button" disabled={loading} aria-pressed={skill.is_added} className={`skill-card-join${skill.is_added ? " is-added" : ""}`} onClick={onAdd}>
                        {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : skill.is_added ? <Check className="size-3.5" /> : <Plus className="size-3.5" />}
                        <span>{skill.is_added ? t("skills:joined") : t("skills:add-to-my-library")}</span>
                    </button>
                    <Tooltip title={`${formatSkillCount(skill.added_count)} 人已加入`}>
                        <span className="skill-card-added-count">{formatSkillCount(skill.added_count)}</span>
                    </Tooltip>
                </div>
            )}
        </article>
    );
}

function SkillSkeleton() {
    return (
        <div className="library-grid skill-library-grid py-6">
            {Array.from({ length: 8 }, (_, index) => (
                <div key={index} className="h-[260px] animate-pulse rounded-[var(--r-xl)] bg-foreground/[.035]" />
            ))}
        </div>
    );
}
