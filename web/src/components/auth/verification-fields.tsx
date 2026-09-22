import { useEffect, useRef, useState } from "react";
import { App, Button, Input } from "antd";
import { startVerification, type VerificationDraft, type VerificationMethod, type VerificationPurpose } from "@/services/api/verification";

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
            message.warning("请先填写联系方式及必要的当前密码");
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
            message.success(purpose === "login" ? "如该联系方式已验证且账号可用，验证码将发送至该联系方式" : "验证码已发送，10 分钟内有效");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送失败，请稍后重试");
        } finally {
            setSending(false);
            inFlight.current = false;
        }
    };
    return (
        <div className="space-y-4">
            {sms && (
                <label className="block space-y-2">
                    <span className="text-sm">手机号</span>
                    <Input size="large" value={value.phone} onChange={(e) => changeTarget("phone", e.target.value)} autoComplete="tel" inputMode="tel" placeholder="中国大陆手机号，支持 +86" required disabled={disabled || sending} />
                </label>
            )}
            {email && (
                <label className="block space-y-2">
                    <span className="text-sm">邮箱</span>
                    <Input size="large" type="email" value={value.email} onChange={(e) => changeTarget("email", e.target.value)} autoComplete="email" placeholder="请输入邮箱" required disabled={disabled || sending} />
                </label>
            )}
            <Button block size="large" loading={sending} disabled={disabled || remaining > 0} onClick={() => void send()}>
                {remaining > 0 ? `${remaining} 秒后可重新获取` : method === "sms_email" ? "获取短信及邮件验证码" : "获取验证码"}
            </Button>
            {sms && (
                <label className="block space-y-2">
                    <span className="text-sm">短信验证码</span>
                    <Input
                        size="large"
                        value={value.smsCode}
                        onChange={(e) => onChange({ ...value, smsCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        placeholder="6 位短信验证码"
                        required
                        disabled={disabled || sending}
                    />
                </label>
            )}
            {email && (
                <label className="block space-y-2">
                    <span className="text-sm">邮件验证码</span>
                    <Input
                        size="large"
                        value={value.emailCode}
                        onChange={(e) => onChange({ ...value, emailCode: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        placeholder="6 位邮件验证码"
                        required
                        disabled={disabled || sending}
                    />
                </label>
            )}
            {method === "sms_email" && <p className="text-xs opacity-65">两项验证必须在本次注册中同时通过；修改联系方式后需要重新获取。</p>}
        </div>
    );
}
