import { Button } from "antd";
import { ArrowUpRight, LogOut, Settings } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { useWorkspaceLogout } from "@/hooks/use-workspace-logout";
import { useUserStore } from "@/stores/use-user-store";
import { UserAvatar } from "./user-avatar";
import { UserGroupAvatarRing } from "./user-group-badge";
import "./workspace-account-card.css";

// C 端账户卡片只保留身份、设置与退出。
// 积分钱包、充值、返佣、管理后台入口一律不出现在用户端界面（对应交接清单 D2 / D3）。
// onWallet 保留在签名里以兼容顶部与侧栏两个调用点，但本卡片不再提供钱包入口。
export function WorkspaceAccountCard({ onNavigate }: { onWallet: () => void; onNavigate: () => void }) {
    const user = useUserStore((state) => state.user);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    const { t } = useTranslation();
    if (!user) return null;
    return <section className="workspace-account-card" aria-label={t("shell.account.region")}>
        <header className="workspace-account-card-identity">
            <UserGroupAvatarRing><UserAvatar user={user} className="workspace-account-card-avatar" /></UserGroupAvatarRing>
            <div><strong className="workspace-account-card-name"><span>{user.displayName || user.username}</span></strong><span>@{user.username}</span></div>
        </header>
        <nav className="workspace-account-card-actions" aria-label={t("shell.account.actions")}>
            <Link to="/settings?section=profile" onClick={onNavigate}><Settings /><span>{t("shell.account.settings")}</span><ArrowUpRight /></Link>
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>{t("shell.account.logout")}</Button>
        </nav>
    </section>;
}
