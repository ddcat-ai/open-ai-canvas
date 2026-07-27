import { useEffect, useMemo, useState, type ReactNode } from "react";
import { App, Button, Collapse, Drawer, Input, Select, Skeleton } from "antd";
import { Check, Flame, Heart, RefreshCw, Search, ShieldCheck, Sparkles, Star, UserRound, Zap } from "lucide-react";

import { CollectionGrid, ListToolbar, PageHeader, PaginationBar, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceState } from "@/components/layout/workspace-state";
import { renderSkillPrompt } from "@/lib/canvas/canvas-skill-mentions";
import { activateSkill, deactivateSkill, favoriteSkill, getCommunitySkill, listActivatedSkills, listCommunitySkills, listFavoriteSkills, skillImageUrl, unfavoriteSkill, type UpdreamSkill, type UpdreamSkillSort } from "@/services/api/skills";

type SkillTab = "featured" | "all" | "activated" | "favorites";

const PAGE_SIZE = 20;
const tabOptions: { label: string; value: SkillTab }[] = [
    { label: "官方精选技能", value: "featured" },
    { label: "全部技能", value: "all" },
    { label: "已激活", value: "activated" },
    { label: "我的收藏", value: "favorites" },
];
const sortOptions: { label: string; value: UpdreamSkillSort }[] = [
    { label: "热门", value: "hot" },
    { label: "高分", value: "top_rated" },
    { label: "最新", value: "new" },
];

