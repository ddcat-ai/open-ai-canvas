import type { ReactNode } from "react";
import { useEffect } from "react";

import { getAuthSession, type AuthSessionPayload } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);

    useEffect(() => {
        let cancelled = false;
        const startedAt = performance.now();
        recordDiagnosticEvent({ category: "navigation", level: "info", code: "startup.auth_session_started", message: "开始恢复认证会话" });
        getAuthSession()
            .then(async (payload) => {
                if (cancelled) return;
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: "startup.auth_session_ready",
                    message: payload.user ? "认证会话已恢复" : "匿名会话已确认",
                    durationMs: performance.now() - startedAt,
                });
                if (!payload.user) {
                    applyAnonymousSession(payload);
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "info",
                        code: "startup.anonymous_ready",
                        message: "匿名页面已解除启动阻塞",
                        durationMs: performance.now() - startedAt,
                    });
                    return;
                }
                // 账号数据、画布和素材持久化只属于已登录工作区，登录页不下载这些模块。
                const { applyUserSession } = await import("@/lib/user-session");
                if (cancelled) return;
                await applyUserSession(payload);
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: "startup.workspace_ready",
                    message: "登录工作区已解除启动阻塞",
                    durationMs: performance.now() - startedAt,
                });
                preloadWorkspaceRoute(window.location.pathname);
            })
            .catch(() => {
                if (!cancelled) {
                    applyAnonymousSession({ user: null });
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "warning",
                        code: "startup.auth_session_failed",
                        message: "认证会话恢复失败，已降级为匿名页面",
                        durationMs: performance.now() - startedAt,
                    });
                }
            });
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
