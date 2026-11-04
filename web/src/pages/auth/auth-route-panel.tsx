import { useEffect, useState } from "react";
import { App } from "antd";
import { useNavigate, useSearchParams } from "react-router";

import { AuthPanel } from "@/components/auth/auth-panel";
import { authPageURL, rememberReferralCode, safeAuthNext, type AuthView } from "@/lib/auth-entry";
import { useUserStore } from "@/stores/use-user-store";

/** 独立登录页：视图切换与登录成功都通过路由完成，next 沿用地址栏参数。 */
export function AuthRoutePanel({ view }: { view: AuthView }) {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);
    const next = safeAuthNext(params.get("next"));
    // 首次渲染即写入推广码，注册表单在同一轮渲染里读取。
    useState(() => rememberReferralCode(params.get("ref")));

    // 已登录用户直接进入目标页面。
    useEffect(() => {
        if (hydrated && user) navigate(next, { replace: true });
    }, [hydrated, user, next, navigate]);

    useEffect(() => {
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
    }, [message, params]);

    return <AuthPanel variant="page" view={view} next={next} onViewChange={(target) => navigate(authPageURL(target, next))} onAuthenticated={() => navigate(next, { replace: true })} />;
}
