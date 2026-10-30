import { ConfigProvider, Dropdown } from "antd";
import type { MenuProps } from "antd";
import {
    Activity,
    ArrowLeft,
    BarChart3,
    BellRing,
    BookMarked,
    ChevronDown,
    CloudUpload,
    Coins,
    CreditCard,
    Crown,
    Database,
    FileClock,
    Gift,
    HardDrive,
    Home,
    Inbox,
    Infinity as InfinityIcon,
    KeyRound,
    Layers3,
    LogIn,
    Mail,
    Megaphone,
    MessageSquareText,
    Moon,
    Paintbrush,
    Palette,
    PanelLeftClose,
    PanelLeftOpen,
    PlugZap,
    RadioTower,
    RefreshCw,
    Rows3,
    Settings2,
    Shapes,
    ShieldAlert,
    ShieldCheck,
    Sparkles,
    Sun,
    TicketCheck,
    ToggleLeft,
    UsersRound,
} from "lucide-react";
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { BrandLogoFrame } from "@/components/brand/brand-logo";
import { publishWorkspaceSidebarCollapsed, readWorkspaceSidebarCollapsed, subscribeWorkspaceSidebarCollapsed } from "@/components/layout/workspace-sidebar-state";
import { AppFeedbackProvider } from "@/components/layout/app-feedback";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { getIsolatedAdminAntTheme } from "../theme/admin-ant-theme";
import { AdminTooltip } from "../ui/controls";
import { AdminDensityProvider, useAdminDensity } from "./admin-density";
import { preloadAdminPages } from "../admin-page-loader";
import "@/styles/admin-ui.css";
import "../theme/admin-tokens.css";
import "../theme/admin-chrome.css";

type AdminNavigationItem = {
    path: string;
    label: string;
    /** 折叠侧栏图标下方的两字名称，与用户端折叠导航保持一致。 */
    shortLabel: string;
    icon: ReactNode;
    requireFeature?: "frontendModelsEnabled";
};

type AdminNavigationGroup = { key: string; label: string; items: AdminNavigationItem[] };

