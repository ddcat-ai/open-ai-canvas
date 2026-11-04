import { type FormEvent, useId, useState } from "react";
import { App, Button, Divider, Input } from "antd";
import { useTranslation } from "react-i18next";

import { VerificationFields } from "@/components/auth/verification-fields";
import type { AuthView } from "@/lib/auth-entry";
import { getAuthSession, linuxDOLoginURL, login, type AuthSettings } from "@/services/api/auth";
import { emptyVerification, loginVerification, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { AuthAgreementDialog, AuthSwitchPrompt, AuthTabs, LinuxDOIcon, authTabId, authTabPanelId, useAuthAgreement } from "./auth-form-parts";

type LoginMethod = "password" | VerificationMethod;

export type AuthFormProps = {
    settings: AuthSettings | null;
    /** 登录成功后的站内地址，Linux.do 跳转回站时同样使用。 */
    next: string;
    onAuthenticated: () => void;
    onViewChange: (view: AuthView) => void;
};

export function AuthLoginForm({ settings, next, onAuthenticated, onViewChange }: AuthFormProps) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const tabsId = useId();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [chosenMethod, setChosenMethod] = useState<LoginMethod | null>(null);
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [agreementOpen, setAgreementOpen] = useState(false);
    const agreement = useAuthAgreement(settings);
    // 验证码登录排在密码登录之前；配置读取失败时只保留密码登录。
    const methods: LoginMethod[] = [...(settings ? verificationMethods(settings, "login") : []), "password"];
    const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0];
    const canRegister = !settings || settings.firstUser || settings.registrationEnabled;
    const methodLabel = (value: LoginMethod) => (value === "password" ? t("auth.login.password") : value === "sms" ? t("auth.login.smsTab") : t("auth.login.emailTab"));

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            if (method === "password") await login({ username, password });
            else {
                if (!verification.ticket) throw new Error(t("auth.login.needCode"));
                await loginVerification(verification);
            }
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success(t("auth.login.success"));
            onAuthenticated();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.login.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={submit} className="auth-form">
            <AuthTabs
                id={tabsId}
                label={t("auth.login.method")}
                items={methods.map((value) => ({ value, label: methodLabel(value) }))}
                value={method}
                disabled={submitting}
                onChange={(value) => {
                    setChosenMethod(value);
                    setVerification({ ...emptyVerification });
                }}
            />
            <div role="tabpanel" id={authTabPanelId(tabsId)} aria-labelledby={authTabId(tabsId, method)} className="auth-form-fields">
                {method === "password" ? (
                    <>
                        <Input size="large" value={username} onChange={(event) => setUsername(event.target.value)} aria-label={t("auth.login.account")} placeholder={t("auth.login.accountPlaceholder")} autoComplete="username" required />
                        <Input.Password
                            size="large"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            aria-label={t("auth.login.passwordLabel")}
                            placeholder={t("auth.login.passwordPlaceholder")}
                            autoComplete="current-password"
                            required
                        />
                        <div className="auth-form-aside">
                            <button type="button" className="auth-form-link" onClick={() => onViewChange("recovery")}>
                                {t("auth.login.forgot")}
                            </button>
                        </div>
                    </>
                ) : (
                    <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} />
                )}
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                {t("auth.login.submit")}
            </Button>
            {settings?.linuxdoEnabled ? (
                <>
                    <Divider plain className="auth-scene-divider auth-form-divider">
                        {t("common.or")}
                    </Divider>
                    {/* 登录入口不携带协议同意标志：新 Linux.do 账号必须从注册页勾选协议后创建。 */}
                    <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>
                        {t("auth.login.linuxdo")}
                    </Button>
                </>
            ) : null}
            {canRegister ? <AuthSwitchPrompt prompt={t("auth.login.noAccount")} action={t("auth.login.toRegister")} onClick={() => onViewChange("register")} /> : null}
            {settings ? (
                <p className="auth-form-legal">
                    {t("auth.login.agreementPrefix")}
                    <button type="button" className="auth-form-link is-strong" onClick={() => setAgreementOpen(true)}>
                        《{agreement.title}》
                    </button>
                </p>
            ) : null}
            <AuthAgreementDialog open={agreementOpen} title={agreement.title} paragraphs={agreement.paragraphs} onClose={() => setAgreementOpen(false)} />
        </form>
    );
}
