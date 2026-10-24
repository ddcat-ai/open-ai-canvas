import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Spin } from "antd";
import { Check, Copy, QrCode, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router";

import { getAuthSession, getWechatQRTicket, getWechatTicketStatus, type WechatQRTicketData } from "@/services/api/auth";

export function WechatQRLogin({ next = "/" }: { next?: string }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [ticketData, setTicketData] = useState<WechatQRTicketData | null>(null);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<"pending" | "scanned" | "confirmed" | "failed" | "expired">("pending");
    const [errorMessage, setErrorMessage] = useState("");
    const [copied, setCopied] = useState(false);
    const [viewMode, setViewMode] = useState<"qr" | "manual">("qr");
    const timerRef = useRef<number | null>(null);

    const navRef = useRef({ next, navigate });
    useEffect(() => {
        navRef.current = { next, navigate };
    }, [next, navigate]);

    const loadTicket = useCallback(async () => {
        setLoading(true);
        setStatus("pending");
        setErrorMessage("");
        try {
            const data = await getWechatQRTicket("login");
            setTicketData(data);
        } catch (err) {
            setErrorMessage(err instanceof Error ? err.message : "获取微信登录二维码失败");
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void loadTicket();
    }, [loadTicket]);

    // 轮询票据状态
    useEffect(() => {
        const ticketId = ticketData?.ticket;
        if (!ticketId || status === "confirmed" || status === "expired" || status === "failed") {
            return;
        }

        let cancelled = false;

        const poll = async () => {
            if (cancelled) return;
            try {
                const res = await getWechatTicketStatus(ticketId);
                if (cancelled) return;
                if (res.status === "confirmed") {
                    cancelled = true;
                    setStatus("confirmed");
                    const { applyUserSession } = await import("@/lib/user-session");
                    await applyUserSession(await getAuthSession());
                    message.success("微信登录成功！");
                    navRef.current.navigate(navRef.current.next, { replace: true });
                } else if (res.status === "expired") {
                    cancelled = true;
                    setStatus("expired");
                } else if (res.status === "failed") {
                    cancelled = true;
                    setStatus("failed");
                    setErrorMessage(res.error || "授权失败");
                } else if (res.status === "scanned") {
                    setStatus("scanned");
                }
            } catch {
                // 网络偶发波动，继续轮询
            }
        };

        const timer = window.setInterval(poll, 1500);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
        };
    }, [ticketData?.ticket, status, message]);

    const handleCopyCode = async () => {
        if (!ticketData?.code) return;
        try {
            await navigator.clipboard.writeText(ticketData.code);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
            message.success("登录码已复制");
        } catch {
            message.error("复制失败");
        }
    };

    if (loading) {
        return (
            <div className="flex h-64 flex-col items-center justify-center gap-3">
                <Spin size="large" />
                <span className="text-xs text-muted-foreground">正在生成微信登录码…</span>
            </div>
        );
    }

    if (errorMessage && !ticketData) {
        return (
            <div className="flex h-64 flex-col items-center justify-center gap-3 text-center">
                <span className="text-xs text-red-500">{errorMessage}</span>
                <Button icon={<RefreshCw className="size-3.5" />} onClick={() => void loadTicket()}>
                    重新获取
                </Button>
            </div>
        );
    }

    const showQR = !ticketData?.manual && Boolean(ticketData?.qrImage) && viewMode === "qr";

    return (
        <div className="flex flex-col items-center justify-center gap-4 py-2">
            {showQR ? (
                /* 真码模式：直接展示微信官方小程序码 */
                <div className="relative flex size-52 items-center justify-center overflow-hidden rounded-2xl border border-border bg-white p-2 shadow-sm">
                    <img src={ticketData?.qrImage} alt="微信扫码登录" className="size-full object-contain" />
                    {status === "expired" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 p-4 text-center text-white backdrop-blur-sm">
                            <span className="text-xs font-medium">二维码已过期</span>
                            <Button size="small" type="primary" icon={<RefreshCw className="size-3" />} onClick={() => void loadTicket()}>
                                点击刷新
                            </Button>
                        </div>
                    )}
                    {status === "scanned" && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-emerald-950/80 p-4 text-center text-white backdrop-blur-sm">
                            <Check className="size-8 text-emerald-400" />
                            <span className="text-xs font-medium">已扫码，请在手机上确认</span>
                        </div>
                    )}
                </div>
            ) : (
                /* 6位验证码输入模式（备用/联调） */
                <div className="flex flex-col items-center gap-3">
                    <span className="text-xs font-medium text-foreground">
                        微信打开小程序，输入 6 位登录码：
                    </span>
                    <div className="flex items-center gap-2">
                        <div className="rounded-xl border border-dashed border-emerald-500/40 bg-emerald-500/10 px-5 py-3 font-mono text-2xl font-bold tracking-widest text-emerald-600 dark:text-emerald-400">
                            {ticketData?.code}
                        </div>
                        <Button
                            icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
                            onClick={() => void handleCopyCode()}
                        >
                            {copied ? "已复制" : "复制"}
                        </Button>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                        在小程序中输入上方登录码并点击确认，网页将自动登录
                    </span>
                </div>
            )}

            {status === "pending" && (
                <div className="flex flex-col items-center gap-1.5 text-center">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <QrCode className="size-3.5" />
                        <span>微信扫一扫，在手机上点击确认即可登录</span>
                    </div>
                    {ticketData?.qrImage && !ticketData?.manual && (
                        <button
                            type="button"
                            className="text-[11px] text-muted-foreground/80 underline decoration-dotted transition-colors hover:text-foreground"
                            onClick={() => setViewMode(viewMode === "qr" ? "manual" : "qr")}
                        >
                            {viewMode === "qr" ? "无法扫码？切换为 6 位登录码" : "返回小程序码扫码"}
                        </button>
                    )}
                </div>
            )}
        </div>
    );
}
