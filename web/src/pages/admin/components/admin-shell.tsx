import { ConfigProvider, Tooltip } from "antd";
import {
    ArrowLeft,
    BarChart3,
    BellRing,
    CloudUpload,
    Coins,
    FileClock,
    HardDrive,
    Home,
    Infinity as InfinityIcon,
    KeyRound,
    Layers3,
    Mail,
    MessageSquareText,
    Paintbrush,
    PanelLeftClose,
    PanelLeftOpen,
    RadioTower,
    Settings2,
    ShieldAlert,
    ShieldCheck,
    TicketCheck,
    ToggleLeft,
    UsersRound,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, Outlet } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { LocaleToggle } from "@/components/layout/locale-switcher";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { WORKSPACE_SIDEBAR_STORAGE_KEY } from "@/components/layout/workspace-sidebar-state";
import { getAdminAntThemeConfig } from "@/lib/app-theme";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

type AdminNavigationItem = {
    path: string;
    label: string;
    description: string;
    icon: ReactNode;
    requireFeature?: "frontendModelsEnabled";
};

function createAdminNavigation(t: TFunction): Array<{ label: string; items: AdminNavigationItem[] }> {
    return [
        {
            label: t("admin:overview"),
            items: [{ path: "/admin", label: t("admin:data-overview"), description: t("admin:active-users-usage-and-cost-trends"), icon: <BarChart3 className="size-4" /> }],
        },
        {
            label: t("admin:platform-resources"),
            items: [
                { path: "/admin/users", label: t("admin:users"), description: t("admin:accounts-roles-and-statuses"), icon: <UsersRound className="size-4" /> },
                { path: "/admin/channels", label: t("admin:system-channels"), description: t("admin:channels-models-and-pricing"), icon: <RadioTower className="size-4" /> },
                { path: "/admin/models", label: t("admin:frontend-models"), description: t("admin:display-routes-and-user-pricing"), icon: <Layers3 className="size-4" />, requireFeature: "frontendModelsEnabled" },
                { path: "/admin/prompt-templates", label: t("admin:prompt-templates"), description: t("admin:platform-creation-strategy-versions"), icon: <MessageSquareText className="size-4" /> },
            ],
        },
        {
            label: t("admin:operations"),
            items: [
                { path: "/admin/announcements", label: t("admin:system-announcements"), description: t("admin:publish-close-and-browse-announcements"), icon: <BellRing className="size-4" /> },
                { path: "/admin/credit-operations", label: t("admin:credit-operations"), description: t("admin:manual-credit-adjustments-and-abnormal-billing"), icon: <Coins className="size-4" /> },
                { path: "/admin/redemption-codes", label: t("admin:redemption-codes"), description: t("admin:generate-and-view-redemption-code-batches"), icon: <TicketCheck className="size-4" /> },
                { path: "/admin/logs", label: t("admin:request-details"), description: t("admin:upstream-calls-and-costs"), icon: <FileClock className="size-4" /> },
            ],
        },
        {
            label: t("admin:system-settings"),
            items: [
                { path: "/admin/settings/features", label: t("admin:feature-access"), description: t("admin:menus-channels-and-credit-modes"), icon: <ToggleLeft className="size-4" /> },
                { path: "/admin/settings/drawing-engine", label: t("admin:drawing-tools"), description: t("admin:default-engine-for-canvas-drawing-nodes"), icon: <Paintbrush className="size-4" /> },
                { path: "/admin/settings/runtime-policy", label: t("admin:resources-and-policies"), description: t("admin:quotas-concurrency-rate-limits-and-timeouts"), icon: <Settings2 className="size-4" /> },
                { path: "/admin/settings/access", label: t("admin:sign-in-and-registration"), description: t("admin:registration-policy-and-linux-do"), icon: <ShieldCheck className="size-4" /> },
                { path: "/admin/settings/email", label: t("admin:email-service"), description: t("admin:registration-verification-smtp"), icon: <Mail className="size-4" /> },
                { path: "/admin/settings/storage", label: t("admin:storage-services"), description: t("admin:object-storage-and-resource-storage"), icon: <HardDrive className="size-4" /> },
                { path: "/admin/settings/ark-private-assets", label: t("admin:ark-asset-library"), description: t("admin:seedance-trusted-reference-assets"), icon: <CloudUpload className="size-4" /> },
                { path: "/admin/settings/response-interception", label: t("admin:model-response-interception"), description: t("admin:replace-user-visible-upstream-errors"), icon: <ShieldAlert className="size-4" /> },
                { path: "/admin/settings/third-party", label: t("admin:third-party-parameters"), description: t("admin:centrally-manage-third-party-platform-credentials"), icon: <KeyRound className="size-4" /> },
            ],
        },
    ];
}

