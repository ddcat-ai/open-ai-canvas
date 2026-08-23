import { ChevronDown, ChevronRight, Home, Infinity as InfinityIcon, LogOut, PanelLeftOpen, Plus, Search, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";

import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore, type FeatureAvailability } from "@/stores/use-user-store";

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

/** 设置页分区子项，沿用 /settings?section=<key> 路由合同。 */
const SETTINGS_SECTIONS: Array<{ key: string; label: string }> = [
    { key: "local-cli", label: "本机工具" },
    { key: "channels", label: "自定义渠道" },
    { key: "models", label: "模型选择" },
    { key: "preferences", label: "生成偏好" },
    { key: "prompts", label: "提示词偏好" },
    { key: "storage", label: "我的对象存储" },
];

function toolItem(slug: NavigationToolSlug, to: string): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool?.label ?? slug, icon: tool?.icon, to };
}

function buildNav(features: FeatureAvailability, balance: string, isAdmin: boolean): { groups: WorkspaceNavGroup[]; footer: WorkspaceNavItem[] } {
    const groups: WorkspaceNavGroup[] = [
        {
            items: [
                { id: "home", title: "首页", icon: Home, to: "/home" },
                toolItem("create", "/create"),
                ...(features.shortDramaEnabled ? [toolItem("projects", "/projects")] : []),
                toolItem("canvas", "/canvas"),
                ...(features.taskCenterEnabled ? [toolItem("tasks", "/tasks")] : []),
                toolItem("assets", "/assets"),
            ],
        },
        {
            heading: "工作台管理",
            items: [
                toolItem("skills", "/skills"),
                ...(features.pluginCenterEnabled || isAdmin ? [toolItem("plugins", "/plugins")] : []),
                ...(features.creditsEnabled ? [{ ...toolItem("wallet", "/wallet"), badge: balance }] : []),
            ],
        },
    ];

    const settingsSections = SETTINGS_SECTIONS.filter((section) => section.key !== "channels" || features.customChannelsEnabled);
    const footer: WorkspaceNavItem[] = [
        ...(isAdmin ? [{ id: "admin", title: "管理员后台", icon: ShieldCheck, to: "/admin" }] : []),
        {
            ...toolItem("settings", "/settings"),
            children: settingsSections.map((section) => ({
                id: `settings:${section.key}`,
                title: section.label,
                to: `/settings?section=${section.key}`,
            })),
        },
        { id: "logout", title: "退出登录", icon: LogOut, action: "logout" },
    ];

    return { groups, footer };
}

function WorkspaceSwitcher({ collapsed, onNavigate, onExpand }: { collapsed: boolean; onNavigate: () => void; onExpand: () => void }) {
    const [isOpen, setIsOpen] = useState(false);
    const navigate = useNavigate();

    const go = (to: string) => {
        setIsOpen(false);
        onNavigate();
        navigate(to);
    };

    if (collapsed) {
        return (
            <div className="app-workspace-sidebar-rail-header shrink-0">
                <button
                    type="button"
                    className="app-workspace-sidebar-rail-button"
                    aria-label="展开侧栏菜单"
                    title="展开侧栏菜单"
                    onClick={onExpand}
                >
                    <PanelLeftOpen className="size-4" strokeWidth={1.7} />
                </button>
            </div>
        );
    }

    return (
        <div className="relative shrink-0 px-3 pt-3">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-haspopup="listbox"
                aria-expanded={isOpen}
                className="group flex w-full items-center justify-between rounded-[var(--r-sm)] px-2 py-2 text-left transition-colors select-none hover:bg-surface-hover"
            >
                <span className="flex min-w-0 items-center gap-3">
                    <span className="app-workspace-brand-mark grid size-8 shrink-0 place-items-center rounded-[var(--r-sm)] shadow-sm">
                        <InfinityIcon className="size-4" strokeWidth={2} />
                    </span>
                    <span className="flex min-w-0 flex-col">
                        <span className="app-workspace-brand-wordmark truncate text-[var(--fs-body)] leading-none font-medium">影策</span>
                        <span className="mt-1 truncate text-[var(--fs-label)] leading-none text-foreground/42">创作工作台</span>
                    </span>
                </span>
                <ChevronDown className="size-4 shrink-0 text-foreground/40 transition-colors group-hover:text-foreground/70" strokeWidth={1.5} />
            </button>

            {isOpen ? (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="app-workspace-nav-popover absolute left-3 right-3 top-full z-50 mt-1 overflow-hidden rounded-lg border border-[var(--workspace-border)] bg-[var(--workspace-surface-strong)] py-1 animate-in fade-in zoom-in-95 duration-100">
                        <div className="px-3 py-2.5">
                            <div className="truncate text-[var(--fs-body)] font-semibold">影策</div>
                            <div className="mt-0.5 truncate text-[var(--fs-label)] text-foreground/45">创作工作台</div>
                        </div>
                        <div className="mx-2 my-1 h-px bg-[var(--workspace-border)]" />
                        {[
                            { label: "首页", to: "/home" },
                            { label: "画布", to: "/canvas" },
                            { label: "设置", to: "/settings" },
                        ].map((entry) => (
                            <button
                                key={entry.to}
                                type="button"
                                onClick={() => go(entry.to)}
                                className="flex w-full items-center gap-2 px-3 py-2 text-[var(--fs-body)] text-foreground/80 transition-colors hover:bg-surface-hover hover:text-foreground"
                            >
                                {entry.label}
                            </button>
                        ))}
                        <div className="mx-2 my-1 h-px bg-[var(--workspace-border)]" />
                        <button
                            type="button"
                            onClick={() => go("/canvas?mode=new")}
                            className="flex w-full items-center gap-2 px-3 py-2 text-[var(--fs-body)] text-foreground/45 transition-colors hover:bg-surface-hover hover:text-foreground"
                        >
                            <Plus className="size-3.5" /> 新建画布
                        </button>
                    </div>
                </>
            ) : null}
        </div>
    );
}

