import { type FormEvent, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Divider, Input } from "antd";
import { ArrowRight, Gift, Info, LockKeyhole, Mail, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, register, sendRegistrationEmailCode } from "@/services/api/auth";
import { getPublicPromotionStatus } from "@/services/api/promotion";
import { LinuxDOIcon } from "./auth-scene";
import { ApiError } from "@/services/api/request";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

export default function RegisterPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    // /register?invite=CODE 来自推广邀请链接，注册成功后由后端建立邀请关系。
    const { message } = App.useApp();
    const inviteCodeFromLink = (params.get("invite") || "").trim().toUpperCase();
    // 邀请码既可以来自邀请链接，也可以手动填写；是否生效取决于推广中心开关。
    const [inviteInput, setInviteInput] = useState(inviteCodeFromLink);
    const [inviteError, setInviteError] = useState("");

    // 邀请码要么留空，要么必须是真实有效的码；无效码不允许注册成功。
    const verifyInviteCode = useCallback(async (code: string) => {
        const normalized = code.trim().toUpperCase();
        if (!normalized) return { ok: true, message: "" };
        try {
            const status = await getPublicPromotionStatus(normalized);
            if (!status.enabled) return { ok: false, message: "推广邀请暂时未启用，请直接注册。" };
            if (!status.inviteCodeValid) return { ok: false, message: "邀请码无效，请检查后重试或留空注册。" };
            return { ok: true, message: "" };
        } catch {
            return { ok: false, message: "邀请码校验失败，请检查网络后重试" };
        }
    }, []);

    useEffect(() => {
        if (!inviteCodeFromLink) return;
        void verifyInviteCode(inviteCodeFromLink).then((result) => {
            if (!result.message) return;
            setInviteError(result.message);
            message.warning(result.message);
        });
    }, [inviteCodeFromLink, message, verifyInviteCode]);
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
    const [registerCountdown, setRegisterCountdown] = useState(0);
    const sending = useRef(false),
        registering = useRef(false);
    const next = safeNext(params.get("next"));

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((value) => !cancelled && setSettings(value))
            .catch((error) => !cancelled && message.error(error instanceof Error ? error.message : "读取注册设置失败"));
        return () => {
            cancelled = true;
        };
    }, [message]);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    const sendCode = async () => {
        if (sending.current || countdown > 0) return;
        if (!email.trim()) {
            message.warning("请先输入邮箱");
            return;
        }
        sending.current = true;
        setSendingCode(true);
        try {
            await sendRegistrationEmailCode(email.trim());
            setCountdown(60);
            message.success("验证码已发送，请检查邮箱");
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : "发送验证码失败");
        } finally {
            sending.current = false;
            setSendingCode(false);
        }
    };

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || registerCountdown > 0) return;
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            // 邀请码要么留空，要么真实有效：无效码必须阻断注册，不能静默忽略。
            const inviteCode = inviteInput.trim().toUpperCase();
            const inviteCheck = await verifyInviteCode(inviteCode);
            if (!inviteCheck.ok) {
                setInviteError(inviteCheck.message);
                message.error(inviteCheck.message);
                return;
            }
            setInviteError("");
            await register({ username, email, emailCode, displayName, password, inviteCode: inviteCode || undefined });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            if (!settings?.firstUser) window.sessionStorage.setItem("infinite-canvas:model-setup-guide", "1");
            message.success(settings?.firstUser ? "管理员账号已创建" : "注册成功");
            navigate(next, { replace: true });
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setRegisterCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : "注册失败");
        } finally {
            registering.current = false;
            setSubmitting(false);
        }
    };

    useEffect(() => {
        if (registerCountdown <= 0) return;
        const timer = window.setInterval(() => setRegisterCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [registerCountdown]);

    const registrationClosed = settings?.registrationEnabled === false;
    const mailUnavailable = Boolean(settings && !settings.firstUser && settings.emailCodeRequired && !settings.emailEnabled);
    const disabled = registrationClosed || mailUnavailable;
    const requireCode = Boolean(settings && !settings.firstUser && settings.emailCodeRequired);

    return (
        <form onSubmit={submit} className="space-y-4">
            {settings?.firstUser ? (
                <Notice icon={<Info className="size-3.5" />} tone="blue">
                    首个账号自动成为管理员，邮箱验证码暂不要求。
                </Notice>
            ) : null}
            {registrationClosed ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    当前已关闭普通注册，请联系管理员创建账号。
                </Notice>
            ) : null}
            {mailUnavailable ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    管理员尚未配置注册邮件，普通邮箱注册暂不可用。
                </Notice>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label="用户名">
                    <Input size="large" prefix={<UserRound className="size-4 text-white/35" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="3-32 位字符" autoComplete="username" required disabled={disabled} />
                </AuthField>
                <AuthField label="显示名称">
                    <Input size="large" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="不填则使用用户名" disabled={disabled} />
                </AuthField>
            </div>

            <AuthField label="邮箱">
                <Input
                    size="large"
                    prefix={<Mail className="size-4 text-white/35" />}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="用于登录与安全验证"
                    autoComplete="email"
                    required={!settings?.firstUser}
                    disabled={disabled}
                />
            </AuthField>

            {requireCode ? (
                <AuthField label="邮箱验证码">
                    <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                        <Input
                            size="large"
                            prefix={<ShieldCheck className="size-4 text-white/35" />}
                            value={emailCode}
                            onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            placeholder="6 位验证码"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            required
                            disabled={disabled}
                        />
                        <Button size="large" loading={sendingCode} disabled={disabled || countdown > 0} onClick={() => void sendCode()}>
                            {countdown > 0 ? `${countdown}s` : "获取验证码"}
                        </Button>
                    </div>
                </AuthField>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <AuthField label="密码">
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="至少 8 位"
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
                <AuthField label="确认密码">
                    <Input.Password
                        size="large"
                        prefix={<LockKeyhole className="size-4 text-white/35" />}
                        value={confirmPassword}
                        onChange={(event) => setConfirmPassword(event.target.value)}
                        placeholder="再次输入密码"
                        autoComplete="new-password"
                        required
                        disabled={disabled}
                    />
                </AuthField>
            </div>

            <AuthField label="邀请码（选填）">
                <Input
                    size="large"
                    prefix={<Gift className="size-4 text-white/35" />}
                    value={inviteInput}
                    onChange={(event) => {
                        setInviteInput(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8));
                        if (inviteError) setInviteError("");
                    }}
                    // 失焦即校验，让用户在提交前就知道邀请码是否可用。
                    onBlur={() => void verifyInviteCode(inviteInput).then((result) => setInviteError(result.message))}
                    status={inviteError ? "error" : undefined}
                    placeholder="填写好友的邀请码，不填也可正常注册"
                    disabled={disabled}
                />
                {inviteError ? <p className="mt-1.5 text-[var(--fs-caption)] text-red-500">{inviteError}</p> : null}
            </AuthField>

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || registerCountdown > 0} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {registerCountdown > 0 ? `${registerCountdown} 秒后可重试` : "创建账号"}
            </Button>
            {settings?.linuxdoEnabled ? (
                <>
                    <Divider plain className="!border-white/10 !text-white/30">
                        或
                    </Divider>
                    <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>
                        使用 Linux.do 注册 / 登录
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
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
