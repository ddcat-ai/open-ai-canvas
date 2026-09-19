import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Input } from "antd";
import { Check, LoaderCircle, Plus, Search, Sparkles, Users } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import type { CanvasTheme } from "@/lib/canvas-theme";
import type { Skill, SkillCategory } from "@/services/api/skills";

type SkillLibraryTab = "enabled" | "installed" | "market";

type CanvasAgentSkillLibraryModalProps = {
    open: boolean;
    theme: CanvasTheme;
    installedSkills: Skill[];
    marketSkills: Skill[];
    selectedSkillIds: string[];
    categories: SkillCategory[];
    category: string;
    search: string;
    loading: boolean;
    hasMore: boolean;
    onClose: () => void;
    onCategoryChange: (value: string) => void;
    onSearch: (value: string) => void;
    onToggle: (skillId: string) => void;
    onInstall: (skill: Skill) => Promise<void>;
    onLoadMore: () => Promise<void>;
};

export function CanvasAgentSkillLibraryModal({
    open,
    theme,
    installedSkills,
    marketSkills,
    selectedSkillIds,
    categories,
    category,
    search,
    loading,
    hasMore,
    onClose,
    onCategoryChange,
    onSearch,
    onToggle,
    onInstall,
    onLoadMore,
}: CanvasAgentSkillLibraryModalProps) {
    const [tab, setTab] = useState<SkillLibraryTab>("market");
    const listRef = useRef<HTMLDivElement>(null);
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const wasOpenRef = useRef(false);
    const selectedCount = selectedSkillIds.length;

    useEffect(() => {
        if (open && !wasOpenRef.current) setTab("market");
        wasOpenRef.current = open;
    }, [open]);

    useEffect(() => {
        listRef.current?.scrollTo({ top: 0 });
    }, [category, search, tab]);

    const visibleSkills = useMemo(() => {
        const keyword = search.trim().toLocaleLowerCase("zh-CN");
        const source = tab === "enabled"
            ? installedSkills.filter((skill) => selectedSkillIds.includes(skill.skillId))
            : tab === "installed"
                ? installedSkills
                : marketSkills;

        return source.filter((skill) => {
            if (category !== "all" && skill.tag !== category) return false;
            if (!keyword) return true;
            return `${skill.skillName} ${skill.description || ""} ${skill.effectiveUser?.name || ""}`
                .toLocaleLowerCase("zh-CN")
                .includes(keyword);
        });
    }, [category, installedSkills, marketSkills, search, selectedSkillIds, tab]);

    useEffect(() => {
        const target = loadMoreRef.current;
        if (tab !== "market" || !target || !hasMore || loading || typeof IntersectionObserver === "undefined") return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) void onLoadMore();
        }, { root: listRef.current, rootMargin: "180px 0px" });
        observer.observe(target);
        return () => observer.disconnect();
    }, [hasMore, loading, onLoadMore, tab, visibleSkills.length]);

    const categoryItems = useMemo(() => {
        const unique = new Map<string, SkillCategory>();
        categories.forEach((item) => {
            if (item.value && item.value !== "all" && item.label) unique.set(item.value, item);
        });
        return [...unique.values()];
    }, [categories]);

    const emptyText = tab === "enabled"
        ? "本轮还没有启用技能，可在“我的技能”中选择"
        : tab === "installed"
            ? "还没有匹配的已加入技能，可前往“全部”添加"
            : "没有匹配的公开技能，换个关键词或分类试试";

    const changeTab = (value: SkillLibraryTab) => {
        setTab(value);
        onCategoryChange("all");
    };

    return (
        <AppModal
            rootClassName="canvas-agent-skill-library-modal"
            open={open}
            title={null}
            footer={null}
            centered
            width="min(1180px, 66vw)"
            closable={false}
            modalRender={(modal) => (
                <div className="canvas-agent-skill-library-frame">
                    <button type="button" className="canvas-agent-skill-library-close" aria-label="关闭技能商店" onClick={onClose}>
                        <kbd>ESC</kbd><span>关闭</span>
                    </button>
                    {modal}
                </div>
            )}
            onCancel={onClose}
            flush
        >
            <section
                className="canvas-agent-skill-library-shell"
                style={{ color: theme.node.text, background: theme.node.panel }}
                data-canvas-no-zoom
                data-canvas-wheel-scroll
                aria-label="Agent Skills 技能库"
            >
                <aside className="canvas-agent-skill-library-sidebar">
                    <Input
                        allowClear
                        prefix={<Search className="size-4" style={{ color: theme.node.muted }} aria-hidden="true" />}
                        value={search}
                        onChange={(event) => onSearch(event.target.value)}
                        placeholder="搜索技能"
                        aria-label="搜索技能名称、说明或作者"
                        className="canvas-agent-skill-library-search"
                    />
                    <nav className="canvas-agent-skill-library-categories thin-scrollbar" aria-label="技能视图与分类">
                        <SkillTab active={tab === "market" && category === "all"} label="全部" onClick={() => changeTab("market")} />
                        <SkillTab active={tab === "installed"} label="我的技能" count={installedSkills.length} onClick={() => changeTab("installed")} />
                        <SkillTab active={tab === "enabled"} label="已启用" count={selectedCount} onClick={() => changeTab("enabled")} />
                        {categoryItems.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className={`canvas-agent-skill-library-tab ${tab === "market" && category === item.value ? "is-active" : ""}`}
                                aria-pressed={tab === "market" && category === item.value}
                                onClick={() => { setTab("market"); onCategoryChange(item.value); }}
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>
                </aside>

                <div className="canvas-agent-skill-library-content">
                    <header className="canvas-agent-skill-library-header">
                        <h2>技能商店</h2>
                        <button type="button" className="canvas-agent-skill-library-count" onClick={() => changeTab("enabled")} aria-label={`查看本轮已启用的 ${selectedCount} 个技能，最多 8 个`}>
                            已启用 <strong>{selectedCount}</strong><span> / 8</span>
                        </button>
                    </header>

                    <div ref={listRef} className="canvas-agent-skill-library-list thin-scrollbar" aria-label="技能列表" aria-busy={loading}>
                        {visibleSkills.map((skill) => (
                            <SkillLibraryCard
                                key={skill.skillId}
                                skill={skill}
                                theme={theme}
                                categories={categories}
                                selected={selectedSkillIds.includes(skill.skillId)}
                                canSelect={selectedCount < 8 || selectedSkillIds.includes(skill.skillId)}
                                onToggle={() => onToggle(skill.skillId)}
                                onInstall={() => onInstall(skill)}
                            />
                        ))}
                        {loading && visibleSkills.length === 0 ? (
                            <div className="canvas-agent-skill-library-state" style={{ color: theme.node.muted }}>
                                <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                                正在读取技能库…
                            </div>
                        ) : null}
                        {!loading && visibleSkills.length === 0 ? (
                            <div className="canvas-agent-skill-library-state" style={{ color: theme.node.muted }}>
                                <Sparkles className="size-6" aria-hidden="true" />
                                <span>{emptyText}</span>
                                {tab !== "market" ? <Button size="small" onClick={() => changeTab("market")}>浏览公开技能</Button> : null}
                            </div>
                        ) : null}
                        {tab === "market" && hasMore ? <div ref={loadMoreRef} className="col-span-full h-px" aria-hidden="true" /> : null}
                    </div>

                    <footer className="canvas-agent-skill-library-footer" style={{ color: theme.node.muted, borderColor: theme.node.stroke }}>
                        <span>{tab === "enabled" ? `${selectedCount} 个技能将在本轮生效` : tab === "installed" ? `${visibleSkills.length} 个已加入技能` : `已加载 ${marketSkills.length} 个公开技能`}</span>
                        {tab === "market" && hasMore ? (
                            <Button size="small" disabled={loading} loading={loading} onClick={() => void onLoadMore()}>{loading ? "加载中" : "加载更多"}</Button>
                        ) : <span>{tab === "market" ? "已加载全部" : "最多启用 8 个"}</span>}
                    </footer>
                </div>
            </section>
        </AppModal>
    );
}

