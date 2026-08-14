import { Infinity as InfinityIcon, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
import { Link } from "react-router";

import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);

    return (
        <header className="app-workspace-topbar flex shrink-0 items-center justify-between gap-3 px-4 sm:px-5">
            <div className="flex min-w-0 items-center gap-2">
                <button type="button" className="app-workspace-topbar-icon-button" aria-label={sidebarOpen ? "收起侧栏" : "展开侧栏"} onClick={onToggleSidebar}>
                    {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </button>
                <Link to="/" className="app-workspace-brand-link inline-flex min-w-0 items-center gap-2 text-foreground" title="影策工作台">
                    <span className="app-workspace-brand-mark grid size-7 shrink-0 place-items-center rounded-md bg-foreground text-background">
                        <InfinityIcon className="size-4" />
                    </span>
                    <span className="app-workspace-brand-wordmark truncate text-[var(--fs-body)] font-semibold">影策</span>
                </Link>
            </div>
            <div className="flex shrink-0 items-center gap-1">
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label="切换主题" />
                <Link to="/settings" className="app-workspace-topbar-icon-button" aria-label="设置" title="设置">
                    <Settings className="size-4" />
                </Link>
            </div>
        </header>
    );
}
