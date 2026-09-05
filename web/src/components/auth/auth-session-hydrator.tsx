import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { getAuthSession, type AuthSessionPayload } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import type { SessionLoadingStage } from "@/lib/user-session";
import { useUserStore } from "@/stores/use-user-store";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const [stage, setStage] = useState<SessionLoadingStage>({ label: "正在恢复工作区", detail: "同步账号、模型和项目数据" });

    useEffect(() => {
        let cancelled = false;
        getAuthSession()
            .then(async (payload) => {
                if (cancelled) return;
                if (!payload.user) {
                    applyAnonymousSession(payload);
                    return;
                }
                // 账号数据、画布和素材持久化只属于已登录工作区，登录页不下载这些模块。
                const { applyUserSession } = await import("@/lib/user-session");
                if (cancelled) return;
                await applyUserSession(payload, setStage);
                preloadWorkspaceRoute(window.location.pathname);
            })
            .catch(() => {
                if (!cancelled) applyAnonymousSession({ user: null, logicalModels: [] });
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return hydrated ? children : <FullScreenLoader label={stage.label} detail={stage.detail} />;
}

function applyAnonymousSession(payload: AuthSessionPayload) {
    const store = useUserStore.getState();
    store.clearSession();
    store.setRuntimeLimits(payload.runtimeLimits);
    store.setDrawingEngine(payload.drawingEngine);
    store.setFeatures(payload.features);
    store.setHydrated(true);
}
