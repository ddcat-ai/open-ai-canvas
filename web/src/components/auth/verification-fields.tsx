import { useEffect, useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { useTranslation } from "react-i18next";
import { startVerification, type VerificationDraft, type VerificationMethod, type VerificationPurpose } from "@/services/api/verification";

// 验证码输入框与「获取验证码」按钮同排显示：按钮贴右侧、竖线分隔。
// 倒计时文案长度变化会撑动按钮宽度，因此按钮用 tabular-nums + nowrap 固定视觉节奏，
// 输入框通过 flex: 1 吸收剩余宽度，避免每次倒计时跳一下布局。
function CodeField({ label, value, onChange, onSend, sending, remaining, targetReady, disabled, placeholder, autoComplete, inputMode, sendLabel }: {
    label: string; value: string; onChange: (next: string) => void;
    onSend: () => void; sending: boolean; remaining: number; targetReady: boolean;
    disabled: boolean; placeholder: string; autoComplete: string; inputMode: "text" | "email" | "tel" | "numeric"; sendLabel: string;
}) {
    const { t } = useTranslation();
    const counting = remaining > 0;
    const blocked = disabled || sending || counting || !targetReady;
    return (
        <label className="block space-y-2">
            <span className="auth-scene-label text-xs font-medium">{label}</span>
            <span className={`auth-code-field${sending ? " is-busy" : ""}`}>
                <Input
                    size="large"
                    variant="borderless"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    autoComplete={autoComplete}
                    inputMode={inputMode}
                    placeholder={placeholder}
                    disabled={disabled || sending}
                />
                <Button
                    className="auth-code-send"
                    size="large"
                    type="text"
                    data-counting={counting ? "true" : "false"}
                    loading={sending}
                    disabled={blocked}
                    onClick={onSend}
                >
                    {counting ? t("auth.verification.resendIn", { seconds: remaining }) : sendLabel}
                </Button>
            </span>
        </label>
    );
}

export function VerificationFields({ purpose, method, value, onChange, disabled = false, password }: {
    purpose: VerificationPurpose; method: VerificationMethod; value: VerificationDraft;
    onChange: (value: VerificationDraft) => void; disabled?: boolean; password?: string;
}) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [sending, setSending] = useState(false);
    const [remaining, setRemaining] = useState(0);
    const inFlight = useRef(false);
    const sms = method !== "email", email = method !== "sms";
    useEffect(() => {
        if (!remaining) return;
        const timer = window.setTimeout(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
        return () => window.clearTimeout(timer);
    }, [remaining]);
    const changeTarget = (key: "email" | "phone", target: string) => onChange({ ...value, [key]: target, ticket: "", emailCode: "", smsCode: "" });
    const send = async () => {
        if (inFlight.current || remaining > 0) return;
        if ((sms && !value.phone.trim()) || (email && !value.email.trim()) || (purpose === "bind" && !password)) {
            message.warning(t("auth.verification.needTarget")); return;
        }
        inFlight.current = true; setSending(true);
        // Start cooldown even on ambiguous failures; never encourage instant resends.
        setRemaining(60);
        onChange({ ...value, ticket: "", emailCode: "", smsCode: "" });
        try {
            const result = await startVerification({ purpose, method, email: email ? value.email.trim() : undefined, phone: sms ? value.phone.trim() : undefined, password });
            onChange({ ...value, email: email ? value.email.trim().toLowerCase() : "", phone: sms ? value.phone.trim() : "", emailCode: "", smsCode: "", ticket: result.ticket });
            setRemaining(result.retryAfter);
            message.success(purpose === "login" ? t("auth.verification.sentLogin") : t("auth.verification.sent"));
        } catch (error) { message.error(error instanceof Error ? error.message : t("auth.verification.sendFailed")); }
        finally { setSending(false); inFlight.current = false; }
    };
    const sendLabel = t("auth.verification.send");
    return <div className="space-y-4">
        {sms && <label className="block space-y-2"><span className="auth-scene-label text-xs font-medium">{t("auth.verification.phone")}</span><Input size="large" value={value.phone} onChange={(e) => changeTarget("phone", e.target.value)} autoComplete="tel" inputMode="tel" placeholder={t("auth.verification.phonePlaceholder")} required disabled={disabled || sending} /></label>}
        {email && <label className="block space-y-2"><span className="auth-scene-label text-xs font-medium">{t("auth.verification.email")}</span><Input size="large" type="email" value={value.email} onChange={(e) => changeTarget("email", e.target.value)} autoComplete="email" placeholder={t("auth.verification.emailPlaceholder")} required disabled={disabled || sending} /></label>}
        {/* 双通道（sms_email）一次请求同时下发两种验证码，此时按钮文案不区分通道。 */}
        {(sms || email) && (
            <CodeField
                label={method === "sms_email" ? t("auth.verification.code") : sms ? t("auth.verification.smsCode") : t("auth.verification.emailCode")}
                value={method === "sms_email" ? value.smsCode : sms ? value.smsCode : value.emailCode}
                onChange={(next) => {
                    const code = next.replace(/\D/g, "").slice(0, 6);
                    if (method === "sms_email" || sms) onChange({ ...value, smsCode: code, ...(method === "sms_email" ? { emailCode: code } : {}) });
                    else onChange({ ...value, emailCode: code });
                }}
                onSend={() => void send()}
                sending={sending}
                remaining={remaining}
                // 按钮在联系方式为空时保持禁用，避免用户点了才发现没填邮箱/手机号。
                targetReady={(sms ? Boolean(value.phone.trim()) : true) && (email ? Boolean(value.email.trim()) : true) && (purpose !== "bind" || Boolean(password))}
                disabled={disabled}
                placeholder={t("auth.verification.codePlaceholder")}
                autoComplete="one-time-code"
                inputMode="numeric"
                sendLabel={sendLabel}
            />
        )}
        {method === "sms_email" && <p className="auth-scene-muted m-0 text-xs leading-5">{t("auth.verification.dualHint")}</p>}
    </div>;
}