function NavItem({ item, activeId, onSelect, onOpenSearch, onLogout, level = 0, collapsed = false }: {
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

    // 激活分支自动展开（如设置分区子项），保证当前位置可见。
    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const rowStyle = collapsed ? undefined : ({ paddingLeft: `${level * 12 + 10}px` } as CSSProperties);

    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                {Icon ? (
                    <Icon className={cn("size-4 shrink-0", isActive ? "text-foreground" : "text-foreground/60 group-hover:text-foreground/80")} strokeWidth={1.6} />
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                <span className="app-workspace-nav-title truncate">{item.title}</span>
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.shortcut ? (
                    <kbd className="hidden h-5 items-center justify-center rounded-sm border border-[var(--workspace-border)] bg-background/50 px-1.5 font-mono text-[var(--fs-tiny)] font-medium text-foreground/55 group-hover:inline-flex">
                        {item.shortcut}
                    </kbd>
                ) : null}
                {item.badge !== undefined ? (
                    <span className="flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium tabular-nums text-primary">
                        {item.badge}
                    </span>
                ) : null}
                {hasChildren ? (
                    <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} />
                ) : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group flex min-h-9 w-full items-center justify-between gap-2 rounded-[var(--r-sm)] px-2.5 py-2 text-[var(--fs-body)] transition-colors duration-200 select-none",
        collapsed && "is-collapsed",
        isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );

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
                    style={rowStyle}
                    aria-label={collapsed ? item.title : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={handleClick}
                    onFocus={() => preloadWorkspaceRoute(linkTo)}
                    onPointerDown={() => preloadWorkspaceRoute(linkTo)}
                    onPointerEnter={() => preloadWorkspaceRoute(linkTo)}
                >
                    {rowContent}
                </Link>
            ) : (
                <button
                    type="button"
                    className={rowClassName}
                    style={rowStyle}
                    aria-label={collapsed ? item.title : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={handleClick}
                    aria-expanded={hasChildren ? isOpen : undefined}
                >
                    {rowContent}
                </button>
            )}

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        <span className="app-workspace-nav-guide-line" style={{ left: `${(level + 1) * 12 + 12.5}px` }} />
                        {item.children!.map((child) => (
                            <NavItem
                                key={child.id}
                                item={child}
                                activeId={activeId}
                                onSelect={onSelect}
                                onOpenSearch={onOpenSearch}
                                onLogout={onLogout}
                                level={level + 1}
                                collapsed={false}
                            />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NavGroup({ group, activeId, onNavigate, onOpenSearch, onLogout, collapsed }: {
    group: WorkspaceNavGroup;
    activeId: string;
    onNavigate: () => void;
    onOpenSearch: () => void;
    onLogout: () => void;
    collapsed: boolean;
}) {
    const [isOpen, setIsOpen] = useState(true);
    const hasActive = group.items.some((item) => item.id === activeId || (item.id === "settings" && activeId.startsWith("settings:")));

    // 激活项所在分组自动展开，保证当前位置可见。
    useEffect(() => {
        if (hasActive) setIsOpen(true);
    }, [hasActive]);

    const content = (
        <div className="flex flex-col gap-0.5">
            {group.items.map((item) => (
                <NavItem
                    key={item.id}
                    item={item}
                    activeId={activeId}
                    onSelect={onNavigate}
                    onOpenSearch={onOpenSearch}
                    onLogout={onLogout}
                    collapsed={collapsed}
                />
            ))}
        </div>
    );

    // 无标题分组（核心导航入口）常驻展示，不做折叠。
    if (!group.heading || collapsed) {
        return <div className="flex shrink-0 flex-col">{content}</div>;
    }

    return (
        <div className="flex shrink-0 flex-col">
            <button
                type="button"
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                className="app-workspace-nav-group-toggle select-none"
            >
                <span className="app-workspace-nav-group-label">{group.heading}</span>
                <ChevronRight
                    className={cn("size-3.5 shrink-0 text-foreground/35 transition-transform duration-200", isOpen && "rotate-90")}
                    strokeWidth={2}
                />
            </button>
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="min-h-0 overflow-hidden pt-0.5">{content}</div>
            </div>
        </div>
    );
}

export function WorkspaceSidebarNav({ collapsed, onNavigate, onOpenSearch, onExpand }: { collapsed: boolean; onNavigate: () => void; onOpenSearch: () => void; onExpand: () => void }) {
    const { pathname } = useLocation();
    const [searchParams] = useSearchParams();
    const features = useUserStore((state) => state.features);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout } = useWorkspaceLogout();

    const balance = availableMicrocredits === null
        ? "--"
        : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

    const { groups, footer } = useMemo(() => buildNav(features, balance, user?.role === "admin"), [features, balance, user?.role]);

    const slug = pathname.split("/").filter(Boolean)[0] || "create";
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
            <WorkspaceSwitcher collapsed={collapsed} onNavigate={onNavigate} onExpand={onExpand} />

            <div className="app-workspace-sidebar-search shrink-0 px-3 pb-1 pt-2">
                <button
                    type="button"
                    onClick={onOpenSearch}
                    className="group flex h-9 w-full items-center gap-2 rounded-[var(--r-lg)] bg-foreground/5 px-3 text-left text-[var(--fs-caption)] text-muted-foreground transition-colors hover:bg-foreground/[.07] hover:text-foreground/70"
                    aria-label={collapsed ? "快速搜索" : undefined}
                    title={collapsed ? "快速搜索" : undefined}
                >
                    <Search className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground/70" strokeWidth={1.6} />
                    <span className="app-workspace-sidebar-search-label flex-1 truncate">快速搜索</span>
                    <kbd className="app-workspace-sidebar-search-shortcut flex h-5 shrink-0 items-center justify-center rounded-sm border border-[var(--workspace-border)] bg-background/50 px-1.5 font-mono text-[var(--fs-tiny)] font-medium text-foreground/55">
                        ⌘K
                    </kbd>
                </button>
            </div>

            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className={cn(
                    "app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 pb-3 pt-2",
                    collapsed && "is-collapsed",
                    scrollState.hasTopFade && "has-top-fade",
                    scrollState.hasBottomFade && "has-bottom-fade",
                )}
            >
                {groups.map((group, index) => (
                    <NavGroup
                        key={index}
                        group={group}
                        activeId={activeId}
                        onNavigate={onNavigate}
                        onOpenSearch={onOpenSearch}
                        onLogout={() => void handleLogout()}
                        collapsed={collapsed}
                    />
                ))}
            </div>

            <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                <div className="flex flex-col gap-0.5">
                    {footer.map((item) => (
                        <NavItem
                            key={item.id}
                            item={item}
                            activeId={activeId}
                            onSelect={onNavigate}
                            onOpenSearch={onOpenSearch}
                            onLogout={() => void handleLogout()}
                            collapsed={collapsed}
                        />
                    ))}
                </div>
            </div>
        </div>
    );
}