function SkillTab({ active, label, count, onClick }: { active: boolean; label: string; count?: number; onClick: () => void }) {
    return (
        <button type="button" aria-pressed={active} className={`canvas-agent-skill-library-tab ${active ? "is-active" : ""}`} onClick={onClick}>
            {label}
            {typeof count === "number" ? <span>{count}</span> : null}
        </button>
    );
}

function SkillLibraryCard({ skill, theme, categories, selected, canSelect, onToggle, onInstall }: {
    skill: Skill;
    theme: CanvasTheme;
    categories: SkillCategory[];
    selected: boolean;
    canSelect: boolean;
    onToggle: () => void;
    onInstall: () => Promise<void>;
}) {
    const [installing, setInstalling] = useState(false);
    const [coverFailed, setCoverFailed] = useState(false);
    const cover = skill.showcaseMedia?.find((item) => item.type === "image" && item.showcaseUrl)
        || skill.showcaseMedia?.find((item) => item.showcaseUrl);
    const coverUrl = cover?.showcaseUrl;
    const categoryLabel = categories.find((item) => item.value === skill.tag)?.label || "其他";
    const author = skill.effectiveUser?.name || "影策创作者";
    const addedCount = formatSkillCount(skill.addedCount || 0);

    useEffect(() => setCoverFailed(false), [coverUrl]);

    const install = async () => {
        if (installing) return;
        setInstalling(true);
        try {
            await onInstall();
        } finally {
            setInstalling(false);
        }
    };

    return (
        <article className={`canvas-agent-skill-card ${selected ? "is-selected" : ""}`}>
            <div className="canvas-agent-skill-card-cover">
                {coverUrl && !coverFailed ? (
                    cover?.type === "video"
                        ? <video src={coverUrl} muted playsInline preload="metadata" onError={() => setCoverFailed(true)} />
                        : <img src={coverUrl} alt="" loading="lazy" onError={() => setCoverFailed(true)} />
                ) : (
                    <div className="canvas-agent-skill-card-placeholder" aria-hidden="true">
                        <Sparkles className="size-7" />
                    </div>
                )}
                <span className="canvas-agent-skill-card-category">{categoryLabel}</span>
                {selected ? <span className="canvas-agent-skill-card-selected" aria-label="本轮已启用"><Check className="size-4" aria-hidden="true" /></span> : null}
            </div>
            <div className="canvas-agent-skill-card-body">
                <div className="canvas-agent-skill-card-title-row">
                    <h3 title={skill.skillName}>{skill.skillName}</h3>
                    <div className="canvas-agent-skill-card-action">
                        {skill.isAdded ? (
                            <Button
                                size="small"
                                type="default"
                                className={selected ? "is-selected" : ""}
                                disabled={!canSelect}
                                aria-pressed={selected}
                                title={!canSelect ? "本轮最多启用 8 个 Skills" : undefined}
                                onClick={onToggle}
                            >
                                {selected ? "已启用" : "使用"}
                            </Button>
                        ) : (
                            <Button size="small" icon={<Plus className="size-3.5" />} loading={installing} disabled={installing || !canSelect} title={!canSelect ? "本轮最多启用 8 个 Skills" : undefined} onClick={() => void install()}>
                                加入
                            </Button>
                        )}
                    </div>
                </div>
                <div className="canvas-agent-skill-card-meta" style={{ color: theme.node.muted }}>
                    <span className="min-w-0 truncate">{author}</span>
                    {skill.version ? <><span aria-hidden="true">·</span><span className="canvas-agent-skill-card-version">v{skill.version}</span></> : null}
                    <span className="inline-flex shrink-0 items-center gap-1"><Users className="size-3.5" aria-hidden="true" />{addedCount}</span>
                </div>
                <p title={skill.description || "暂无技能说明"}>{skill.description || "暂无技能说明"}</p>
            </div>
        </article>
    );
}

function formatSkillCount(value: number) {
    return new Intl.NumberFormat("zh-CN", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}
