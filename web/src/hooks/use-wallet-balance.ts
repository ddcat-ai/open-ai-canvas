import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { getWallet } from "@/services/api/wallet";

const WALLET_REFRESH_INTERVAL_MS = 30_000;
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
        staleTime: 15_000,
        refetchInterval: WALLET_REFRESH_INTERVAL_MS,
        refetchOnWindowFocus: true,
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
