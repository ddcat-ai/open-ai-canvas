import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Checkbox, Divider, Input, Modal, Segmented } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, googleLoginURL, linuxDOLoginURL, login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { LinuxDOIcon } from "./auth-scene";
import { WeChatQRPanel } from "@/components/auth/wechat-qr-panel";
import { VerificationFields } from "@/components/auth/verification-fields";
import { emptyVerification, loginVerification, methodLabels, verificationMethods, type VerificationMethod } from "@/services/api/verification";

export default function LoginPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
    const [wechatEnabled, setWechatEnabled] = useState(false);
    const [googleEnabled, setGoogleEnabled] = useState(false);
    const [wechatOpen, setWechatOpen] = useState(false);
    const [methods, setMethods] = useState<VerificationMethod[]>([]);
    const [method, setMethod] = useState<"password" | VerificationMethod>("password");
    const [verification, setVerification] = useState({ ...emptyVerification });
    // 第三方登录走「新用户注册」路径时后端要求已同意服务协议，
    // 与注册页保持一致：未勾选时先弹协议，勾选后携带 acceptedTerms 跳转。
    const [agreementAccepted, setAgreementAccepted] = useState(false);
    const [agreementOpen, setAgreementOpen] = useState(false);
    const [agreementTitle, setAgreementTitle] = useState("服务协议");
    const [agreementContent, setAgreementContent] = useState("");
    const [pendingProvider, setPendingProvider] = useState<"google" | "linuxdo" | null>(null);
    const next = safeNext(params.get("next"));
    const forgotPasswordURL = `/forgot-password?next=${encodeURIComponent(next)}`;
    const user = useUserStore((state) => state.user);
    const hydrated = useUserStore((state) => state.hydrated);

    // 如果已登录，直接跳转
    useEffect(() => {
        if (hydrated && user) {
            navigate(next, { replace: true });
        }
    }, [hydrated, user, next, navigate]);

    useEffect(() => {
        void getAuthSettings()
            .then((settings) => {
                setLinuxdoEnabled(settings.linuxdoEnabled);
                setWechatEnabled(settings.wechatEnabled);
                setGoogleEnabled(settings.googleEnabled);
                setMethods(verificationMethods(settings, "login"));
                if ((settings.agreementTitle ?? "").trim()) {
                    setAgreementTitle((settings.agreementTitle ?? "").trim().replace(/^《|》$/g, ""));
                }
                setAgreementContent((settings.agreementContent || "").trim());
            })
            .catch((error) => {
                // 这是登录页的展示配置读取：失败时明确隐藏第三方入口，
                // 账号密码登录仍可用；不能无痕地把配置读取失败当成成功。
                console.warn("读取登录方式配置失败，已隐藏第三方登录入口", error);
            });
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
    }, [message, params]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            if (method === "password") await login({ username, password });
            else {
                if (!verification.ticket) throw new Error("请先获取本次登录验证码");
                await loginVerification(verification);
            }
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("登录成功");
            navigate(next, { replace: true });
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <>
        <form onSubmit={submit} className="space-y-5">
            {methods.length > 0 && <Segmented block aria-label="登录方式" value={method} disabled={submitting} options={[{ value: "password", label: "密码登录" }, ...methods.map((value) => ({ value, label: methodLabels[value] }))]} onChange={(value) => { setMethod(value as typeof method); setVerification({ ...emptyVerification }); }} />}
            {method !== "password" ? <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} /> : <>
            <AuthField label="用户名 / 邮箱" htmlFor="login-account">
                <Input id="login-account" size="large" prefix={<UserRound className="auth-scene-icon size-4" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" required />
            </AuthField>
            <AuthField
                label="密码"
                htmlFor="login-password"
                action={
                    <Link
                        to={forgotPasswordURL}
                        className="auth-scene-link -my-2 inline-flex min-h-8 items-center rounded-sm text-xs font-medium transition-colors"
                    >
                        忘记密码？
                    </Link>
                }
            >
                <Input.Password
                    id="login-password"
                    size="large"
                    prefix={<LockKeyhole className="auth-scene-icon size-4" />}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="请输入密码"
                    autoComplete="current-password"
                    required
                />
            </AuthField>
            </>}
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                登录
            </Button>
            {linuxdoEnabled || googleEnabled || wechatEnabled ? (
                <Divider plain className="auth-scene-divider">
                    或
                </Divider>
            ) : null}
            {googleEnabled ? (
                <Button
                    size="large"
                    block
                    icon={<GoogleIcon />}
                    onClick={() => {
                        if (agreementAccepted) {
                            window.location.href = googleLoginURL(next, true);
                            return;
                        }
                        setPendingProvider("google");
                        setAgreementOpen(true);
                    }}
                >
                    使用 Google 登录
                </Button>
            ) : null}
            {wechatEnabled ? (
                <Button size="large" block icon={<WeChatIcon />} onClick={() => setWechatOpen(true)}>
                    微信扫码登录
                </Button>
            ) : null}
            {linuxdoEnabled ? (
                <Button
                    size="large"
                    block
                    icon={<LinuxDOIcon />}
                    onClick={() => {
                        if (agreementAccepted) {
                            window.location.href = linuxDOLoginURL(next, true);
                            return;
                        }
                        setPendingProvider("linuxdo");
                        setAgreementOpen(true);
                    }}
                >
                    使用 Linux.do 登录
                </Button>
            ) : null}
        </form>
        <Modal
            open={wechatOpen}
            onCancel={() => setWechatOpen(false)}
            footer={null}
            centered
            width={320}
            title="微信登录"
            destroyOnHidden
        >
            {wechatOpen ? (
                <WeChatQRPanel
                    next={next}
                    onSuccess={(target) => {
                        setWechatOpen(false);
                        navigate(target, { replace: true });
                    }}
                />
            ) : null}
        </Modal>
        <Modal
            className="workspace-modal workspace-modal-compact auth-agreement-modal"
            title={agreementTitle}
            open={agreementOpen}
            onCancel={() => setAgreementOpen(false)}
            footer={
                <div className="flex items-center justify-between gap-3">
                    <Checkbox
                        checked={agreementAccepted}
                        onChange={(event) => setAgreementAccepted(event.target.checked)}
                    >
                        <span className="auth-agreement-label">我已阅读并同意</span>
                    </Checkbox>
                    <Button
                        type="primary"
                        disabled={!agreementAccepted}
                        onClick={() => {
                            setAgreementOpen(false);
                            if (pendingProvider === "google") {
                                window.location.href = googleLoginURL(next, true);
                            } else if (pendingProvider === "linuxdo") {
                                window.location.href = linuxDOLoginURL(next, true);
                            }
                            setPendingProvider(null);
                        }}
                    >
                        同意并继续
                    </Button>
                </div>
            }
            destroyOnHidden
        >
            {agreementContent ? (
                agreementContent.split(/\n\s*\n/).map((paragraph, index) => (
                    <p key={index} className="auth-agreement-paragraph whitespace-pre-wrap text-sm leading-6">
                        {paragraph}
                    </p>
                ))
            ) : (
                <p className="text-sm leading-6 text-muted-foreground">
                    管理员尚未配置协议内容。勾选同意后即可继续使用第三方账号登录。
                </p>
            )}
        </Modal>
        </>
    );
}

function GoogleIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
            <path fill="#4285F4" d="M24.44 20v8.52h11.84c-.52 2.74-2.08 5.06-4.42 6.62l7.14 5.54c4.16-3.84 6.56-9.48 6.56-16.18 0-1.56-.14-3.06-.4-4.5H24.44Z" />
            <path fill="#34A853" d="M12.11 28.19 10.5 29.42 4.8 33.86C8.42 41.04 15.84 46 24.44 46c5.94 0 10.92-1.96 14.56-5.32l-7.14-5.54c-1.96 1.32-4.46 2.12-7.42 2.12-5.72 0-10.58-3.86-12.33-9.07Z" />
            <path fill="#FBBC05" d="M4.8 14.14A21.9 21.9 0 0 0 2.44 24c0 3.56.86 6.9 2.36 9.86l7.31-5.68A13.2 13.2 0 0 1 11.42 24c0-1.46.26-2.86.7-4.18L4.8 14.14Z" />
            <path fill="#EA4335" d="M24.44 10.74c3.24 0 6.14 1.12 8.42 3.3l6.32-6.32C35.34 4.06 30.38 2 24.44 2 15.84 2 8.42 6.94 4.8 14.14l7.32 5.68c1.75-5.22 6.61-9.08 12.32-9.08Z" />
        </svg>
    );
}

function WeChatIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 1024 1024" aria-hidden>
            <path fill="#07C160" d="M690.1 377.4c5.9 0 11.8.2 17.6.5-24.4-128.3-152-223.9-300.8-223.9-168.7 0-306.6 114.9-306.6 256.6 0 82.9 46.4 151.1 124.1 203.9l-31 93.2 108.4-54.2c38.8 7.6 69.9 15.4 108.7 15.4 9.8 0 19.5-.5 29.1-1.2-6.1-20.8-9.6-42.7-9.6-65.4 0-136.1 116.7-224.9 260.1-224.9zM487.1 276.6c23.3 0 38.8 15.5 38.8 38.8 0 23.2-15.5 38.7-38.8 38.7-23.2 0-46.5-15.5-46.5-38.7 0-23.3 23.3-38.8 46.5-38.8zm-186.3 77.5c-23.2 0-46.6-15.5-46.6-38.7 0-23.3 23.4-38.8 46.6-38.8 23.2 0 38.7 15.5 38.7 38.8 0 23.2-15.5 38.7-38.7 38.7z" />
            <path fill="#07C160" d="M951.9 667.1c0-119.4-116.7-217-248.2-217-139.2 0-248.3 97.6-248.3 217s109.1 217 248.3 217c29.1 0 58.1-7.7 87.2-15.5l79.5 46.5-21.8-77.5c58.2-46.5 103.3-100.9 103.3-170.5zM620.5 628.3c-15.5 0-31-15.5-31-31 0-15.4 15.5-30.9 31-30.9 23.3 0 38.8 15.5 38.8 30.9 0 15.5-15.5 31-38.8 31zm170.6 0c-15.5 0-31-15.5-31-31 0-15.4 15.5-30.9 31-30.9 23.2 0 38.7 15.5 38.7 30.9 0 15.5-15.5 31-38.7 31z" />
        </svg>
    );
}

function AuthField({ label, htmlFor, action, children }: { label: string; htmlFor: string; action?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <label htmlFor={htmlFor} className="auth-scene-label text-xs font-medium">
                    {label}
                </label>
                {action}
            </div>
            {children}
        </div>
    );
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
    return value;
}
