import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Bot, Check, ChevronDown, Clapperboard, CloudDownload, Coins, CopyPlus, Focus, FolderKanban, Gauge, Infinity as InfinityIcon, LoaderCircle, MoreHorizontal, Plus, Search, Share2 } from "lucide-react";
import { Button, Dropdown } from "antd";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { canvasDockStyle } from "@/lib/canvas/canvas-aceternity-style";
import type { CanvasContextSummary } from "@/lib/canvas/canvas-context-summary";
import type { CanvasShortDramaProgress } from "@/lib/canvas/canvas-short-drama";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasMediaPerformanceMode } from "@/types/canvas";
import { CanvasShortcutsModal } from "./canvas-shortcuts-modal";

type CanvasTopBarProps = {
    projectId: string;
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    onCreateProject: () => void;
    onImportLibTV: () => void;
    onImportTapNow: () => void;
    onShare: () => void;
    agentOpen: boolean;
    agentWidth?: number;
    onToggleAgent: () => void;
    shortcutRequestNonce: number;
    mediaPerformanceMode: CanvasMediaPerformanceMode;
    onMediaPerformanceModeChange: (mode: CanvasMediaPerformanceMode) => void;
    onOpenSearch: () => void;
    projectContext?: CanvasContextSummary & { projectId: string; projectName: string };
    onEnterFocusMode: () => void;
    shortDramaGuide?: { progress: CanvasShortDramaProgress; collapsed: boolean; onToggle: () => void };
};

