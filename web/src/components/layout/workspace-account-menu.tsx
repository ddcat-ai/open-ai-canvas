import { useState } from "react";

import { LL2ConnectBadge } from "@/components/ll2/ll2-connect";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 顶部入口：DMC C 端没有账号，"账户按钮"改成 DMC Key 连接状态。
 * 已登录（老会话残留）时保留原账户卡片，但不引导新用户登录。
 */
export function WorkspaceAccountMenu() {
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const [menuOpen] = useState(false);
    if (!hydrated) {
        return <span className="size-9 animate-pulse rounded-[var(--r-md)] bg-foreground/[.06]" aria-hidden />;
    }

    // 免登录模式下所有访客都走 DMC Key 入口；menuOpen 保留给将来接账户卡片。
    void menuOpen;
    void user;
    return <LL2ConnectBadge compact />;
}
