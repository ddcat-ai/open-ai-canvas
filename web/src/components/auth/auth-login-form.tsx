import { type FormEvent, useEffect, useId, useState } from "react";
import { App, Button, Checkbox, Divider, Input } from "antd";
import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import { VerificationFields } from "@/components/auth/verification-fields";
import { clearReferralCode, readReferralCode, type AuthView } from "@/lib/auth-entry";
import { getAuthSession, linuxDOLoginURL, login, oidcLoginURL, register, type AuthSettings } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";
import { emptyVerification, loginVerification, registrationVerificationRequired, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { AuthAgreementDialog, AuthNotice, AuthTabs, LinuxDOIcon, authTabId, authTabPanelId, useAuthAgreement } from "./auth-form-parts";

type LoginMethod = "password" | VerificationMethod;

export type AuthFormProps = {
    settings: AuthSettings | null;
    /** 登录成功后的站内地址，第三方登录跳转回站时同样使用。 */
    next: string;
    onAuthenticated: () => void;
    onViewChange: (view: AuthView) => void;
};

/** 服务端确认账号不存在后进入的补充注册步骤；accountKind 决定账号按用户名还是邮箱创建。 */
type PendingRegistration = { accountKind: "username" | "email" };

/**
 * 登录注册一体表单：密码登录时账号不存在且允许注册，服务端返回 account_not_registered，
 * 表单原地补齐注册所需信息（确认密码、邮箱或验证码、服务协议）后创建账号并登录。
 */
export function AuthLoginForm({ settings, settingsFailed, onReloadSettings, next, onAuthenticated, onViewChange }: AuthFormProps & { settingsFailed: boolean; onReloadSettings: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const tabsId = useId();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [email, setEmail] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [chosenMethod, setChosenMethod] = useState<LoginMethod | null>(null);
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [registerVerification, setRegisterVerification] = useState({ ...emptyVerification });
    const [chosenRegisterMethod, setChosenRegisterMethod] = useState<VerificationMethod | null>(null);
    const [pending, setPending] = useState<PendingRegistration | null>(null);
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [retryCountdown, setRetryCountdown] = useState(0);
    // 推广码由登录路由从 ?ref= 写入会话缓存；弹窗与独立页面都从这里读取。
    const [referralCode] = useState(readReferralCode);
    const agreement = useAuthAgreement(settings);

    // 验证码登录排在密码登录之前；配置读取失败时只保留密码登录。
    const methods: LoginMethod[] = [...(settings ? verificationMethods(settings, "login") : []), "password"];
    const method = pending ? "password" : chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0];
    const canRegister = Boolean(settings && (settings.firstUser || settings.registrationEnabled));
    const showLinuxDO = Boolean(settings?.linuxdoEnabled && !settings.smsAndEmailRegistration && !pending);
    const showOIDC = Boolean(settings?.oidcEnabled && !pending);
    const showAgreement = Boolean(settings && (pending || canRegister || showOIDC));
    const verificationRequired = Boolean(settings && registrationVerificationRequired(settings));
    const registerMethods = settings && verificationRequired ? verificationMethods(settings, "register") : [];
    const registerMethod = chosenRegisterMethod && registerMethods.includes(chosenRegisterMethod) ? chosenRegisterMethod : registerMethods[0];
    const verificationUnavailable = Boolean(pending && verificationRequired && !registerMethod);
    // 验证方式自带邮箱输入时不再重复显示；短信验证时邮箱作为可选或必填的附加信息。
    const showEmailField = Boolean(pending && pending.accountKind === "username" && registerMethod !== "email" && registerMethod !== "sms_email" && !settings?.firstUser);
    const emailRequired = Boolean(settings?.emailRequired);
    const methodLabel = (value: LoginMethod) => (value === "password" ? t("auth.login.password") : value === "sms" ? t("auth.login.smsTab") : t("auth.login.emailTab"));

    useEffect(() => {
        if (retryCountdown <= 0) return;
        const timer = window.setInterval(() => setRetryCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [retryCountdown]);

    const finish = async (successText: string) => {
        const { applyUserSession } = await import("@/lib/user-session");
        await applyUserSession(await getAuthSession());
        message.success(successText);
        onAuthenticated();
    };

    const startRegistration = (accountKind: PendingRegistration["accountKind"]) => {
        const account = username.trim();
        setPending({ accountKind });
        setConfirmPassword("");
        setEmail(accountKind === "email" ? account : "");
        // 邮箱账号直接带入验证码表单，用户只需获取验证码。
        setRegisterVerification({ ...emptyVerification, email: accountKind === "email" ? account : "" });
    };

    const cancelRegistration = () => {
        setPending(null);
        setConfirmPassword("");
        setRegisterVerification({ ...emptyVerification });
    };

    const submitLogin = async () => {
        try {
            if (method === "password") await login({ username: username.trim(), password, autoRegister: canRegister });
            else {
                if (!verification.ticket) throw new Error(t("auth.login.needCode"));
                await loginVerification(verification);
            }
            await finish(t("auth.login.success"));
        } catch (error) {
            if (error instanceof ApiError && error.reason === "account_not_registered") {
                startRegistration(error.details?.accountKind === "email" ? "email" : "username");
                return;
            }
            throw error;
        }
    };

    const submitRegistration = async (current: PendingRegistration) => {
        if (!agreementAccepted) {
            message.warning(t("auth.register.agreeFirst", { title: agreement.title }));
            return;
        }
        if (password !== confirmPassword) throw new Error(t("auth.register.mismatch"));
        if (verificationRequired && !registerVerification.ticket) throw new Error(t("auth.register.needCode"));
        const account = username.trim();
        const contactEmail = current.accountKind === "email" ? account : email.trim();
        if (emailRequired && !settings?.firstUser && !contactEmail && !registerVerification.email) throw new Error(t("auth.login.emailRequired"));
        const contact = verificationRequired ? { ...registerVerification, email: registerVerification.email || contactEmail } : { email: contactEmail };
        try {
            await register({
                username: current.accountKind === "username" ? account : "",
                ...contact,
                password,
                acceptedTerms: agreementAccepted,
                ...(referralCode ? { referralCode } : {}),
            });
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRetryCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            throw error;
        }
        clearReferralCode();
        if (!settings?.firstUser) window.sessionStorage.setItem("yingce:model-setup-guide", "1");
        await finish(settings?.firstUser ? t("auth.register.adminCreated") : t("auth.register.success"));
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting || retryCountdown > 0) return;
        setSubmitting(true);
        try {
            if (pending) await submitRegistration(pending);
            else await submitLogin();
        } catch (error) {
            message.error(error instanceof Error ? error.message : pending ? t("auth.register.failed") : t("auth.login.failed"));
        } finally {
            setSubmitting(false);
        }
    };

    const registrationBlocked = verificationUnavailable;

    return (
        <form onSubmit={submit} className="auth-form">
            {settings?.firstUser ? (
                <AuthNotice icon={<Info className="size-3.5" />} tone="blue">
                    {t("auth.register.firstUser")}
                </AuthNotice>
            ) : null}
            {pending ? (
                <AuthNotice icon={<Info className="size-3.5" />} tone="blue">
                    <span>
                        {t("auth.login.newAccount")}{" "}
                        <button type="button" className="auth-form-link is-strong" onClick={cancelRegistration} disabled={submitting}>
                            {t("auth.login.changeAccount")}
                        </button>
                    </span>
                </AuthNotice>
            ) : null}
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
            {verificationUnavailable ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.register.noMethod")}</AuthNotice> : null}
            {!pending && methods.length > 1 ? (
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
            ) : null}
            <div {...(!pending && methods.length > 1 ? { role: "tabpanel", id: authTabPanelId(tabsId), "aria-labelledby": authTabId(tabsId, method) } : {})} className="auth-form-fields">
                {method === "password" ? (
                    <>
                        <Input
                            size="large"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            aria-label={t("auth.login.account")}
                            placeholder={t("auth.login.accountPlaceholder")}
                            autoComplete="username"
                            required
                            // 进入补充注册后账号锁定，改账号需要点「修改账号」回到登录。
                            readOnly={Boolean(pending)}
                        />
                        <Input.Password
                            size="large"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            aria-label={t("auth.login.passwordLabel")}
                            placeholder={pending ? t("auth.register.passwordPlaceholder") : t("auth.login.passwordPlaceholder")}
                            autoComplete={pending ? "new-password" : "current-password"}
                            required
                        />
                        {pending ? (
                            <>
                                <Input.Password
                                    size="large"
                                    value={confirmPassword}
                                    onChange={(event) => setConfirmPassword(event.target.value)}
                                    aria-label={t("auth.register.confirmPassword")}
                                    placeholder={t("auth.register.confirmPlaceholder")}
                                    autoComplete="new-password"
                                    required
                                    autoFocus
                                />
                                {showEmailField ? (
                                    <Input
                                        size="large"
                                        type="email"
                                        value={email}
                                        onChange={(event) => setEmail(event.target.value)}
                                        aria-label={emailRequired ? t("auth.verification.email") : t("auth.register.emailOptional")}
                                        placeholder={emailRequired ? t("auth.login.emailRequiredPlaceholder") : t("auth.register.emailPlaceholder")}
                                        autoComplete="email"
                                        required={emailRequired}
                                    />
                                ) : null}
                                {registerMethods.length > 1 ? (
                                    <AuthTabs
                                        id={`${tabsId}-register`}
                                        label={t("auth.register.method")}
                                        items={registerMethods.map((value) => ({ value, label: value === "sms" ? t("auth.register.smsTab") : t("auth.register.emailTab") }))}
                                        value={registerMethod}
                                        disabled={submitting}
                                        onChange={(value) => {
                                            setChosenRegisterMethod(value);
                                            setRegisterVerification({ ...emptyVerification, email: pending.accountKind === "email" ? username.trim() : "" });
                                        }}
                                    />
                                ) : null}
                                {registerMethod ? <VerificationFields key={registerMethod} purpose="register" method={registerMethod} value={registerVerification} onChange={setRegisterVerification} disabled={submitting} /> : null}
                            </>
                        ) : (
                            <div className="auth-form-aside">
                                <button type="button" className="auth-form-link" onClick={() => onViewChange("recovery")}>
                                    {t("auth.login.forgot")}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} />
                )}
            </div>
            {showAgreement ? (
                <div className="auth-agreement-row" data-accepted={agreementAccepted ? "true" : "false"}>
                    <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                        <span className="auth-agreement-label">{pending ? t("auth.register.agree") : t("auth.login.agreeForSignup")}</span>
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreement.title}》
                    </button>
                </div>
            ) : null}
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={registrationBlocked || retryCountdown > 0 || (Boolean(pending) && !agreementAccepted)}>
                {retryCountdown > 0 ? t("auth.register.retryIn", { seconds: retryCountdown }) : pending ? t("auth.login.createAndLogin") : canRegister && method === "password" ? t("auth.login.submitOrRegister") : t("auth.login.submit")}
            </Button>
            {!pending && canRegister && method === "password" ? <p className="auth-form-switch">{t("auth.login.autoRegisterHint")}</p> : null}
            {showLinuxDO || showOIDC ? (
                <>
                    <Divider plain className="auth-scene-divider auth-form-divider">
                        {t("common.or")}
                    </Divider>
                    {/* 新 Linux.do 账号同样需要同意协议：勾选后才携带同意标志，否则只能登录已绑定账号。 */}
                    {showLinuxDO ? (
                        <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next, agreementAccepted || undefined)}>
                            {t("auth.login.linuxdo")}
                        </Button>
                    ) : null}
                    {showOIDC ? (
                        <Button size="large" block href={oidcLoginURL(next, agreementAccepted)}>
                            {t("auth.login.oidc")}
                        </Button>
                    ) : null}
                </>
            ) : null}
            {settings && !showAgreement ? (
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
