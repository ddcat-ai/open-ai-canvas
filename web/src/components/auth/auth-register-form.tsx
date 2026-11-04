import { type FormEvent, useEffect, useId, useRef, useState } from "react";
import { App, Button, Checkbox, Divider, Input } from "antd";
import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { VerificationFields } from "@/components/auth/verification-fields";
import { clearReferralCode, readReferralCode } from "@/lib/auth-entry";
import { getAuthSession, linuxDOLoginURL, register } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";
import { emptyVerification, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { AuthAgreementDialog, AuthNotice, AuthSwitchPrompt, AuthTabs, LinuxDOIcon, authTabId, authTabPanelId, useAuthAgreement } from "./auth-form-parts";
import type { AuthFormProps } from "./auth-login-form";

export function AuthRegisterForm({ settings, settingsFailed, onReloadSettings, next, onAuthenticated, onViewChange }: AuthFormProps & { settingsFailed: boolean; onReloadSettings: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const tabsId = useId();
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [chosenMethod, setChosenMethod] = useState<VerificationMethod | null>(null);
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [registerCountdown, setRegisterCountdown] = useState(0);
    const registering = useRef(false);
    // 推广码由登录路由从 ?ref= 写入会话缓存；弹窗与独立页面都从这里读取。
    const [referralCode] = useState(readReferralCode);
    const agreement = useAuthAgreement(settings);
    const agreementTitle = agreement.title;

    const registrationClosed = settings?.registrationEnabled === false;
    const methods = settings ? verificationMethods(settings, "register") : [];
    const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : (methods[0] ?? "email");
    const verificationUnavailable = Boolean(settings && !settings.firstUser && methods.length === 0);
    const disabled = !settings || registrationClosed || verificationUnavailable;

    useEffect(() => {
        if (registerCountdown <= 0) return;
        const timer = window.setInterval(() => setRegisterCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [registerCountdown]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || registerCountdown > 0) return;
        if (!agreementAccepted) {
            message.warning(t("auth.register.agreeFirst", { title: agreementTitle }));
            return;
        }
        if (password !== confirmPassword) {
            message.error(t("auth.register.mismatch"));
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            if (!settings?.firstUser && !verification.ticket) throw new Error(t("auth.register.needCode"));
            await register({ username, ...(settings?.firstUser ? { email } : verification), displayName, password, acceptedTerms: agreementAccepted, ...(referralCode ? { referralCode } : {}) });
            clearReferralCode();
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            if (!settings?.firstUser) window.sessionStorage.setItem("yingce:model-setup-guide", "1");
            message.success(settings?.firstUser ? t("auth.register.adminCreated") : t("auth.register.success"));
            onAuthenticated();
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRegisterCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : t("auth.register.failed"));
        } finally {
            registering.current = false;
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={submit} className="auth-form">
            {settings?.firstUser ? (
                <AuthNotice icon={<Info className="size-3.5" />} tone="blue">
                    {t("auth.register.firstUser")}
                </AuthNotice>
            ) : null}
            {registrationClosed ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.register.closed")}</AuthNotice> : null}
            {verificationUnavailable ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.register.noMethod")}</AuthNotice> : null}
            {/* 协议标题只能来自后台配置：读取失败时留下失败态并允许重新读取，不用品牌名顶替。 */}
            {settingsFailed ? (
                <AuthNotice icon={<TriangleAlert className="size-3.5" />}>
                    <span>
                        {t("auth.register.settingsFailed")}{" "}
                        <button type="button" className="auth-form-link is-strong" onClick={onReloadSettings}>
                            {t("auth.register.reload")}
                        </button>
                    </span>
                </AuthNotice>
            ) : null}

            {!settings?.firstUser && methods.length > 1 ? (
                <AuthTabs
                    id={tabsId}
                    label={t("auth.register.method")}
                    items={methods.map((value) => ({ value, label: value === "sms" ? t("auth.register.smsTab") : t("auth.register.emailTab") }))}
                    value={method}
                    disabled={submitting}
                    onChange={(value) => {
                        setChosenMethod(value);
                        setVerification({ ...emptyVerification });
                    }}
                />
            ) : null}

            <div {...(!settings?.firstUser && methods.length > 1 ? { role: "tabpanel", id: authTabPanelId(tabsId), "aria-labelledby": authTabId(tabsId, method) } : {})} className="auth-form-fields">
                <div className="auth-form-pair">
                    <Input
                        size="large"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        aria-label={t("auth.register.username")}
                        placeholder={t("auth.register.usernamePlaceholder")}
                        autoComplete="username"
                        required
                        disabled={disabled}
                    />
                    <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} aria-label={t("auth.register.displayName")} placeholder={t("auth.register.displayNamePlaceholder")} disabled={disabled} />
                </div>
                {settings?.firstUser ? (
                    <Input
                        size="large"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        aria-label={t("auth.register.emailOptional")}
                        placeholder={t("auth.register.emailPlaceholder")}
                        autoComplete="email"
                        disabled={disabled}
                    />
                ) : methods.length > 0 ? (
                    <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={disabled || submitting} />
                ) : null}
                <div className="auth-form-pair">
                    <Input.Password
                        size="large"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-label={t("auth.register.password")}
                        placeholder={t("auth.register.passwordPlaceholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                    <Input.Password
                        size="large"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        aria-label={t("auth.register.confirmPassword")}
                        placeholder={t("auth.register.confirmPlaceholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </div>
            </div>

            {/* 协议入口只在拿到设置后渲染，读不到配置就不展示协议名。 */}
            {settings ? (
                <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                    <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                        <span className="auth-agreement-label">{t("auth.register.agree")}</span>
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreementTitle}》
                    </button>
                </div>
            ) : null}

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || registerCountdown > 0 || !agreementAccepted}>
                {registerCountdown > 0 ? t("auth.register.retryIn", { seconds: registerCountdown }) : t("auth.register.submit")}
            </Button>
            {settings?.linuxdoEnabled && !settings.smsAndEmailRegistration ? (
                <>
                    <Divider plain className="auth-scene-divider auth-form-divider">
                        {t("common.or")}
                    </Divider>
                    <Button size="large" block disabled={!agreementAccepted} icon={<LinuxDOIcon />} href={agreementAccepted ? linuxDOLoginURL(next, true) : undefined}>
                        {t("auth.register.linuxdo")}
                    </Button>
                </>
            ) : null}
            <AuthSwitchPrompt prompt={t("auth.register.hasAccount")} action={t("auth.register.toLogin")} onClick={() => onViewChange("login")} />
            <AuthAgreementDialog open={agreementOpen} title={agreementTitle} paragraphs={agreement.paragraphs} onClose={() => setAgreementOpen(false)} />
        </form>
    );
}
