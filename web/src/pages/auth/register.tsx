import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Divider, Input } from "antd";
import { ArrowRight, Info, LockKeyhole, Mail, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";

import { applyUserSession } from "@/lib/user-session";
import { getAuthSession, getAuthSettings, linuxDOLoginURL, register, sendRegistrationEmailCode } from "@/services/api/auth";
import { LinuxDOIcon } from "./auth-scene";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

export default function RegisterPage() {
    const { t } = useTranslation("auth");
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [emailCode, setEmailCode] = useState("");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [countdown, setCountdown] = useState(0);
    const next = safeNext(params.get("next"));

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((value) => !cancelled && setSettings(value))
            .catch((error) => !cancelled && message.error(error instanceof Error ? error.message : t("register.settings-load-failed")));
        return () => {
            cancelled = true;
        };
    }, [message, t]);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const sendCode = async () => {
        if (!email.trim()) {
            message.warning(t("register.email-required-first"));
            return;
        }
        setSendingCode(true);
        try {
            await sendRegistrationEmailCode(email.trim());
            setCountdown(60);
            message.success(t("register.code-sent"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("register.code-send-failed"));
        } finally {
            setSendingCode(false);
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (password !== confirmPassword) {
            message.error(t("register.password-mismatch"));
            return;
        }
        setSubmitting(true);
        try {
            await register({ username, email, emailCode, displayName, password });
            await applyUserSession(await getAuthSession());
            if (!settings?.firstUser) window.sessionStorage.setItem("infinite-canvas:model-setup-guide", "1");
            message.success(settings?.firstUser ? t("register.success-admin") : t("register.success"));
            navigate(next, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("register.failed-fallback"));
        } finally {
            setSubmitting(false);
        }
    };

    const registrationClosed = settings?.registrationEnabled === false;
    const mailUnavailable = Boolean(settings && !settings.firstUser && settings.emailCodeRequired && !settings.emailEnabled);
    const disabled = registrationClosed || mailUnavailable;
    const requireCode = Boolean(settings && !settings.firstUser && settings.emailCodeRequired);

    return (
        <form onSubmit={submit} className="space-y-4">
            {settings?.firstUser ? (
                <Notice icon={<Info className="size-3.5" />} tone="blue">
                    {t("register.first-user-notice")}
                </Notice>
            ) : null}
            {registrationClosed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    {t("register.registration-closed-notice")}
                </Notice>
            ) : null}
            {mailUnavailable ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    {t("register.mail-unavailable-notice")}
                </Notice>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={t("register.username-label")}>
                    <Input
                        size="large"
                        prefix={<UserRound className="size-4 text-white/35" />}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder={t("register.username-placeholder")}
                        autoComplete="username"
                        required
                        disabled={disabled}
                    />
                </AuthField>
                <AuthField label={t("register.display-name-label")}>
                    <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("register.display-name-placeholder")} disabled={disabled} />
                </AuthField>
            </div>

            <AuthField label={t("register.email-label")}>
                <Input
                    size="large"
                    prefix={<Mail className="size-4 text-white/35" />}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder={t("register.email-placeholder")}
                    autoComplete="email"
                    required={!settings?.firstUser}
                    disabled={disabled}
                />
            </AuthField>

            {requireCode ? (
                <AuthField label={t("register.email-code-label")}>
                    <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                        <Input
                            size="large"
                            prefix={<ShieldCheck className="size-4 text-white/35" />}
                            value={emailCode}
                            onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            placeholder={t("register.email-code-placeholder")}
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            disabled={disabled}
                        />
                        <Button size="large" loading={sendingCode} disabled={disabled || countdown > 0} onClick={() => void sendCode()}>
                            {countdown > 0 ? `${countdown}s` : t("register.get-code")}
                        </Button>
                    </div>
                </AuthField>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label={t("register.password-label")}>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder={t("register.password-placeholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
                <AuthField label={t("register.confirm-password-label")}>
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder={t("register.confirm-password-placeholder")}
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
            </div>

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {t("register.submit")}
            </Button>
            {settings?.linuxdoEnabled ? (
                <>
                    <Divider plain className="!border-white/10 !text-white/30">
                        {t("register.or")}
                    </Divider>
                    <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>
                        {t("register.linuxdo")}
                    </Button>
                </>
            ) : null}
        </form>
    );
}

function AuthField({ label, children }: { label: string; children: ReactNode }) {
    return (
        <label className="block space-y-2">
            <span className="text-xs font-medium text-white/62">{label}</span>
            {children}
        </label>
    );
}

function Notice({ icon, tone, children }: { icon: ReactNode; tone: "blue" | "amber"; children: ReactNode }) {
    return (
        <div className={`flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-5 ${tone === "blue" ? "border-blue-300/15 bg-blue-300/[0.06] text-blue-100/78" : "border-amber-300/15 bg-amber-300/[0.06] text-amber-100/78"}`}>
            <span className="mt-0.5 shrink-0">{icon}</span>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/create";
    return value;
}
