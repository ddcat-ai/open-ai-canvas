import type { ReactNode } from "react";
import { lazy, Suspense, useEffect, useLayoutEffect } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { ConfigProvider } from "antd";
import type { Locale as AntdLocale } from "antd/es/locale";
import deDE from "antd/locale/de_DE";
import enUS from "antd/locale/en_US";
import frFR from "antd/locale/fr_FR";
import jaJP from "antd/locale/ja_JP";
import koKR from "antd/locale/ko_KR";
import zhCN from "antd/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/de";
import "dayjs/locale/fr";
import "dayjs/locale/ja";
import "dayjs/locale/ko";
import "dayjs/locale/zh-cn";
import { I18nextProvider, useTranslation } from "react-i18next";

import { AuthSessionHydrator } from "@/components/auth/auth-session-hydrator";
import { AppFeedbackProvider } from "@/components/layout/app-feedback";
import { FullScreenLoader } from "@/components/ui/aceternity/full-screen-loader";
import { getAntThemeConfig } from "@/lib/app-theme";
import { applySkinTheme } from "@/lib/skin-themes";
import { appQueryClient } from "@/lib/query-client";
import { isIsolatedPrevisRepro } from "@/lib/dev-repro";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { applyAppearanceMetadata, useAppearanceStore } from "@/stores/use-appearance-store";
import { useUserStore } from "@/stores/use-user-store";
import { refreshPublicAppearance } from "@/services/appearance-bootstrap";
import { i18n } from "@/i18n";
import type { AppLocale } from "@/i18n/locales";
import { useLocaleStore } from "@/stores/use-locale-store";

// antd 组件内置文案与 dayjs 日期格式随界面语言切换。
const ANTD_LOCALES: Record<AppLocale, AntdLocale> = { "zh-CN": zhCN, "en-US": enUS, "fr-FR": frFR, "de-DE": deDE, "ja-JP": jaJP, "ko-KR": koKR };
const DAYJS_LOCALES: Record<AppLocale, string> = { "zh-CN": "zh-cn", "en-US": "en", "fr-FR": "fr", "de-DE": "de", "ja-JP": "ja", "ko-KR": "ko" };

const ClientRootInit = lazy(() => import("@/components/layout/client-root-init").then((module) => ({ default: module.ClientRootInit })));

function ClientRootBoundary({ children }: { children: ReactNode }) {
    const authenticated = useUserStore((state) => Boolean(state.user));
    const { t } = useTranslation();
    if (!authenticated) return children;
    return (
        <Suspense fallback={<FullScreenLoader label={t("shell.preparing")} detail={t("shell.preparingDetail")} />}>
            <ClientRootInit>{children}</ClientRootInit>
        </Suspense>
    );
}

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useActiveTheme();
    const dark = theme === "dark";
    const appearance = useAppearanceStore((state) => state.appearance);
    const locale = useLocaleStore((state) => state.locale);

    useLayoutEffect(() => {
        document.documentElement.lang = locale;
        dayjs.locale(DAYJS_LOCALES[locale]);
    }, [locale]);

    useLayoutEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
        applySkinTheme(appearance.activeSkin, theme);
        applyAppearanceMetadata(appearance);
    }, [appearance, dark, theme]);

    // DEV 复现台必须是同源本地确定性场景：AuthSessionHydrator 会打 /api/auth/session，
    // ClientRootInit 会打 /api/model-catalog，没有后端时产生真实 502，与导演台无关却会污染判据。
    // 与启动入口共用精确路径边界；生产构建中 import.meta.env.DEV 为 false，始终不启用隔离。
    const isolateDevRepro = typeof window !== "undefined" && isIsolatedPrevisRepro(import.meta.env.DEV, window.location.pathname);

    useEffect(() => {
        if (isolateDevRepro) return;
        const refresh = () => {
            if (document.visibilityState === "visible") void refreshPublicAppearance();
        };
        window.addEventListener("focus", refresh);
        document.addEventListener("visibilitychange", refresh);
        return () => {
            window.removeEventListener("focus", refresh);
            document.removeEventListener("visibilitychange", refresh);
        };
    }, [isolateDevRepro]);

    return (
        // 两个汉字的按钮（取消、确定）不再被 antd 拉开字距，与其他按钮的文字节奏一致。
        // I18nextProvider 放在最外层，antd 浮层与懒加载模块都能取到同一实例。
        <I18nextProvider i18n={i18n}>
            <ConfigProvider locale={ANTD_LOCALES[locale]} theme={getAntThemeConfig(dark, appearance.activeSkin)} wave={{ disabled: true }} button={{ autoInsertSpace: false }}>
                <AppFeedbackProvider>
                    <QueryClientProvider client={appQueryClient}>
                        {isolateDevRepro ? (
                            children
                        ) : (
                            <AuthSessionHydrator>
                                <ClientRootBoundary>{children}</ClientRootBoundary>
                            </AuthSessionHydrator>
                        )}
                    </QueryClientProvider>
                </AppFeedbackProvider>
            </ConfigProvider>
        </I18nextProvider>
    );
}
