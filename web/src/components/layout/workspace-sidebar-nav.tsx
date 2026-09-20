import { Popover } from "antd";
import { Bell, ChevronDown, ChevronRight, CircleUserRound, History as HistoryIcon, Infinity as InfinityIcon, PanelLeftClose, PanelLeftOpen, Plus } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { Kbd } from "@/components/ui/base/kbd";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { WorkspaceAccountCard } from "./workspace-account-card";
import { WorkspaceSidebarCheckin } from "./workspace-sidebar-checkin";
import { WorkspaceSidebarStorageMeter } from "./workspace-sidebar-storage-meter";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";

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

function toolItem(slug: NavigationToolSlug, to: string): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool?.label ?? slug, icon: tool?.icon, to };
}

function buildNav(features: FeatureAvailability, isAdmin: boolean): { groups: WorkspaceNavGroup[]; footer: WorkspaceNavItem[] } {
    const groups: WorkspaceNavGroup[] = [
        {
            items: [
                { ...toolItem("create", "/"), id: "home", title: "创作" },
                { ...toolItem("projects", "/projects"), title: "短剧 Agent" },
                { ...toolItem("canvas", "/canvas"), title: "自由画布" },
            ],
        },
        {
            heading: "资源与工具",
            items: [{ ...toolItem("assets", "/assets"), title: "资产" }, { ...toolItem("skills", "/skills"), title: "技能" }, ...(features.pluginCenterEnabled || isAdmin ? [{ ...toolItem("plugins", "/plugins"), title: "插件" }] : [])],
        },
        ...(features.taskCenterEnabled ? [{ items: [{ ...toolItem("tasks", "/tasks"), title: "创作历史", icon: HistoryIcon }] }] : []),
    ];

    // 管理、设置和退出登录不再占据参考站式侧栏底部，而是通过用户卡片菜单进入。
    // 路由和写操作仍保留，避免把用户端导航变成无法访问的装饰。
    return { groups, footer: [] };
}

function WorkspaceSidebarProfile({ collapsed, user }: { collapsed: boolean; user: NonNullable<ReturnType<typeof useUserStore.getState>["user"]> | null }) {
    const [failed, setFailed] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user?.avatarUrl || "") ? user?.avatarUrl : "";
    const profileName = user?.displayName || user?.username || "未登录";

    useEffect(() => setFailed(false), [avatarUrl]);

    if (!user) {
        return <Link to="/login" className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label="登录" title="登录"><CircleUserRound className="size-5" /><span>登录</span></Link>;
    }

    const avatar = avatarUrl && !failed ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <CircleUserRound aria-hidden />;
    const content = <WorkspaceAccountCard onNavigate={() => setMenuOpen(false)} onWallet={() => { setMenuOpen(false); openWorkspaceWallet(); }} />;

    return (
        <div className={cn("app-workspace-sidebar-account", collapsed && "is-collapsed")}>
            <WorkspaceSidebarCheckin collapsed={collapsed} />
            <WorkspaceSidebarStorageMeter collapsed={collapsed} />
            <div className={cn("app-workspace-sidebar-profile-row", collapsed && "is-collapsed")}>
                <Popover open={menuOpen} onOpenChange={setMenuOpen} trigger="click" placement="topLeft" arrow={false} rootClassName="workspace-account-popover" content={content}>
                    <button type="button" className={cn("app-workspace-sidebar-profile", collapsed && "is-collapsed")} aria-label="打开账户菜单" title={profileName}>
                        <span className="app-workspace-sidebar-profile-avatar">{avatar}</span>
                        {!collapsed ? <span className="app-workspace-sidebar-profile-copy"><strong>{profileName}</strong><span>创作工作台</span></span> : null}
                    </button>
                </Popover>
                {!collapsed ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-sidebar-notification" /> : <span className="app-workspace-sidebar-notification-spacer" aria-hidden />}
            </div>
        </div>
    );
}

