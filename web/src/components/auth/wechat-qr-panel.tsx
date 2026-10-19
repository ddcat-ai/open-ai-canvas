import { useCallback, useEffect, useRef, useState } from "react";
import { App, Button, Skeleton } from "antd";
import { RefreshCw } from "lucide-react";

import { applyUserSession } from "@/lib/user-session";
import { getAuthSession, getWeChatQRCode, pollWeChatLoginStatus } from "@/services/api/auth";

type Props = {
    next: string;
    acceptedTerms?: boolean;
    onSuccess: (next: string) => void;
};

type Phase = "loading" | "ready" | "expired" | "error";

// 轮询间隔。微信事件通常 1–2 秒内到达，2 秒足够且不会给后端造成压力。
const POLL_INTERVAL_MS = 2000;
// 连续失败次数上限，超过后停止轮询并提示，避免无限重试打爆日志。
const MAX_POLL_FAILURES = 3;

/**
 * 微信服务号「关注即登录」二维码面板。
 *
 * 交互：挂载时生成二维码 → 每 2 秒轮询确认态 → 确认后建立会话并跳转。
 * 注意：组件卸载必须停掉定时器，否则用户切走后仍会一直请求后端。
 */
export function WeChatQRPanel({ next, acceptedTerms, onSuccess }: Props) {
    const { message } = App.useApp();
    const [phase, setPhase] = useState<Phase>("loading");
    const [qrCodeUrl, setQrCodeUrl] = useState("");
    const [loginToken, setLoginToken] = useState("");
    const [errorText, setErrorText] = useState("");
    const timerRef = useRef<number | null>(null);
    const failuresRef = useRef(0);
    const cancelledRef = useRef(false);

    const stopPolling = useCallback(() => {
        if (timerRef.current !== null) {
            window.clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const requestQRCode = useCallback(async () => {
        stopPolling();
        failuresRef.current = 0;
        setPhase("loading");
        setErrorText("");
        try {
            const code = await getWeChatQRCode(next, acceptedTerms);
            if (cancelledRef.current) return;
            setQrCodeUrl(code.qrCodeUrl);
            setLoginToken(code.loginToken);
            setPhase("ready");
        } catch (error) {
            if (cancelledRef.current) return;
            // 未启用或未配置时后端返回 403，这里直接展示原因，不重试。
            setErrorText(error instanceof Error ? error.message : "获取微信二维码失败");
            setPhase("error");
        }
    }, [next, acceptedTerms, stopPolling]);

    // 生成二维码
    useEffect(() => {
        cancelledRef.current = false;
        void requestQRCode();
        return () => {
            cancelledRef.current = true;
            stopPolling();
        };
    }, [requestQRCode, stopPolling]);

    // 轮询确认态
    useEffect(() => {
        if (phase !== "ready" || !loginToken) return;
        timerRef.current = window.setInterval(() => {
            void (async () => {
                try {
                    const status = await pollWeChatLoginStatus(loginToken);
                    if (cancelledRef.current) return;
                    failuresRef.current = 0;
                    if (status.status === "expired") {
                        stopPolling();
                        setPhase("expired");
                        return;
                    }
                    if (status.status !== "confirmed") return;
                    stopPolling();
                    // 会话 Cookie 已由后端在轮询响应里下发，这里拉一次完整会话
                    // 以填充模型目录、运行时限制等依赖项。
                    await applyUserSession(await getAuthSession());
                    message.success("登录成功");
                    onSuccess(status.next || next);
                } catch (error) {
                    if (cancelledRef.current) return;
                    failuresRef.current += 1;
                    if (failuresRef.current >= MAX_POLL_FAILURES) {
                        stopPolling();
                        setErrorText(error instanceof Error ? error.message : "登录状态查询失败");
                        setPhase("error");
                    }
                }
            })();
        }, POLL_INTERVAL_MS);
        return stopPolling;
    }, [phase, loginToken, next, onSuccess, message, stopPolling]);

    // 标签页切到后台时暂停轮询，回来再恢复，避免无意义的请求。
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === "hidden") stopPolling();
            else if (phase === "ready" && loginToken && timerRef.current === null) {
                // 重新进入时立即查一次，拿到期间可能发生的确认。
                void (async () => {
                    try {
                        const status = await pollWeChatLoginStatus(loginToken);
                        if (cancelledRef.current) return;
                        if (status.status === "expired") {
                            setPhase("expired");
                            return;
                        }
                        if (status.status === "confirmed") {
                            await applyUserSession(await getAuthSession());
                            message.success("登录成功");
                            onSuccess(status.next || next);
                        }
                    } catch {
                        // 恢复时的失败交给下一轮定时器处理。
                    }
                })();
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [phase, loginToken, next, onSuccess, message, stopPolling]);

    if (phase === "loading") {
        return (
            <div className="flex flex-col items-center gap-3 py-4">
                <Skeleton.Node active style={{ width: 160, height: 160, borderRadius: 12 }} />
                <span className="auth-scene-hint text-xs">正在生成二维码…</span>
            </div>
        );
    }

    if (phase === "error") {
        return (
            <div className="flex flex-col items-center gap-3 py-4">
                <p className="auth-scene-hint text-center text-xs leading-5">{errorText || "微信登录暂不可用"}</p>
                <Button size="small" icon={<RefreshCw className="size-3.5" />} onClick={() => void requestQRCode()}>
                    重试
                </Button>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center gap-3">
            <div className="relative size-40 overflow-hidden rounded-xl bg-white">
                {qrCodeUrl ? <img src={qrCodeUrl} alt="微信登录二维码" className="size-40 object-contain" /> : null}
                {phase === "expired" ? (
                    <button
                        type="button"
                        onClick={() => void requestQRCode()}
                        className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-xs text-white"
                    >
                        <RefreshCw className="size-5" />
                        二维码已过期
                        <span className="text-white/70">点击刷新</span>
                    </button>
                ) : null}
            </div>
            <p className="auth-scene-hint text-center text-xs leading-5">扫码关注服务号后登录</p>
        </div>
    );
}
