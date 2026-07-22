import { useEffect, useState, type CSSProperties } from "react";
import { App, Dropdown } from "antd";
import { Coins, Keyboard, LogIn, LogOut, Settings2, ShieldCheck, UserRound } from "lucide-react";
import { Link, useNavigate } from "react-router";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { AppChangelogButton } from "@/components/layout/app-changelog-modal";
import { SystemAnnouncementCenter } from "@/components/layout/system-announcement-center";
import { canvasThemes } from "@/lib/canvas-theme";
import { applyUserSession } from "@/lib/user-session";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { logout } from "@/services/api/auth";
import { useConfigStore } from "@/stores/use-config-store";
import { useUserStore, type LocalUser } from "@/stores/use-user-store";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts }: UserStatusActionsProps) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const navigate = useNavigate();
    const { message } = App.useApp();
    const canvasTheme = canvasThemes[theme];
    const { availableMicrocredits } = useWalletBalance(user?.id, variant !== "canvas");
    const naturalIconClass = "inline-flex size-7 shrink-0 items-center justify-center text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white [&_svg]:size-4";
    const announcementIconClass = "relative grid size-9 shrink-0 place-items-center rounded-full border border-stone-300/80 bg-white/80 text-stone-600 outline-none transition hover:border-stone-500 hover:text-stone-950 focus-visible:ring-2 focus-visible:ring-stone-500/50 dark:border-white/15 dark:bg-white/8 dark:text-stone-200 dark:hover:border-white/35 dark:hover:text-white";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    const handleLogout = async () => {
        try {
            await logout();
            await applyUserSession({ user: null, systemChannels: [] });
            message.success("已退出登录");
            navigate("/login", { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "退出失败");
        }
    };

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {variant !== "canvas" && user && availableMicrocredits !== null ? (
                <Link to="/wallet" className="mr-1 inline-flex h-7 items-center gap-1 text-xs font-medium tabular-nums text-stone-600 transition hover:text-stone-950 dark:text-stone-300 dark:hover:text-white" title="积分中心">
                    <Coins className="size-3.5" />
                    {(availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}
                </Link>
            ) : null}
            <AppChangelogButton className={naturalIconClass} style={iconStyle} />
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => openConfigDialog(false)} aria-label="配置" title="配置">
                    <Settings2 className="size-4" />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} title={theme === "dark" ? "切换到浅色主题" : "切换到深色主题"} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label="快捷键" title="快捷键">
                    <Keyboard className="size-4" />
                </button>
            ) : null}
            {hydrated && user ? <SystemAnnouncementCenter userId={user.id} className={announcementIconClass} style={variant === "canvas" ? { color: canvasTheme.node.text, borderColor: canvasTheme.toolbar.border, background: canvasTheme.toolbar.panel } : undefined} /> : null}
            {hydrated && user ? (
                <Dropdown
                    trigger={["click", "hover"]}
                    menu={{
                        items: [
                            {
                                key: "profile",
                                disabled: true,
                                label: (
                                    <div className="flex min-w-56 items-start gap-3 py-1.5 text-stone-900 dark:text-white">
                                        <UserAvatar user={user} className="size-10" />
                                        <div className="min-w-0 flex-1">
                                            <div className="truncate text-sm font-semibold">{user.displayName || user.username}</div>
                                            <div className="mt-0.5 truncate text-xs text-stone-500 dark:text-stone-400">站内账号 · @{user.username}</div>
                                            {user.identityProvider === "linuxdo" && user.identityId ? (
                                                <div className="mt-2 border-t border-stone-200 pt-2 text-[11px] leading-4 text-stone-500 dark:border-stone-700 dark:text-stone-400">
                                                    <div className="flex items-start gap-1.5">
                                                        <span className="shrink-0 font-medium text-stone-700 dark:text-stone-200">Linux.do ID</span>
                                                        <span className="min-w-0 break-all" title={user.identityId}>{user.identityId}</span>
                                                    </div>
                                                    {user.identityUsername ? <div className="mt-0.5 truncate">Linux.do 账号 · @{user.identityUsername}</div> : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    </div>
                                ),
                            },
                            ...(user.role === "admin" ? [{ key: "admin", icon: <ShieldCheck className="size-4" />, label: "管理员后台", onClick: () => navigate("/admin") }] : []),
                            { key: "wallet", icon: <Coins className="size-4" />, label: "积分中心", onClick: () => navigate("/wallet") },
                            { key: "logout", icon: <LogOut className="size-4" />, label: "退出登录", danger: true, onClick: () => void handleLogout() },
                        ],
                    }}
                >
                    <button
                        type="button"
                        className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full border border-stone-300/80 bg-stone-100 text-stone-600 outline-none transition hover:border-stone-500 focus-visible:ring-2 focus-visible:ring-stone-500/50 dark:border-white/15 dark:bg-white/8 dark:text-stone-200 dark:hover:border-white/35"
                        style={variant === "canvas" ? { color: canvasTheme.node.text, borderColor: canvasTheme.toolbar.border, background: canvasTheme.toolbar.panel } : undefined}
                        aria-label="用户菜单"
                        title={user.displayName || user.username}
                    >
                        <UserAvatar user={user} className="size-full" decorative />
                    </button>
                </Dropdown>
            ) : hydrated ? (
                <Link className={naturalIconClass} style={iconStyle} to="/login" aria-label="登录" title="登录">
                    <LogIn className="size-4" />
                </Link>
            ) : null}
        </div>
    );
}

function UserAvatar({ user, className, decorative = false }: { user: LocalUser; className: string; decorative?: boolean }) {
    const [failed, setFailed] = useState(false);
    const avatarUrl = /^https?:\/\//i.test(user.avatarUrl || "") ? user.avatarUrl : "";

    useEffect(() => setFailed(false), [avatarUrl]);

    return (
        <span className={`grid shrink-0 place-items-center overflow-hidden rounded-full bg-stone-200 text-stone-600 dark:bg-stone-800 dark:text-stone-200 ${className}`}>
            {avatarUrl && !failed ? (
                <img src={avatarUrl} alt={decorative ? "" : `${user.displayName || user.username}的头像`} referrerPolicy="no-referrer" className="size-full object-cover" onError={() => setFailed(true)} />
            ) : (
                <UserRound className="size-[52%]" aria-hidden />
            )}
        </span>
    );
}
