import { type FormEvent, useEffect, useState } from "react";
import { App, Button, Input } from "antd";
import { ArrowLeft, MailQuestion, TriangleAlert } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { AuthView } from "@/lib/auth-entry";
import { resetPassword, sendPasswordResetEmailCode, type AuthSettings } from "@/services/api/auth";
import { AuthNotice } from "./auth-form-parts";

type RecoveryStage = "request" | "reset";

export function AuthRecoveryForm({ settings, onViewChange }: { settings: AuthSettings | null; onViewChange: (view: AuthView) => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const [stage, setStage] = useState<RecoveryStage>("request");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [countdown, setCountdown] = useState(0);
    // 配置读取失败时不预先禁用，由找回接口给出真实结果。
    const emailDisabled = settings?.emailEnabled === false;

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
            onViewChange("login");
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

    const backToLogin = (
        <div className="auth-form-switch">
            <button type="button" className="auth-form-link has-icon" onClick={() => onViewChange("login")}>
                <ArrowLeft className="size-3.5" aria-hidden />
                {t("auth.recovery.back")}
            </button>
        </div>
    );

    if (stage === "request") {
        return (
            <form onSubmit={requestCode} className="auth-form">
                {emailDisabled ? <AuthNotice icon={<TriangleAlert className="size-3.5" />}>{t("auth.recovery.disabled")}</AuthNotice> : null}
                <Input
                    size="large"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    aria-label={t("auth.recovery.email")}
                    placeholder={t("auth.recovery.emailPlaceholder")}
                    autoComplete="email"
                    inputMode="email"
                    required
                    disabled={emailDisabled}
                />
                <Button type="primary" htmlType="submit" size="large" block loading={sendingCode} disabled={emailDisabled}>
                    {t("auth.recovery.send")}
                </Button>
                {backToLogin}
            </form>
        );
    }

    return (
        <form onSubmit={submitReset} className="auth-form">
            <AuthNotice tone="blue" icon={<MailQuestion className="size-3.5" />}>
                {t("auth.recovery.notReceived")}
            </AuthNotice>
            <div className="auth-form-fields">
                <div className="auth-code-row">
                    <Input size="large" value={email} readOnly autoComplete="email" aria-label={t("auth.recovery.email")} />
                    <Button htmlType="button" size="large" className="auth-code-button" onClick={editEmail}>
                        {t("auth.recovery.editEmail")}
                    </Button>
                </div>
                <div className="auth-code-row">
                    <Input
                        size="large"
                        value={emailCode}
                        onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        aria-label={t("auth.recovery.code")}
                        placeholder={t("auth.recovery.codePlaceholder")}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        required
                    />
                    <Button htmlType="button" size="large" className="auth-code-button" data-counting={countdown > 0 ? "true" : "false"} loading={sendingCode} disabled={countdown > 0} onClick={() => void sendCode(false)}>
                        {countdown > 0 ? t("auth.verification.resendIn", { seconds: countdown }) : t("auth.recovery.resend")}
                    </Button>
                </div>
                <div className="auth-form-pair">
                    <Input.Password
                        size="large"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        aria-label={t("auth.recovery.newPassword")}
                        placeholder={t("auth.recovery.passwordPlaceholder")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                    <Input.Password
                        size="large"
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        aria-label={t("auth.recovery.confirmPassword")}
                        placeholder={t("auth.recovery.confirmPlaceholder")}
                        autoComplete="new-password"
                        minLength={8}
                        required
                    />
                </div>
            </div>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                {t("auth.recovery.submit")}
            </Button>
            {backToLogin}
        </form>
    );
}