// 一个页面一个入口，按管理员的工作对象分组：先看运行状况，再处理用户与钱，再管模型供给，最后是低频的平台配置。
const adminNavigation: AdminNavigationGroup[] = [
    {
        key: "overview",
        label: "运营监控",
        items: [
            { path: "/admin", label: "运行总览", shortLabel: "总览", icon: <BarChart3 className="size-4" /> },
            { path: "/admin/logs", label: "请求明细", shortLabel: "请求", icon: <FileClock className="size-4" /> },
            { path: "/admin/login-logs", label: "登录日志", shortLabel: "登录", icon: <LogIn className="size-4" /> },
            { path: "/admin/settings/system-performance", label: "系统性能", shortLabel: "性能", icon: <Activity className="size-4" /> },
        ],
    },
    {
        key: "users",
        label: "用户与运营",
        items: [
            { path: "/admin/users", label: "用户管理", shortLabel: "用户", icon: <UsersRound className="size-4" /> },
            { path: "/admin/user-groups", label: "用户分组", shortLabel: "分组", icon: <Crown className="size-4" /> },
            { path: "/admin/credit-operations", label: "积分运营", shortLabel: "积分", icon: <Coins className="size-4" /> },
            { path: "/admin/payments", label: "支付充值", shortLabel: "支付", icon: <CreditCard className="size-4" /> },
            { path: "/admin/redemption-codes", label: "兑换码", shortLabel: "兑换", icon: <TicketCheck className="size-4" /> },
            { path: "/admin/referral", label: "推广中心", shortLabel: "推广", icon: <Gift className="size-4" /> },
            { path: "/admin/announcements", label: "系统公告", shortLabel: "公告", icon: <BellRing className="size-4" /> },
            { path: "/admin/banner-announcements", label: "常驻通知", shortLabel: "通知", icon: <Megaphone className="size-4" /> },
            { path: "/admin/feedbacks", label: "用户反馈", shortLabel: "反馈", icon: <Inbox className="size-4" /> },
            { path: "/admin/agent-lessons", label: "Agent 记忆", shortLabel: "记忆", icon: <BookMarked className="size-4" /> },
        ],
    },
    {
        key: "models",
        label: "模型与渠道",
        items: [
            { path: "/admin/channels", label: "渠道与模型", shortLabel: "渠道", icon: <RadioTower className="size-4" /> },
            { path: "/admin/models", label: "前台模型", shortLabel: "模型", icon: <Layers3 className="size-4" />, requireFeature: "frontendModelsEnabled" },
        ],
    },
    {
        key: "creation",
        label: "创作与扩展",
        items: [
            { path: "/admin/workbench-tools", label: "工作台工具", shortLabel: "工具", icon: <Shapes className="size-4" /> },
            { path: "/admin/prompt-templates", label: "提示词模板", shortLabel: "模板", icon: <MessageSquareText className="size-4" /> },
            { path: "/admin/settings/drawing-engine", label: "绘图工具", shortLabel: "绘图", icon: <Paintbrush className="size-4" /> },
            { path: "/admin/plugins", label: "插件管理", shortLabel: "插件", icon: <PlugZap className="size-4" /> },
            { path: "/admin/skill-curation", label: "技能分类", shortLabel: "技能", icon: <Sparkles className="size-4" /> },
            { path: "/admin/resources", label: "存储资源", shortLabel: "资源", icon: <Database className="size-4" /> },
        ],
    },
    {
        key: "settings",
        label: "系统设置",
        items: [
            { path: "/admin/settings/appearance", label: "站点及外观", shortLabel: "外观", icon: <Palette className="size-4" /> },
            { path: "/admin/settings/features", label: "功能开放", shortLabel: "功能", icon: <ToggleLeft className="size-4" /> },
            { path: "/admin/settings/access", label: "登录与注册", shortLabel: "注册", icon: <ShieldCheck className="size-4" /> },
            { path: "/admin/settings/email", label: "邮件服务", shortLabel: "邮件", icon: <Mail className="size-4" /> },
            { path: "/admin/settings/storage", label: "存储服务", shortLabel: "存储", icon: <HardDrive className="size-4" /> },
            { path: "/admin/settings/runtime-policy", label: "资源与策略", shortLabel: "策略", icon: <Settings2 className="size-4" /> },
            { path: "/admin/settings/ark-private-assets", label: "方舟素材库", shortLabel: "方舟", icon: <CloudUpload className="size-4" /> },
            { path: "/admin/settings/third-party", label: "第三方参数配置", shortLabel: "三方", icon: <KeyRound className="size-4" /> },
            { path: "/admin/settings/response-interception", label: "模型响应拦截", shortLabel: "拦截", icon: <ShieldAlert className="size-4" /> },
            { path: "/admin/settings/system-update", label: "系统更新", shortLabel: "更新", icon: <RefreshCw className="size-4" /> },
        ],
    },
];

function isAdminNavigationPath(pathname: string, navigationPath: string) {
    if (navigationPath === "/admin") {
        return pathname === navigationPath;
    }
    return pathname === navigationPath || pathname.startsWith(`${navigationPath}/`);
}

function findAdminNavigation(pathname: string) {
    for (const group of adminNavigation) {
        const item = group.items.find((candidate) => isAdminNavigationPath(pathname, candidate.path));
        if (item) return { group, item };
    }
    return undefined;
}

function visibleNavigationGroups(features: Partial<Record<"frontendModelsEnabled", boolean>>) {
    return adminNavigation.map((group) => ({ ...group, items: group.items.filter((item) => !item.requireFeature || features[item.requireFeature]) })).filter((group) => group.items.length > 0);
}

// v2：从“全部展开”改为默认只展开当前所在分组，菜单更紧凑。
const expandedGroupsStorageKey = "admin-nav-expanded-groups-v2";

function readExpandedGroups(currentGroupKey?: string): Set<string> {
    const fallback = new Set(currentGroupKey ? [currentGroupKey] : []);
    if (typeof window === "undefined") return fallback;
    try {
        const saved = JSON.parse(window.localStorage.getItem(expandedGroupsStorageKey) || "null") as string[] | null;
        return Array.isArray(saved) ? new Set(saved) : fallback;
    } catch {
        return fallback;
    }
}

