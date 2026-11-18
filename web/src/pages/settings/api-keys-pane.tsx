import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Input } from "antd";
import { Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";

import { createUserAPIKey, listUserAPIKeys, revokeUserAPIKey } from "@/services/api/external-access";
import { useUserStore } from "@/stores/use-user-store";

export function APIKeysPane() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const userId = useUserStore((state) => state.user?.id);
    const queryKey = ["user-api-keys", userId];
    const keys = useQuery({ queryKey, queryFn: ({ signal }) => listUserAPIKeys(signal), enabled: Boolean(userId) });
    const [name, setName] = useState("");
    const [issuedToken, setIssuedToken] = useState("");
    const [pending, setPending] = useState(false);
    const remoteHTTP = window.location.protocol === "http:" && !["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);

    const copyIssuedToken = async () => {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(issuedToken);
                message.success("已复制");
                return;
            } catch {
                // HTTP and browser permissions can reject the modern clipboard API.
            }
        }
        const input = document.createElement("textarea");
        input.value = issuedToken;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.appendChild(input);
        input.select();
        const copied = document.execCommand("copy");
        input.remove();
        if (copied) message.success("已复制");
        else message.warning("浏览器未允许复制，请显示 Key 后手动复制");
    };

    const create = async () => {
        if (!name.trim() || pending) return;
        setPending(true);
        try {
            const issued = await createUserAPIKey(name.trim());
            setIssuedToken(issued.token);
            setName("");
            await queryClient.invalidateQueries({ queryKey });
            message.success("API Key 已创建；请立即复制，关闭后无法再次查看");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建失败");
        } finally {
            setPending(false);
        }
    };

    const revoke = (id: string, name: string) => {
        modal.confirm({
            title: "撤销此授权？",
            content: `“${name}”将立即无法访问影策。授权记录会保留在列表中。`,
            okText: "撤销授权",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                await revokeUserAPIKey(id);
                await queryClient.invalidateQueries({ queryKey });
                message.success("授权已撤销");
            },
        });
    };

    return (
        <div className="settings-section space-y-5">
            <div className="settings-pane-header">
                <div>
                    <h2>API Key 与 MCP 授权</h2>
                    <p>将影策连接到你的 Agent。MCP 地址：{window.location.origin}/api/mcp</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void keys.refetch()}>
                    刷新
                </Button>
            </div>
            {remoteHTTP && <p className="text-sm text-muted-foreground">当前站点使用 HTTP。部分 Agent 会拒绝自动登录授权；可先创建 API Key，在 Agent 中手动配置 Bearer 凭证。</p>}
            <div className="rounded-lg border border-border bg-card p-4">
                <label htmlFor="api-key-name" className="mb-2 block text-sm font-medium">
                    创建 API Key
                </label>
                <div className="flex gap-2">
                    <Input id="api-key-name" value={name} maxLength={100} placeholder="例如：我的创作 Agent" onChange={(event) => setName(event.target.value)} onPressEnter={() => void create()} />
                    <Button type="primary" icon={<Plus className="size-4" />} loading={pending} disabled={!name.trim()} onClick={() => void create()}>
                        创建
                    </Button>
                </div>
                <p className="mt-2 text-xs text-muted-foreground">首次连接远程 MCP 时也可在 Agent 中直接登录授权，无需手动创建 Key。</p>
            </div>
            {issuedToken && (
                <div className="rounded-lg border border-border bg-card p-4">
                    <p className="mb-2 text-sm font-medium">新 Key（仅显示一次）</p>
                    <div className="flex gap-2">
                        <Input.Password readOnly value={issuedToken} visibilityToggle />
                        <Button icon={<Copy className="size-4" />} onClick={() => void copyIssuedToken()}>
                            复制
                        </Button>
                    </div>
                    <Button className="mt-3" onClick={() => setIssuedToken("")}>
                        我已保存
                    </Button>
                </div>
            )}
            <div className="space-y-2">
                {keys.isLoading && <p role="status">正在加载授权…</p>}
                {keys.isError && <p role="alert">授权列表加载失败，请重试。</p>}
                {keys.data?.keys.map((key) => (
                    <div key={key.id} className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4">
                        <div className="flex min-w-0 items-center gap-3">
                            <KeyRound className="size-4 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                                <p className="truncate text-sm font-medium">{key.name}</p>
                                <p className="text-xs text-muted-foreground">
                                    {key.kind === "mcp" ? "MCP 登录授权 · 记录不可删除" : "手动创建"} · {key.prefix}… · {key.revokedAt ? "已撤销" : "有效"}
                                </p>
                            </div>
                        </div>
                        {!key.revokedAt && (
                            <Button danger size="small" onClick={() => revoke(key.id, key.name)}>
                                撤销
                            </Button>
                        )}
                    </div>
                ))}
                {keys.data?.keys.length === 0 && <p className="text-sm text-muted-foreground">暂无 API Key 或 MCP 授权。</p>}
            </div>
        </div>
    );
}
