import type { ReactNode } from "react";
import { useEffect, useState } from "react";

import { getAuthSession, invalidateAuthSessionCache } from "@/services/api/auth";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { WorkspaceErrorState } from "@/components/layout/workspace-state";
import { appQueryClient } from "@/lib/query-client";
import { PageResourceError } from "@/lib/module-preload";
import { PageResourceErrorState } from "@/components/layout/page-resource-error-state";
import { assertCurrentUserSession, captureUserSession, isUserSessionInvalidated, subscribeUserSessionInvalidation } from "@/lib/user-scope";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useUserStore } from "@/stores/use-user-store";
import { recordDiagnosticEvent } from "@/services/diagnostics/client-diagnostics";

export function AuthSessionHydrator({ children }: { children: ReactNode }) {
    const hydrated = useUserStore((state) => state.hydrated);
    const [recoveryFailed, setRecoveryFailed] = useState<"session" | "workspace" | PageResourceError | null>(null);
    const [retry, setRetry] = useState(0);

    useEffect(() => {
        let cancelled = false;
        let recovery = 0;
        const restore = async (externalChange: boolean) => {
            const current = ++recovery;
            const isCurrent = () => !cancelled && current === recovery;
            const startedAt = performance.now();
            setRecoveryFailed(null);
            useUserStore.getState().setHydrated(false);
            if (externalChange) {
                appQueryClient.clear();
                invalidateAuthSessionCache();
            }
            recordDiagnosticEvent({ category: "navigation", level: "info", code: "startup.auth_session_started", message: "开始恢复认证会话" });
            const session = captureUserSession(true);
            let phase: "session" | "workspace" = "workspace";
            try {
                if (externalChange) {
                    const { suspendUserSession } = await import("@/lib/user-session");
                    if (!isCurrent()) return;
                    suspendUserSession();
                }
                phase = "session";
                const payload = await getAuthSession();
                phase = "workspace";
                if (!isCurrent()) return;
                assertCurrentUserSession(session, true);
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: "startup.auth_session_ready",
                    message: payload.user ? "认证会话已恢复" : "匿名会话已确认",
                    durationMs: performance.now() - startedAt,
                });
                // 账号数据、画布和素材持久化只属于已登录工作区，登录页不下载这些模块。
                const { applyUserSession } = await import("@/lib/user-session");
                if (!isCurrent()) return;
                assertCurrentUserSession(session, true);
                await applyUserSession(payload, session);
                if (!isCurrent()) return;
                recordDiagnosticEvent({
                    category: "navigation",
                    level: "info",
                    code: payload.user ? "startup.workspace_ready" : "startup.anonymous_ready",
                    message: payload.user ? "登录工作区已解除启动阻塞" : "匿名页面已解除启动阻塞",
                    durationMs: performance.now() - startedAt,
                });
                if (payload.user) preloadWorkspaceRoute(window.location.pathname);
            } catch (error) {
                if (isCurrent() && !(error instanceof DOMException && error.name === "AbortError")) {
                    const failure = error instanceof PageResourceError ? error : phase;
                    setRecoveryFailed(failure);
                    recordDiagnosticEvent({
                        category: "navigation",
                        level: "warning",
                        code: failure === "session" ? "startup.auth_session_failed" : "startup.workspace_init_failed",
                        message: failure === "session" ? "认证会话恢复失败，等待重试" : "工作区初始化失败，等待重试",
                        durationMs: performance.now() - startedAt,
                    });
                }
            }
        };
        const unsubscribe = subscribeUserSessionInvalidation(() => void restore(true));
        void restore(isUserSessionInvalidated());
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [retry]);

    if (recoveryFailed) {
        const retryRestore = () => setRetry((value) => value + 1);
        if (recoveryFailed instanceof PageResourceError) return <PageResourceErrorState error={recoveryFailed} onRetry={retryRestore} />;
        return <WorkspaceErrorState title={recoveryFailed === "session" ? "登录状态恢复失败" : "工作区初始化失败"} description="工作区已暂停，请重试。" onRetry={retryRestore} />;
    }
    return hydrated ? children : <FullScreenLoader />;
}
