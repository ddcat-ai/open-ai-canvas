import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, ArrowRight, LockKeyhole, Mail, ShieldCheck, TriangleAlert } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { getAuthSettings, resetPassword, sendPasswordResetEmailCode } from "@/services/api/auth";

type RecoveryStage = "request" | "reset";

export default function ForgotPasswordPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const { t } = useTranslation();
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
            message.warning(t("auth.recovery.needEmail"));
            return;
        }
        setSendingCode(true);
        try {
            await sendPasswordResetEmailCode(normalizedEmail);
            setEmail(normalizedEmail);
            setCountdown(60);
            if (advance) setStage("reset");
            message.success(t("auth.recovery.sent"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.recovery.sendFailed"));
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
            message.error(t("auth.recovery.mismatch"));
            return;
        }
        setSubmitting(true);
        try {
            await resetPassword({ email: email.trim(), emailCode, password });
            message.success(t("auth.recovery.success"));
            navigate(loginURL, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("auth.recovery.failed"));
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
                {emailEnabled === false ? <Notice icon={<TriangleAlert className="size-3.5" />}>{t("auth.recovery.disabled")}</Notice> : null}
                <AuthField label={t("auth.recovery.email")} htmlFor="recovery-email">
                    <Input
                        id="recovery-email"
                        size="large"
                        prefix={<Mail className="auth-scene-icon size-4" />}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder={t("auth.recovery.emailPlaceholder")}
                        autoComplete="email"
                        inputMode="email"
                        required
                        disabled={emailEnabled === false}
                    />
                </AuthField>
                <Button type="primary" htmlType="submit" size="large" block loading={sendingCode} disabled={emailEnabled === false} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                    {t("auth.recovery.send")}
                </Button>
                <BackToLogin to={loginURL} label={t("auth.recovery.back")} />
            </form>
        );
    }

    return (
        <form onSubmit={submitReset} className="space-y-4">
            <AuthField label={t("auth.recovery.email")} htmlFor="recovery-email-confirm">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                    <Input id="recovery-email-confirm" size="large" prefix={<Mail className="auth-scene-icon size-4" />} value={email} readOnly autoComplete="email" />
                    <Button htmlType="button" size="large" onClick={editEmail}>
                        {t("auth.recovery.editEmail")}
                    </Button>
                </div>
            </AuthField>
            <AuthField label={t("auth.recovery.code")} htmlFor="recovery-code">
                <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                    <Input
                        id="recovery-code"
                        size="large"
                        prefix={<ShieldCheck className="auth-scene-icon size-4" />}
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        placeholder={t("auth.recovery.codePlaceholder")}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                    />
                    <Button htmlType="button" size="large" loading={sendingCode} disabled={countdown > 0} onClick={() => void sendCode(false)}>
                        {countdown > 0 ? `${countdown}s` : t("auth.recovery.resend")}
                    </Button>
                </div>
            </AuthField>
            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={t("auth.recovery.newPassword")} htmlFor="recovery-password">
                    <Input.Password
                        id="recovery-password"
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("auth.recovery.passwordPlaceholder")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
                <AuthField label={t("auth.recovery.confirmPassword")} htmlFor="recovery-confirm-password">
                    <Input.Password
                        id="recovery-confirm-password"
                        size="large"
                        prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("auth.recovery.confirmPlaceholder")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </AuthField>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {t("auth.recovery.submit")}
            </Button>
            <BackToLogin to={loginURL} label={t("auth.recovery.back")} />
        </form>
    );
}

function AuthField({ label, htmlFor, children }: { label: string; htmlFor: string; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <label htmlFor={htmlFor} className="auth-scene-label block text-xs font-medium">
                {label}
            </label>
            {children}
        </div>
    );
}

function BackToLogin({ to, label }: { to: string; label: string }) {
    return (
        <div className="text-center">
            <Link to={to} className="auth-scene-link inline-flex min-h-8 items-center gap-2 rounded-sm text-xs transition-colors">
                <ArrowLeft className="size-3.5" />
                {label}
            </Link>
        </div>
    );
}

function Notice({ icon, children }: { icon: ReactNode; children: ReactNode }) {
    return (
        <div className="auth-scene-notice flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5">
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
