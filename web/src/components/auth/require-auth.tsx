import { type ReactNode } from "react";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useUserStore } from "@/stores/use-user-store";

/**
 * DMC C 端不需要登录界面：用户填自己的 DMC API Key 即可使用。
 *
 * 这里只保留「会话状态恢复完成前显示加载态」，不再跳转 /login，
 * 也不再打开登录弹窗。Key 的连接引导由 LL2KeyNotice / LL2ConnectBadge 承担，
 * 它们是设置项，不是认证流程。
 *
 * allowAnonymous 参数保留以兼容现有路由调用，但不再影响放行结果。
 */
export function RequireAuth({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
    void allowAnonymous;
    const hydrated = useUserStore((state) => state.hydrated);
    if (!hydrated) return <FullScreenLoader />;
    return <>{children}</>;
}
