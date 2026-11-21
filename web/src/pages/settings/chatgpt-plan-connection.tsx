import { App, Button, Checkbox, Spin } from "antd";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal";
import { refreshSystemChannels } from "@/lib/user-session";
import { saveChatGPTPlanModels, disconnectChatGPTPlan, getChatGPTPlanStatus, listChatGPTPlanModels, startChatGPTPlanConnection } from "@/services/api/chatgpt-plan";

export function ChatGPTPlanConnection({ userId, authorizationOpen = false, onAuthorizationClose }: { userId: string; authorizationOpen?: boolean; onAuthorizationClose?: () => void }) {
    const { message } = App.useApp();
    const client = useQueryClient();
    const [authorizing, setAuthorizing] = useState(false);
    const [pendingAction, setPendingAction] = useState<"connect" | "save" | "disconnect" | null>(null);
    const busy = pendingAction !== null;
    const [selectionOpen, setSelectionOpen] = useState(false);
    const [selection, setSelection] = useState<string[]>([]);
    const status = useQuery({ queryKey: ["chatgpt-plan", userId], queryFn: ({ signal }) => getChatGPTPlanStatus(signal), refetchInterval: authorizing ? 2000 : false });
    const models = useQuery({ queryKey: ["chatgpt-plan-models", userId], queryFn: ({ signal }) => listChatGPTPlanModels(signal), enabled: Boolean(selectionOpen && status.data?.enabled && status.data.connected) });

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
        onAuthorizationClose?.();
        void refreshSystemChannels().catch((error) => message.error(error instanceof Error ? error.message : "刷新模型失败"));
        message.success("ChatGPT 已连接，请选择要加入的模型");
    }, [authorizing, status.data?.connected, message, onAuthorizationClose]);

    useEffect(() => {
        if (selectionOpen && models.data) setSelection(models.data.models.filter((item) => item.selected).map((item) => item.slug));
    }, [selectionOpen, models.data]);
    useEffect(() => {
        if (status.data && (!status.data.enabled || !status.data.connected)) setSelectionOpen(false);
    }, [status.data?.enabled, status.data?.connected]);
    const connect = async () => {
        const popup = window.open("about:blank", "yingce-chatgpt-plan", "width=720,height=760");
        if (!popup) {
            message.error("请允许弹出窗口后重试");
            return;
        }
        setPendingAction("connect");
        try {
            const result = await startChatGPTPlanConnection();
            popup.location.href = result.authorizationUrl;
            setAuthorizing(true);
        } catch (error) {
            popup.close();
            message.error(error instanceof Error ? error.message : "启动授权失败");
        } finally {
            setPendingAction(null);
        }
    };

    const change = async (action: "save" | "disconnect") => {
        setPendingAction(action);
        try {
            if (action === "disconnect") {
                const result = await disconnectChatGPTPlan();
                client.removeQueries({ queryKey: ["chatgpt-plan-models", userId] });
                setSelection([]);
                setSelectionOpen(false);
                if (result.revocationConfirmed) message.success("ChatGPT 已断开");
                else message.warning("本站凭据已清除；远端撤销未确认，可在 ChatGPT 设置检查连接");
            } else {
                await saveChatGPTPlanModels(selection);
                setSelectionOpen(false);
                await client.invalidateQueries({ queryKey: ["chatgpt-plan-models", userId] });
                message.success("已保存个人渠道模型");
            }
            await status.refetch();
            await refreshSystemChannels();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "更新连接失败");
        } finally {
            setPendingAction(null);
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

    if (!status.data.connected)
        return (
            <AppModal open={authorizationOpen} title="连接 ChatGPT 个人方案" footer={null} onCancel={onAuthorizationClose}>
                <p className="text-sm text-foreground/60">连接自己的 ChatGPT 账号，凭据加密保存在此部署的服务器，授权和额度调用仅供你本人使用。</p>
                <p className="mb-3 text-sm text-foreground/60">当前授权要求浏览器与后端运行在同一台电脑。调用消耗你的 ChatGPT 方案额度，影策收取 0 积分。</p>
                <Button type="primary" loading={pendingAction === "connect" || authorizing} onClick={() => void connect()}>
                    {authorizing ? "等待浏览器授权" : "使用 ChatGPT 登录"}
                </Button>
            </AppModal>
        );
    return (
        <>
            <section className="settings-channel mb-3 p-2 sm:p-3" aria-label="ChatGPT 个人方案渠道">
                <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1 basis-52">
                        <h3 className="text-sm font-semibold">ChatGPT 个人方案</h3>
                        <p className="mt-1 text-xs text-foreground/55">
                            {status.data.email || "ChatGPT 账号"} · 已选择 {status.data.selectedModelSlugs?.length || 0} 个模型 · 仅本人可用
                        </p>
                        <span className={`settings-channel-status mt-2 ${status.data.enabled ? "is-ready" : "is-warning"}`}>
                            <i aria-hidden="true" />
                            {status.data.enabled ? "已授权" : "管理员已关闭此功能，授权暂停使用"}
                        </span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <Button
                            disabled={!status.data.enabled || busy}
                            onClick={() => {
                                setSelection(status.data.selectedModelSlugs || []);
                                setSelectionOpen(true);
                            }}
                        >
                            选择模型
                        </Button>
                        <Button danger loading={pendingAction === "disconnect"} disabled={busy && pendingAction !== "disconnect"} onClick={() => void change("disconnect")}>
                            断开连接
                        </Button>
                    </div>
                </div>
            </section>
            <AppModal
                open={selectionOpen}
                title="选择 ChatGPT 模型"
                okText="保存选择"
                cancelText="取消"
                confirmLoading={pendingAction === "save"}
                okButtonProps={{ disabled: models.isPending || models.isError || models.isFetching }}
                onOk={() => void change("save")}
                onCancel={() => {
                    if (!busy) setSelectionOpen(false);
                }}
            >
                <p className="mb-3 text-sm text-foreground/60">勾选要在「模型选择」中使用的模型，取消勾选后停止提供该模型，历史任务保留。当前已选 {selection.length} 个。</p>
                {models.isPending ? (
                    <Spin size="small" />
                ) : models.isError ? (
                    <div role="alert">
                        无法读取模型目录。<Button onClick={() => void models.refetch()}>重试</Button>
                    </div>
                ) : (
                    <div className="max-h-80 space-y-2 overflow-y-auto" role="group" aria-label="ChatGPT 可用模型">
                        {models.data.models.length === 0 && <p>当前账号暂无可用模型。</p>}
                        {models.data.models.map((item) => (
                            <div key={item.slug} className="rounded-md border border-border p-2">
                                <Checkbox
                                    disabled={busy || models.isFetching || (!item.available && !selection.includes(item.slug))}
                                    checked={selection.includes(item.slug)}
                                    onChange={({ target }) => setSelection((current) => (target.checked ? [...current, item.slug] : current.filter((slug) => slug !== item.slug)))}
                                >
                                    <span>{item.displayName || item.slug}</span>
                                    <span className="ml-2 text-xs text-foreground/55">{item.slug}</span>
                                    {!item.available && <span className="ml-2 text-xs text-foreground/55">当前不可用，请取消勾选</span>}
                                </Checkbox>
                            </div>
                        ))}
                    </div>
                )}
            </AppModal>
        </>
    );
}
