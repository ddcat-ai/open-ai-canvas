import type { ReactNode } from "react";
import { useEffect } from "react";

import { getAuthSession, type AuthSessionPayload } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";

// hydrate 兜底超时：即使 getAuthSession 因任何原因久挂，骨架屏也不能吞一辈子 UI。
const HYDRATE_FALLBACK_MS = 8_000;

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        let cancelled = false;
        // 登录态与当前工作区 chunk 并行恢复，避免进入应用后再出现一次页面级等待。
        preloadWorkspaceRoute(window.location.pathname);
        const sessionPromise = getAuthSession()
            .then(async (payload) => {
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
            })
            .catch((error) => {
                console.warn("[hydrate] 登录态恢复失败，按未登录继续渲染", error);
                if (!cancelled) applyAnonymousSession({ user: null, logicalModels: [] });
            });
        // 兜底：超时后强制把前端从骨架屏切出去，主人能进入登录页 / 创作页，至少能看到东西。
        const fallback = window.setTimeout(() => {
            if (cancelled) return;
            if (useUserStore.getState().hydrated) return;
            console.warn("[hydrate] 时长超过", HYDRATE_FALLBACK_MS, "ms，强制按未登录兜底");
            // 直接同步 set hydrated，让 React 立刻重渲染——React 18 下 zustand 外部 setState 也需要刷新，
            // 因此这里同时处理：user 切到 null + 在主循环外再 set 一次 + 触发一个微任务让 React 调度。
            useUserStore.getState().setUser(null);
            useUserStore.getState().setHydrated(true);
            void Promise.resolve().then(() => useUserStore.getState().setHydrated(true));
            // 异步继续给其他 store 灌水（让 fallback 不再阻塞 UI），失败也不影响 hydrate。
            void import("@/lib/user-session")
                .then(({ applyUserSession }) => applyUserSession({ user: null, logicalModels: [] }))
                .catch((error) => console.warn("[hydrate] 后台恢复失败", error));
        }, HYDRATE_FALLBACK_MS);
        return () => {
            cancelled = true;
            window.clearTimeout(fallback);
            void sessionPromise;
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