export default function SkillsPage() {
    const { message } = App.useApp();
    const [tab, setTab] = useState<SkillTab>("featured");
    const [sort, setSort] = useState<UpdreamSkillSort>("hot");
    const [category, setCategory] = useState("all");
    const [categories, setCategories] = useState<string[]>([]);
    const [search, setSearch] = useState("");
    const [debouncedSearch, setDebouncedSearch] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(PAGE_SIZE);
    const [skills, setSkills] = useState<UpdreamSkill[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [detailLoading, setDetailLoading] = useState(false);
    const [activeSkill, setActiveSkill] = useState<UpdreamSkill | null>(null);
    const [mutatingDir, setMutatingDir] = useState<string | null>(null);
    const [reloadKey, setReloadKey] = useState(0);
    const isPagedTab = tab === "featured" || tab === "all";

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 260);
        return () => window.clearTimeout(timer);
    }, [search]);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        const request =
            tab === "activated"
                ? listActivatedSkills().then(({ skills }) => ({ skills, total: skills.length, page: 1, page_size: skills.length || pageSize, categories: [] as string[] }))
                : tab === "favorites"
                  ? listFavoriteSkills().then(({ skills }) => ({ skills, total: skills.length, page: 1, page_size: skills.length || pageSize, categories: [] as string[] }))
                  : listCommunitySkills({
                        page,
                        page_size: pageSize,
                        sort: tab === "featured" ? "hot" : sort,
                        search: debouncedSearch,
                        categories: category === "all" ? undefined : [category],
                    });

        request
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills);
                setTotal(result.total);
                if (result.categories.length) setCategories((current) => Array.from(new Set([...current, ...result.categories])).sort((a, b) => a.localeCompare(b, "zh-CN")));
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setTotal(0);
                message.error(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [category, debouncedSearch, message, page, pageSize, reloadKey, sort, tab]);

    const visibleSkills = useMemo(() => {
        if (isPagedTab || !debouncedSearch) return skills;
        const query = debouncedSearch.toLowerCase();
        return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.uploader_name}`.toLowerCase().includes(query));
    }, [debouncedSearch, isPagedTab, skills]);
    const displayedSkills = isPagedTab ? visibleSkills : visibleSkills.slice((page - 1) * pageSize, page * pageSize);
    const displayedTotal = isPagedTab ? total : visibleSkills.length;

    const openSkill = async (skill: UpdreamSkill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getCommunitySkill(skill.dir);
            setActiveSkill(result.skill);
            patchSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能详情加载失败");
        } finally {
            setDetailLoading(false);
        }
    };

    const patchSkill = (next: UpdreamSkill) => {
        setSkills((items) =>
            items.flatMap((item) => {
                if (item.dir !== next.dir) return [item];
                const merged = mergeSkill(item, next);
                if (tab === "activated" && !merged.activated) return [];
                if (tab === "favorites" && !merged.liked) return [];
                return [merged];
            }),
        );
        setActiveSkill((current) => (current?.dir === next.dir ? mergeSkill(current, next) : current));
    };

    const toggleActivation = async (skill: UpdreamSkill) => {
        setMutatingDir(skill.dir);
        try {
            const result = skill.activated ? await deactivateSkill(skill.dir) : await activateSkill(skill.dir);
            patchSkill(result.skill);
            message.success(result.skill.activated ? "已激活" : "已取消激活");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "状态更新失败");
        } finally {
            setMutatingDir(null);
        }
    };

    const toggleFavorite = async (skill: UpdreamSkill) => {
        setMutatingDir(skill.dir);
        try {
            const result = skill.liked ? await unfavoriteSkill(skill.dir) : await favoriteSkill(skill.dir);
            patchSkill(result.skill);
            message.success(result.skill.liked ? "已收藏" : "已取消收藏");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "收藏更新失败");
        } finally {
            setMutatingDir(null);
        }
    };

    const refresh = () => {
        setPage(1);
        setDebouncedSearch(search.trim());
        setReloadKey((value) => value + 1);
    };

    return (
        <>
            <WorkspacePage grid>
                <PageHeader
                    icon="skills"
                    title="技能库"
                    description="浏览 Updream 技能，管理激活与收藏。"
                    meta={<span className="text-xs text-foreground/45">{displayedTotal} 个技能</span>}
                    actions={
                        <Button icon={<RefreshCw className="size-4" />} loading={loading} onClick={refresh}>
                            刷新
                        </Button>
                    }
                />
                <ListToolbar
                    active={Boolean(search || category !== "all" || tab !== "featured" || sort !== "hot")}
                    onReset={() => {
                        setSearch("");
                        setDebouncedSearch("");
                        setCategory("all");
                        setTab("featured");
                        setSort("hot");
                        setPage(1);
                    }}
                >
                    <Input
                        allowClear
                        className="w-full sm:w-80"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={search}
                        placeholder="搜索技能或作者"
                        onChange={(event) => {
                            setPage(1);
                            setSearch(event.target.value);
                        }}
                    />
                    <Select
                        className="w-44"
                        value={tab}
                        options={tabOptions}
                        onChange={(value) => {
                            setTab(value);
                            setPage(1);
                        }}
                    />
                    {isPagedTab ? (
                        <Select
                            className="w-32"
                            disabled={tab === "featured"}
                            value={tab === "featured" ? "hot" : sort}
                            options={sortOptions}
                            onChange={(value) => {
                                setSort(value);
                                setPage(1);
                            }}
                        />
                    ) : null}
                </ListToolbar>

                {isPagedTab && categories.length ? (
                    <div className="thin-scrollbar flex gap-1 overflow-x-auto border-b border-border/70 py-2" aria-label="技能分类">
                        {["all", ...categories].map((value) => (
                            <button key={value} type="button" className={`h-7 shrink-0 rounded px-2.5 text-xs transition-colors ${category === value ? "bg-foreground text-background" : "text-foreground/55 hover:bg-foreground/[.05] hover:text-foreground"}`} onClick={() => { setCategory(value); setPage(1); }}>
                                {value === "all" ? "全部分类" : value}
                            </button>
                        ))}
                    </div>
                ) : null}

                {loading ? (
                    <SkillSkeleton />
                ) : displayedSkills.length ? (
                    <CollectionGrid className="sm:grid-cols-[repeat(auto-fill,minmax(280px,1fr))] xl:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
                        {displayedSkills.map((skill) => (
                            <SkillCard key={skill.dir} skill={skill} loading={mutatingDir === skill.dir} onOpen={() => openSkill(skill)} onActivate={() => toggleActivation(skill)} onFavorite={() => toggleFavorite(skill)} />
                        ))}
                    </CollectionGrid>
                ) : (
                    <WorkspaceState icon="skills" title="暂无匹配技能" description="换一个关键词、分类或技能范围继续查找。" />
                )}

                <PaginationBar
                    current={page}
                    pageSize={pageSize}
                    total={displayedTotal}
                    pageSizeOptions={[20, 40, 80]}
                    onChange={(nextPage, nextPageSize) => {
                        setPage(nextPageSize !== pageSize ? 1 : nextPage);
                        setPageSize(nextPageSize);
                    }}
                />
            </WorkspacePage>

            <SkillDetailModal skill={activeSkill} loading={detailLoading} mutating={Boolean(activeSkill && mutatingDir === activeSkill.dir)} onClose={() => setActiveSkill(null)} onActivate={toggleActivation} onFavorite={toggleFavorite} />
        </>
    );
}

function SkillCard({ skill, loading, onOpen, onActivate, onFavorite }: { skill: UpdreamSkill; loading: boolean; onOpen: () => void; onActivate: () => void; onFavorite: () => void }) {
    return (
        <article className="app-collection-card group h-full">
            <button type="button" className="block w-full text-left" onClick={onOpen}>
                <div className="relative aspect-[16/10] overflow-hidden bg-stone-100 dark:bg-stone-900">
                    {skill.cover_url ? <img src={skillImageUrl(skill.cover_url)} alt="" className="h-full w-full object-cover" /> : <SkillCoverFallback skill={skill} />}
                    <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                        <span className="rounded bg-white/90 px-1.5 py-0.5 text-[10px] font-medium text-stone-700 backdrop-blur dark:bg-stone-950/80 dark:text-stone-200">{featuredLabel(skill.featured_label)}</span>
                        {skill.activated ? <span className="rounded bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-medium text-white">已激活</span> : null}
                    </div>
                </div>
                <div className="p-3">
                    <div className="flex items-start justify-between gap-2">
                        <h2 className="line-clamp-1 text-sm font-semibold text-stone-950 dark:text-stone-100">{skill.name}</h2>
                        <span className="shrink-0 text-[10px] text-stone-400">V{skill.version || "-"}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[11px] text-stone-500 dark:text-stone-400">
                        {skill.uploader_avatar ? <img src={skillImageUrl(skill.uploader_avatar)} alt="" className="size-4 rounded-full object-cover" /> : <UserRound className="size-3.5" />}
                        <span className="truncate">{skill.uploader_name || "未知作者"}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-5 text-stone-600 dark:text-stone-300">{skill.description || "暂无简介"}</p>
                    {skill.categories?.length ? <div className="mt-2 flex gap-1 overflow-hidden">{skill.categories.slice(0, 3).map((item) => <span key={item} className="shrink-0 rounded bg-foreground/[.055] px-1.5 py-0.5 text-[10px] text-foreground/50">{item}</span>)}</div> : null}
                </div>
            </button>
            <div className="border-t border-stone-100 px-3 py-2.5 dark:border-stone-800">
                <div className="mb-2 flex items-center gap-3 text-[10px] text-stone-500 dark:text-stone-400"><span className="inline-flex items-center gap-1"><Zap className="size-3" />{formatCount(skill.usage_count || 0)}</span><span className="inline-flex items-center gap-1"><Star className="size-3" />{skill.avg_rating ? skill.avg_rating.toFixed(1) : "-"}</span><span className="inline-flex items-center gap-1"><Heart className="size-3" />{formatCount(skill.like_count || 0)}</span></div>
                <div className="flex items-center gap-2">
                    <Button className="flex-1" loading={loading} type={skill.activated ? "default" : "primary"} icon={skill.activated ? <Check className="size-4" /> : <Zap className="size-4" />} onClick={onActivate}>
                        {skill.activated ? "已激活" : "激活"}
                    </Button>
                    <Button className="!w-10" loading={loading} icon={<Heart className={`size-4 ${skill.liked ? "fill-current text-rose-500" : ""}`} />} onClick={onFavorite} aria-label={skill.liked ? "取消收藏" : "收藏"} />
                </div>
            </div>
        </article>
    );
}

function SkillDetailModal({ skill, loading, mutating, onClose, onActivate, onFavorite }: { skill: UpdreamSkill | null; loading: boolean; mutating: boolean; onClose: () => void; onActivate: (skill: UpdreamSkill) => void; onFavorite: (skill: UpdreamSkill) => void }) {
    const injectedPrompt = skill ? renderSkillPrompt(skill) : "";

    return (
        <Drawer open={Boolean(skill)} size="large" onClose={onClose} destroyOnHidden title={skill?.name || "技能详情"}>
            {skill ? (
                <div className="space-y-4">
                    <div className="overflow-hidden rounded-md bg-stone-100 dark:bg-stone-900">{skill.cover_url ? <img src={skillImageUrl(skill.cover_url)} alt="" className="aspect-[16/8] w-full object-cover" /> : <SkillCoverFallback skill={skill} />}</div>
                    <div className="flex items-center gap-2">
                        <Button className="flex-1" loading={mutating} type={skill.activated ? "default" : "primary"} icon={skill.activated ? <Check className="size-4" /> : <Zap className="size-4" />} onClick={() => onActivate(skill)}>
                            {skill.activated ? "已激活" : "激活"}
                        </Button>
                        <Button loading={mutating} icon={<Heart className={`size-4 ${skill.liked ? "fill-current text-rose-500" : ""}`} />} onClick={() => onFavorite(skill)}>收藏</Button>
                    </div>
                    <div className="grid grid-cols-4 divide-x divide-border border-y border-border py-3 text-center">
                        <SkillMetric icon={<Flame className="size-3.5" />} label="热度" value={formatCount(skill.hot_score || 0)} />
                        <SkillMetric icon={<Zap className="size-3.5" />} label="使用" value={formatCount(skill.usage_count || 0)} />
                        <SkillMetric icon={<Heart className="size-3.5" />} label="收藏" value={formatCount(skill.like_count || 0)} />
                        <SkillMetric icon={<Star className="size-3.5" />} label="评分" value={skill.avg_rating ? skill.avg_rating.toFixed(1) : "-"} />
                    </div>
                        {loading ? (
                            <Skeleton active paragraph={{ rows: 14 }} />
                        ) : (
                            <div className="space-y-5">
                                <DetailPanel icon={<ShieldCheck className="size-4 text-stone-500" />} title="简介">
                                    <p className="text-sm leading-6 text-stone-600 dark:text-stone-300">{skill.description || "暂无简介"}</p>
                                </DetailPanel>
                                <DetailPanel icon={<Sparkles className="size-4 text-stone-500" />} title="能力说明">
                                    <pre className="thin-scrollbar max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm leading-6 text-stone-700 dark:bg-stone-900 dark:text-stone-300">{skill.detail_text || skill.description || "暂无详情"}</pre>
                                </DetailPanel>
                                <DetailPanel icon={<Zap className="size-4 text-stone-500" />} title="画布引用内容">
                                    <pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 text-sm leading-6 text-stone-700 dark:bg-stone-900 dark:text-stone-300">{injectedPrompt}</pre>
                                </DetailPanel>
                                <Collapse ghost size="small" items={[{ key: "technical", label: "技术信息", children: <div className="space-y-0 text-sm"><DetailRow label="目录" value={skill.dir} /><DetailRow label="图标标识" value={skill.icon_url || "-"} /><DetailRow label="版本" value={`V${skill.version || "-"}`} /><DetailRow label="上传者 ID" value={String(skill.uploader_id ?? "-")} /><DetailRow label="审核状态" value={skill.review_status || "-"} /><DetailRow label="共享范围" value={skill.share_scope || "-"} /><DetailRow label="更新时间" value={formatDate(skill.mtime)} /></div> }]} />
                            </div>
                        )}
                </div>
            ) : null}
        </Drawer>
    );
}

function DetailPanel({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
    return (
        <section>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-900 dark:text-stone-100">
                {icon}
                {title}
            </div>
            {children}
        </section>
    );
}

function SkillSkeleton() {
    return (
        <CollectionGrid>
            {Array.from({ length: 8 }).map((_, index) => (
                <div key={index} className="app-collection-card p-3">
                    <Skeleton.Image active className="!h-36 !w-full !rounded-md" />
                    <Skeleton active paragraph={{ rows: 3 }} className="mt-4" />
                </div>
            ))}
        </CollectionGrid>
    );
}

function SkillCoverFallback({ skill }: { skill: UpdreamSkill }) {
    return (
        <div className="flex h-full min-h-40 w-full flex-col justify-between bg-stone-100 p-4 text-stone-900 dark:bg-stone-900 dark:text-stone-100">
            <Sparkles className="size-6 text-stone-400" />
            <div>
                <div className="text-xs font-semibold uppercase text-stone-500">{skill.icon_url || "skill"}</div>
                <div className="mt-1 line-clamp-2 text-lg font-semibold leading-6">{skill.name}</div>
            </div>
        </div>
    );
}

function SkillMetric({ icon, label, value }: { icon: ReactNode; label: string; value: string }) {
    return (
        <div className="min-w-0 px-2">
            <div className="flex items-center justify-center gap-1 text-stone-400">{icon}<span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{value}</span></div>
            <div className="mt-0.5 text-[10px] text-stone-500">{label}</div>
        </div>
    );
}

function DetailRow({ label, value }: { label: string; value: string }) {
    return (
        <div className="grid grid-cols-[104px_minmax(0,1fr)] gap-2 border-b border-stone-200 py-1.5 last:border-b-0 dark:border-stone-800">
            <span className="text-xs text-stone-500">{label}</span>
            <span className="truncate text-xs font-medium text-stone-800 dark:text-stone-200" title={value}>
                {value}
            </span>
        </div>
    );
}

function mergeSkill(current: UpdreamSkill, next: UpdreamSkill) {
    return { ...current, ...next, detail_content: next.detail_content || current.detail_content };
}

function featuredLabel(label?: string) {
    if (label === "rising") return "上升";
    if (label === "new") return "新";
    if (label === "featured") return "精选";
    return label || "精选";
}

function formatCount(value: number) {
    if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
    if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
    return String(value);
}

function formatDate(value?: string) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleDateString("zh-CN");
}
