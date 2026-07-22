import { type FormEvent, useEffect, useState, type ReactNode } from "react";
import { App, Button, Divider, Input } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { applyUserSession } from "@/lib/user-session";
import { getAuthSession, getAuthSettings, linuxDOLoginURL, login } from "@/services/api/auth";
import { LinuxDOIcon } from "./auth-scene";

export default function LoginPage() {
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);
    const [linuxdoEnabled, setLinuxdoEnabled] = useState(false);
    const next = safeNext(params.get("next"));

    useEffect(() => {
        void getAuthSettings().then((settings) => setLinuxdoEnabled(settings.linuxdoEnabled)).catch(() => undefined);
        const oauthError = params.get("oauth_error");
        if (oauthError) message.error(oauthError);
    }, [message, params]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        setSubmitting(true);
        try {
            await login({ username, password });
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
            <AuthField label="用户名 / 邮箱"><Input size="large" prefix={<UserRound className="size-4 text-white/35" />} value={username} onChange={(event) => setUsername(event.target.value)} placeholder="用户名或邮箱" autoComplete="username" required /></AuthField>
            <AuthField label="密码"><Input.Password size="large" prefix={<LockKeyhole className="size-4 text-white/35" />} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" autoComplete="current-password" required /></AuthField>
            <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPosition="end">登录</Button>
            {linuxdoEnabled ? <><Divider plain className="!border-white/10 !text-white/30">或</Divider><Button size="large" block icon={<LinuxDOIcon />} href={linuxDOLoginURL(next)}>使用 Linux.do 登录</Button></> : null}
        </form>
    );
}

function AuthField({ label, children }: { label: string; children: ReactNode }) {
    return <label className="block space-y-2"><span className="text-xs font-medium text-white/62">{label}</span>{children}</label>;
}

function safeNext(value: string | null) {
    if (!value || !value.startsWith("/") || value.startsWith("//")) return "/canvas";
    return value;
}
