import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, useLocation } from "react-router";

import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { useWorkspaceTopBarContent } from "@/components/layout/workspace-top-bar-extension";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

const PAGE_TITLES: Record<string, string> = {
    home: "首页",
    create: "创作",
    projects: "短剧创作",
    canvas: "画布",
    tasks: "任务",
    assets: "素材",
    skills: "技能库",
    wallet: "积分中心",
    settings: "设置",
};

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const { pathname } = useLocation();
    const extension = useWorkspaceTopBarContent();

    const slug = pathname.split("/").filter(Boolean)[0];
    const pageTitle = (slug && PAGE_TITLES[slug]) || "影策";

    return (
        <header className={`app-workspace-topbar flex shrink-0 items-center justify-between gap-2 px-3 sm:px-4 ${extension ? "has-extension" : ""}`}>
            <div className="flex min-w-0 flex-1 items-center gap-2">
                <button type="button" className="app-workspace-topbar-icon-button" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
                    {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </button>
                <nav className={`${extension ? "hidden 2xl:flex" : "flex"} min-w-0 items-center gap-2 text-[var(--fs-caption)] text-foreground/50`} aria-label="当前位置">
                    <Link to="/" className="shrink-0 font-medium text-foreground/70 transition-colors hover:text-foreground">影策</Link>
                    <span className="shrink-0 text-foreground/30">/</span>
                    <span className="truncate font-medium text-foreground">{pageTitle}</span>
                </nav>
                {extension ? <div className="min-w-0 flex-1">{extension}</div> : null}
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label="切换主题" />
                <WorkspaceAccountMenu />
            </div>
        </header>
    );
}
