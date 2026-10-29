import { Button } from "antd";
import { ArrowUpRight, Coins, Gift, LogOut, RefreshCw, Settings, ShieldCheck } from "lucide-react";
import { Link } from "react-router";
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
    const { availableMicrocredits, refreshing, refresh } = useWalletBalance(user?.id, creditsEnabled);
    const { handleLogout, loggingOut } = useWorkspaceLogout();
    if (!user) return null;
    return <section className="workspace-account-card" aria-label="我的账户">
        <header className="workspace-account-card-identity">
            <UserGroupAvatarRing><UserAvatar user={user} className="workspace-account-card-avatar" /></UserGroupAvatarRing>
            <div><strong className="workspace-account-card-name"><span>{user.displayName || user.username}</span><UserGroupBadge /></strong><span>@{user.username}</span></div>
            <em>{user.role === "admin" ? "管理员" : "创作者"}</em>
        </header>
        {creditsEnabled ? <div className="workspace-account-card-wallet">
            <div className="workspace-account-card-balance"><span><Coins />可用积分</span><strong>{availableMicrocredits === null ? "—" : (availableMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}</strong></div>
            {availableMicrocredits === null ? <Button size="small" loading={refreshing} icon={<RefreshCw />} onClick={() => void refresh()}>刷新余额</Button> : <button type="button" onClick={onWallet}>充值 / 兑换<ArrowUpRight /></button>}
        </div> : null}
        <nav className="workspace-account-card-actions" aria-label="账户操作">
            <Link to="/settings?section=profile" onClick={onNavigate}><Settings /><span>账户与设置</span><ArrowUpRight /></Link>
            {referralAvailable ? <Link to="/referral" onClick={onNavigate}><Gift /><span>推广中心</span><ArrowUpRight /></Link> : null}
            {user.role === "admin" ? <Link to="/admin" onClick={onNavigate}><ShieldCheck /><span>管理员后台</span><ArrowUpRight /></Link> : null}
            <Button danger type="text" icon={<LogOut />} loading={loggingOut} onClick={() => void handleLogout()}>退出登录</Button>
        </nav>
    </section>;
}
