import type { ReactNode } from "react";
import { lazy, Suspense, useEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { AuthSessionHydrator } from "@/components/auth/auth-session-hydrator";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme } from "@/lib/skin-themes";
import { appQueryClient } from "@/lib/query-client";
import { useThemeStore } from "@/stores/use-theme-store";
import { applyAppearanceMetadata, useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";

const ClientRootInit = lazy(() => import("@/components/layout/client-root-init").then((module) => ({ default: module.ClientRootInit })));

function ClientRootBoundary({ children }: { children: ReactNode }) {
    const authenticated = useUserStore((state) => Boolean(state.user));
    // Keep the route tree mounted while the session changes from its initial
    // anonymous state to the restored user. Wrapping `children` only after
    // authentication would unmount RouterProvider and visibly flash the
    // workspace sidebar during refresh.
    return <>
        {children}
        {authenticated ? <Suspense fallback={null}><ClientRootInit>{null}</ClientRootInit></Suspense> : null}
    </>;
}

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";
    const appearance = useAppearanceStore((state) => state.appearance);

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        applySkinTheme(appearance.activeSkin, theme);
        applyAppearanceMetadata(appearance);
    }, [appearance, dark, theme]);

    // DEV 复现台和 CLI 文档页都不应被登录态、模型目录等工作区初始化阻塞：
    // 前者需要确定性本地场景，后者是公开的独立安装页。
    // 复现台条件在生产构建中会被摇树删除；CLI 条件保持公开页面可直接加载。
    const isolateDevRepro = import.meta.env.DEV && typeof window !== "undefined" && window.location.pathname === "/dev/director-repro";
    const isolatePublicCli = typeof window !== "undefined" && window.location.pathname === "/cli";

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark, appearance.activeSkin)}>
            <App message={{ duration: 3, maxCount: 3 }} notification={{ duration: 4.5, maxCount: 3, placement: "topRight" }}>
                <QueryClientProvider client={appQueryClient}>
                    {isolateDevRepro || isolatePublicCli ? (
                        children
                    ) : (
                        <AuthSessionHydrator>
                            <ClientRootBoundary>{children}</ClientRootBoundary>
                        </AuthSessionHydrator>
                    )}
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}
