import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { getAuthSettings, resetPassword, sendPasswordResetEmailCode } from "@/services/api/auth";

type RecoveryStage = "request" | "reset";

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [stage, setStage] = useState<RecoveryStage>("request");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [emailEnabled, setEmailEnabled] = useState<boolean | null>(null);
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const next = safeNext(params.get("next"));
    const loginURL = `/login?next=${encodeURIComponent(next)}`;

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((settings) => !cancelled && setEmailEnabled(settings.emailEnabled))
            .catch(() => !cancelled && setEmailEnabled(null));
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const sendCode = async (advance: boolean) => {
        const normalizedEmail = email.trim();
        if (!normalizedEmail) {
            message.warning("请先输入邮箱");
            return;
        }
        setSendingCode(true);
        try {
            await sendPasswordResetEmailCode(normalizedEmail);
            setEmail(normalizedEmail);
            setCountdown(60);
            if (advance) setStage("reset");
            message.success("如果该邮箱已绑定可找回的账号，验证码将发送到邮箱");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "发送验证码失败");
        } finally {
            setSendingCode(false);
        }
    };

    const requestCode = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        void sendCode(true);
    };

    const submitReset = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        setSubmitting(true);
        try {
            await resetPassword({ email: email.trim(), emailCode, password });
            message.success("密码已重置，请使用新密码登录");
            navigate(loginURL, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "密码重置失败");
        } finally {
            setSubmitting(false);
        }
    };

    const editEmail = () => {
        setStage("request");
        setEmailCode("");
        setPassword("");
        setConfirmPassword("");
        setCountdown(0);
    };

    if (stage === "request") {
        return (
            <form onSubmit={requestCode} className="space-y-5">
                {emailEnabled === false ? <Notice icon={<TriangleAlert className="size-3.5" />}>管理员尚未启用密码找回，请联系管理员处理。</Notice> : null}
                <AuthField label="账号邮箱" htmlFor="recovery-email">
                    <Input
                        id="recovery-email"
                        size="large"
                        prefix={<Mail className="size-4 text-white/35" />}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="请输入绑定邮箱"
                        autoComplete="email"
                        inputMode="email"
                        required
                        disabled={emailEnabled === false}
                    />
                </AuthField>
                <Button type="primary" htmlType="submit" size="large" block loading={sendingCode} disabled={emailEnabled === false} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    发送验证码
                </Button>
                <BackToLogin to={loginURL} />
            </form>
        );
    }

    return (
        <form onSubmit={submitReset} className="space-y-4">
            <AuthField label="账号邮箱" htmlFor="recovery-email-confirm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input id="recovery-email-confirm" size="large" prefix={<Mail className="size-4 text-white/35" />} value={email} readOnly autoComplete="email" />
                    <Button htmlType="button" size="large" onClick={editEmail}>
                        修改邮箱
                    </Button>
                </div>
            </AuthField>
            <AuthField label="邮箱验证码" htmlFor="recovery-code">
                <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                    <Input
                        id="recovery-code"
                        size="large"
                        prefix={<ShieldCheck className="size-4 text-white/35" />}
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder="6 位验证码"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                    />
                    <Button htmlType="button" size="large" loading={sendingCode} disabled={countdown > 0} onClick={() => void sendCode(false)}>
                        {countdown > 0 ? `${countdown}s` : "重新发送"}
                    </Button>
                </div>
            </AuthField>
            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label="新密码" htmlFor="recovery-password">
                    <Input.Password
                        id="recovery-password"
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
                <AuthField label="确认密码" htmlFor="recovery-confirm-password">
                    <Input.Password
                        id="recovery-confirm-password"
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="再次输入密码"
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                重置密码
            </Button>
            <BackToLogin to={loginURL} />
        </form>
    );
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="block text-xs font-medium text-white/62">
                {label}
            </label>
            {children}
        </div>
    );
}

function BackToLogin({ to }: { to: string }) {
    return (
        <div className="text-center">
            <Link to={to} className="inline-flex min-h-8 items-center gap-1.5 rounded-sm text-xs text-white/50 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/45">
                <ArrowLeft className="size-3.5" />
                返回登录
            </Link>
        </div>
    );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300/15 bg-amber-300/[0.06] px-3 py-2.5 text-xs leading-5 text-amber-100/78">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
