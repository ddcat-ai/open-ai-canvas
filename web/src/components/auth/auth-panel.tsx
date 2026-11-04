import { useId } from "react";
import { useTranslation } from "react-i18next";

import { useAuthSettings } from "@/hooks/use-auth-entry";
import type { AuthView } from "@/lib/auth-entry";
import { cn } from "@/lib/utils";
import { useAppearanceStore } from "@/stores/use-appearance-store";
import { AuthLoginForm } from "./auth-login-form";
import { AuthRecoveryForm } from "./auth-recovery-form";
import { AuthRegisterForm } from "./auth-register-form";
import "./auth-panel.css";

export type AuthPanelProps = {
    view: AuthView;
    onViewChange: (view: AuthView) => void;
    next: string;
    onAuthenticated: () => void;
    /** page：独立登录页里的卡片；dialog：登录弹窗右侧，由弹窗提供外壳。 */
    variant: "page" | "dialog";
};

/** 登录、注册、找回密码的共用面板。导航方式由外层决定：独立页面改路由，弹窗只切换视图。 */
export function AuthPanel({ view, onViewChange, next, onAuthenticated, variant }: AuthPanelProps) {
    const { t } = useTranslation();
    const titleId = useId();
    const brand = useAppearanceStore((state) => state.appearance.brandName) || t("auth.register.platform");
    const { settings, failed, reload } = useAuthSettings();
    const title = view === "login" ? t("auth.panel.loginTitle", { brand }) : view === "register" ? t("auth.panel.registerTitle", { brand }) : t("auth.panel.recoveryTitle");
    const formProps = { settings, next, onAuthenticated, onViewChange };

    return (
        <section className={cn("auth-panel", variant === "page" ? "is-page" : "is-dialog")} aria-labelledby={titleId}>
            <header className="auth-panel-header">
                <h2 id={titleId} className="auth-panel-title">
                    {title}
                </h2>
                {view === "recovery" ? <p className="auth-panel-description">{t("auth.panel.recoveryDescription")}</p> : null}
            </header>
            <div key={view} className="auth-panel-body">
                {view === "login" ? (
                    <AuthLoginForm {...formProps} />
                ) : view === "register" ? (
                    <AuthRegisterForm {...formProps} settingsFailed={failed} onReloadSettings={() => void reload()} />
                ) : (
                    <AuthRecoveryForm settings={settings} onViewChange={onViewChange} />
                )}
            </div>
        </section>
    );
}
