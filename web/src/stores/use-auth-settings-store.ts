import { create } from "zustand";

import { getAuthSettings, type AuthSettings } from "@/services/api/auth";

type AuthSettingsStatus = "idle" | "loading" | "ready" | "error";

type AuthSettingsStore = {
    /** 最近一次成功读取的公开登录配置；刷新失败时保留，避免表单闪空。 */
    settings: AuthSettings | null;
    status: AuthSettingsStatus;
    loadedAt: number;
    /** maxAgeMs 内已读取过则复用；省略时只要读取过就复用。 */
    load: (options?: { maxAgeMs?: number }) => Promise<AuthSettings | null>;
};

let inflight: Promise<AuthSettings | null> | null = null;

/**
 * 公开登录配置（登录方式、注册开关、服务协议、打开方式）。不属于任何账号，
 * 切换账号无需清空；登录入口、路由守卫和登录表单共用同一份，避免重复请求。
 */
export const useAuthSettingsStore = create<AuthSettingsStore>((set, get) => ({
    settings: null,
    status: "idle",
    loadedAt: 0,
    load: ({ maxAgeMs = Number.POSITIVE_INFINITY } = {}) => {
        const { settings, status, loadedAt } = get();
        if (status === "ready" && settings && Date.now() - loadedAt <= maxAgeMs) return Promise.resolve(settings);
        if (inflight) return inflight;
        set({ status: "loading" });
        inflight = getAuthSettings()
            .then((value) => {
                set({ settings: value, status: "ready", loadedAt: Date.now() });
                return value;
            })
            .catch((error: unknown) => {
                // 只记录失败态，由调用方决定降级方式：登录表单隐藏验证码与第三方入口，注册表单提示重新读取。
                console.warn("读取登录配置失败", error);
                set({ status: "error" });
                return null;
            })
            .finally(() => {
                inflight = null;
            });
        return inflight;
    },
}));
