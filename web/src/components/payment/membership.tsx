import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays } from "lucide-react";
import { currentLocale } from "@/i18n";
import { useQueryClient } from "@tanstack/react-query";
import { getAuthSession, invalidateAuthSessionCache } from "@/services/api/auth";
import { refreshSystemChannels } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";
import type { MembershipStatus } from "@/services/api/membership";
import type { TopupProduct } from "@/services/api/payments";

export async function refreshMembershipAccess() {
    const userId = useUserStore.getState().user?.id;
    invalidateAuthSessionCache();
    const session = await getAuthSession();
    if (!userId || session.user?.id !== userId || useUserStore.getState().user?.id !== userId) return;
    useUserStore.getState().setUserGroup(session.userGroup);
    await refreshSystemChannels();
}

export const membershipQueryKey = ["wallet-membership"] as const;

export function useMembershipBoundary() {
    const end = useUserStore((state) => state.userGroup?.membershipEndsAt);
    const queryClient = useQueryClient();
    useEffect(() => {
        if (!end) return;
        let timer: number;
        let refreshing = false;
        const check = () => {
            window.clearTimeout(timer);
            const left = Date.parse(end) - Date.now();
            if (left > 0) {
                timer = window.setTimeout(check, Math.min(left + 50, 2_147_000_000));
                return;
            }
            if (refreshing) return;
            refreshing = true;
            void Promise.all([refreshMembershipAccess(), queryClient.invalidateQueries({ queryKey: membershipQueryKey }), queryClient.invalidateQueries({ queryKey: ["drama-models"] })])
                .catch((err) => console.warn("刷新到期会员权益失败", err))
                .finally(() => {
                    refreshing = false;
                });
        };
        check();
        window.addEventListener("focus", check);
        return () => {
            window.clearTimeout(timer);
            window.removeEventListener("focus", check);
        };
    }, [end, queryClient]);
}

export function MembershipSchedule({ state, selected }: { state: MembershipStatus; selected?: TopupProduct }) {
    const { t } = useTranslation();
    const now = Date.now();
    const periods = state.periods.filter((p) => Date.parse(p.endsAt) > now);
    const start = Math.max(now, Date.parse(periods.at(-1)?.endsAt ?? "") || now);
    if (!periods.length && selected?.kind !== "membership") return null;
    const formatter = new Intl.DateTimeFormat(currentLocale(), { dateStyle: "medium", timeStyle: "short" });
    const date = (value: number | string) => formatter.format(new Date(value));
    return (
        <div className="wallet-membership-schedule">
            <CalendarDays aria-hidden="true" />
            <div>
                {periods.map((p) => (
                    <div key={p.startsAt}>
                        <strong>
                            {p.productName} · {p.membershipGroup}
                        </strong>
                        　{date(p.startsAt)} – {date(p.endsAt)}
                    </div>
                ))}
                {periods.length > 0 && <div>{t("membership.restore", { group: state.baseGroup })}</div>}
                {selected?.kind === "membership" && <div>{t("membership.preview", { start: date(start), end: date(start + (selected.membershipDays ?? 0) * 86_400_000) })}</div>}
            </div>
        </div>
    );
}
