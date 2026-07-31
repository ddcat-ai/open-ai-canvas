import { Infinity as InfinityIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WORKSPACE_SIDEBAR_STORAGE_KEY } from "@/components/layout/workspace-sidebar-state";
import { WorkspaceSidebarFooter } from "@/components/layout/workspace-sidebar-footer";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => window.localStorage.getItem(WORKSPACE_SIDEBAR_STORAGE_KEY) === "1");
    const hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname);
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const compactSidebar = sidebarCollapsed;
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const visibleNavigationTools = spatialWorkbench ? navigationTools : navigationTools.filter((tool) => tool.section === "创作空间");

    useEffect(() => {
        window.localStorage.setItem(WORKSPACE_SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
    }, [sidebarCollapsed]);

    useEffect(() => {
        const handleWorkspaceNavigation = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{ to?: string }>;
            if (!event.detail?.to) return;
            event.preventDefault();
            navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", handleWorkspaceNavigation);
        return () => window.removeEventListener("workspace:navigate", handleWorkspaceNavigation);
    }, [navigate]);

    return (
        <>
            <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full overflow-hidden", spatialWorkbench && "is-spatial")}>
                {spatialWorkbench && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label="收起侧栏" onClick={() => setMobileSidebarExpanded(false)} /> : null}
                {!hideChrome ? (
                    <aside className={cn("app-workspace-sidebar flex shrink-0 flex-col overflow-hidden", mobileSidebarExpanded ? "is-mobile-expanded w-[196px]" : "w-[52px]", compactSidebar ? "lg:w-[60px]" : "lg:w-[220px]")}>
                        <div
                            className={cn(
                                "flex h-14 shrink-0 items-center border-b border-border/55 text-foreground",
                                mobileSidebarExpanded ? "gap-2 px-3" : "justify-center",
                                compactSidebar ? "lg:justify-center lg:px-0" : "lg:justify-start lg:gap-2 lg:px-3",
                            )}
                        >
                            <Link to="/" className={cn("min-w-0 items-center gap-2", mobileSidebarExpanded ? "flex" : "hidden", compactSidebar ? "lg:hidden" : "lg:flex")} title="影策">
                                <span className="app-workspace-brand-mark grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background"><InfinityIcon className="size-4" /></span>
                                {spatialWorkbench ? <span className="min-w-0"><span className="block truncate text-[13px] font-semibold">影策</span><span className="block truncate text-[9px] text-foreground/36">AI 叙事工作台</span></span> : <span className="truncate text-[13px] font-semibold">影策</span>}
                            </Link>
                            <button
                                type="button"
                                className={cn("app-workspace-icon-button shrink-0", mobileSidebarExpanded ? "ml-auto" : !compactSidebar ? "lg:ml-auto" : undefined)}
                                onClick={() => {
                                    if (window.innerWidth < 1024) setMobileSidebarExpanded((value) => !value);
                                    else setSidebarCollapsed((value) => !value);
                                }}
                                aria-label="切换侧栏"
                                title="切换侧栏"
                            >
                                {mobileSidebarExpanded ? <PanelLeftClose className="size-4 lg:hidden" /> : <PanelLeftOpen className="size-4 lg:hidden" />}
                                {compactSidebar ? <PanelLeftOpen className="hidden size-4 lg:block" /> : <PanelLeftClose className="hidden size-4 lg:block" />}
                            </button>
                        </div>

                        <nav className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-3">
                            {visibleNavigationTools.map((tool, index) => {
                                const Icon = tool.icon;
                                const active = tool.slug === activeToolSlug;
                                const showSection = index === 0 || tool.section !== visibleNavigationTools[index - 1]?.section;
                                return (
                                    <Fragment key={tool.slug}>
                                        {showSection ? <div className={cn("mb-2 px-2 text-[10px] font-medium text-foreground/34", index > 0 && "mt-4", mobileSidebarExpanded ? "block" : "hidden", compactSidebar ? "lg:hidden" : "lg:block")}>{tool.section}</div> : null}
                                        <Link
                                            to={`/${tool.slug}`}
                                            title={tool.label}
                                            onClick={() => {
                                                if (window.innerWidth < 1024) setMobileSidebarExpanded(false);
                                            }}
                                            className={cn(
                                                "app-workspace-nav-link relative mb-1 flex shrink-0 items-center rounded-md text-[13px] transition-colors",
                                                spatialWorkbench ? "h-11" : "h-9",
                                                mobileSidebarExpanded ? "gap-3 px-2.5" : "justify-center px-0",
                                                compactSidebar ? "lg:justify-center lg:px-0" : "lg:justify-start lg:gap-3 lg:px-2.5",
                                                active ? "is-active font-medium" : "text-foreground/55 hover:bg-foreground/[0.045] hover:text-foreground/85",
                                            )}
                                        >
                                            <Icon className="size-4 shrink-0" />
                                            <span className={cn("truncate", mobileSidebarExpanded ? "inline" : "hidden", compactSidebar ? "lg:hidden" : "lg:inline")}>{tool.label}</span>
                                        </Link>
                                    </Fragment>
                                );
                            })}
                        </nav>
                        <div className="shrink-0 border-t border-border/55 p-2">
                            <WorkspaceSidebarFooter
                                collapsedClassName={cn(
                                    mobileSidebarExpanded ? "justify-start gap-2 px-2" : "justify-center gap-0 px-0",
                                    compactSidebar ? "lg:justify-center lg:gap-0 lg:px-0" : "lg:justify-start lg:gap-2 lg:px-2",
                                )}
                                expandedClassName={cn(mobileSidebarExpanded ? "flex" : "hidden", compactSidebar ? "lg:hidden" : "lg:flex")}
                                accountClassName={cn(
                                    mobileSidebarExpanded ? "flex-row gap-2 px-2" : "flex-col gap-0.5 px-0 py-1",
                                    compactSidebar ? "lg:flex-col lg:gap-0.5 lg:px-0 lg:py-1" : "lg:flex-row lg:gap-2 lg:px-2 lg:py-0",
                                )}
                            />
                        </div>
                    </aside>
                ) : null}

                <div className="app-workspace-stage relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</div>
            </div>
            <ModelSetupGuide hidden={pathname === "/login" || pathname === "/register" || pathname.startsWith("/admin")} />
        </>
    );
}
