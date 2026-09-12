import type { ReactNode } from "react";
import { useEffect } from "react";

import { getAuthSession, type AuthSessionPayload } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        let cancelled = false;
        const hydrate = async () => {
            let payload: AuthSessionPayload;
            try {
                payload = await getAuthSession();
            } catch (error) {
                // 只有认证接口本身没有返回有效身份时才进入匿名态；工作区初始化失败不能冒充“登录失效”。
                console.warn("恢复登录会话失败", error);
                if (!cancelled) applyAnonymousSession({ user: null, logicalModels: [] });
                return;
            }
            try {
                if (cancelled) return;
                if (!payload.user) {
                    applyAnonymousSession(payload);
                    return;
                }
                // 账号数据、画布和素材持久化只属于已登录工作区，登录页不下载这些模块。
                const { applyUserSession } = await import("@/lib/user-session");
                if (cancelled) return;
                await applyUserSession(payload);
                preloadWorkspaceRoute(window.location.pathname);
            } catch (error) {
                if (cancelled) return;
                // /auth/session 已确认身份时，后续本地缓存或工作区初始化错误不得清空用户。
                // applyUserSession 会在 finally 中结束 loading；这里保留身份并留下可诊断日志。
                const store = useUserStore.getState();
                store.setUser(payload.user);
                store.setRuntimeLimits(payload.runtimeLimits);
                store.setDrawingEngine(payload.drawingEngine);
                store.setFeatures(payload.features);
                store.setHydrated(true);
                console.error("登录身份已恢复，但工作区初始化失败", error);
            }
        };
        void hydrate();
        return () => {
            cancelled = true;
        };
    }, []);

    return hydrated ? children : <FullScreenLoader />;
}

function applyAnonymousSession(payload: AuthSessionPayload) {
    const store = useUserStore.getState();
    store.clearSession();
    store.setRuntimeLimits(payload.runtimeLimits);
    store.setDrawingEngine(payload.drawingEngine);
    store.setFeatures(payload.features);
    store.setHydrated(true);
}