export function CanvasTopBar({
    projectId,
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    onCreateProject,
    onImportLibTV,
    onImportTapNow,
    onShare,
    agentOpen,
    agentWidth = 0,
    onToggleAgent,
    shortcutRequestNonce,
    mediaPerformanceMode,
    onMediaPerformanceModeChange,
    onOpenSearch,
    projectContext,
    onEnterFocusMode,
    shortDramaGuide,
}: CanvasTopBarProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const dockStyle = canvasDockStyle(theme, theme.node.text);
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits, refreshing } = useWalletBalance(user?.id, creditsEnabled);
    const titleRef = useRef<HTMLDivElement>(null);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
    const [projectQuery, setProjectQuery] = useState("");

    useEffect(() => {
        if (!projectSwitcherOpen) return;
        const closeOnCanvasBlank = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest(".canvas-project-switcher-popover, .canvas-topbar-project-switcher-trigger")) return;
            setProjectSwitcherOpen(false);
            setProjectQuery("");
        };
        document.addEventListener("pointerdown", closeOnCanvasBlank, true);
        return () => document.removeEventListener("pointerdown", closeOnCanvasBlank, true);
    }, [projectSwitcherOpen]);

    const visibleProjects = useMemo(() => {
        const query = projectQuery.trim().toLocaleLowerCase();
        return [...projects]
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
            .filter((project) => !query || project.title.toLocaleLowerCase().includes(query));
    }, [projectQuery, projects]);

    const projectMenuItems = useMemo(() => {
        const rows = visibleProjects.map((project) => ({
            key: project.id,
            label: <ProjectSwitcherItem project={project} current={project.id === projectId} />,
        }));
        if (rows.length) return rows;
        return [{ key: "empty", disabled: true, label: <span className="canvas-project-switcher-empty">未找到匹配的画布</span> }];
    }, [projectId, visibleProjects]);

    const handleShortDramaGuideToggle = () => {
        shortDramaGuide?.onToggle();
    };

    useEffect(() => {
        if (shortcutRequestNonce > 0) setShortcutsOpen(true);
    }, [shortcutRequestNonce]);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div data-agent-open={agentOpen || undefined} className="canvas-topbar pointer-events-none absolute left-0 right-0 top-0 z-[var(--z-toolbar)] flex h-[var(--canvas-topbar-h)] items-center justify-between px-4 sm:px-5" style={{ "--canvas-agent-shift": agentOpen ? `${Math.max(0, agentWidth) + 7}px` : "0px" } as CSSProperties}>
                <div className="canvas-topbar-cluster canvas-topbar-project-cluster pointer-events-auto flex min-w-0 items-center gap-2" style={dockStyle}>
                    <Link to="/" className="canvas-topbar-brand-link" aria-label="返回首页" title="返回首页">
                        <BrandLogoFrame className="canvas-topbar-brand-mark" logoClassName="canvas-topbar-brand-logo" alt="" fallback={<InfinityIcon className="size-4" strokeWidth={2} />} />
                    </Link>

                    <div ref={titleRef} className="canvas-topbar-title-block flex min-w-0 flex-auto flex-col items-start overflow-hidden">
                        <div className="canvas-topbar-title-row flex min-w-0 items-center">
                            {isTitleEditing ? (
                                <input
                                    autoFocus
                                    value={titleDraft}
                                    onChange={(event) => onTitleDraftChange(event.target.value.slice(0, 32))}
                                    maxLength={32}
                                    onBlur={onFinishTitleEditing}
                                    onKeyDown={(event) => {
                                        if (event.key === "Enter") onFinishTitleEditing();
                                        if (event.key === "Escape") onCancelTitleEditing();
                                    }}
                                    className="canvas-topbar-title-input h-8 w-auto min-w-12 max-w-[min(280px,42vw)] appearance-none border-0 bg-transparent text-left text-base font-semibold tracking-normal"
                                    style={{ color: theme.node.text, caretColor: theme.accent.primary }}
                                    aria-label="画布名称"
                                />
                            ) : (
                                <button type="button" className="canvas-topbar-title-button min-w-0 flex-1 truncate text-left text-base font-semibold tracking-normal" onClick={onStartTitleEditing} title="点击修改画布名称">
                                    {title}
                                </button>
                            )}
                            <Dropdown
                                trigger={["click"]}
                                open={projectSwitcherOpen}
                                onOpenChange={(open) => {
                                    setProjectSwitcherOpen(open);
                                    if (!open) setProjectQuery("");
                                }}
                                placement="bottomLeft"
                                classNames={{ root: "canvas-project-switcher-dropdown" }}
                                popupRender={(menu) => (
                                    <div className="canvas-project-switcher-popover">
                                        <label className="canvas-project-switcher-search">
                                            <Search className="size-3.5 shrink-0" aria-hidden="true" />
                                            <input
                                                type="search"
                                                value={projectQuery}
                                                onChange={(event) => setProjectQuery(event.target.value)}
                                                onKeyDown={(event) => event.stopPropagation()}
                                                placeholder="搜索画布"
                                                aria-label="搜索画布"
                                            />
                                        </label>
                                        <div className="canvas-project-switcher-list">{menu}</div>
                                        <div className="canvas-project-switcher-footer">
                                            <button
                                                type="button"
                                                className="canvas-project-switcher-create"
                                                onClick={() => {
                                                    setProjectSwitcherOpen(false);
                                                    setProjectQuery("");
                                                    onCreateProject();
                                                }}
                                            >
                                                <Plus className="size-4" aria-hidden="true" />
                                                <span>新建画布</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                                menu={{
                                    selectedKeys: [projectId],
                                    items: projectMenuItems,
                                    onClick: ({ key }) => {
                                        setProjectSwitcherOpen(false);
                                        setProjectQuery("");
                                        if (key !== "empty" && key !== projectId) navigate(`/canvas/${key}`);
                                    },
                                }}
                            >
                                <button type="button" className="canvas-topbar-project-switcher-trigger" aria-label="切换画布" aria-haspopup="menu" aria-expanded={projectSwitcherOpen}>
                                    <ChevronDown className="size-3.5" aria-hidden="true" />
                                </button>
                            </Dropdown>
                        </div>
                        {projectContext && !isTitleEditing ? (
                            <div className="canvas-topbar-project-context mt-0.5 flex w-full min-w-0 items-center gap-1.5 overflow-hidden text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                                <Link to={`/projects/${projectContext.projectId}/overview`} className="inline-flex min-w-0 items-center gap-1 hover:underline" title={`返回项目：${projectContext.projectName}`}>
                                    <FolderKanban className="size-3 shrink-0" />
                                    <span className="max-w-[120px] truncate">{projectContext.projectName}</span>
                                </Link>
                                <span aria-hidden>·</span>
                                <button type="button" className="min-w-0 truncate hover:underline" onClick={onOpenSearch} title="搜索并定位章节或镜头">
                                    {projectContext.chapterLabel || `${projectContext.nodeCount} 个节点`}
                                    {projectContext.shotLabel ? ` · ${projectContext.shotLabel}` : ""}
                                    {projectContext.selectedCount ? ` · 已选 ${projectContext.selectedCount}` : ""}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <div className="canvas-topbar-user-cluster pointer-events-auto flex items-center gap-1.5">
                    <CanvasTopBarTooltip label="搜索画布节点" className="canvas-topbar-tooltip-match-toolbar">
                        <Button
                            type="text"
                            className="canvas-topbar-action canvas-topbar-search !h-10 !w-10 !min-w-10 !rounded-full !p-0"
                            style={{ color: theme.node.text, ...dockStyle }}
                            icon={<Search className="size-4" />}
                            aria-label="搜索画布节点"
                            onClick={onOpenSearch}
                        />
                    </CanvasTopBarTooltip>
                    <Dropdown
                        trigger={["hover"]}
                        mouseEnterDelay={0}
                        mouseLeaveDelay={0.2}
                        placement="bottomRight"
                            menu={{
                                selectedKeys: [`performance-${mediaPerformanceMode}`],
                                items: [
                                    {
                                        key: "performance",
                                        icon: <Gauge className="size-4" />,
                                        label: "媒体性能",
                                        children: [
                                            { key: "performance-auto", label: "自动性能", onClick: () => onMediaPerformanceModeChange("auto") },
                                            { key: "performance-quality", label: "画质优先", onClick: () => onMediaPerformanceModeChange("quality") },
                                            { key: "performance-performance", label: "性能优先", onClick: () => onMediaPerformanceModeChange("performance") },
                                        ],
                                    },
                                    { key: "focus", icon: <Focus className="size-4" />, label: "进入专注模式", onClick: onEnterFocusMode },
                                    { key: "share", icon: <Share2 className="size-4" />, label: "分享画布", onClick: onShare },
                                    { type: "divider" },
                                    { key: "libtv", icon: <CopyPlus className="size-4" />, label: "导入 LibTV 画布", onClick: onImportLibTV },
                                    { key: "tapnow", icon: <CloudDownload className="size-4" />, label: "导入 TapNow 画布", onClick: onImportTapNow },
                                ],
                            }}
                        >
                            <Button type="text" className="canvas-topbar-action canvas-topbar-more !h-10 !w-10 !min-w-10 !rounded-full !p-0" style={{ color: theme.node.text, ...dockStyle }} icon={<MoreHorizontal className="size-4" />} aria-label="更多画布操作" />
                    </Dropdown>
                    <CanvasTopBarTooltip label="进入专注模式（Shift + Ctrl/Cmd + F）">
                        <Button
                            type="text"
                            className="canvas-topbar-action canvas-topbar-focus !h-10 !w-10 !min-w-10 !rounded-xl !p-0"
                            style={{ color: theme.node.text }}
                            icon={<Focus className="size-4" />}
                            onClick={onEnterFocusMode}
                            aria-label="进入专注模式"
                        />
                    </CanvasTopBarTooltip>
                    {shortDramaGuide ? (
                        <CanvasTopBarTooltip label={shortDramaGuide.collapsed ? "展开短剧流程" : "收起短剧流程"}>
                            <Button
                                type="text"
                                className="canvas-topbar-action canvas-topbar-drama !h-10 !rounded-xl !px-2.5 !font-medium"
                                style={{ color: theme.node.text, background: shortDramaGuide.collapsed ? undefined : theme.toolbar.activeBg }}
                                icon={<Clapperboard className="size-4" />}
                                onClick={handleShortDramaGuideToggle}
                                aria-label="短剧流程"
                                aria-pressed={!shortDramaGuide.collapsed}
                            >
                                <span className="tabular-nums">{shortDramaGuide.progress.completedCount}/5</span>
                            </Button>
                        </CanvasTopBarTooltip>
                    ) : null}
                    <CanvasTopBarTooltip label="分享画布">
                        <Button type="text" className="canvas-topbar-action canvas-topbar-share !h-10 !w-10 !min-w-10 !rounded-xl !p-0" style={{ color: theme.node.text }} icon={<Share2 className="size-4" />} onClick={onShare} aria-label="分享画布" />
                    </CanvasTopBarTooltip>
                    <div className="canvas-topbar-account-wrap">
                        <Link to="/wallet" className="canvas-topbar-account-pill" aria-label="进入积分中心">
                            {user && creditsEnabled ? <span className="canvas-topbar-account-credits">{refreshing && availableMicrocredits === null ? <LoaderCircle className="size-3.5 animate-spin opacity-60" /> : <Coins className="size-3.5" />}<span>{availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}</span></span> : null}
                            <span className="canvas-topbar-user-avatar">
                                {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : (user?.displayName || user?.username || "U").slice(0, 1).toUpperCase()}
                            </span>
                        </Link>
                    </div>
                    <Button
                        type="text"
                        className="canvas-topbar-action canvas-topbar-agent !h-10 !rounded-xl !px-3 !font-medium"
                        style={{ background: agentOpen ? theme.toolbar.activeBg : "transparent", color: theme.node.text }}
                        icon={<Bot className="size-4" />}
                        onClick={onToggleAgent}
                        aria-pressed={agentOpen}
                    >
                        Agent
                    </Button>
                </div>
            </div>
            <CanvasShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
        </>
    );
}

function CanvasTopBarTooltip({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
    return (
        <span className="group relative inline-flex">
            {children}
            <span role="tooltip" className={`aceternity-dock-tooltip pointer-events-none absolute left-1/2 top-[calc(100%+8px)] z-[var(--dock-tooltip-z)] -translate-x-1/2 translate-y-1 whitespace-nowrap rounded-md border px-2 py-1 text-[var(--fs-tiny)] font-medium opacity-0 shadow-xl backdrop-blur-xl transition-all duration-150 motion-reduce:transition-none group-hover:translate-y-0 group-hover:opacity-100 group-focus-within:translate-y-0 group-focus-within:opacity-100 ${className}`}>
                {label}
            </span>
        </span>
    );
}
function ProjectSwitcherItem({ project, current }: { project: CanvasProject; current: boolean }) {
    return (
        <span className="canvas-project-switcher-item">
            <span className="canvas-project-switcher-thumb" aria-hidden="true">
                {project.nodes.length === 0 ? (
                    <svg className="canvas-project-switcher-placeholder" viewBox="0 0 32 32" fill="none">
                        <g className="canvas-project-switcher-placeholder-haze">
                            <ellipse cx="24" cy="8" rx="11" ry="13" />
                            <ellipse cx="5" cy="27" rx="12" ry="10" />
                        </g>
                        <rect className="canvas-project-switcher-placeholder-back" x="7" y="6" width="16" height="20" rx="3" transform="rotate(-12 15 16)" />
                        <rect className="canvas-project-switcher-placeholder-sheet" x="10" y="8" width="15" height="19" rx="3" transform="rotate(7 17.5 17.5)" />
                        <path className="canvas-project-switcher-placeholder-glint" d="M13 11h7M13 14h4" strokeLinecap="round" />
                    </svg>
                ) : <ProjectPreview project={project} />}
            </span>
            <span className="canvas-project-switcher-name">{project.title || "未命名画布"}</span>
            {current ? <Check className="canvas-project-switcher-check size-4" aria-hidden="true" /> : null}
        </span>
    );
}