export function AdminShell() {
    const { t } = useTranslation("canvas");
    const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY) === "1");
    const dark = useThemeStore((state) => state.theme === "dark");
    const toggleCollapsed = () => {
        setCollapsed((current) => {
            const next = !current;
            window.localStorage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, next ? "1" : "0");
            return next;
        });
    };

    return (
        <ConfigProvider theme={getAdminAntThemeConfig(dark)}>
            <main className="admin-shell app-user-workspace flex h-full min-h-0 overflow-hidden text-foreground">
                <aside className={cn("app-workspace-sidebar admin-sidebar hidden shrink-0 flex-col overflow-hidden lg:flex", collapsed && "is-collapsed")}>
                    <div className={cn("flex h-13 shrink-0 items-center", collapsed ? "justify-center" : "gap-2 px-3")}>
                        {!collapsed ? (
                            <Link to="/" className="app-workspace-brand-link flex min-w-0 flex-1 items-center gap-2" title={t("admin:yingce-2")}>
                                <span className="grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
                                    <InfinityIcon className="size-4" />
                                </span>
                                <span className="min-w-0">
                                    <span className="block truncate text-[var(--fs-body)] font-semibold">{t("admin:yingce-2")}</span>
                                    <span className="block truncate text-[var(--fs-micro)] text-foreground/42">{t("admin:admin-console")}</span>
                                </span>
                            </Link>
                        ) : null}
                        <Tooltip mouseEnterDelay={0.1} title={collapsed ? t("admin:expand-sidebar") : t("admin:collapse-sidebar")} placement="right">
                            <button type="button" className="app-workspace-icon-button shrink-0" onClick={toggleCollapsed} aria-label={collapsed ? t("admin:expand-sidebar") : t("admin:collapse-sidebar")}>
                                {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
                            </button>
                        </Tooltip>
                    </div>
                    <AdminNavigation collapsed={collapsed} />
                    <div className="shrink-0 border-t border-border/70 p-2">
                        <Tooltip mouseEnterDelay={0.1} title={collapsed ? t("admin:switch-language") : undefined} placement="right">
                            <LocaleToggle className={cn("flex h-8 items-center rounded text-[var(--fs-label)] text-foreground/52 transition-colors hover:bg-surface-hover hover:text-foreground", collapsed ? "justify-center px-0" : "gap-2 px-2")} />
                        </Tooltip>
                        <Tooltip mouseEnterDelay={0.1} title={collapsed ? t("admin:changelog") : undefined} placement="right">
                            <AppChangelogButton
                                className={cn("flex h-8 w-full items-center rounded text-[var(--fs-label)] text-foreground/52 transition-colors hover:bg-surface-hover hover:text-foreground", collapsed ? "justify-center px-0" : "gap-2 px-2")}
                                showVersion={!collapsed}
                            />
                        </Tooltip>
                        <Tooltip mouseEnterDelay={0.1} title={collapsed ? t("admin:back-to-studio-2") : undefined} placement="right">
                            <NavLink to="/canvas" className={cn("flex h-8 items-center rounded text-[var(--fs-label)] text-foreground/52 transition-colors hover:bg-surface-hover hover:text-foreground", collapsed ? "justify-center px-0" : "gap-2 px-2")}>
                                <Home className="size-3.5" />
                                {!collapsed ? <span>{t("admin:back-to-studio-2")}</span> : null}
                            </NavLink>
                        </Tooltip>
                    </div>
                </aside>
                <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <MobileAdminNavigation />
                    <Outlet />
                </section>
            </main>
        </ConfigProvider>
    );
}

