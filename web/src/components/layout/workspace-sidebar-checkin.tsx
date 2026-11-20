import { App } from "antd";
import { useState } from "react";
import { Gift, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";

import { formatCredits } from "@/constant/credits";
import { useWalletBalance } from "@/hooks/use-wallet-balance";
import { sidebarCheckinTitle, shouldShowSidebarCheckin } from "@/lib/sidebar-checkin";
import { cn } from "@/lib/utils";
import { ApiError } from "@/services/api/request";
import { checkinCredits } from "@/services/api/wallet";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

export function WorkspaceSidebarCheckin({ collapsed }: { collapsed: boolean }) {
    const { t } = useTranslation();
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
    const summary = t("account.layout.checkin.summary", { title, amount });

    const claim = async () => {
        if (claiming) return;
        setClaiming(true);
        try {
            await checkinCredits();
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            message.success(t("account.layout.checkin.success"));
        } catch (error) {
            const alreadyClaimed = error instanceof ApiError && error.status === 409;
            window.dispatchEvent(new CustomEvent("wallet:updated"));
            await refresh();
            if (alreadyClaimed) return;
            message.error(error instanceof Error ? error.message : t("account.layout.checkin.failed"));
        } finally {
            setClaiming(false);
        }
    };

    if (collapsed) {
        return (
            <button type="button" className="app-workspace-sidebar-checkin is-collapsed" title={summary} aria-label={t("account.layout.checkin.claimToday", { amount })} aria-busy={claiming} disabled={claiming} onClick={() => void claim()}>
                {claiming ? <LoaderCircle className="size-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Gift className="size-5" aria-hidden="true" />}
            </button>
        );
    }

    return (
        <aside className="app-workspace-sidebar-checkin" aria-label={summary}>
            <div className="app-workspace-sidebar-checkin-copy">
                <strong className="app-workspace-sidebar-checkin-title">{title}</strong>
                <span className="app-workspace-sidebar-checkin-offer">
                    {t("account.layout.checkin.offerBefore")}
                    <em>{amount}</em>
                    {t("account.layout.checkin.offerAfter")}
                </span>
            </div>
            <button type="button" className={cn("app-workspace-sidebar-checkin-claim", claiming && "is-loading")} disabled={claiming} aria-label={t("account.layout.checkin.claimAmount", { amount })} onClick={() => void claim()}>
                {claiming ? t("account.layout.checkin.claiming") : t("account.layout.checkin.claim")}
            </button>
        </aside>
    );
}
