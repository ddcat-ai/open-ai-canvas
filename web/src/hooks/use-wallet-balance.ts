import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getWallet } from "@/services/api/wallet";

// 余额不是页面心跳数据。工作区内多个位置共享同一个 Query，只有首次进入、显式
// wallet:updated 事件或低频后台刷新才需要访问服务端，避免每个窗口 focus 都打一次列表接口。
const WALLET_REFRESH_INTERVAL_MS = 60_000;
const walletBalanceQueryKey = (userId: string) => ["wallet-balance", userId] as const;

export function useWalletBalance(userId?: string, enabled = true) {
    const activeUserId = enabled ? userId || "" : "";
    const queryClient = useQueryClient();
    const queryKey = walletBalanceQueryKey(activeUserId);
    const query = useQuery({
        queryKey,
        enabled: Boolean(activeUserId),
        queryFn: async () => {
            const wallet = await getWallet(1, 1);
            if (wallet.account.userId !== activeUserId) throw new Error("积分账户与当前用户不一致");
            return wallet.account.availableMicrocredits;
        },
        staleTime: WALLET_REFRESH_INTERVAL_MS,
        refetchInterval: WALLET_REFRESH_INTERVAL_MS,
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
        availableMicrocredits: query.data ?? null,
        refreshing: query.isFetching,
        refresh: query.refetch,
    };
}
