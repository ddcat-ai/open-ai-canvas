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

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const ensurePlugin = usePluginStore((state) => state.ensurePlugin);

    useEffect(() => {
        for (const plugin of listRegisteredPlugins()) ensurePlugin(plugin.manifest);
    }, [ensurePlugin]);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    <AuthSessionHydrator>
                        <ClientRootInit>{children}</ClientRootInit>
                    </AuthSessionHydrator>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
