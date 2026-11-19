import { Popover } from "antd";
import { ChevronRight, CircleHelp, Clapperboard, Film, Images, LayoutGrid, Monitor, Moon, Plus, Sparkles, Sun, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { LL2ConnectBadge } from "@/components/ll2/ll2-connect";
import { UserAvatar } from "@/components/layout/user-avatar";
import { UserGroupAvatarRing, UserGroupBadge } from "@/components/layout/user-group-badge";
import { Kbd } from "@/components/ui/base/kbd";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useThemeStore, type ThemePreference } from "@/stores/use-theme-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { ll2CreateLocalCanvas, ll2NewCanvasName } from "@/lib/ll2-workspace";
import { ll2OpenKeyDialog } from "@/stores/use-ll2-store";
import { WorkspaceAccountCard } from "./workspace-account-card";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { trackSiteTrafficAction } from "@/services/site-traffic";

/** 版本号只认构建注入的 APP_VERSION，不再另写 v0.1。 */
const APP_VERSION_LABEL = typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "v1.8.5";

export type WorkspaceNavItem = {
    id: string;
    title: string;
    icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
    to?: string;
    shortcut?: string;
    badge?: string | number;
    action?: "search" | "logout";
    children?: WorkspaceNavItem[];
};

type WorkspaceNavGroup = {
    heading?: string;
    items: WorkspaceNavItem[];
};

// 收起侧栏时只显示短名称。
const COLLAPSED_TITLE_KEYS: Record<string, string> = {
    home: "出片",
    canvas: "画布",
    assets: "资产",
    inspiration: "灵感",
    films: "片子",
};

function toolItem(slug: NavigationToolSlug, to: string, t: TFunction): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool ? t(tool.labelKey) : slug, icon: tool?.icon, to };
}

/**
 * 2026-11-18 18:57：按用户口径补回「资产」一级入口（对齐影策体验站左侧「资源与工具 / 资产」）。
 * 素材库是整页，不再只藏在一句话成片的小弹窗里；badge 显示本机素材数，让人一眼知道入口有内容。
 * 「模型广场」和「模型配置（设置）」仍收在底部小链接，不与创作入口并列。
 */
function buildNav(t: TFunction, assetCount: number): { groups: WorkspaceNavGroup[]; footer: WorkspaceNavItem[] } {
    const groups: WorkspaceNavGroup[] = [
        {
            items: [
                { ...toolItem("create", "/", t), id: "home", icon: Clapperboard, title: t("ll2.nav.create", { defaultValue: "一句话成片" }) },
                { id: "canvas", title: t("ll2.nav.canvas", { defaultValue: "无限画布" }), icon: LayoutGrid, to: "/canvas" },
                { id: "assets", title: t("ll2.nav.assets", { defaultValue: "资产" }), icon: Images, to: "/assets", ...(assetCount ? { badge: assetCount } : {}) },
                { id: "inspiration", title: t("ll2.nav.inspiration", { defaultValue: "灵感广场" }), icon: Sparkles, to: "/inspiration" },
                { id: "films", title: t("ll2.nav.films", { defaultValue: "我的片子" }), icon: Film, to: "/films" },
            ],
        },
    ];
    return { groups, footer: [] };
}

function WorkspaceSidebarProfile({ collapsed, user }: { collapsed: boolean; user: NonNullable<ReturnType<typeof useUserStore.getState>["user"]> | null }) {
    const [menuOpen, setMenuOpen] = useState(false);
    const { t } = useTranslation();
    const userGroup = useUserStore((state) => state.userGroup);
    const profileName = user?.displayName || user?.username || t("shell.guest");

    // 没有登录界面：未登录时这里显示的是 LL2 Key 连接状态与唯一填写入口。
    if (!user) {
        return (
            <div className={cn("app-workspace-sidebar-account", collapsed && "is-collapsed")}>
                <LL2ConnectBadge compact={collapsed} />
            </div>
        );
    }

    const content = (
        <WorkspaceAccountCard
            onNavigate={() => setMenuOpen(false)}
            onWallet={() => {
                setMenuOpen(false);
                openWorkspaceWallet();
            }}
        />
    );

    return (
        <div className={cn("app-workspace-sidebar-account", collapsed && "is-collapsed")}>
            <div className={cn("app-workspace-sidebar-profile-row", collapsed && "is-collapsed")}>
                <Popover open={menuOpen} onOpenChange={setMenuOpen} trigger="click" placement="topLeft" arrow={false} rootClassName="workspace-account-popover" content={content}>
                    <button type="button" className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label={t("shell.openAccountMenu")} title={profileName}>
                        <UserGroupAvatarRing>
                            <UserAvatar user={user} className="app-workspace-sidebar-profile-avatar" />
                        </UserGroupAvatarRing>
                        {!collapsed ? (
                            <span className="app-workspace-sidebar-profile-copy">
                                <strong>{profileName}</strong>
                                {userGroup?.badgeStyle === "vip" || userGroup?.badgeStyle === "svip" ? <UserGroupBadge className="self-start" /> : <span>{t("shell.workbench")}</span>}
                            </span>
                        ) : null}
                    </button>
                </Popover>
            </div>
        </div>
    );
}

