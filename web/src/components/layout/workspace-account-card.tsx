import { Button } from "antd";
import { ChevronRight, Coins, Gift, LogOut, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { currentLocale } from "@/i18n";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing, UserGroupBadge } from "./user-group-badge";
import "./workspace-account-card.css";

/** 同一账户卡片用于顶部和侧栏；余额与退出均复用真实服务。 */
export function WorkspaceAccountCard({ onWallet, onNavigate }: { onWallet: () => void; onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const referralAvailable = useUserStore((state) => state.referralAvailable);
    const { availableMicrocredits, account, refreshing, refresh } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const { t } = useTranslation();
    if (!user) return null;
    const name = user.displayName || user.username;
    const accountLabel = user.email || `@${user.username}`;
    const formatCompact = (value: number) => (value / 1_000_000).toLocaleString(currentLocale(), { maximumFractionDigits: 2 });
    const balance = availableMicrocredits === null ? null : formatCompact(availableMicrocredits);
    const loadingBalance = balance === null && refreshing;
    const poolParts: string[] = [];
    if (account && ((account.imageAvailableMicrocredits || 0) > 0 || (account.videoAvailableMicrocredits || 0) > 0)) {
        poolParts.push(`通用 ${formatCompact(account.availableMicrocredits)}`);
        if ((account.imageAvailableMicrocredits || 0) > 0) poolParts.push(`图片 ${formatCompact(account.imageAvailableMicrocredits || 0)}`);
        if ((account.videoAvailableMicrocredits || 0) > 0) poolParts.push(`视频 ${formatCompact(account.videoAvailableMicrocredits || 0)}`);
    }

    return (
        <section className="workspace-account-card" aria-label={t("shell.account.region")}>
            <header className="workspace-account-card-identity">
                <UserGroupAvatarRing>
                    <UserAvatar user={user} className="workspace-account-card-avatar" />
                </UserGroupAvatarRing>
                <div className="workspace-account-card-copy">
                    <div className="workspace-account-card-name">
                        <strong title={name}>{name}</strong>
                        <UserGroupBadge />
                    </div>
                    <span className="workspace-account-card-meta" title={accountLabel}>
                        {accountLabel}
                    </span>
                </div>
            </header>
            {creditsEnabled ? (
                <div className="workspace-account-card-wallet">
                    <span className="workspace-account-card-wallet-label">{t("shell.account.availableCredits")}</span>
                    <button type="button" disabled={loadingBalance} aria-busy={loadingBalance} onClick={balance === null ? () => void refresh() : onWallet}>
                        <span className="workspace-account-card-wallet-icon">
                            <Coins aria-hidden />
                        </span>
                        <span className="workspace-account-card-copy">
                            <strong className="workspace-account-card-balance">{balance ?? "—"}</strong>
                            <span className="workspace-account-card-meta">{balance === null ? t("shell.account.refreshBalance") : poolParts.length ? poolParts.join(" · ") : t("shell.account.topup")}</span>
                        </span>
                        {balance === null ? <RefreshCw aria-hidden className={refreshing ? "motion-safe:animate-spin" : undefined} /> : <ChevronRight aria-hidden />}
                    </button>
                </div>
            ) : null}
            <nav className="workspace-account-card-actions" aria-label={t("shell.account.actions")}>
                <Link to="/settings?section=profile" onClick={onNavigate}>
                    <Settings aria-hidden />
                    {t("shell.account.settings")}
                </Link>
                {referralAvailable ? (
                    <Link to="/referral" onClick={onNavigate}>
                        <Gift aria-hidden />
                        {t("shell.account.referral")}
                    </Link>
                ) : null}
                {user.role === "admin" ? (
                    <Link to="/admin" onClick={onNavigate}>
                        <ShieldCheck aria-hidden />
                        {t("shell.account.adminConsole")}
                    </Link>
                ) : null}
                <Button danger type="text" icon={<LogOut aria-hidden />} loading={loggingOut} onClick={() => void handleLogout()}>
                    {t("shell.account.logout")}
                </Button>
            </nav>
        </section>
    );
}
