import { useEffect, useState, type FormEvent } from "react";
import { App, Button, Input } from "antd";
import { ArrowRight, LockKeyhole, UserRound } from "lucide-react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { getAuthSession, login } from "@/services/api/auth";

export function CreationLoginDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
    const { message } = App.useApp();
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        if (!open) {
            setUsername("");
            setPassword("");
            setSubmitting(false);
        }
    }, [open]);

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (submitting) return;
        setSubmitting(true);
        try {
            await login({ username: username.trim(), password });
            const { applyUserSession } = await import("@/lib/user-session");
            await applyUserSession(await getAuthSession());
            message.success("登录成功，请再次点击生成");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "登录失败");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <AppModal open={open} onCancel={onClose} title="登录后开始创作" footer={null} centered width="min(440px, calc(100vw - 32px))">
            <div className="space-y-4">
                <p className="text-sm text-foreground/60">你的创作内容会保留。登录成功后，请再次点击生成。</p>
                <form className="space-y-3" onSubmit={(event) => void submit(event)}>
                    <Input
                        size="large"
                        aria-label="用户名或邮箱"
                        prefix={<UserRound className="size-4 text-foreground/40" />}
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        placeholder="用户名或邮箱"
                        autoComplete="username"
                        required
                    />
                    <Input.Password
                        size="large"
                        aria-label="密码"
                        prefix={<LockKeyhole className="size-4 text-foreground/40" />}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        placeholder="密码"
                        autoComplete="current-password"
                        required
                    />
                    <Button type="primary" htmlType="submit" size="large" block loading={submitting} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                        登录并继续
                    </Button>
                </form>
                <p className="text-center text-xs text-foreground/55">还没有账号？ <Link className="text-primary hover:underline" to="/register?next=%2F" onClick={onClose}>注册</Link></p>
            </div>
        </AppModal>
    );
}
