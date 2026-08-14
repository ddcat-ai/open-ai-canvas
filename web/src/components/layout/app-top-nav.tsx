import { Home, Infinity as InfinityIcon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WorkspaceSidebarFooter } from "@/components/layout/workspace-sidebar-footer";
import { WorkspaceTopBar } from "@/components/layout/workspace-top-bar";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { cn } from "@/lib/utils";
import { refreshFeatureAvailability } from "@/lib/user-session";
import { isSpatialWorkbenchPath } from "@/lib/workspace-routes";
import { useUserStore } from "@/stores/use-user-store";

export function AppWorkspaceShell({ children }: { children: ReactNode }) {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const user = useUserStore((state) => state.user);
    const features = useUserStore((state) => state.features);
    const [mobileSidebarExpanded, setMobileSidebarExpanded] = useState(false);
    const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
    const scrollRef = useRef<HTMLElement>(null);
    const [scrollState, setScrollState] = useState({
        hasTopFade: false,
        hasBottomFade: false,
    });
    const hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname);
    const showGlobalTopBar = !hideChrome;
    const spatialWorkbench = isSpatialWorkbenchPath(pathname);
    const creationWorkspace = pathname === "/create";
    const slug = pathname.split("/").filter(Boolean)[0];
    const activeToolSlug = navigationTools.some((tool) => tool.slug === slug) ? (slug as NavigationToolSlug) : undefined;
    const visibleNavigationTools = (spatialWorkbench ? navigationTools : navigationTools.filter((tool) => tool.section === "创作空间"))
        .filter((tool) => {
            if (tool.slug === "projects") return features.shortDramaEnabled;
            if (tool.slug === "tasks") return features.taskCenterEnabled;
            if (tool.slug === "wallet") return features.creditsEnabled;
            return true;
        });
    const topRailNavTools = visibleNavigationTools.filter((tool) => tool.section === "创作空间" || tool.slug === "skills");
    const bottomRailNavTools = visibleNavigationTools.filter((tool) => tool.slug === "wallet");

    const toggleSidebar = () => {
        if (window.innerWidth < 1024) {
            setMobileSidebarExpanded((current) => !current);
            return;
        }
        setDesktopSidebarCollapsed((current) => !current);
    };

    const handleNavClick = () => {
        if (window.innerWidth < 1024) setMobileSidebarExpanded(false);
    };

    const renderSidebarLink = (tool: (typeof navigationTools)[number]) => {
        const Icon = tool.icon;
        const active = tool.slug === activeToolSlug;
        return (
            <Link
                key={tool.slug}
                to={`/${tool.slug}`}
                title={tool.label}
                onClick={handleNavClick}
                className={cn(
                    "app-workspace-nav-link app-workspace-rail-tile grid size-10 place-items-center rounded-md text-[var(--fs-tiny)] transition-colors",
                    active ? "is-active font-medium" : "",
                )}
            >
                <Icon className="size-5 shrink-0" />
            </Link>
        );
    };

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
        const handleWorkspaceNavigation = (rawEvent: Event) => {
            const event = rawEvent as CustomEvent<{ to?: string }>;
            if (!event.detail?.to) return;
            event.preventDefault();
            navigate(event.detail.to);
        };
        window.addEventListener("workspace:navigate", handleWorkspaceNavigation);
        return () => window.removeEventListener("workspace:navigate", handleWorkspaceNavigation);
    }, [navigate]);

    useEffect(() => {
        handleScroll();
    }, [visibleNavigationTools.length, mobileSidebarExpanded]);

    useEffect(() => {
        if (!user) return;
        const refresh = () => void refreshFeatureAvailability().catch((error) => console.warn("功能开放状态刷新失败", error));
        const timer = window.setInterval(refresh, 30_000);
        window.addEventListener("focus", refresh);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", refresh);
        };
    }, [user]);

    return (
        <>
            <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full flex-col overflow-hidden", spatialWorkbench && "is-spatial", creationWorkspace && "is-creation-workspace")} data-sidebar-collapsed={desktopSidebarCollapsed || undefined}>
                {!hideChrome && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label="收起侧栏" onClick={() => setMobileSidebarExpanded(false)} /> : null}
                {showGlobalTopBar ? <WorkspaceTopBar sidebarOpen={window.innerWidth < 1024 ? mobileSidebarExpanded : !desktopSidebarCollapsed} onToggleSidebar={toggleSidebar} /> : null}
                <div className="app-workspace-main-row flex min-h-0 min-w-0 flex-1 overflow-hidden">
                {!hideChrome ? (
                    <aside className={cn("app-workspace-sidebar flex shrink-0 flex-col overflow-hidden transition-all duration-200", mobileSidebarExpanded ? "is-mobile-expanded w-[196px]" : "w-0 lg:w-[var(--workspace-sidebar-width)] lg:shrink-0")} style={{ "--workspace-sidebar-width": desktopSidebarCollapsed ? "0px" : "64px" } as CSSProperties}>
                        {/* 桌面：64px 电影胶片条式轨道 */}
                        <div className="app-workspace-rail hidden min-h-0 flex-col overflow-y-auto lg:flex">
                            <div className="app-workspace-rail-header flex h-16 shrink-0 items-center justify-center">
                                <Link to="/home" className="grid size-10 shrink-0 place-items-center rounded-md text-foreground/55 transition-colors hover:bg-surface-hover hover:text-foreground" title="工作台首页">
                                    <Home className="size-4" />
                                </Link>
                            </div>
                            <div className="app-workspace-rail-middle flex min-h-0 w-full flex-1 flex-col items-center justify-start overflow-y-auto px-3 pt-3">
                                <nav className="flex w-full flex-col items-center gap-2">
                                    {topRailNavTools.map((tool) => renderSidebarLink(tool))}
                                </nav>
                                <nav className="mt-4 flex w-full flex-col items-center gap-2 pb-3">
                                    {bottomRailNavTools.map((tool) => renderSidebarLink(tool))}
                                </nav>
                            </div>
                            <div className="app-workspace-rail-footer shrink-0 px-2 pb-4 pt-3">
                                <WorkspaceSidebarFooter
                                    showAnnouncement={false}
                                    expandedClassName="hidden"
                                    collapsedClassName="flex h-10 w-10 items-center justify-center rounded-md"
                                    accountClassName="justify-center rounded-md"
                                />
                            </div>
                        </div>

                        {/* 移动端：抽屉完整导航 */}
                        <div className="app-workspace-mobile-nav flex min-h-0 flex-1 flex-col overflow-hidden lg:hidden">
                            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 px-3">
                                <Link to="/" className="flex min-w-0 items-center gap-2" title="影策">
                                    <span className="app-workspace-brand-mark grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background"><InfinityIcon className="size-4" /></span>
                                    <span className="truncate text-[var(--fs-body)] font-semibold">影策</span>
                                </Link>
                            </div>
                            <nav
                                ref={scrollRef}
                                onScroll={handleScroll}
                                className={cn(
                                    "app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col px-2 py-3",
                                    scrollState.hasTopFade && "has-top-fade",
                                    scrollState.hasBottomFade && "has-bottom-fade",
                                )}
                            >
                                {visibleNavigationTools.map((tool, index) => {
                                    const Icon = tool.icon;
                                    const active = tool.slug === activeToolSlug;
                                    const showSection = index === 0 || tool.section !== visibleNavigationTools[index - 1]?.section;
                                    return (
                                        <Fragment key={tool.slug}>
                                            {showSection ? <div className="mb-2 px-2 text-[var(--fs-tiny)] font-medium text-foreground/34">{tool.section}</div> : null}
                                            <Link
                                                to={`/${tool.slug}`}
                                                title={tool.label}
                                                onClick={handleNavClick}
                                                className={cn("app-workspace-nav-link relative mb-1 flex h-11 shrink-0 items-center gap-3 rounded-md px-2.5 text-[var(--fs-body)] transition-colors", active ? "is-active font-medium" : "text-foreground/55 hover:bg-surface-hover hover:text-foreground/85")}
                                            >
                                                <Icon className="size-4 shrink-0" />
                                                <span className="truncate">{tool.label}</span>
                                            </Link>
                                        </Fragment>
                                    );
                                })}
                            </nav>
                            <div className="shrink-0 border-t border-border/55 p-2">
                                <WorkspaceSidebarFooter
                                    expandedClassName="flex"
                                    collapsedClassName="hidden"
                                    accountClassName="flex-row gap-2 px-2"
                                />
                            </div>
                        </div>
                    </aside>
                ) : null}

                <div className="app-workspace-stage relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    {children}
                </div>
                </div>
            </div>
            <ModelSetupGuide hidden={pathname === "/login" || pathname === "/register" || pathname.startsWith("/admin")} />
        </>
    );
}
