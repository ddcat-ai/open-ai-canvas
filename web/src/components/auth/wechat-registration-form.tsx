import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Checkbox, Input, Skeleton } from "antd";
import { Info, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { authPageURL, clearReferralCode, readReferralCode, safeAuthNext } from "@/lib/auth-entry";
import { applyUserSession } from "@/lib/user-session";
import { getAuthSession, type AuthSettings } from "@/services/api/auth";
import { cancelWechatRegistration, completeWechatRegistration, getWechatRegistration, type WechatRegistrationInfo } from "@/services/api/wechat";
import { emptyVerification, registrationVerificationRequired, verificationMethods, type VerificationMethod } from "@/services/api/verification";
import { VerificationFields } from "./verification-fields";
import { TurnstileWidget } from "./turnstile-widget";
import { AuthAgreementDialog, AuthNotice, AuthTabs, useAuthAgreement } from "./auth-form-parts";

export function WechatRegistrationForm({ settings, settingsFailed, onReloadSettings, next }: { settings: AuthSettings | null; settingsFailed: boolean; onReloadSettings: () => void; next: string }) {
    const { t } = useTranslation();
    const navigate = useNavigate();
    const agreement = useAuthAgreement(settings);
    const [info, setInfo] = useState<WechatRegistrationInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const submittingRef = useRef(false);
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [chosenMethod, setChosenMethod] = useState<VerificationMethod | null>(null);
    const [email, setEmail] = useState("");
    const [accepted, setAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [turnstileToken, setTurnstileToken] = useState("");
    const [turnstileResetKey, setTurnstileResetKey] = useState(0);
    const required = settings ? registrationVerificationRequired(settings) : true;
    const methods = settings && required ? verificationMethods(settings, "register") : [];
    const turnstileRequired = Boolean(settings?.turnstileEnabled && settings.turnstileSiteKey);
    const method = chosenMethod && methods.includes(chosenMethod) ? chosenMethod : methods[0];
    const blocked = !settings || settingsFailed || !settings.registrationEnabled || (required && !method);
    useEffect(() => {
        const controller = new AbortController();
        getWechatRegistration(controller.signal)
            .then((value) => {
                if (!controller.signal.aborted) {
                    setInfo(value);
                    setAccepted(value.acceptedTerms);
                }
            })
            .catch((cause) => {
                if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "读取微信注册信息失败");
            })
            .finally(() => {
                if (!controller.signal.aborted) setLoading(false);
            });
        return () => controller.abort();
    }, []);
    const cancel = async () => {
        if (submittingRef.current) return;
        submittingRef.current = true;
        setSubmitting(true);
        try {
            await cancelWechatRegistration();
            navigate(authPageURL("login", next), { replace: true });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "退出微信注册失败");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submittingRef.current || blocked || !info || !accepted || (turnstileRequired && !turnstileToken)) return;
        submittingRef.current = true;
        setSubmitting(true);
        setError("");
        try {
            const contactEmail = method === "email" || method === "sms_email" ? verification.email : email.trim();
            const result = await completeWechatRegistration({ ...(required ? verification : {}), email: contactEmail, acceptedTerms: accepted, referralCode: readReferralCode() || undefined, turnstileToken: turnstileToken || undefined });
            await applyUserSession(await getAuthSession());
            clearReferralCode();
            navigate(safeAuthNext(result.next), { replace: true });
        } catch (cause) {
            if (turnstileRequired) {
                setTurnstileToken("");
                setTurnstileResetKey((value) => value + 1);
            }
            setError(cause instanceof Error ? cause.message : "微信注册失败");
        } finally {
            submittingRef.current = false;
            setSubmitting(false);
        }
    };
    if (loading) return <Skeleton active paragraph={{ rows: 3 }} />;
    return (
        <form className="auth-form" onSubmit={submit}>
            <AuthNotice icon={<Info className="size-3.5" />} tone="blue">
                {t("auth.wechat.newAccount", { defaultValue: "首次使用微信登录，请完成本站注册。已有账号请先登录，再在个人设置中绑定微信。" })}
            </AuthNotice>
            {info ? <p className="auth-form-switch">{info.displayName}</p> : null}
            {error ? (
                <AuthNotice icon={<TriangleAlert className="size-3.5" />}>
                    <span role="alert">{error}</span>
                </AuthNotice>
            ) : null}
            {settingsFailed ? <Button onClick={onReloadSettings}>{t("auth.register.reload")}</Button> : null}
            {settings && !settings.registrationEnabled ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.wechat.registrationClosed", { defaultValue: "管理员已关闭新用户注册，请使用已有账号登录后绑定微信。" })}</AuthNotice> : null}
            {settings && required && !method ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.register.noMethod")}</AuthNotice> : null}
            {required && methods.length > 1 ? (
                <AuthTabs
                    id="wechat-registration-method"
                    label={t("auth.login.method")}
                    items={methods.map((value) => ({ value, label: value === "sms" ? t("auth.login.smsTab") : t("auth.login.emailTab") }))}
                    value={method}
                    disabled={submitting}
                    onChange={(value) => {
                        setChosenMethod(value);
                        setVerification({ ...emptyVerification });
                    }}
                />
            ) : null}
            {required && method ? <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={submitting} /> : null}
            {method !== "email" && method !== "sms_email" ? (
                <Input
                    size="large"
                    type="email"
                    aria-label={t("auth.verification.email")}
                    placeholder={settings?.emailRequired ? t("auth.login.emailRequired") : t("auth.verification.emailPlaceholder")}
                    required={Boolean(settings?.emailRequired)}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    disabled={submitting}
                />
            ) : null}
            {turnstileRequired ? <TurnstileWidget siteKey={settings?.turnstileSiteKey ?? ""} resetKey={turnstileResetKey} onToken={setTurnstileToken} /> : null}
            {settings && !settingsFailed ? (
                <div className="auth-agreement-row" data-accepted={accepted ? "true" : "false"}>
                    <Checkbox checked={accepted} onChange={(event) => setAccepted(event.target.checked)}>
                        {t("auth.register.agree")}
                    </Checkbox>
                    <button type="button" className="auth-agreement-link" onClick={() => setAgreementOpen(true)}>
                        《{agreement.title}》
                    </button>
                </div>
            ) : null}
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={blocked || !info || !accepted || (required && !verification.ticket) || (turnstileRequired && !turnstileToken)}>
                {t("auth.wechat.submit", { defaultValue: "完成注册并登录" })}
            </Button>
            <Button size="large" block disabled={submitting} onClick={() => void cancel()}>
                {t("auth.wechat.existingAccount", { defaultValue: "使用已有账号登录" })}
            </Button>
            <AuthAgreementDialog open={agreementOpen} title={agreement.title} paragraphs={agreement.paragraphs} onClose={() => setAgreementOpen(false)} />
        </form>
    );
}
