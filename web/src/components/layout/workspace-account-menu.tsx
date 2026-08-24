import { Popover, Switch } from "antd";
import { CircleUserRound, Languages, LogIn, Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { LocaleSwitcher } from "@/components/layout/locale-switcher";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { formatLocale } from "@/lib/format-locale";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

/** 顶部栏头像账户菜单：只承载账户信息、版本和显示偏好；管理与退出入口统一放在侧栏。 */
export function WorkspaceAccountMenu() {
    const { t } = useTranslation("layout");
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const [menuOpen, setMenuOpen] = useState(false);

    const balance = availableMicrocredits === null ? "--" : (availableMicrocredits / 1_000_000).toLocaleString(formatLocale(), { maximumFractionDigits: 2 });

    if (!hydrated) {
        return <span className="size-9 animate-pulse rounded-[var(--r-md)] bg-foreground/[.06]" aria-hidden />;
    }

    return user ? (
        <Popover
            trigger="click"
            placement="bottomRight"
            rootClassName="workspace-account-popover"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            content={
                <div className="w-56 py-0.5">
                    <div className="flex items-center gap-3 px-1 pb-3">
                        <UserAvatar user={user} className="size-8" />
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5">
                                <span className="truncate text-sm font-medium">{user.displayName || user.username}</span>
                                <IdentityProviderBadge user={user} />
                            </div>
                            {creditsEnabled ? <div className="mt-0.5 truncate text-[var(--fs-label)] tabular-nums text-foreground/45">{t("account-menu.credits-available", { balance })}</div> : null}
                        </div>
                    </div>

                    <div className="border-t border-border/35 py-2">
                        <AppChangelogButton
                            className="flex h-8 w-full items-center gap-2 rounded px-2 text-[var(--fs-label)] text-foreground/58 hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5"
                            showLabel
                            showVersion
                            versionClassName="ml-auto text-[var(--fs-micro)] tabular-nums text-foreground/32"
                        />
                    </div>

                    <div className="flex h-10 items-center px-2">
                        {theme === "dark" ? <Moon className="size-3.5 text-foreground/45" /> : <Sun className="size-3.5 text-foreground/45" />}
                        <span className="ml-2 flex-1 text-xs text-foreground/65">{t("account-menu.dark-mode")}</span>
                        <Switch size="small" checked={theme === "dark"} onChange={(checked) => setTheme(checked ? "dark" : "light")} aria-label={t("account-menu.dark-mode")} />
                    </div>

                    <div className="flex h-10 items-center px-2">
                        <Languages className="size-3.5 text-foreground/45" />
                        <span className="ml-2 flex-1 text-xs text-foreground/65">{t("language.label")}</span>
                        <LocaleSwitcher />
                    </div>
                </div>
            }
        >
            <button type="button" className="app-workspace-topbar-icon-button app-workspace-account-trigger" aria-label={t("account-menu.trigger-aria")} title={user.displayName || user.username}>
                <UserAvatar user={user} className="size-6" />
            </button>
        </Popover>
    ) : (
        <Link to="/login" className="app-workspace-topbar-icon-button" aria-label={t("account-menu.sign-in-aria")} title={t("account-menu.sign-in-aria")}>
            <LogIn />
        </Link>
    );
}

function UserAvatar({ user, className }: { user: LocalUser; className?: string }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user.avatarUrl || "") ? user.avatarUrl : "";

    useEffect(() => setFailed(false), [avatarUrl]);

    // 结构保持 button > span > svg：占位图标自动复用顶栏图标按钮的 18px/1.8 描边与配色合同；默认不套圆角容器，hover 由按钮背景反馈。
    return (
        <span className={cn("grid shrink-0 place-items-center overflow-hidden", className)}>
            {avatarUrl && !failed ? <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} /> : <CircleUserRound className="size-full" aria-hidden />}
        </span>
    );
}
