import { useCallback, useEffect, useState } from "react";

import { getWallet } from "@/services/api/wallet";

const WALLET_REFRESH_INTERVAL_MS = 30_000;

export function useWalletBalance(userId?: string, enabled = true) {
    const [availableMicrocredits, setAvailableMicrocredits] = useState<number | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    const refresh = useCallback(async () => {
        if (!enabled || !userId) {
            setAvailableMicrocredits(null);
            return;
        }
        setRefreshing(true);
        try {
            const wallet = await getWallet(1, 1);
            setAvailableMicrocredits(wallet.account.availableMicrocredits);
        } catch {
            // 顶栏余额是只读辅助信息，读取失败时保留上次成功值，避免短暂网络错误造成闪烁。
        } finally {
            setRefreshing(false);
        }
    }, [enabled, userId]);

    useEffect(() => {
        if (!enabled || !userId) {
            setAvailableMicrocredits(null);
            return;
        }
        void refresh();
        const timer = window.setInterval(() => void refresh(), WALLET_REFRESH_INTERVAL_MS);
        const handleFocus = () => void refresh();
        const handleVisibility = () => {
            if (document.visibilityState === "visible") void refresh();
        };
        window.addEventListener("focus", handleFocus);
        window.addEventListener("wallet:updated", handleFocus);
        document.addEventListener("visibilitychange", handleVisibility);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener("focus", handleFocus);
            window.removeEventListener("wallet:updated", handleFocus);
            document.removeEventListener("visibilitychange", handleVisibility);
        };
    }, [enabled, refresh, userId]);

    return { availableMicrocredits, refreshing, refresh };
}