function adminPopupContainer(node?: HTMLElement) {
    return document.getElementById("admin-root") || node?.closest("[data-admin-root]") || document.body;
}

export function AdminShell() {
    const userId = useUserStore((state) => state.user?.id);
    return (
        <AdminDensityProvider key={userId || "anonymous"} userId={userId}>
            <AdminShellLayout />
        </AdminDensityProvider>
    );
}

function AdminShellLayout() {
    const { density } = useAdminDensity();
    const appearance = useAppearanceStore((state) => state.appearance);
    const [collapsed, setCollapsed] = useState(readWorkspaceSidebarCollapsed);
    const dark = useThemeStore((state) => state.theme === "dark");

    // 进入后台后空闲预取其他页面代码，切换菜单时不再出现加载白屏。
    useEffect(() => {
        preloadAdminPages();
    }, []);

    useEffect(() => {
        document.body.classList.add("admin-overlays");
        return () => document.body.classList.remove("admin-overlays");
    }, []);

    useEffect(() => {
        return subscribeWorkspaceSidebarCollapsed(setCollapsed);
    }, []);

    const toggleCollapsed = () => {
        const next = !collapsed;
        setCollapsed(next);
        publishWorkspaceSidebarCollapsed(next);
    };

    return (
        <ConfigProvider theme={getIsolatedAdminAntTheme(dark, appearance.activeSkin)} getPopupContainer={(node) => adminPopupContainer(node)}>
            <AppFeedbackProvider>
                <main id="admin-root" data-admin-root data-admin-density={density} className="admin-shell flex h-full min-h-0 overflow-hidden">
                    <aside className={cn("admin-sidebar hidden shrink-0 flex-col overflow-hidden lg:flex", collapsed && "is-collapsed")}>
                        <div className="admin-sidebar-identity shrink-0">
                            <AdminTooltip title={collapsed ? (appearance.updates?.enabled ? "查看更新公告" : "查看更新日志") : undefined} placement="right">
                                <AppChangelogButton
                                    className={cn("admin-sidebar-brand-button", collapsed && "is-collapsed")}
                                    icon={<BrandLogoFrame className="admin-sidebar-brand-mark grid shrink-0 place-items-center bg-foreground text-background" logoClassName="size-5 object-contain" alt="" fallback={<InfinityIcon className="size-4" />} />}
                                    label={appearance.brandName}
                                    showLabel={!collapsed}
                                    showVersion={!collapsed}
                                    labelClassName="admin-sidebar-brand-title"
                                    versionClassName="admin-sidebar-brand-version"
                                />
                            </AdminTooltip>
                        </div>
                        <AdminNavigation collapsed={collapsed} />
                        <div className={cn("admin-sidebar-footer shrink-0", collapsed && "is-collapsed")}>
                            <div className="admin-sidebar-footer-row">
                                <AdminTooltip title={collapsed ? "返回创作台" : undefined} placement="right">
                                    <NavLink to="/" aria-label={collapsed ? "返回创作台" : undefined} className={cn("admin-nav-link", collapsed && "is-collapsed")}>
                                        <Home className="size-4" strokeWidth={1.6} />
                                        {collapsed ? <span className="admin-nav-short-label">返回</span> : <span>返回创作台</span>}
                                    </NavLink>
                                </AdminTooltip>
                                {!collapsed ? (
                                    <button type="button" className="admin-sidebar-collapse-toggle" onClick={toggleCollapsed} aria-label="收起侧栏" title="收起侧栏" aria-expanded={!collapsed}>
                                        <PanelLeftClose className="size-4" strokeWidth={1.7} />
                                    </button>
                                ) : null}
                            </div>
                            {collapsed ? (
                                <button type="button" className="admin-sidebar-collapse-toggle is-collapsed" onClick={toggleCollapsed} aria-label="展开侧栏" title="展开侧栏">
                                    <PanelLeftOpen className="size-4" strokeWidth={1.7} />
                                </button>
                            ) : null}
                        </div>
                    </aside>
                    <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
                        <MobileAdminNavigation />
                        <Suspense
                            fallback={
                                <div className="p-8 text-sm" role="status">
                                    正在加载管理页面…
                                </div>
                            }
                        >
                            <Outlet />
                        </Suspense>
                    </section>
                </main>
            </AppFeedbackProvider>
        </ConfigProvider>
    );
}

