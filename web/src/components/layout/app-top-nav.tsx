import { Infinity as InfinityIcon, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { ModelSetupGuide } from "@/components/layout/model-setup-guide";
import { WorkspaceSidebarFooter } from "@/components/layout/workspace-sidebar-footer";
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
    const scrollRef = useRef<HTMLElement>(null);
    const [scrollState, setScrollState] = useState({
        hasTopFade: false,
        hasBottomFade: false,
    });
    const hideChrome = pathname.startsWith("/admin") || /^\/canvas\/[^/]+/.test(pathname);
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
            <div className={cn("app-workspace-shell flex h-dvh min-h-0 w-full overflow-hidden", spatialWorkbench && "is-spatial", creationWorkspace && "is-creation-workspace")}>
                {!hideChrome && mobileSidebarExpanded ? <button type="button" className="app-workspace-sidebar-scrim lg:hidden" aria-label="收起侧栏" onClick={() => setMobileSidebarExpanded(false)} /> : null}
                {!hideChrome ? (
                    <aside className={cn("app-workspace-sidebar flex shrink-0 flex-col overflow-hidden transition-all duration-200", mobileSidebarExpanded ? "is-mobile-expanded w-[196px]" : "w-0 lg:w-[88px] lg:shrink-0")}>
                        <div
                            className={cn(
                                "flex h-14 shrink-0 items-center border-b border-border/55 text-foreground",
                                mobileSidebarExpanded ? "gap-2 px-3" : "justify-center",
                                "lg:justify-center lg:px-0",
                            )}
                        >
                            <Link to="/" className={cn("min-w-0 items-center gap-2", mobileSidebarExpanded || spatialWorkbench ? "flex" : "hidden", "lg:flex")} title="影策">
                                <span className="app-workspace-brand-mark grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background"><InfinityIcon className="size-4" /></span>
                                {spatialWorkbench ? <span className="min-w-0"><span className="block truncate text-[var(--fs-body)] font-semibold">影策</span><span className="block truncate text-[var(--fs-micro)] text-foreground/36">AI 叙事工作台</span></span> : <span className="truncate text-[var(--fs-body)] font-semibold">影策</span>}
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
                                        {showSection ? <div className={cn("mb-2 px-2 text-[var(--fs-tiny)] font-medium text-foreground/34", index > 0 && "mt-4", mobileSidebarExpanded ? "block" : "hidden", "lg:hidden")}>{tool.section}</div> : null}
                                        <Link
                                            to={`/${tool.slug}`}
                                            title={tool.label}
                                            onClick={() => {
                                                if (window.innerWidth < 1024) setMobileSidebarExpanded(false);
                                            }}
                                            className={cn(
                                                "app-workspace-nav-link relative mb-1 flex shrink-0 items-center rounded-md text-[var(--fs-body)] transition-colors",
                                                spatialWorkbench ? "h-11" : "h-9",
                                                mobileSidebarExpanded ? "gap-3 px-2.5" : "justify-center px-0",
                                                "lg:justify-center lg:px-0",
                                                active ? "is-active font-medium" : "text-foreground/55 hover:bg-foreground/[0.045] hover:text-foreground/85",
                                            )}
                                        >
                                            <Icon className="size-4 shrink-0" />
                                            <span className={cn("truncate", mobileSidebarExpanded ? "inline" : "hidden", "lg:inline")}>{tool.label}</span>
                                        </Link>
                                    </Fragment>
                                );
                            })}
                        </nav>
                        <div className="shrink-0 border-t border-border/55 p-2">
                            <WorkspaceSidebarFooter
                                collapsedClassName={cn(
                                    mobileSidebarExpanded ? "justify-start gap-2 px-2" : "justify-center gap-0 px-0",
                                    "lg:justify-center lg:gap-0 lg:px-0",
                                )}
                                expandedClassName={cn(mobileSidebarExpanded ? "flex" : "hidden", "lg:hidden")}
                                accountClassName={cn(
                                    mobileSidebarExpanded ? "flex-row gap-2 px-2" : "flex-col gap-0.5 px-0 py-1",
                                    "lg:flex-col lg:gap-0.5 lg:px-0 lg:py-1",
                                )}
                            />
                        </div>
                    </aside>
                ) : null}

                <div className="app-workspace-stage relative min-h-0 min-w-0 flex-1 overflow-hidden">
                    {!hideChrome ? (
                        <button type="button" className="app-workspace-sidebar-toggle absolute left-2 top-2 z-30 grid size-8 place-items-center rounded-md border border-border/60 bg-background/75 text-foreground/80 backdrop-blur transition hover:bg-foreground/[0.06] lg:hidden" aria-label={mobileSidebarExpanded ? "收起侧栏" : "展开侧栏"} onClick={() => setMobileSidebarExpanded((current) => !current)}>
                            {mobileSidebarExpanded ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                        </button>
                    ) : null}
                    {children}
                </div>
            </div>
            <ModelSetupGuide hidden={pathname === "/login" || pathname === "/register" || pathname.startsWith("/admin")} />
        </>
    );
}
