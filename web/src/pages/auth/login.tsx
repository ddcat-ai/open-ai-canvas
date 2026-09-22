import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Divider, Input, Segmented } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { getAuthSession, getAuthSettings, linuxDOLoginURL, login } from "@/services/api/auth";
import { useUserStore } from "@/stores/use-user-store";
import { LinuxDOIcon } from "./auth-scene";
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
    const [methods, setMethods] = useState<VerificationMethod[]>([]);
    const [method, setMethod] = useState<"password" | VerificationMethod>("password");
    const [verification, setVerification] = useState({ ...emptyVerification });
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
                setMethods(verificationMethods(settings, "login"));
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
        <form onSubmit={submit} className="space-y-5">
            {methods.length > 0 && (
                <Segmented
                    block
                    aria-label="登录方式"
                    value={method}
                    disabled={submitting}
                    options={[{ value: "password", label: "密码登录" }, ...methods.map((value) => ({ value, label: methodLabels[value] }))]}
                    onChange={(value) => {
                        setMethod(value as typeof method);
                        setVerification({ ...emptyVerification });
                    }}
                />
            )}
            {method !== "password" ? (
                <VerificationFields key={method} purpose="login" method={method} value={verification} onChange={setVerification} disabled={submitting} />
            ) : (
                <>
                    <AuthField label="用户名 / 邮箱" htmlFor="login-account">
                        <Input id="login-account" size="large" prefix={<UserRound className="size-4 text-white/35" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" required />
                    </AuthField>
                    <AuthField
                        label="密码"
                        htmlFor="login-password"
                        action={
                            <Link
                                to={forgotPasswordURL}
                                className="-my-2 inline-flex min-h-8 items-center rounded-sm text-xs font-medium text-blue-300/80 transition-colors hover:text-blue-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300/45"
                            >
                                忘记密码？
                            </Link>
                        }
                    >
                        <Input.Password
                            id="login-password"
                            size="large"
                            prefix={<LockKeyhole className="size-4 text-white/35" />}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="请输入密码"
                            autoComplete="current-password"
                            required
                        />
                    </AuthField>
                </>
            )}
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                登录
            </Button>
            {linuxdoEnabled ? (
                <>
                    <Divider plain className="!border-white/10 !text-white/30">
                        或
                    </Divider>
                    <Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>
                        使用 Linux.do 登录
                    </Button>
                </>
            ) : null}
        </form>
    );
}

function AuthField({ label, htmlFor, action, children }: { label: string; htmlFor: string; action?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
                <label htmlFor={htmlFor} className="text-xs font-medium text-white/62">
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