export function AdminPageFrame({ title, description, actions, back, scroll = false, children }: { title: string; description?: string; actions?: ReactNode; back?: { label: string; onClick: () => void }; scroll?: boolean; children: ReactNode }) {
    const location = useLocation();
    const current = findAdminNavigation(location.pathname);

    return (
        <div className={cn("admin-page-root", scroll && "admin-page-root-scrollable")}>
            <div className={cn("admin-page-frame", scroll && "admin-page-frame-scrollable")}>
                <header className="admin-page-header flex shrink-0 flex-col sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                        {back ? (
                            <AdminTooltip title={back.label}>
                                <button type="button" className="admin-icon-button shrink-0" aria-label={back.label} onClick={back.onClick}>
                                    <ArrowLeft className="size-4" />
                                </button>
                            </AdminTooltip>
                        ) : null}
                        <div className="admin-page-title-block min-w-0">
                            <nav className="admin-page-location" aria-label="当前位置">
                                <span className="admin-page-location-section">{current?.group.label ?? "管理后台"}</span>
                                <span className="admin-page-location-separator" aria-hidden="true">
                                    /
                                </span>
                                {back && current ? (
                                    <>
                                        <Link to={current.item.path} className="admin-page-location-section is-link">
                                            {current.item.label}
                                        </Link>
                                        <span className="admin-page-location-separator" aria-hidden="true">
                                            /
                                        </span>
                                    </>
                                ) : null}
                                <h1 className="admin-page-title truncate">{title}</h1>
                            </nav>
                            {description ? <p className="admin-page-description">{description}</p> : null}
                        </div>
                    </div>
                    <div className="admin-page-actions flex shrink-0 flex-wrap items-center">
                        {actions}
                        <AdminDensityButton />
                        <AdminThemeButton />
                    </div>
                </header>
                {children}
            </div>
        </div>
    );
}

function AdminDensityButton() {
    const { density, toggleDensity } = useAdminDensity();
    return (
        <AdminTooltip title={density === "compact" ? "切换为舒适行距" : "切换为紧凑行距"}>
            <button type="button" className="admin-density-toggle" onClick={toggleDensity} aria-label="紧凑表格行距" aria-pressed={density === "compact"}>
                <Rows3 className="size-4" aria-hidden="true" />
                {density === "compact" ? "紧凑" : "舒适"}
            </button>
        </AdminTooltip>
    );
}

function AdminThemeButton() {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const dark = theme === "dark";

    return (
        <AdminTooltip title={dark ? "切换到浅色主题" : "切换到深色主题"} placement="bottom">
            <button type="button" className="admin-page-theme-toggle shrink-0" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "切换到浅色主题" : "切换到深色主题"}>
                {dark ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
            </button>
        </AdminTooltip>
    );
}

