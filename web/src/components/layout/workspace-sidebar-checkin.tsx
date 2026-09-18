import { App } from "antd";
import { useState } from "react";

import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "@/lib/sidebar-checkin";
import { cn } from "@/lib/utils";
import { ApiError } from "@/services/api/request";
import { checkinCredits } from "@/services/api/wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceSidebarCheckin({ collapsed }: { collapsed: boolean }) {
    const user = useUserStore((state) => state.user);
    const creditsEnabled = useUserStore((state) => state.features.creditsEnabled);
    const brandName = useAppearanceStore((state) => state.appearance.brandName);
    const { policy, refresh } = useWalletBalance(user?.id, Boolean(user) && creditsEnabled);
    const { message } = App.useApp();
    const [claiming, setClaiming] = useState(false);

    const visible = shouldShowSidebarCheckin({
        creditsEnabled,
        checkinBonusMicrocredits: policy?.checkinBonusMicrocredits,
        checkedInToday: policy?.checkedInToday,
    });
    if (!user || !visible || !policy) return null;

    const amount = formatCredits(policy.checkinBonusMicrocredits, 2);
    const title = sidebarCheckinTitle(brandName);
    const summary = `${title}，今日可领 ${amount} 积分`;

    const claim = async () => {
        if (claiming) return;
        setClaiming(true);
        try {
            await checkinCredits();
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            message.success("签到成功，积分已到账");
        } catch (error) {
            const alreadyClaimed = error instanceof ApiError && error.status === 409;
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            if (alreadyClaimed) return;
            message.error(error instanceof Error ? error.message : "领取失败");
        } finally {
            setClaiming(false);
        }
    };

    if (collapsed) {
        return (
            <button type="button" className="app-workspace-sidebar-checkin is-collapsed" title={summary} aria-label={`立即领取今日 ${amount} 积分`} disabled={claiming} onClick={() => void claim()}>
                {claiming ? "…" : "领"}
            </button>
        );
    }

    return (
        <aside className="app-workspace-sidebar-checkin" aria-label={summary}>
            <div className="app-workspace-sidebar-checkin-copy">
                <strong className="app-workspace-sidebar-checkin-title">{title}</strong>
                <span className="app-workspace-sidebar-checkin-offer">
                    今日可领<em>{amount}</em>积分
                </span>
            </div>
            <button type="button" className={cn("app-workspace-sidebar-checkin-claim", claiming && "is-loading")} disabled={claiming} aria-label={`立即领取 ${amount} 积分`} onClick={() => void claim()}>
                {claiming ? "领取中" : "立即领取"}
            </button>
        </aside>
    );
}
