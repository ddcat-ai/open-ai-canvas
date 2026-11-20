import { useEffect, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router";

import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { useAuthLoginMode } from "@/hooks/use-auth-entry";
import { authPageURL } from "@/lib/auth-entry";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { useUserStore } from "@/stores/use-user-store";

export function RequireAuth({ children, allowAnonymous = false }: { children: ReactNode; allowAnonymous?: boolean }) {
    const location = useLocation();
    const hydrated = useUserStore((state) => state.hydrated);
    const user = useUserStore((state) => state.user);

    if (!hydrated) return <FullScreenLoader />;
    if (!user && !allowAnonymous) return <LoginRequired next={location.pathname + location.search} />;
    return children;
}

/** 未登录访问受保护页面：独立页面模式跳转 /login；弹窗模式回到首页并打开登录框，登录后再进入原页面。 */
function LoginRequired({ next }: { next: string }) {
    const mode = useAuthLoginMode();
    useEffect(() => {
        if (mode === "modal") useAuthDialogStore.getState().openDialog("login", next);
    }, [mode, next]);
    if (mode === null) return <FullScreenLoader />;
    return <Navigate to={mode === "page" ? authPageURL("login", next) : "/"} replace />;
}