export function AdminPageFrame({ title, actions, back, scroll = false, children }: { title: string; description?: string; actions?: ReactNode; back?: { label: string; onClick: () => void }; scroll?: boolean; children: ReactNode }) {
    return (
        <WorkspacePage scroll={scroll} fluid className={cn("admin-page-root", scroll && "admin-page-root-scrollable")}>
            <div className={cn("admin-page-frame", scroll && "admin-page-frame-scrollable")}>
                <header className="admin-page-header flex min-h-12 shrink-0 flex-col gap-2 pb-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2.5">
                        {back ? (
                            <Tooltip title={back.label}>
                                <button type="button" className="app-workspace-icon-button size-9 shrink-0" aria-label={back.label} onClick={back.onClick}>
                                    <ArrowLeft className="size-4" />
                                </button>
                            </Tooltip>
                        ) : null}
                        <h1 className="truncate text-base font-semibold leading-6">{title}</h1>
                    </div>
                    {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
                </header>
                {children}
            </div>
        </WorkspacePage>
    );
}

function MobileAdminNavigation() {
    const { t } = useTranslation("canvas");
    const features = useUserStore((state) => state.features);
    const adminNavigation = createAdminNavigation(t);
    const visibleItems = adminNavigation.flatMap((group) => group.items).filter((item) => !item.requireFeature || features[item.requireFeature]);

    return (
        <nav className="app-workspace-navigation hide-scrollbar flex shrink-0 gap-1 overflow-x-auto border-b border-border/70 px-3 py-2 lg:hidden" aria-label={t("admin:admin-console-sections")}>
            {visibleItems.map((item) => (
                <NavLink
                    key={item.path}
                    to={item.path}
                    end={item.path === "/admin"}
                    className={({ isActive }) =>
                        cn("app-workspace-nav-link flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors", isActive ? "is-active font-medium" : "text-foreground/60 hover:bg-surface-hover hover:text-foreground")
                    }
                >
                    {item.icon}
                    <span>{item.label}</span>
                </NavLink>
            ))}
            <AppChangelogButton className="grid size-8 shrink-0 place-items-center rounded-md text-foreground/55 transition-colors hover:bg-surface-hover hover:text-foreground [&_svg]:size-4" />
        </nav>
    );
}

function AdminNavigation({ collapsed }: { collapsed: boolean }) {
    const { t } = useTranslation("canvas");
    const features = useUserStore((state) => state.features);
    const adminNavigation = createAdminNavigation(t);

    return (
        <nav className="thin-scrollbar flex-1 overflow-y-auto px-2 py-2" aria-label={t("admin:admin-console-menu")}>
            {adminNavigation.map((group) => {
                const visibleItems = group.items.filter((item) => !item.requireFeature || features[item.requireFeature]);
                if (visibleItems.length === 0) return null;

                return (
                    <div key={group.label} className="mb-3">
                        {!collapsed ? (
                            <div className="admin-nav-group-label mb-1 px-2.5 text-[var(--fs-tiny)] font-medium text-foreground/38">
                                <span>{group.label}</span>
                            </div>
                        ) : (
                            <div className="mx-auto mb-1.5 h-px w-7 bg-border/80" />
                        )}
                        <div className="space-y-0.5">
                            {visibleItems.map((item) => (
                                <Tooltip key={item.path} mouseEnterDelay={0.1} title={collapsed ? item.label : undefined} placement="right">
                                    <NavLink
                                        to={item.path}
                                        end={item.path === "/admin"}
                                        className={({ isActive }) =>
                                            cn(
                                                "app-workspace-nav-link flex h-8 items-center rounded-md text-[var(--fs-body)] transition-colors",
                                                collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                                                isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
                                            )
                                        }
                                    >
                                        {item.icon}
                                        {!collapsed ? <span className="truncate">{item.label}</span> : null}
                                    </NavLink>
                                </Tooltip>
                            ))}
                        </div>
                    </div>
                );
            })}
        </nav>
    );
}
