import { App, Popover } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { ChevronRight, LogIn, LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "react-router";

import { AuthLoginLink } from "@/components/auth/auth-login-link";
import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { UserAvatar } from "@/components/layout/user-avatar";
import { UserGroupBadge } from "@/components/layout/user-group-badge";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { useAuthEntry } from "@/hooks/use-auth-entry";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { applyUserSession } from "@/lib/user-session";
import { cn } from "@/lib/utils";
import { logout } from "@/services/api/auth";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";

type WorkspaceSidebarFooterProps = {
    expandedClassName: string;
    collapsedClassName: string;
    accountClassName: string;
    showAnnouncement?: boolean;
};

export function WorkspaceSidebarFooter({ expandedClassName, collapsedClassName, accountClassName, showAnnouncement = true }: WorkspaceSidebarFooterProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { showLoginAfterSignOut } = useAuthEntry();
    const { message } = App.useApp();
    const [menuOpen, setMenuOpen] = useState(false);
    const { t } = useTranslation();
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const balance = availableMicrocredits === null
        ? "--"
        : (availableMicrocredits / 1_000_000).toLocaleString(currentLocale(), { maximumFractionDigits: 2 });

    const handleLogout = async () => {
        try {
            await logout();
            await applyUserSession({ user: null });
            setMenuOpen(false);
            message.success(t("account.layout.footerMenu.loggedOut"));
            showLoginAfterSignOut();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.layout.footerMenu.logoutFailed"));
        }
    };

    if (!hydrated) return <div className="h-24 animate-pulse rounded-md bg-foreground/[.035]" />;

    return (
        <div>
            {user && showAnnouncement ? (
                <SystemAnnouncementCenter
                    userId={user.id}
                    className={cn("relative mb-1 flex h-9 w-full items-center rounded-md text-xs text-foreground/55 transition-colors hover:bg-surface-hover hover:text-foreground", collapsedClassName)}
                    showLabel
                    labelClassName={expandedClassName}
                    staticMotion
                />
            ) : null}
            {user ? (
                <Popover
                    trigger="click"
                    placement="rightBottom"
                    open={menuOpen}
                    onOpenChange={setMenuOpen}
                    content={(
                        <div className="w-[232px] py-0.5">
                            <div className="flex items-center gap-3 border-b border-border/65 px-1 pb-3">
                                <SidebarUserAvatar user={user} className="size-8" />
                                <div className="min-w-0 flex-1">
                                    <div className="flex min-w-0 items-center gap-2"><span className="truncate text-sm font-medium">{user.displayName || user.username}</span><UserGroupBadge /><IdentityProviderBadge user={user} /></div>
                                    {creditsEnabled ? <div className="mt-0.5 truncate text-[var(--fs-label)] tabular-nums text-foreground/45">{t("shell.account.availableBalance", { balance })}</div> : null}
                                </div>
                            </div>

                            {user.role === "admin" ? (
                                <nav className="py-2" aria-label={t("shell.account.adminTools")}>
                                    <MenuLink to="/admin" icon={<ShieldCheck />} label={t("shell.account.adminConsole")} onNavigate={() => setMenuOpen(false)} />
                                </nav>
                            ) : null}

                            <div className="border-y border-border/65 py-2">
                                <AppChangelogButton className="flex h-8 w-full items-center gap-2 rounded px-2 text-[var(--fs-label)] text-foreground/58 hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5" showLabel showVersion versionClassName="ml-auto text-[var(--fs-micro)] tabular-nums text-foreground/32" />
                            </div>

                            <div className="flex h-10 items-center px-2">
                                {theme === "dark" ? <Moon className="size-3.5 text-foreground/45" /> : <Sun className="size-3.5 text-foreground/45" />}
                                <span className="ml-2 flex-1 text-xs text-foreground/65">{t("shell.darkMode")}</span>
                                <Switch size="sm" checked={theme === "dark"} onChange={(checked) => setTheme(checked ? "dark" : "light")} aria-label={t("shell.darkMode")} />
                            </div>
                            <button type="button" className="flex h-9 w-full items-center gap-2 rounded px-2 text-xs text-foreground/55 hover:bg-surface-hover hover:text-foreground" onClick={() => void handleLogout()}><LogOut className="size-3.5" />{t("shell.account.logout")}</button>
                        </div>
                    )}
                >
                    <button type="button" className={cn("app-workspace-account-button flex min-h-10 w-full min-w-0 items-center overflow-hidden rounded-md text-left transition-colors hover:bg-surface-hover", accountClassName)} title={creditsEnabled ? `${user.displayName || user.username} · ${t("shell.account.balance", { balance })}` : user.displayName || user.username}>
                        <SidebarUserAvatar user={user} className="size-7" />
                        <span className={cn("min-w-0 flex-1 flex-col", expandedClassName)}>
                            <span className="flex min-w-0 items-center gap-1.5"><span className="truncate text-xs font-medium">{user.displayName || user.username}</span><UserGroupBadge compact /></span>
                            {creditsEnabled ? <span className="mt-0.5 block truncate text-[var(--fs-micro)] tabular-nums text-foreground/42">{t("shell.account.balance", { balance })}</span> : null}
                        </span>
                        <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/30", expandedClassName)} />
                    </button>
                </Popover>
            ) : (
                <AuthLoginLink className={cn("flex h-10 items-center rounded-md text-xs text-foreground/65 hover:bg-surface-hover hover:text-foreground", collapsedClassName)} title={t("shell.login")}>
                    <LogIn className="size-4 shrink-0" /><span className={expandedClassName}>{t("shell.login")}</span>
                </AuthLoginLink>
            )}
        </div>
    );
}

function MenuLink({ to, icon, label, onNavigate }: { to: string; icon: ReactNode; label: string; onNavigate: () => void }) {
    return <Link to={to} onClick={onNavigate} className="flex h-9 items-center gap-2 rounded px-2 text-xs text-foreground/62 hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">{icon}<span className="flex-1">{label}</span><ChevronRight className="!size-3 text-foreground/25" /></Link>;
}

function SidebarUserAvatar({ user, className }: { user: LocalUser; className: string }) {
    return (
        <span className={`relative grid shrink-0 place-items-center ${className}`}>
            <UserAvatar user={user} className="size-full rounded-md bg-transparent text-foreground/55" iconClassName="size-6 app-workspace-account-icon" />
            <IdentityProviderBadge user={user} compact className="absolute -bottom-1 -right-1" />
        </span>
    );
}