function MobileAdminNavigation() {
    const features = useUserStore((state) => state.features);
    const location = useLocation();
    const visibleGroups = visibleNavigationGroups(features);
    // 与桌面侧栏同一规则按前缀匹配；当前页可能因功能关闭而不在菜单里但仍可直达。
    const current = findAdminNavigation(location.pathname);
    const currentItem = current?.item;
    const menuItems: MenuProps["items"] = visibleGroups.map((group) => ({
        type: "group",
        key: `group-${group.key}`,
        label: group.label,
        children: group.items.map((item) => ({
            key: item.path,
            label: (
                <Link to={item.path} className="admin-mobile-navigation-menu-link">
                    {item.icon}
                    <span>{item.label}</span>
                </Link>
            ),
        })),
    }));

    return (
        <nav className="admin-mobile-navigation flex shrink-0 items-center justify-between gap-2 lg:hidden" aria-label="管理后台导航">
            <Dropdown menu={{ items: menuItems, selectable: true, selectedKeys: currentItem ? [currentItem.path] : [], className: "admin-mobile-navigation-menu" }} trigger={["click"]} placement="bottomLeft">
                <button type="button" className="admin-mobile-navigation-trigger" aria-label={`打开管理后台导航，当前页面${currentItem?.label || "未知"}`}>
                    <span className="admin-mobile-navigation-current-icon">{currentItem?.icon}</span>
                    <span className="min-w-0 text-left">
                        <span className="admin-mobile-navigation-eyebrow">管理后台</span>
                        <span className="admin-mobile-navigation-current-label">{currentItem?.label || "选择页面"}</span>
                    </span>
                    <ChevronDown className="size-3.5 shrink-0" aria-hidden="true" />
                </button>
            </Dropdown>
            <div className="flex shrink-0 items-center gap-1">
                <AdminTooltip title="返回创作台">
                    <Link to="/" className="admin-mobile-navigation-action" aria-label="返回创作台">
                        <Home className="size-4" aria-hidden="true" />
                    </Link>
                </AdminTooltip>
                <AppChangelogButton className="admin-mobile-navigation-action [&_svg]:size-4" />
            </div>
        </nav>
    );
}

function AdminNavigation({ collapsed }: { collapsed: boolean }) {
    const features = useUserStore((state) => state.features);
    const location = useLocation();
    const groups = visibleNavigationGroups(features);
    const currentGroupKey = findAdminNavigation(location.pathname)?.group.key;
    const [expandedGroups, setExpandedGroups] = useState(() => readExpandedGroups(currentGroupKey));

    // 进入某个分组的页面时自动展开该组，避免当前页藏在折叠分组里。
    useEffect(() => {
        if (!currentGroupKey) return;
        setExpandedGroups((current) => (current.has(currentGroupKey) ? current : new Set([...current, currentGroupKey])));
    }, [currentGroupKey]);

    useEffect(() => {
        window.localStorage.setItem(expandedGroupsStorageKey, JSON.stringify([...expandedGroups]));
    }, [expandedGroups]);

    const toggleGroup = (key: string) =>
        setExpandedGroups((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });

    const renderItem = (item: AdminNavigationItem) => {
        const active = isAdminNavigationPath(location.pathname, item.path);
        return (
            <AdminTooltip key={item.path} delay={100} title={collapsed ? item.label : undefined} placement="right">
                <NavLink to={item.path} end={item.path === "/admin"} aria-label={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} className={cn("admin-nav-link", collapsed && "is-collapsed", active && "is-active")}>
                    {item.icon}
                    {collapsed ? <span className="admin-nav-short-label">{item.shortLabel}</span> : <span className="truncate">{item.label}</span>}
                </NavLink>
            </AdminTooltip>
        );
    };

    return (
        <nav className={cn("admin-sidebar-nav thin-scrollbar flex-1 overflow-y-auto", !collapsed && "is-tree")} aria-label="管理后台菜单">
            {groups.map((group) => {
                if (collapsed) {
                    return (
                        <div key={group.key} className="admin-nav-group">
                            <div className="admin-nav-collapsed-separator" />
                            <div className="admin-nav-group-items is-collapsed">{group.items.map(renderItem)}</div>
                        </div>
                    );
                }
                const expanded = expandedGroups.has(group.key);
                const panelId = `admin-nav-group-${group.key}`;
                return (
                    <div key={group.key} className={cn("admin-nav-group", group.key === currentGroupKey && "is-current")}>
                        <button type="button" className="admin-nav-group-toggle" aria-expanded={expanded} aria-controls={panelId} onClick={() => toggleGroup(group.key)}>
                            <span>{group.label}</span>
                            <ChevronDown className={cn("admin-nav-group-chevron size-3.5", !expanded && "is-collapsed")} aria-hidden="true" />
                        </button>
                        {expanded ? (
                            <div id={panelId} className="admin-nav-group-items">
                                {group.items.map(renderItem)}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </nav>
    );
}
