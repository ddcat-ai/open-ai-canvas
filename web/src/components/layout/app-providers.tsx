import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AuthSessionHydrator } from "@/components/auth/auth-session-hydrator";
import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { appQueryClient } from "@/lib/query-client";
import { useThemeStore } from "@/stores/use-theme-store";
import { listRegisteredPlugins } from "@/lib/plugins/plugin-registry";
import { usePluginStore } from "@/stores/use-plugin-store";
import { fetchWorkflowPluginStatuses } from "@/services/api/plugins";
import { useUserStore } from "@/stores/use-user-store";

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);
    const setRuntimeStatuses = usePluginStore((state) => state.setRuntimeStatuses);
    const userId = useUserStore((state) => state.user?.id);

    useEffect(() => {
        for (const plugin of listRegisteredPlugins()) ensurePlugin(plugin.manifest);
    }, [ensurePlugin]);

    useEffect(() => {
        if (!userId) {
            setRuntimeStatuses({});
            return;
        }
        let cancelled = false;
        void fetchWorkflowPluginStatuses()
            .then((statuses) => {
                if (!cancelled) setRuntimeStatuses(statuses);
            })
            .catch(() => {
                if (!cancelled) setRuntimeStatuses({});
            });
        return () => {
            cancelled = true;
        };
    }, [setRuntimeStatuses, userId]);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    // DEV 复现台必须是同源本地确定性场景：AuthSessionHydrator 会打 /api/auth/session，
    // ClientRootInit 会打 /api/model-catalog，没有后端时产生真实 502，与导演台无关却会污染判据。
    // 只精确匹配该路径；生产构建中 import.meta.env.DEV 为 false，本分支被摇树删除。
    const isolateDevRepro = import.meta.env.DEV && typeof window !== "undefined" && window.location.pathname === "/dev/director-repro";

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    {isolateDevRepro ? (
                        children
                    ) : (
                        <AuthSessionHydrator>
                            <ClientRootInit>{children}</ClientRootInit>
                        </AuthSessionHydrator>
                    )}
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
