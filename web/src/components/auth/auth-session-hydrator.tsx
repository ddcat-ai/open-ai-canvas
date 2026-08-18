import type { ReactNode } from "react";
import { useEffect } from "react";

import { applyUserSession } from "@/lib/user-session";
import { getAuthSession } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        let cancelled = false;
        // 登录态与当前工作区 chunk 并行恢复，避免进入应用后再出现一次页面级等待。
        preloadWorkspaceRoute(window.location.pathname);
        getAuthSession()
            .then(async (payload) => {
                if (!cancelled) await applyUserSession(payload);
            })
            .catch(async () => {
                if (!cancelled) await applyUserSession({ user: null, logicalModels: [] });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return hydrated ? children : <FullScreenLoader />;
}
