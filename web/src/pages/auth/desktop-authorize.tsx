import { useEffect, useState } from "react";
import { Button, Result } from "antd";
import { useLocation, useNavigate } from "react-router";

import { authPageURL } from "@/lib/auth-entry";
import { getAuthSession, logout as logoutAuthSession, type LocalUser } from "@/services/api/auth";
import { desktopAuthorizationCallback, desktopAuthorizationCancelCallback, issueDesktopAuthorizationCode, parseDesktopAuthorizationRequest, type DesktopAuthorizationRequest } from "@/services/api/desktop-auth";

export default function DesktopAuthorizePage() {
    const location = useLocation();
    const navigate = useNavigate();
    const [request, setRequest] = useState<DesktopAuthorizationRequest | null>(null);
    const [user, setUser] = useState<LocalUser | null>(null);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const returnPath = `${location.pathname}${location.search}`;

    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const parsed = parseDesktopAuthorizationRequest(location.search);
                const session = await getAuthSession({ refresh: true });
                if (cancelled) return;
                if (!session.user) {
                    navigate(authPageURL("login", returnPath), { replace: true });
                    return;
                }
                setRequest(parsed);
                setUser(session.user);
            } catch (cause) {
                if (!cancelled) setError(cause instanceof Error ? cause.message : "桌面授权失败，请返回 PeekReel Lite 重试。");
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [location.search, navigate, returnPath]);

    async function authorize() {
        if (!request || submitting) return;
        setSubmitting(true);
        setError("");
        try {
            const currentSession = await getAuthSession({ refresh: true });
            if (!currentSession.user) {
                navigate(authPageURL("login", returnPath), { replace: true });
                return;
            }
            if (!user) {
                setUser(currentSession.user);
                throw new Error("授权页账号状态已刷新，请核对账号后再次授权。");
            }
            if (currentSession.user.id !== user.id) {
                setUser(currentSession.user);
                const currentName = currentSession.user.displayName || currentSession.user.username;
                throw new Error(`浏览器中的影策账号已切换为“${currentName}”。请核对后重新授权。`);
            }
            const authorization = await issueDesktopAuthorizationCode(request);
            if (!authorization.code || !Number.isInteger(authorization.expiresIn) || authorization.expiresIn <= 0) {
                throw new Error("授权服务没有返回有效授权码");
            }
            window.location.replace(desktopAuthorizationCallback(request.redirectUri, authorization.code, request.state));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "桌面授权失败，请返回 PeekReel Lite 重试。");
            setSubmitting(false);
        }
    }

    function cancel() {
        if (!request) return;
        window.location.replace(desktopAuthorizationCancelCallback(request.redirectUri, request.state));
    }

    async function switchAccount() {
        if (submitting) return;
        setSubmitting(true);
        setError("");
        try {
            await logoutAuthSession();
            navigate(authPageURL("login", returnPath), { replace: true });
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "切换账号失败，请稍后重试。");
            setSubmitting(false);
        }
    }

    if (error) {
        return (
            <Result
                status="error"
                title="无法完成桌面登录"
                subTitle={error}
                extra={[
                    <Button key="retry" type="primary" onClick={() => window.location.reload()}>
                        重试
                    </Button>,
                    <Button key="login" onClick={() => navigate(authPageURL("login", returnPath), { replace: true })}>
                        登录影策账号
                    </Button>,
                    request ? (
                        <Button key="cancel" onClick={cancel}>
                            取消并返回 PeekReel Lite
                        </Button>
                    ) : null,
                ]}
            />
        );
    }
    if (loading) return <Result status="info" title="正在检查影策会话" subTitle="请稍候…" />;
    if (!request || !user) return <Result status="error" title="桌面登录请求无效" subTitle="请返回 PeekReel Lite 重新发起登录。" />;

    const accountName = user.displayName || user.username;
    return (
        <Result
            status="info"
            title="允许 PeekReel Lite 登录吗？"
            subTitle={
                <span>
                    当前影策账号：<strong>{accountName}</strong>
                    {user.email ? (
                        <>
                            <br />
                            {user.email}
                        </>
                    ) : null}
                </span>
            }
            extra={[
                <Button key="authorize" type="primary" loading={submitting} onClick={() => void authorize()}>
                    授权并返回 PeekReel Lite
                </Button>,
                <Button key="switch" disabled={submitting} onClick={() => void switchAccount()}>
                    切换影策账号
                </Button>,
                <Button key="cancel" disabled={submitting} onClick={cancel}>
                    取消
                </Button>,
            ]}
        />
    );
}
