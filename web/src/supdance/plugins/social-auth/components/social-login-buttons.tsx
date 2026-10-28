import { useEffect, useState } from "react";
import { App, Tooltip } from "antd";
import { Globe } from "lucide-react";

import { useI18n } from "@/supdance/plugins/i18n";
import { buildSocialAuthStartUrl, getPublicSocialAuthProviders } from "../api";
import { SocialProviderIcon } from "./social-provider-icons";
import type { PublicProvidersResponse, SocialAuthProviderPublic, SocialAuthRegion } from "../types";

export interface SocialLoginButtonsProps {
    variant?: "dark-card" | "light-card";
    next?: string;
    acceptedTerms?: boolean;
    onRequireAcceptTerms?: () => boolean;
}

export function SocialLoginButtons({
    variant = "light-card",
    next = "/",
    acceptedTerms = true,
    onRequireAcceptTerms,
}: SocialLoginButtonsProps) {
    const { t } = useI18n();
    const { message } = App.useApp();
    const [loading, setLoading] = useState(true);
    const [data, setData] = useState<PublicProvidersResponse | null>(null);
    const [activeRegion, setActiveRegion] = useState<SocialAuthRegion>("cn");

    useEffect(() => {
        let mounted = true;
        const controller = new AbortController();

        getPublicSocialAuthProviders(undefined, controller.signal)
            .then((res) => {
                if (!mounted) return;
                setData(res);
                setActiveRegion(res.detectedRegion || res.region || "cn");
            })
            .catch((err) => {
                if (mounted && err?.name !== "AbortError") {
                    console.warn("加载社交登录配置失败:", err);
                }
            })
            .finally(() => {
                if (mounted) setLoading(false);
            });

        return () => {
            mounted = false;
            controller.abort();
        };
    }, []);

    const handleProviderClick = (provider: SocialAuthProviderPublic) => {
        if (onRequireAcceptTerms && !onRequireAcceptTerms()) {
            message.warning(t("auth.accept_terms_required", undefined, "请先勾选并同意服务协议与隐私政策"));
            return;
        }

        const url = buildSocialAuthStartUrl(provider.id, {
            next,
            acceptedTerms,
            mock: provider.sandboxEnabled,
            simulateRegion: activeRegion,
        });
        window.location.href = url;
    };

    if (loading) {
        return (
            <div data-plugin-scope="social-auth" className="flex items-center justify-center py-2.5" role="status" aria-label="正在加载第三方登录渠道">
                <span className="inline-block size-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary" />
            </div>
        );
    }

    if (!data) {
        return null;
    }

    const detectedRegion = data.detectedRegion || data.region || "cn";
    const cnList = data.cn || data.allRegions?.cn || (detectedRegion === "cn" ? data.providers : []);
    const intlList = data.intl || data.allRegions?.intl || (detectedRegion === "intl" ? data.providers : []);
    const currentProviders = (activeRegion === "cn" ? cnList : intlList) || [];
    const isDark = variant === "dark-card";

    if (currentProviders.length === 0) {
        return (
            <div data-plugin-scope="social-auth" className="w-full text-center py-2">
                <p className={`text-xs ${isDark ? "text-slate-400" : "text-muted-foreground"}`}>
                    {t("auth.no_social_providers", undefined, "当前分区暂无开放的第三方登录")}
                </p>
                <button
                    type="button"
                    onClick={() => setActiveRegion((prev) => (prev === "cn" ? "intl" : "cn"))}
                    className={`mt-1.5 inline-flex min-h-[36px] items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isDark ? "text-slate-300 hover:text-white" : "text-muted-foreground hover:text-foreground"
                    }`}
                >
                    <Globe className="size-3.5 opacity-70" aria-hidden="true" />
                    <span>
                        {activeRegion === "cn"
                            ? t("auth.switch_to_intl", undefined, "切换至海外国际渠道")
                            : t("auth.switch_to_cn", undefined, "切换至中国大陆渠道")}
                    </span>
                </button>
            </div>
        );
    }

    return (
        <div data-plugin-scope="social-auth" className="w-full">
            {/* Branded Social Login Buttons */}
            <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-3.5" role="group" aria-label={t("auth.social_login_group", undefined, "快捷社交登录方式")}>
                {currentProviders.map((provider) => {
                    const isMock = Boolean(provider.sandboxEnabled);
                    const tooltipText = isMock
                        ? `${provider.name} (${t("auth.sandbox_mock_mode", undefined, "沙盒联调模式")})`
                        : `${provider.name} ${t("auth.social_login_action", undefined, "登录")}`;

                    return (
                        <Tooltip
                            key={provider.id}
                            title={tooltipText}
                            placement="top"
                        >
                            <button
                                type="button"
                                aria-label={tooltipText}
                                onClick={() => handleProviderClick(provider)}
                                className={`group relative flex size-11 items-center justify-center rounded-xl transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:scale-95 ${
                                    isDark
                                        ? "border border-white/10 bg-white/[0.04] text-white hover:border-white/25 hover:bg-white/[0.08] hover:shadow-sm"
                                        : "border border-border/70 bg-card text-foreground hover:border-primary/50 hover:bg-accent hover:shadow-sm"
                                }`}
                            >
                                <SocialProviderIcon
                                    provider={provider.id}
                                    className="size-5 transition-transform duration-150 group-hover:scale-110"
                                />
                                {isMock && (
                                    <span
                                        className={`absolute -top-1 -right-1 size-2 rounded-full ${
                                            isDark ? "bg-amber-400 ring-2 ring-slate-900" : "bg-amber-500 ring-2 ring-background"
                                        }`}
                                        title={t("auth.sandbox_mock_mode", undefined, "沙盒联调模式")}
                                        aria-hidden="true"
                                    />
                                )}
                            </button>
                        </Tooltip>
                    );
                })}
            </div>

            {/* Subtle Region Switcher Link */}
            <div className="mt-2.5 flex items-center justify-center">
                <button
                    type="button"
                    onClick={() => setActiveRegion((prev) => (prev === "cn" ? "intl" : "cn"))}
                    className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        isDark ? "text-slate-400 hover:text-white" : "text-muted-foreground/80 hover:text-foreground"
                    }`}
                >
                    <Globe className="size-3.5 opacity-70" aria-hidden="true" />
                    <span>
                        {activeRegion === "cn"
                            ? t("auth.showing_cn_switch_intl", undefined, "当前显示国内渠道 · 切换至国际登录")
                            : t("auth.showing_intl_switch_cn", undefined, "当前显示国际渠道 · 切换至国内登录")}
                    </span>
                </button>
            </div>
        </div>
    );
}
