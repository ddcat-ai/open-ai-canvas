import { App, Button } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Select } from "@/components/ui/base/select";
import { refreshSystemChannels } from "@/lib/user-session";
import { addChatGPTPlanModel, disconnectChatGPTPlan, getChatGPTPlanStatus, listChatGPTPlanModels, startChatGPTPlanConnection } from "@/services/api/chatgpt-plan";

export function ChatGPTPlanConnection({ userId }: { userId: string }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [authorizing, setAuthorizing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [slug, setSlug] = useState("");
    const status = useQuery({ queryKey: ["chatgpt-plan", userId], queryFn: ({ signal }) => getChatGPTPlanStatus(signal), refetchInterval: authorizing ? 2000 : false });
    const models = useQuery({ queryKey: ["chatgpt-plan-models", userId], queryFn: ({ signal }) => listChatGPTPlanModels(signal), enabled: Boolean(status.data?.enabled && status.data.connected) });
    const selected = models.data?.models.some((item) => item.slug === slug) ? slug : models.data?.models[0]?.slug || "";

    useEffect(() => {
        if (!authorizing) return;
        const timer = window.setTimeout(
            () => {
                setAuthorizing(false);
                message.info("授权等待已结束，可重新连接");
            },
            10 * 60 * 1000,
        );
        return () => window.clearTimeout(timer);
    }, [authorizing, message]);

    useEffect(() => {
        if (!authorizing || !status.data?.connected) return;
        setAuthorizing(false);
        void refreshSystemChannels().catch((error) => message.error(error instanceof Error ? error.message : "刷新模型失败"));
        message.success("ChatGPT 已连接，请选择要加入的模型");
    }, [authorizing, status.data?.connected, message]);

    const connect = async () => {
        const popup = window.open("about:blank", "yingce-chatgpt-plan", "width=720,height=760");
        if (!popup) {
            message.error("请允许弹出窗口后重试");
            return;
        }
        setBusy(true);
        try {
            const result = await startChatGPTPlanConnection();
            popup.location.href = result.authorizationUrl;
            setAuthorizing(true);
        } catch (error) {
            popup.close();
            message.error(error instanceof Error ? error.message : "启动授权失败");
        } finally {
            setBusy(false);
        }
    };

    const change = async (disconnect: boolean) => {
        setBusy(true);
        try {
            if (disconnect) {
                const result = await disconnectChatGPTPlan();
                client.removeQueries({ queryKey: ["chatgpt-plan-models", userId] });
                setSlug("");
                if (result.revocationConfirmed) message.success("ChatGPT 已断开");
                else message.warning("本站凭据已清除；远端撤销未确认，可在 ChatGPT 设置检查连接");
            } else {
                await addChatGPTPlanModel(selected);
                message.success(`已加入 ${selected}`);
            }
            await status.refetch();
            await refreshSystemChannels();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新连接失败");
        } finally {
            setBusy(false);
        }
    };

    if (status.isPending) return <span role="status">正在读取个人模型授权…</span>;
    if (status.isError)
        return (
            <div role="alert">
                无法读取个人模型授权。<Button onClick={() => void status.refetch()}>重试</Button>
            </div>
        );
    if (!status.data.enabled && !status.data.connected) return null;

    return (
        <section className="settings-section" aria-label="ChatGPT 个人方案授权">
            <h3>ChatGPT 个人方案</h3>
            <p className="text-sm text-foreground/60">连接自己的 ChatGPT 账号，授权和额度调用仅供你本人使用。凭据加密保存在此部署的服务器，由服务器代为调用。</p>
            <p className="text-sm text-foreground/60">当前授权要求浏览器与影策后端运行在同一台电脑。模型调用消耗你的 ChatGPT 方案额度，影策收取 0 积分。</p>
            {!status.data.enabled && <p role="status">管理员已关闭此功能，现有授权暂停使用，你仍可断开连接。</p>}
            <div className="flex flex-wrap items-center gap-2">
                {status.data.connected ? (
                    <>
                        <span>已连接 {status.data.email || "ChatGPT 账号"}</span>
                        {status.data.enabled && (
                            <>
                                <Select aria-label="选择 ChatGPT 模型" value={selected} onChange={setSlug} options={(models.data?.models || []).map((item) => ({ label: item.displayName || item.slug, value: item.slug }))} />
                                <Button type="primary" loading={busy} disabled={!selected || models.isError} onClick={() => void change(false)}>
                                    加入这个模型
                                </Button>
                            </>
                        )}
                        <Button danger loading={busy} onClick={() => void change(true)}>
                            断开连接
                        </Button>
                    </>
                ) : (
                    <Button loading={busy || authorizing} onClick={() => void connect()}>
                        {authorizing ? "等待浏览器授权" : "使用 ChatGPT 登录"}
                    </Button>
                )}
            </div>
            {models.isError && status.data.enabled && (
                <p role="alert">
                    无法读取 ChatGPT 模型目录。<Button onClick={() => void models.refetch()}>重试</Button>
                </p>
            )}
        </section>
    );
}
