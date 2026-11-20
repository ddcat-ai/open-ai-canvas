import { ChevronRight, Coins, PanelLeftClose, PanelLeftOpen, UserPlus } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";

import { TopbarFeedbackButton } from "@/components/feedback/topbar-feedback-button";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { WorkspaceAccountMenu } from "@/components/layout/workspace-account-menu";
import { useThemePack } from "@/themes/use-theme-pack";
import { WorkspaceTopBarExtensionSlot } from "@/components/layout/workspace-top-bar-extension";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { LanguageMenu } from "@/components/layout/language-menu";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useSpaceCreditOverview } from "@/hooks/use-space-credit-overview";
import { openWorkspaceWallet } from "@/lib/workspace-wallet";
import { workspacePageTitleKey } from "@/lib/workspace-page-title";
import { teamCredits, teamIdFromPath } from "@/lib/team-query-keys";
import { openTeamInvitations } from "./team-invitation-center";
import { openSpaceDirectory } from "./team-space-directory";

export function WorkspaceTopBar({ sidebarOpen, onToggleSidebar }: { sidebarOpen: boolean; onToggleSidebar: () => void }) {
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { t } = useTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const teamsEnabled = useUserStore((state) => state.features.teamsEnabled);
    const BalanceMark = useThemePack()?.creditMark ?? Coins;
    const { pathname } = useLocation();
    const teamId = teamIdFromPath(pathname);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled && !teamsEnabled);
    const overview = useSpaceCreditOverview();
    const data = overview.isError ? undefined : overview.data;
    const scopedCredit = data?.spaces.find((space) => space.teamId === teamId);
    const spaceCredit = teamId ? scopedCredit : data?.personal;
    const spaceBalance = spaceCredit ? teamCredits(spaceCredit.availableMicrocredits) : "—";
    const spaceTitle = teamId ? "本空间积分" : "个人积分";
    const teamTotal = !teamId && data?.spaces.length ? `团队 ${teamCredits(data.spaces.reduce((sum, space) => sum + space.availableMicrocredits, 0))}` : "";
    const spaceLabel = [spaceTitle, spaceBalance, teamTotal].filter(Boolean).join(" ") + "，查看各空间额度";
    const sectionKey = workspacePageTitleKey(pathname);
    const pageTitle = teamId ? scopedCredit?.name || "团队空间" : pathname === "/teams" ? "公司与团队" : sectionKey ? t(sectionKey) : brandName;
    const balance = availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString(currentLocale(), { maximumFractionDigits: 2 });

    return (
        <header className="app-workspace-topbar">
            <button type="button" className="app-workspace-mobile-menu app-workspace-topbar-icon-button" aria-expanded={sidebarOpen} aria-label={sidebarOpen ? t("shell.collapseSidebar") : t("shell.expandSidebar")} onClick={onToggleSidebar}>
                {sidebarOpen ? <PanelLeftClose className="size-4" /> : <PanelLeftOpen className="size-4" />}
            </button>
            <nav className="app-workspace-topbar-breadcrumb" aria-label={t("shell.breadcrumb")}>
                <Link to="/" className="font-medium text-foreground/65 transition-colors hover:text-foreground">
                    {brandName}
                </Link>
                <ChevronRight aria-hidden />
                <span className="truncate" aria-current="page">
                    {pageTitle}
                </span>
            </nav>
            <WorkspaceTopBarExtensionSlot />
            <div className="app-workspace-topbar-actions">
                {creditsEnabled && (
                    <div className="app-workspace-topbar-wallet">
                        {teamsEnabled && user ? (
                            <button type="button" className="app-workspace-topbar-credit-pill space-credit-pill" aria-haspopup="dialog" aria-label={spaceLabel} title={spaceLabel} onClick={openSpaceDirectory}>
                                <BalanceMark aria-hidden />
                                <span>{spaceTitle}</span>
                                <strong>{spaceBalance}</strong>
                                {teamTotal && <small>{teamTotal}</small>}
                            </button>
                        ) : (
                            <button type="button" className="app-workspace-topbar-credit-pill" aria-label={t("shell.openWallet", { balance })} onClick={() => openWorkspaceWallet()}>
                                <BalanceMark aria-hidden />
                                <span>{t("shell.credits")}</span>
                                <strong>{balance}</strong>
                            </button>
                        )}
                        {teamsEnabled && teamId ? (
                            <Link className="app-workspace-topbar-topup" to={`/teams/${encodeURIComponent(teamId)}/wallet`}>
                                查看额度
                            </Link>
                        ) : (
                            <button type="button" className="app-workspace-topbar-topup" onClick={() => openWorkspaceWallet({ tab: "topup", category: "credits" })}>
                                {t("account.wallet.tabTopup")}
                            </button>
                        )}
                    </div>
                )}
                <div className="app-workspace-topbar-utilities">
                    <LanguageMenu />
                    {user ? <TopbarFeedbackButton /> : null}
                    {user && teamsEnabled ? (
                        <button type="button" className="app-workspace-topbar-icon-button" aria-label="团队邀请" title="团队邀请" onClick={openTeamInvitations}>
                            <UserPlus />
                        </button>
                    ) : null}
                    {user ? <SystemAnnouncementCenter userId={user.id} className="app-workspace-topbar-icon-button" autoOpen /> : null}
                    <AnimatedThemeToggler className="app-workspace-topbar-icon-button" theme={theme} onThemeChange={setTheme} aria-label={t("shell.toggleTheme")} />
                </div>
                <WorkspaceAccountMenu />
            </div>
        </header>
    );
}
