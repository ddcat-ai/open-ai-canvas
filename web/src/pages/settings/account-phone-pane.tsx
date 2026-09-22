import { App, Button, Input } from "antd";
import { BadgeCheck, ShieldCheck, Smartphone, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { bindPhone, getAuthSession, getAuthSettings, sendBindPhoneSmsCode, unbindPhone } from "@/services/api/auth";
import { ApiError } from "@/services/api/request";
import { useUserStore } from "@/stores/use-user-store";

/**
 * 「账号与手机号」面板。
 *
 * 老用户（邮箱注册的）在这里补绑手机号；绑过之后可以解绑。
 * ⚠️ 号码在服务端是 **E.164**（`+8613800138000`），这里只做展示与输入，规整由后端归一化。
 */
export default function AccountPhonePane() {
    const { message, modal } = App.useApp();
    const user = useUserStore((state) => state.user);
    const [smsEnabled, setSmsEnabled] = useState<boolean | null>(null);
    const [phone, setPhone] = useState("");
    const [code, setCode] = useState("");
    const [countdown, setCountdown] = useState(0);
    const [sending, setSending] = useState(false);
    const [binding, setBinding] = useState(false);
    const sendingRef = useRef(false);

    useEffect(() => {
        let cancelled = false;
        void getAuthSettings()
            .then((settings) => !cancelled && setSmsEnabled(Boolean(settings.smsEnabled)))
            .catch(() => !cancelled && setSmsEnabled(false));
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (countdown <= 0) return;
        const timer = window.setInterval(() => setCountdown((value) => Math.max(0, value - 1)), 1000);
        return () => window.clearInterval(timer);
    }, [countdown]);

    /** 绑定/解绑之后要让会话里的 user 反映最新手机号（`/auth/session` 才是权威）。 */
    const refreshSession = async () => {
        const { applyUserSession } = await import("@/lib/user-session");
        await applyUserSession(await getAuthSession());
    };

    const sendCode = async () => {
        if (sendingRef.current || countdown > 0) return;
        if (!phone.trim()) {
            message.warning("请先输入手机号");
            return;
        }
        sendingRef.current = true;
        setSending(true);
        try {
            await sendBindPhoneSmsCode(phone.trim());
            setCountdown(60);
            message.success("验证码已发送，请查看短信");
        } catch (error) {
            if (error instanceof ApiError && error.status === 429) setCountdown(Math.max(1, Math.ceil((error.retryAfterMs ?? 60000) / 1000)));
            message.error(error instanceof Error ? error.message : "发送验证码失败");
        } finally {
            sendingRef.current = false;
            setSending(false);
        }
    };

    const submitBind = async () => {
        setBinding(true);
        try {
            await bindPhone({ phone: phone.trim(), smsCode: code.trim() });
            await refreshSession();
            setPhone("");
            setCode("");
            setCountdown(0);
            message.success("手机号已绑定");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "绑定失败");
        } finally {
            setBinding(false);
        }
    };

    const confirmUnbind = () => {
        modal.confirm({
            title: "解绑手机号？",
            content: "解绑后将无法用短信找回密码，需要重新绑定才能恢复。",
            okText: "解绑",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await unbindPhone();
                    await refreshSession();
                    message.success("已解绑手机号");
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "解绑失败");
                }
            },
        });
    };

    const boundPhone = (user?.phone || "").trim();

    return (
        <div className="settings-section">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>账号与手机号</h2>
                    <p>绑定手机号后可用于短信验证码找回密码；邮箱注册的账号也可以在这里补绑。</p>
                </div>
            </div>

            {smsEnabled === false ? (
                <div className="flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[var(--fs-caption)] text-amber-700 dark:text-amber-300">
                    <TriangleAlert className="size-4 shrink-0" />
                    <span>管理员尚未启用短信服务，暂时无法绑定手机号。</span>
                </div>
            ) : null}

            {boundPhone ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border/70 bg-surface px-4 py-3">
                    <BadgeCheck className="size-4 text-emerald-500" />
                    <span className="text-[var(--fs-label)] font-medium">已绑定：{boundPhone}</span>
                    <Button className="ml-auto" danger onClick={confirmUnbind}>
                        解绑
                    </Button>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[var(--fs-caption)] text-foreground/62">手机号</span>
                        <Input
                            size="large"
                            prefix={<Smartphone className="size-4 text-foreground/35" />}
                            value={phone}
                            onChange={(event) => setPhone(event.target.value.replace(/[^0-9+]/g, "").slice(0, 20))}
                            placeholder="请输入要绑定的手机号"
                            inputMode="tel"
                            autoComplete="tel"
                            disabled={smsEnabled === false}
                        />
                    </label>
                    <label className="flex flex-col gap-1.5">
                        <span className="text-[var(--fs-caption)] text-foreground/62">短信验证码</span>
                        <div className="grid grid-cols-[minmax(0,1fr)_116px] gap-2">
                            <Input
                                size="large"
                                prefix={<ShieldCheck className="size-4 text-foreground/35" />}
                                value={code}
                                onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                                placeholder="6 位验证码"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                disabled={smsEnabled === false}
                            />
                            <Button size="large" loading={sending} disabled={smsEnabled === false || countdown > 0} onClick={() => void sendCode()}>
                                {countdown > 0 ? `${countdown}s` : "获取验证码"}
                            </Button>
                        </div>
                    </label>
                    <div>
                        <Button type="primary" size="large" loading={binding} disabled={smsEnabled === false || !phone.trim() || code.trim().length !== 6} onClick={() => void submitBind()}>
                            绑定手机号
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