function WorkspaceSwitcher({ collapsed, onNavigate, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void; onCollapse: () => void }) {
    const appearance = useAppearanceStore((state) => state.appearance);

    if (collapsed) {
        return (
            <div className="app-workspace-sidebar-rail-header shrink-0">
                <button type="button" className="app-workspace-sidebar-rail-button" aria-label="展开侧栏菜单" title="展开侧栏菜单" onClick={onExpand}>
                    <PanelLeftOpen className="size-4" strokeWidth={1.7} />
                </button>
            </div>
        );
    }

    return (
        <div className="app-workspace-sidebar-brand-row relative shrink-0 px-3 pt-3">
            <Link to="/" onClick={onNavigate} className="app-workspace-sidebar-brand-button group" aria-label={`${appearance.brandName}首页`}>
                <span className="flex min-w-0 items-center gap-2">
                    <BrandLogoFrame className="app-workspace-brand-mark grid size-8 shrink-0 place-items-center rounded-[var(--r-sm)] shadow-sm" logoClassName="size-5 object-contain" alt="" fallback={<InfinityIcon className="size-4" strokeWidth={2.2} />} />
                    <span className="flex min-w-0 flex-col">
                        <span className="app-workspace-brand-wordmark truncate text-[var(--fs-body)] leading-none font-semibold">{appearance.brandName}</span>
                        <span className="mt-1 truncate text-[var(--fs-label)] leading-none text-foreground/60">创作工作台</span>
                    </span>
                </span>
            </Link>
            <button type="button" className="app-workspace-sidebar-collapse-button" aria-label="收起侧栏" title="收起侧栏" onClick={onCollapse}>
                <PanelLeftClose className="size-4" strokeWidth={1.7} />
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
    const isActive = activeId === item.id || (item.id === "settings" && activeId.startsWith("settings:"));
    const hasChildren = Boolean(item.children?.length);
    const [isOpen, setIsOpen] = useState(false);
    const reducedMotion = useReducedMotion();

    // 激活分支自动展开（如设置分区子项），保证当前位置可见。
    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const rowStyle = collapsed ? undefined : ({ paddingLeft: `${level * 12 + 10}px` } as CSSProperties);

    const collapsedTitle = item.id === "home" ? "创作" : item.id === "projects" ? "短剧" : item.id === "canvas" ? "画布" : item.id === "assets" ? "资产" : item.id === "skills" ? "技能" : item.id === "plugins" ? "插件" : item.id === "tasks" ? "历史" : item.title.slice(0, 2);
    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                {Icon ? (
                    <span className="app-workspace-nav-icon" aria-hidden>
                        <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                    </span>
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                <span className="app-workspace-nav-title truncate">{collapsed ? collapsedTitle : item.title}</span>
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.shortcut ? (
                    <Kbd className="hidden group-hover:inline-flex">{item.shortcut}</Kbd>
                ) : null}
                {item.badge !== undefined ? <span className="flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium tabular-nums text-primary">{item.badge}</span> : null}
                {hasChildren ? <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} /> : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group relative isolate flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] transition-[color,transform] duration-200 select-none",
        collapsed && "is-collapsed",
        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );
    const activePill = isActive ? (
        <motion.span
            layoutId="workspace-nav-active-pill"
            className="app-workspace-nav-active-pill"
            aria-hidden
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock}
        />
    ) : null;

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
        onSelect(item.id);
    };

    // 局部 const：闭包内 TS 保留窄化，供 preload 回调使用。
    const linkTo = item.to;

    return (
        <div className="flex w-full flex-col">
            {linkTo ? (
                <Link
                    to={linkTo}
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
                <button type="button" className={rowClassName} data-nav-id={item.id} style={rowStyle} aria-label={collapsed ? item.title : undefined} title={collapsed ? item.title : undefined} onClick={handleClick} aria-expanded={hasChildren ? isOpen : undefined}>
                    {activePill}
                    {rowContent}
                </button>
            )}

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        <span className="app-workspace-nav-guide-line" style={{ left: `${(level + 1) * 12 + 12.5}px` }} />
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
    const [isOpen, setIsOpen] = useState(true);
    const hasActive = group.items.some((item) => item.id === activeId || (item.id === "settings" && activeId.startsWith("settings:")));

    // 激活项所在分组自动展开，保证当前位置可见。
    useEffect(() => {
        if (hasActive) setIsOpen(true);
    }, [hasActive]);

    const content = (
        <div className="flex flex-col gap-2">
            {group.items.map((item) => (
                <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={onLogout} collapsed={collapsed} />
            ))}
        </div>
    );

    // 无标题分组（核心导航入口）常驻展示，不做折叠。
    if (!group.heading || collapsed) {
        return <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading || ""}>{content}</div>;
    }

    return (
        <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading}>
            <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="app-workspace-nav-group-toggle select-none">
                <span className="app-workspace-nav-group-label">{group.heading}</span>
                <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/35 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} />
            </button>
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="min-h-0 overflow-hidden pt-0.5">{content}</div>
            </div>
        </div>
    );
}

export function WorkspaceSidebarNav({ collapsed, onNavigate, onOpenSearch, onExpand, onCollapse }: { collapsed: boolean; onNavigate: () => void; onOpenSearch: () => void; onExpand: () => void; onCollapse: () => void }) {
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const features = useUserStore((state) => state.features);
    const user = useUserStore((state) => state.user);
    const { handleLogout } = useWorkspaceLogout();
    const { groups, footer } = useMemo(() => buildNav(features, user?.role === "admin"), [features, user?.role]);

    const slug = pathname.split("/").filter(Boolean)[0] || "home";
    const section = searchParams.get("section");
    const activeId = slug === "settings" && section ? `settings:${section}` : slug;

    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollState, setScrollState] = useState({ hasTopFade: false, hasBottomFade: false });
    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        setScrollState({
            hasTopFade: scrollTop > 0,
            hasBottomFade: scrollTop + clientHeight < scrollHeight - 1,
        });
    };
    useEffect(() => {
        handleScroll();
    }, [groups]);

    return (
        <div className={cn("app-workspace-sidebar-nav flex h-full shrink-0 flex-col", collapsed && "is-collapsed")}>
            <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} onExpand={onExpand} onCollapse={onCollapse} />

            <LayoutGroup id="workspace-sidebar-nav">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className={cn("app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-7", collapsed && "is-collapsed", scrollState.hasTopFade && "has-top-fade", scrollState.hasBottomFade && "has-bottom-fade")}
            >
                {groups.map((group, index) => (
                    <NavGroup key={index} group={group} activeId={activeId} onNavigate={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                ))}
            </div>
            </LayoutGroup>

            <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                <WorkspaceSidebarProfile collapsed={collapsed} user={user} />
                {footer.length ? <div className="mt-2 flex flex-col gap-0.5">
                    {footer.map((item) => (
                        <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} onLogout={() => void handleLogout()} collapsed={collapsed} />
                    ))}
                </div> : null}
            </div>
        </div>
    );
}
