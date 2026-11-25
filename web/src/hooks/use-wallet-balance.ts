import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getWallet, totalAvailableMicrocredits, type CreditAccount, type WalletSummary } from "@/services/api/wallet";
import { getTeamWallet } from "@/services/api/teams";
import { workspaceTeamId } from "@/lib/workspace-routes";

// 余额不是页面心跳数据。工作区内多个位置共享同一个 Query，只在首次进入、显式
// wallet:updated 事件或用户主动刷新时访问服务端，避免常驻布局产生永久轮询。
const WALLET_STALE_TIME_MS = 5 * 60_000;
const walletBalanceQueryKey = (userId: string) => (workspaceTeamId ? (["wallet-balance", userId, workspaceTeamId] as const) : (["wallet-balance", userId] as const));

export type WalletSnapshot = {
    availableMicrocredits: number;
    account: CreditAccount | null;
    policy: WalletSummary["policy"] | null;
};

export function useWalletBalance(userId?: string, enabled = true) {
    const activeUserId = enabled ? userId || "" : "";
    const queryClient = useQueryClient();
    const queryKey = walletBalanceQueryKey(activeUserId);
    const query = useQuery({
        queryKey,
        enabled: Boolean(activeUserId),
        queryFn: async ({ signal }): Promise<WalletSnapshot> => {
            if (workspaceTeamId) {
                const { myAccount } = await getTeamWallet(workspaceTeamId, signal);
                return { availableMicrocredits: myAccount.availableMicrocredits, account: null, policy: null };
            }
            const wallet = await getWallet(1, 1);
            if (wallet.account.userId !== activeUserId) throw new Error("积分账户与当前用户不一致");
            return { availableMicrocredits: totalAvailableMicrocredits(wallet.account), account: wallet.account, policy: wallet.policy };
        },
        staleTime: WALLET_STALE_TIME_MS,
        refetchOnWindowFocus: false,
    });

    useEffect(() => {
        if (!activeUserId) return;
        const handleUpdated = () => void queryClient.invalidateQueries({ queryKey: walletBalanceQueryKey(activeUserId) });
        window.addEventListener("wallet:updated", handleUpdated);
        return () => {
            window.removeEventListener("wallet:updated", handleUpdated);
        };
    }, [activeUserId, queryClient]);

    useEffect(() => {
        if (query.error) console.warn("积分余额刷新失败", query.error);
    }, [query.error]);

    return {
        availableMicrocredits: query.data?.availableMicrocredits ?? null,
        account: query.data?.account ?? null,
        policy: query.data?.policy ?? null,
        refreshing: query.isFetching,
        refresh: query.refetch,
    };
}