function WorkspaceSwitcher({ collapsed, onNavigate, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; onCollapse: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance);
    const { t } = useTranslation();
    const mark = (
        <BrandLogoFrame
            className={cn("app-workspace-brand-mark grid shrink-0 place-items-center", !appearance.logoConfigured && "is-builtin")}
            logoClassName="size-5 object-contain"
            alt=""
            fallback={<span className="app-workspace-brand-glyph" aria-hidden />}
        />
    );
    return (
        <div className={cn("app-workspace-sidebar-brand-row relative shrink-0", collapsed && "is-collapsed")}>
            <Link to="/" onClick={onNavigate} className="app-workspace-sidebar-brand-button group" aria-label={t("shell.brandHome", { brand: appearance.brandName })}>
                {mark}
                {!collapsed ? <span className="app-workspace-brand-wordmark truncate">DMC</span> : null}
            </Link>
            <button
                type="button"
                className="product-icon-button app-workspace-brand-toggle"
                aria-label={t(collapsed ? "shell.expandSidebarMenu" : "shell.collapseSidebar")}
                title={t(collapsed ? "shell.expandSidebarMenu" : "shell.collapseSidebar")}
                onClick={collapsed ? onExpand : onCollapse}
            >
                {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
            </button>
        </div>
    );
}

function NavItem({
    item,
    activeId,
    onSelect,
    onOpenSearch,
    onLogout,
    level = 0,
    collapsed = false,
}: {
    item: WorkspaceNavItem;
    activeId: string;
    onSelect: (id: string) => void;
    onOpenSearch: () => void;
    onLogout: () => void;
    level?: number;
    collapsed?: boolean;
}) {
    const { t } = useTranslation();
    const isActive = activeId === item.id || (item.id === "settings" && activeId.startsWith("settings:"));
    const hasChildren = Boolean(item.children?.length);
    const [isOpen, setIsOpen] = useState(false);
    const reducedMotion = useReducedMotion();

    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const rowStyle = !collapsed && level ? ({ paddingLeft: `${level * 12 + 8}px` } as CSSProperties) : undefined;

    const collapsedTitle = COLLAPSED_TITLE_KEYS[item.id] ? t(COLLAPSED_TITLE_KEYS[item.id]) : item.title.slice(0, 2);
    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2">
                {Icon ? (
                    <span className="app-workspace-nav-icon" aria-hidden>
                        <Icon className="size-4.5 shrink-0" strokeWidth={2.2} />
                    </span>
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                <span className="app-workspace-nav-title truncate">{collapsed ? collapsedTitle : item.title}</span>
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.shortcut ? <Kbd className="hidden group-hover:inline-flex">{item.shortcut}</Kbd> : null}
                {item.badge !== undefined ? <span className="flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-2 py-0.5 text-[var(--fs-tiny)] font-medium tabular-nums text-primary">{item.badge}</span> : null}
                {hasChildren ? <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} /> : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group relative isolate flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] transition-[color,transform] duration-200 select-none",
        collapsed && "is-collapsed",
        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );
    const activePill = isActive ? <motion.span layoutId="workspace-nav-active-pill" className="app-workspace-nav-active-pill" aria-hidden transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock} /> : null;

    const handleClick = () => {
        if (item.action === "search") {
            onOpenSearch();
            return;
        }
        if (item.action === "logout") {
            onLogout();
            return;
        }
        if (hasChildren) {
            setIsOpen((open) => !open);
            return;
        }
        if (item.to === "/" || item.to === "/create") trackSiteTrafficAction("open_create");
        if (item.to === "/ecommerce") trackSiteTrafficAction("open_ecommerce");
        onSelect(item.id);
    };

    const linkTo = item.to;

    return (
        <div className="flex w-full flex-col">
            {linkTo ? (
                <Link
                    to={linkTo}
                    aria-current={isActive ? "page" : undefined}
                    className={rowClassName}
                    data-nav-id={item.id}
                    style={rowStyle}
                    aria-label={collapsed ? item.title : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={handleClick}
                    onFocus={() => preloadWorkspaceRoute(linkTo)}
                    onPointerDown={() => preloadWorkspaceRoute(linkTo)}
                    onPointerEnter={() => preloadWorkspaceRoute(linkTo)}
                >
                    {activePill}
                    {rowContent}
                </Link>
            ) : (
                <button
                    type="button"
                    className={rowClassName}
                    data-nav-id={item.id}
                    style={rowStyle}
                    aria-label={collapsed ? item.title : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={handleClick}
                    aria-expanded={hasChildren ? isOpen : undefined}
                >
                    {activePill}
                    {rowContent}
                </button>
            )}

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-200 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        {item.children!.map((child) => (
                            <NavItem key={child.id} item={child} activeId={activeId} onSelect={onSelect} onOpenSearch={onOpenSearch} onLogout={onLogout} level={level + 1} collapsed={false} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NavGroup({ group, activeId, onNavigate, onOpenSearch, onLogout, collapsed }: { group: WorkspaceNavGroup; activeId: string; onNavigate: () => void; onOpenSearch: () => void; onLogout: () => void; collapsed: boolean }) {
    const hasActive = group.items.some((item) => item.id === activeId || (item.id === "settings" && activeId.startsWith("settings:")));
    const [isOpen, setIsOpen] = useState(true);

    useEffect(() => {
        if (hasActive) setIsOpen(true);
    }, [hasActive]);

    const content = (
        <div className="flex flex-col gap-1">
            {group.items.map((item) => (
                <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={onLogout} collapsed={collapsed} />
            ))}
        </div>
    );

    if (!group.heading || collapsed) {
        return (
            <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading || ""}>
                {content}
            </div>
        );
    }

    return (
        <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading}>
            <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="app-workspace-nav-group-toggle select-none">
                <span className="app-workspace-nav-group-label">{group.heading}</span>
                <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/35 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} />
            </button>
            {isOpen ? <div className="min-h-0 pt-1">{content}</div> : null}
        </div>
    );
}

export function workspaceNavActiveId(pathname: string, section?: string | null) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments[0] === "toolbox" && segments[1]) return `toolbox-${segments[1]}`;
    const slug = segments[0] || "home";
    if (slug === "create") return "home";
    return slug === "settings" && section ? `settings:${section}` : slug;
}

/** 工作台顶部的「+ 新建画布」：建一张真正落本机的画布并打开。 */
function NewCanvasButton({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
    const navigate = useNavigate();
    const { t } = useTranslation();
    const create = () => {
        const count = useCanvasStore.getState().projects.length;
        onNavigate();
        void ll2CreateLocalCanvas(ll2NewCanvasName(count)).then((id) => navigate(`/canvas/${id}`));
    };
    return (
        <button type="button" className={`ll2-sidebar-new ${collapsed ? "is-collapsed" : ""}`} onClick={create} title={collapsed ? t("ll2.nav.newCanvas", { defaultValue: "新建画布" }) : undefined}>
            <Plus className="size-4 shrink-0" aria-hidden />
            {!collapsed ? <span>{t("ll2.nav.newCanvas", { defaultValue: "新建画布" })}</span> : null}
        </button>
    );
}

/** 「怎么出第一支片子」：不跳接口文档，就地展开四步白话。 */
function FirstFilmGuide() {
    const [open, setOpen] = useState(false);
    return (
        <div className="ll2-sidebar-links">
            <button type="button" className="ll2-sidebar-guide" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                <CircleHelp className="size-3.5" aria-hidden /> 怎么出第一支片子
            </button>
            {open ? (
                <div className="ll2-sidebar-guide-panel">
                    <strong>四步就能出片</strong>
                    <ol>
                        <li>写一句话，说清想拍的画面</li>
                        <li>看「本次一共」，先知道花多少钱</li>
                        <li>第一次用，填一次 LL2 Key</li>
                        <li>点「开始创作」，片子进「我的片子」</li>
                    </ol>
                    <button type="button" onClick={ll2OpenKeyDialog}>去填 Key</button>
                </div>
            ) : null}
            <div className="ll2-sidebar-sublinks">
                <Link to="/models">模型广场 · 看看价格</Link>
                <Link to="/config">设置 · 填 Key 与默认参数</Link>
            </div>
        </div>
    );
}

/** 黑夜模式开关：放在一级侧栏底部，免登录游客也能看到、也能记住。 */
const THEME_CHOICES: { value: ThemePreference; label: string; icon: ComponentType<{ className?: string }> }[] = [
    { value: "light", label: "浅色", icon: Sun },
    { value: "dark", label: "黑夜", icon: Moon },
    { value: "system", label: "跟随系统", icon: Monitor },
];

function ThemePicker({ collapsed }: { collapsed: boolean }) {
    const preference = useThemeStore((state) => state.preference);
    const setPreference = useThemeStore((state) => state.setPreference);
    return (
        <div className={cn("ll2-theme-picker", collapsed && "is-collapsed")} role="group" aria-label="界面主题">
            {!collapsed ? <span className="ll2-theme-picker-label">界面</span> : null}
            <div className="ll2-theme-picker-options">
                {THEME_CHOICES.map(({ value, label, icon: Icon }) => (
                    <button
                        key={value}
                        type="button"
                        className={cn("ll2-theme-picker-option", preference === value && "is-active")}
                        aria-pressed={preference === value}
                        title={label}
                        onClick={() => setPreference(value)}
                    >
                        <Icon className="size-3.5 shrink-0" aria-hidden />
                        {!collapsed ? <span>{label}</span> : null}
                    </button>
                ))}
            </div>
        </div>
    );
}

export function WorkspaceSidebarNav({ collapsed, onNavigate, onOpenSearch, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onOpenSearch: () => void; onExpand: () => void; onCollapse: () => void }) {
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const user = useUserStore((state) => state.user);
    const { handleLogout } = useWorkspaceLogout();
    const { t, i18n } = useTranslation();
    // 资产入口上的数字只算正常状态（回收站里的不算），素材增删后即时更新。
    const assetCount = useAssetStore((state) => state.assets.filter((a) => (a.kind === "image" || a.kind === "video") && a.status !== "archived").length);
    const { groups, footer } = useMemo(() => buildNav(t, assetCount), [t, i18n.language, assetCount]);

    const activeId = workspaceNavActiveId(pathname, searchParams.get("section"));

    const scrollRef = useRef<HTMLDivElement>(null);
    const sectionsRef = useRef<HTMLDivElement>(null);
    const [scrollState, setScrollState] = useState({ hasTopFade: false, hasBottomFade: false });
    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        const next = {
            hasTopFade: scrollTop > 0,
            hasBottomFade: scrollTop + clientHeight < scrollHeight - 1,
        };
        setScrollState((previous) => (previous.hasTopFade === next.hasTopFade && previous.hasBottomFade === next.hasBottomFade ? previous : next));
    };
    useEffect(() => {
        handleScroll();
        if (typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(handleScroll);
        if (scrollRef.current) observer.observe(scrollRef.current);
        if (sectionsRef.current) observer.observe(sectionsRef.current);
        return () => observer.disconnect();
    }, []);

    return (
        <div className={cn("app-workspace-sidebar-nav flex h-full shrink-0 flex-col", collapsed && "is-collapsed")}>
            <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} onExpand={onExpand} onCollapse={onCollapse} />
            <NewCanvasButton collapsed={collapsed} onNavigate={onNavigate} />

            <LayoutGroup id="workspace-sidebar-nav">
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className={cn(
                        "app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-7",
                        collapsed && "is-collapsed",
                        scrollState.hasTopFade && "has-top-fade",
                        scrollState.hasBottomFade && "has-bottom-fade",
                    )}
                >
                    <div ref={sectionsRef} className="app-workspace-sidebar-sections">
                        <nav className="app-workspace-sidebar-navigation" aria-label={t("nav.sections.create")}>
                            {groups.map((group, index) => (
                                <NavGroup key={index} group={group} activeId={activeId} onNavigate={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                            ))}
                        </nav>
                    </div>
                </div>
            </LayoutGroup>

            <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                {!collapsed ? <FirstFilmGuide /> : null}
                <WorkspaceSidebarProfile collapsed={collapsed} user={user} />
                <ThemePicker collapsed={collapsed} />
                {!collapsed ? <div className="ll2-sidebar-version">不用注册账号，只要填一次 Key · {APP_VERSION_LABEL} · 存这台电脑</div> : null}
                {footer.length ? (
                    <div className="mt-2 flex flex-col gap-0.5">
                        {footer.map((item) => (
                            <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
