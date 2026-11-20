import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";

import { authPageURL, resolveLoginMode, type AuthView } from "@/lib/auth-entry";
import type { AuthLoginMode } from "@/services/api/auth";
import { useAuthDialogStore } from "@/stores/use-auth-dialog-store";
import { useAuthSettingsStore } from "@/stores/use-auth-settings-store";

/**
 * 当前登录入口的打开方式；首次调用会触发读取。返回 null 表示仍在读取。
 * 读取失败时退回独立页面：/login 不依赖弹窗，任何部署下都能完成登录。
 */
export function useAuthLoginMode(): AuthLoginMode | null {
    const settings = useAuthSettingsStore((state) => state.settings);
    const status = useAuthSettingsStore((state) => state.status);
    useEffect(() => {
        if (useAuthSettingsStore.getState().status === "idle") void useAuthSettingsStore.getState().load();
    }, []);
    if (settings) return resolveLoginMode(settings);
    return status === "error" ? "page" : null;
}

/** 登录表单使用的公开配置：每次打开最多复用 maxAgeMs 内的结果，保证注册开关等状态及时。 */
export function useAuthSettings(maxAgeMs = 5_000) {
    const settings = useAuthSettingsStore((state) => state.settings);
    const status = useAuthSettingsStore((state) => state.status);
    const load = useAuthSettingsStore((state) => state.load);
    useEffect(() => {
        void load({ maxAgeMs });
    }, [load, maxAgeMs]);
    const reload = useCallback(() => load({ maxAgeMs: 0 }), [load]);
    return { settings, failed: status === "error", reload };
}

function currentLoginMode(): AuthLoginMode | null {
    const { settings, status } = useAuthSettingsStore.getState();
    if (settings) return resolveLoginMode(settings);
    return status === "error" ? "page" : null;
}

/**
 * 站内登录入口统一从这里进入：弹窗模式在当前页面打开登录框，独立页面模式跳转 /login。
 * 配置尚未读到时也跳转 /login，由登录路由读取配置后决定继续展示页面还是改为弹窗。
 */
export function useAuthEntry() {
    const navigate = useNavigate();
    const location = useLocation();

    const openAuth = useCallback(
        (options: { view?: AuthView; next?: string | null; preferDialog?: boolean } = {}) => {
            const view = options.view ?? "login";
            // preferDialog 用于页面上有未提交内容的场景：跳走会丢失输入，两种模式都改为弹窗。
            if (options.preferDialog || currentLoginMode() === "modal") {
                useAuthDialogStore.getState().openDialog(view, options.next ?? null);
                return;
            }
            navigate(authPageURL(view, options.next ?? location.pathname + location.search));
        },
        [location.pathname, location.search, navigate],
    );

    /** 退出登录或凭据失效后回到登录入口：独立页面模式进入 /login，弹窗模式回首页并打开登录框。 */
    const showLoginAfterSignOut = useCallback(() => {
        if (currentLoginMode() === "modal") {
            navigate("/", { replace: true });
            useAuthDialogStore.getState().openDialog("login", null);
            return;
        }
        navigate("/login", { replace: true });
    }, [navigate]);

    return { openAuth, showLoginAfterSignOut };
}
