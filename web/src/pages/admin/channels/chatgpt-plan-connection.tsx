import { App, Button, Spin } from "antd";
import { useEffect, useState } from "react";
import { Select } from "@/components/ui/base/select";
import { addChatGPTPlanModel, disconnectChatGPTPlan, getChatGPTPlanStatus, listChatGPTPlanModels, startChatGPTPlanConnection, type ChatGPTPlanModel, type ChatGPTPlanStatus } from "@/services/api/chatgpt-plan";

export function ChatGPTPlanConnection({ onChanged }: { onChanged: () => Promise<void> }) {
    const { message } = App.useApp();
    const [status, setStatus] = useState<ChatGPTPlanStatus | null>(null);
    const [models, setModels] = useState<ChatGPTPlanModel[]>([]);
    const [slug, setSlug] = useState("");
    const [authorizing, setAuthorizing] = useState(false);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        void getChatGPTPlanStatus()
            .then(setStatus)
            .catch(() => setStatus({ connected: false }));
    }, []);

    useEffect(() => {
        if (!authorizing) return;
        const timer = window.setInterval(() => {
            void getChatGPTPlanStatus().then(async (next) => {
                if (!next.connected) return;
                setStatus(next);
                setAuthorizing(false);
                await onChanged();
                message.success("ChatGPT 已连接，请选择要使用的模型");
            });
        }, 2000);
        const timeout = window.setTimeout(() => setAuthorizing(false), 10 * 60 * 1000);
        return () => {
            window.clearInterval(timer);
            window.clearTimeout(timeout);
        };
    }, [authorizing, message, onChanged]);

    useEffect(() => {
        if (!status?.connected) return;
        void listChatGPTPlanModels()
            .then(({ models: items }) => {
                setModels(items);
                setSlug((current) => current || items[0]?.slug || "");
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "无法读取 ChatGPT 模型目录"));
    }, [status?.connected, message]);

    const connect = async () => {
        const popup = window.open("about:blank", "yingce-chatgpt-plan", "width=720,height=760");
        setBusy(true);
        try {
            const { authorizationUrl } = await startChatGPTPlanConnection();
            if (popup) popup.location.href = authorizationUrl;
            else window.location.href = authorizationUrl;
            setAuthorizing(true);
        } catch (error) {
            popup?.close();
            message.error(error instanceof Error ? error.message : "无法启动 ChatGPT 授权");
        } finally {
            setBusy(false);
        }
    };

    const addModel = async () => {
        if (!slug) return;
        setBusy(true);
        try {
            await addChatGPTPlanModel(slug);
            await onChanged();
            message.success(`已加入 ${slug}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加模型失败");
        } finally {
            setBusy(false);
        }
    };

    const disconnect = async () => {
        setBusy(true);
        try {
            const result = await disconnectChatGPTPlan();
            setStatus({ connected: false });
            setModels([]);
            setSlug("");
            await onChanged();
            if (result.revocationConfirmed) message.success("ChatGPT 已断开");
            else message.warning("本机连接已清除；远端撤销未确认，可在 ChatGPT 设置中断开影策");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "断开连接失败");
        } finally {
            setBusy(false);
        }
    };

    return (
        <section className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-background p-3" aria-label="ChatGPT 方案渠道">
            <span className="text-sm font-medium">ChatGPT 方案渠道</span>
            {status === null ? (
                <Spin size="small" />
            ) : status.connected ? (
                <span className="text-xs text-foreground/60">已连接 {status.email || "ChatGPT 账号"}，仅你本人可用</span>
            ) : (
                <span className="text-xs text-foreground/60">用你的 ChatGPT/Codex 方案额度，需先授权</span>
            )}
            {!status?.connected && (
                <Button size="small" loading={busy || authorizing} onClick={() => void connect()}>
                    {authorizing ? "等待浏览器授权" : "使用 ChatGPT 登录"}
                </Button>
            )}
            {status?.connected && (
                <>
                    <Select aria-label="选择 ChatGPT 模型" value={slug} onChange={setSlug} options={models.map((item) => ({ label: item.displayName || item.slug, value: item.slug }))} />
                    <Button size="small" type="primary" loading={busy} disabled={!slug} onClick={() => void addModel()}>
                        加入这个模型
                    </Button>
                    <Button size="small" danger loading={busy} onClick={() => void disconnect()}>
                        断开
                    </Button>
                </>
            )}
        </section>
    );
}
