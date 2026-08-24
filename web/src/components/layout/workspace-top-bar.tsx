import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Link, useLocation } from "react-router";

import { LocaleToggle } from "@/components/layout/locale-switcher";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";

const PAGE_TITLE_KEYS: Record<string, string> = {
    home: "layout:workspace-title-home",
    create: "layout:workspace-title-create",
    projects: "layout:workspace-title-projects",
    canvas: "layout:workspace-title-canvas",
    tasks: "layout:workspace-title-tasks",
    assets: "layout:workspace-title-assets",
    skills: "layout:workspace-title-skills",
    wallet: "layout:workspace-title-wallet",
    settings: "layout:workspace-title-settings",
};

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const { t } = useTranslation(["canvas", "layout"]);
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const { pathname } = useLocation();

    const slug = pathname.split("/").filter(Boolean)[0];
    const pageTitle = (slug && PAGE_TITLE_KEYS[slug] && t(PAGE_TITLE_KEYS[slug])) || t("domain:yingce-4");

    return (
        <header className="app-workspace-topbar flex shrink-0 items-center justify-between gap-3 px-3 sm:px-4">
            <div className="flex min-w-0 items-center gap-1.5">
                <button type="button" className="app-workspace-topbar-icon-button" aria-label={sidebarOpen ? t("domain:collapse-sidebar") : t("domain:expand-sidebar")} onClick={onToggleSidebar}>
                    {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
                </button>
                <nav className="flex min-w-0 items-center gap-2 text-[var(--fs-caption)] text-foreground/50" aria-label={t("domain:current-location")}>
                    <Link to="/" className="shrink-0 font-medium text-foreground/70 transition-colors hover:text-foreground">
                        {t("domain:yingce-4")}
                    </Link>
                    <span className="shrink-0 text-foreground/30">/</span>
                    <span className="truncate font-medium text-foreground">{pageTitle}</span>
                </nav>
            </div>

            <div className="flex shrink-0 items-center gap-1">
                {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" /> : null}
                <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label={t("domain:switch-theme")} />
                <LocaleToggle className="app-workspace-topbar-icon-button inline-flex items-center justify-center" />
                <WorkspaceAccountMenu />
            </div>
        </header>
    );
}
