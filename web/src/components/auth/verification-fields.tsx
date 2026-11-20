import { useEffect, useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { useTranslation } from "react-i18next";
import { startVerification, type VerificationDraft, type VerificationMethod, type VerificationPurpose } from "@/services/api/verification";

// 字段不显示可见标签：占位文案说明填写内容，aria-label 提供无障碍名称。
// 「获取验证码」按钮固定最小宽度并使用等宽数字，倒计时文案变化时输入框不跳动。
export function VerificationFields({
    purpose,
    method,
    value,
    onChange,
    disabled = false,
    password,
}: {
    purpose: VerificationPurpose;
    method: VerificationMethod;
    value: VerificationDraft;
    onChange: (value: VerificationDraft) => void;
    disabled?: boolean;
    password?: string;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [sending, setSending] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const inFlight = useRef(false);
    const sms = method !== "email",
        email = method !== "sms";
    useEffect(() => {
        if (!remaining) return;
        const timer = window.setTimeout(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [remaining]);
    const changeTarget = (key: "email" | "phone", target: string) => onChange({ ...value, [key]: target, ticket: "", emailCode: "", smsCode: "" });
    const send = async () => {
        if (inFlight.current || remaining > 0) return;
        if ((sms && !value.phone.trim()) || (email && !value.email.trim()) || (purpose === "bind" && !password)) {
            message.warning(t("auth.verification.needTarget"));
            return;
        }
        inFlight.current = true;
        setSending(true);
        // Start cooldown even on ambiguous failures; never encourage instant resends.
        setRemaining(60);
        onChange({ ...value, ticket: "", emailCode: "", smsCode: "" });
        try {
            const result = await startVerification({ purpose, method, email: email ? value.email.trim() : undefined, phone: sms ? value.phone.trim() : undefined, password });
            onChange({ ...value, email: email ? value.email.trim().toLowerCase() : "", phone: sms ? value.phone.trim() : "", emailCode: "", smsCode: "", ticket: result.ticket });
            setRemaining(result.retryAfter);
            message.success(purpose === "login" ? t("auth.verification.sentLogin") : t("auth.verification.sent"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.verification.sendFailed"));
        } finally {
            setSending(false);
            inFlight.current = false;
        }
    };
    const counting = remaining > 0;
    // 按钮在联系方式为空时保持禁用，避免用户点了才发现没填邮箱/手机号。
    const targetReady = (sms ? Boolean(value.phone.trim()) : true) && (email ? Boolean(value.email.trim()) : true) && (purpose !== "bind" || Boolean(password));
    const codeLabel = method === "sms_email" ? t("auth.verification.code") : sms ? t("auth.verification.smsCode") : t("auth.verification.emailCode");
    return (
        <div className="auth-form-fields">
            {/* 后端只接受中国大陆手机号，+86 是固定前缀，输入时可省略。 */}
            {sms && (
                <Input
                    size="large"
                    className="auth-phone-input"
                    prefix={
                        <span className="auth-phone-prefix" aria-hidden>
                            +86
                        </span>
                    }
                    value={value.phone}
                    onChange={(e) => changeTarget("phone", e.target.value)}
                    autoComplete="tel"
                    inputMode="tel"
                    aria-label={t("auth.verification.phone")}
                    placeholder={t("auth.verification.phonePlaceholder")}
                    required
                    disabled={disabled || sending}
                />
            )}
            {email && (
                <Input
                    size="large"
                    type="email"
                    value={value.email}
                    onChange={(e) => changeTarget("email", e.target.value)}
                    autoComplete="email"
                    aria-label={t("auth.verification.email")}
                    placeholder={t("auth.verification.emailPlaceholder")}
                    required
                    disabled={disabled || sending}
                />
            )}
            <div className="auth-code-row">
                <Input
                    size="large"
                    // 双通道（sms_email）一次请求同时下发两种验证码，一个输入框同时填入两项。
                    value={method === "email" ? value.emailCode : value.smsCode}
                    onChange={(event) => {
                        const code = event.target.value.replace(/\D/g, "").slice(0, 6);
                        if (method === "email") onChange({ ...value, emailCode: code });
                        else onChange({ ...value, smsCode: code, ...(method === "sms_email" ? { emailCode: code } : {}) });
                    }}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    aria-label={codeLabel}
                    placeholder={t("auth.verification.codePlaceholder")}
                    disabled={disabled || sending}
                />
                <Button className="auth-code-button" size="large" data-counting={counting ? "true" : "false"} loading={sending} disabled={disabled || sending || counting || !targetReady} onClick={() => void send()}>
                    {counting ? t("auth.verification.resendIn", { seconds: remaining }) : t("auth.verification.send")}
                </Button>
            </div>
            {method === "sms_email" && <p className="auth-scene-muted m-0 text-xs leading-5">{t("auth.verification.dualHint")}</p>}
        </div>
    );
}
