import { Popover, Switch } from "antd";
import { ChevronRight, CircleUserRound, LogIn, LogOut, Moon, ShieldCheck, Sun } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";

import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { IdentityProviderBadge } from "@/components/layout/identity-provider-badge";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { cn } from "@/lib/utils";
import { useThemeStore } from "@/stores/use-theme-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";

/** 顶部栏头像账户菜单：账户信息、管理入口、版本、深色模式与退出登录。 */
export function WorkspaceAccountMenu() {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const { availableMicrocredits } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout } = useWorkspaceLogout();
    const [menuOpen, setMenuOpen] = useState(false);

    const balance = availableMicrocredits === null
        ? "--"
        : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 });

    if (!hydrated) {
        return <span className="size-9 animate-pulse rounded-[var(--r-md)] bg-foreground/[.06]" aria-hidden />;
    }

    return user ? (
        <Popover
            trigger="click"
            placement="bottomRight"
            open={menuOpen}
            onOpenChange={setMenuOpen}
            content={(
                <div className="w-56 py-0.5">
                    <div className="flex items-center gap-3 border-b border-border/65 px-1 pb-3">
                        <UserAvatar user={user} className="size-8" />
                        <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 items-center gap-1.5"><span className="truncate text-sm font-medium">{user.displayName || user.username}</span><IdentityProviderBadge user={user} /></div>
                            {creditsEnabled ? <div className="mt-0.5 truncate text-[var(--fs-label)] tabular-nums text-foreground/45">可用 {balance} 积分</div> : null}
                        </div>
                    </div>

                    {user.role === "admin" ? (
                        <nav className="py-2" aria-label="管理工具">
                            <MenuLink to="/admin" icon={<ShieldCheck />} label="管理员后台" onNavigate={() => setMenuOpen(false)} />
                        </nav>
                    ) : null}

                    <div className="border-y border-border/65 py-2">
                        <AppChangelogButton className="flex h-8 w-full items-center gap-2 rounded px-2 text-[var(--fs-label)] text-foreground/58 hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5" showLabel showVersion versionClassName="ml-auto text-[var(--fs-micro)] tabular-nums text-foreground/32" />
                    </div>

                    <div className="flex h-10 items-center px-2">
                        {theme === "dark" ? <Moon className="size-3.5 text-foreground/45" /> : <Sun className="size-3.5 text-foreground/45" />}
                        <span className="ml-2 flex-1 text-xs text-foreground/65">深色模式</span>
                        <Switch size="small" checked={theme === "dark"} onChange={(checked) => setTheme(checked ? "dark" : "light")} aria-label="深色模式" />
                    </div>

                    <button
                        type="button"
                        className="flex h-9 w-full items-center gap-2 rounded px-2 text-xs text-foreground/55 hover:bg-surface-hover hover:text-foreground"
                        onClick={() => void handleLogout()}
                    >
                        <LogOut className="size-3.5" />退出登录
                    </button>
                </div>
            )}
        >
            <button type="button" className="app-workspace-topbar-icon-button" aria-label="账户菜单" title={user.displayName || user.username}>
                <UserAvatar user={user} className="size-6" />
            </button>
        </Popover>
    ) : (
        <Link to="/login" className="app-workspace-topbar-icon-button" aria-label="登录" title="登录">
            <LogIn />
        </Link>
    );
}

function MenuLink({ to, icon, label, onNavigate }: { to: string; icon: ReactNode; label: string; onNavigate: () => void }) {
    return <Link to={to} onClick={onNavigate} className="flex h-9 items-center gap-2.5 rounded px-2 text-xs text-foreground/62 hover:bg-surface-hover hover:text-foreground [&_svg]:size-3.5 [&_svg]:shrink-0">{icon}<span className="flex-1">{label}</span><ChevronRight className="!size-3 text-foreground/25" /></Link>;
}

function UserAvatar({ user, className }: { user: LocalUser; className?: string }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user.avatarUrl || "") ? user.avatarUrl : "";

    useEffect(() => setFailed(false), [avatarUrl]);

    // 结构保持 button > span > svg：占位图标自动复用顶栏图标按钮的 18px/1.8 描边与配色合同。
    return (
        <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-[var(--r-sm)] bg-foreground/[.06]", className)}>
            {avatarUrl && !failed ? (
                <img src={avatarUrl} alt="" referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <CircleUserRound className="size-full" aria-hidden />
            )}
        </span>
    );
}
