import { type FormEvent, useEffect, useRef, useState, type ReactNode } from "react";
import { App, Button, Checkbox, Divider, Input, Modal, Segmented } from "antd";
import { ArrowRight, Info, LockKeyhole, Mail, TriangleAlert, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, register } from "@/services/api/auth";
import { LinuxDOIcon } from "./auth-scene";
import { ApiError } from "@/services/api/request";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";

type AuthSettings = Awaited<ReturnType<typeof getAuthSettings>>;

// TODO: 由维护者填写正式的影策服务协议条款后再发布。
const SERVICE_AGREEMENT: { title: string; content: string }[] = [];

export default function RegisterPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [settings, setSettings] = useState<AuthSettings | null>(null);
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [verification, setVerification] = useState({ ...emptyVerification });
    const [method, setMethod] = useState<VerificationMethod>("email");
    const [displayName, setDisplayName] = useState("");
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [registerCountdown, setRegisterCountdown] = useState(0);
    const registering = useRef(false);
    const next = safeNext(params.get("next"));

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((value) => {
                if (!cancelled) {
                    setSettings(value);
                    setMethod(verificationMethods(value, "register")[0] ?? "email");
                }
            })
            .catch((error) => !cancelled && message.error(error instanceof Error ? error.message : "读取注册设置失败"));
        return () => {
            cancelled = true;
        };
    }, [message]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (registering.current || registerCountdown > 0) return;
        if (!agreementAccepted) {
            message.warning("请先同意影策服务协议");
            return;
        }
        if (password !== confirmPassword) {
            message.error("两次输入的密码不一致");
            return;
        }
        registering.current = true;
        setSubmitting(true);
        try {
            if (!settings?.firstUser && !verification.ticket) throw new Error("请先获取本次注册验证码");
            await register({ username, ...(settings?.firstUser ? { email } : verification), displayName, password, acceptedTerms: agreementAccepted });
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
    const methods = settings ? verificationMethods(settings, "register") : [];
    const verificationUnavailable = Boolean(settings && !settings.firstUser && methods.length === 0);
    const disabled = !settings || registrationClosed || verificationUnavailable;

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
            {verificationUnavailable ? (
                <Notice icon={<TriangleAlert className="size-3.5" />} tone="amber">
                    当前没有可用的注册验证方式，请联系管理员检查短信及邮件配置。
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

            {settings?.firstUser ? (
                <AuthField label="邮箱（可选）">
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
            ) : (
                <>
                    {methods.length > 1 && (
                        <Segmented
                            block
                            aria-label="注册验证方式"
                            options={methods.map((value) => ({ value, label: methodLabels[value] }))}
                            value={method}
                            disabled={submitting}
                            onChange={(value) => {
                                setMethod(value as VerificationMethod);
                                setVerification({ ...emptyVerification });
                            }}
                        />
                    )}
                    {methods.length > 0 && <VerificationFields key={method} purpose="register" method={method} value={verification} onChange={setVerification} disabled={disabled || submitting} />}
                </>
            )}

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

            <div className="flex items-start gap-2 text-xs leading-5 text-white/55">
                <Checkbox checked={agreementAccepted} onChange={(event) => setAgreementAccepted(event.target.checked)}>
                    <span className="text-xs leading-5 text-white/55">我已阅读并同意</span>
                </Checkbox>
                <button type="button" className="-ml-1 text-xs leading-5 text-blue-300/85 transition hover:text-blue-200" onClick={() => setAgreementOpen(true)}>
                    《影策服务协议》
                </button>
            </div>

            <Button type="primary" htmlType="submit" size="large" block loading={submitting} disabled={disabled || registerCountdown > 0 || !agreementAccepted} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                {registerCountdown > 0 ? `${registerCountdown} 秒后可重试` : "创建账号"}
            </Button>
            {settings?.linuxdoEnabled && !settings.smsAndEmailRegistration ? (
                <>
                    <Divider plain className="!border-white/10 !text-white/30">
                        或
                    </Divider>
                    <Button size="large" block disabled={!agreementAccepted} icon={<LinuxDOIcon />} href={agreementAccepted ? linuxDOLoginURL(next, true) : undefined}>
                        使用 Linux.do 注册 / 登录
                    </Button>
                </>
            ) : null}
            <Modal className="workspace-modal workspace-modal-compact" title="影策服务协议" open={agreementOpen} onCancel={() => setAgreementOpen(false)} footer={null} destroyOnHidden>
                <div className="max-h-96 space-y-4 overflow-y-auto pr-1 text-sm leading-6 text-foreground/68">
                    {SERVICE_AGREEMENT.length === 0 ? <p className="m-0">服务协议内容待补充。</p> : null}
                    {SERVICE_AGREEMENT.map((item) => (
                        <section key={item.title}>
                            <h3 className="m-0 text-sm font-semibold text-foreground">{item.title}</h3>
                            <p className="mt-1.5 mb-0">{item.content}</p>
                        </section>
                    ))}
                </div>
            </Modal>
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
