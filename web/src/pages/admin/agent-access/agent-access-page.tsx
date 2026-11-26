import { App, Alert, Button, Input, InputNumber, Popconfirm, Space, Tag, Typography } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";
import { useUserStore } from "@/stores/use-user-store";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminModal } from "../ui/overlays";
import { Checkbox } from "../ui/controls";
import { assistantInstallInstructions } from "./install-instructions";
import { AssistantConsentCard } from "./assistant-consent-card";
import {
    authorizeAssistant,
    confirmAssistantCall,
    createAssistantToken,
    getAssistantCall,
    getAssistantConsent,
    getAssistantSetup,
    getAssistantSkillRelease,
    listAssistantCalls,
    listAssistantGrants,
    listAssistantTokens,
    revokeAssistantGrant,
    revokeAssistantToken,
    type AssistantCall,
} from "@/services/api/admin-assistant";

const timeLabel = (value: string) => new Date(value).toLocaleString();
const errorLabel = (error: unknown) => (error instanceof Error ? error.message : "请求失败");

export default function AgentAccessPage() {
    const actorId = useUserStore((s) => s.user?.id);
    const { pathname, search } = useLocation();
    const consentMode = pathname.endsWith("/authorize");
    const confirmationId = new URLSearchParams(search).get("confirmation") || "";
    const cache = useQueryClient();
    const { message } = App.useApp();
    const key = ["admin-assistant", actorId];
    const setup = useQuery({ queryKey: [...key, "setup"], queryFn: getAssistantSetup });
    const release = useQuery({ queryKey: [...key, "skill"], queryFn: getAssistantSkillRelease });
    const [tokenPage, setTokenPage] = useState(1);
    const [grantPage, setGrantPage] = useState(1);
    const tokens = useQuery({ queryKey: [...key, "tokens", tokenPage], queryFn: () => listAssistantTokens(tokenPage), enabled: !consentMode });
    const grants = useQuery({ queryKey: [...key, "grants", grantPage], queryFn: () => listAssistantGrants(grantPage), enabled: !consentMode });
    const [page, setPage] = useState(1);
    const calls = useQuery({ queryKey: [...key, "calls", page], queryFn: () => listAssistantCalls(page), enabled: !consentMode });
    const focused = useQuery({ queryKey: [...key, "call", confirmationId], queryFn: () => getAssistantCall(confirmationId), enabled: Boolean(confirmationId) && !consentMode });
    const consent = useQuery({ queryKey: [...key, "consent", search], queryFn: () => getAssistantConsent(search.slice(1)), enabled: consentMode, retry: false });
    const [creating, setCreating] = useState(false);
    const [name, setName] = useState("");
    const [days, setDays] = useState(30);
    const [scopes, setScopes] = useState<string[]>([]);
    const [secret, setSecret] = useState("");
    const [preview, setPreview] = useState<AssistantCall | null>(null);
    const [busy, setBusy] = useState(false);
    const openedConfirmation = useRef("");
    useEffect(() => {
        const target = `${actorId}:${confirmationId}`;
        if (focused.data?.id === confirmationId && openedConfirmation.current !== target) {
            openedConfirmation.current = target;
            setPreview(focused.data);
        }
    }, [actorId, confirmationId, focused.data]);
    useEffect(() => {
        setSecret("");
        setCreating(false);
        setPreview(null);
        setTokenPage(1);
        setGrantPage(1);
        setPage(1);
    }, [actorId]);
    const refresh = () => cache.invalidateQueries({ queryKey: key });
    const create = useMutation({
        mutationFn: () => createAssistantToken({ name, days, scopes }),
        onSuccess: (data) => {
            if (useUserStore.getState().user?.id !== actorId) return;
            setSecret(data.token);
            setCreating(false);
            setName("");
            setTokenPage(1);
            void refresh();
        },
        onError: (error) => void message.error(errorLabel(error)),
    });
    async function act(action: () => Promise<unknown>) {
        setBusy(true);
        try {
            await action();
            await refresh();
        } catch (error) {
            void message.error(errorLabel(error));
        } finally {
            setBusy(false);
        }
    }
    async function authorize(approve: boolean) {
        await act(async () => {
            const result = await authorizeAssistant(Object.fromEntries(new URLSearchParams(search)), approve);
            const target = new URL(result.redirectUrl);
            if (target.protocol !== "https:" && !(target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname))) throw new Error("无效的授权回调地址");
            window.location.assign(target.href);
        });
    }
    const failures = [setup.error, release.error, tokens.error, grants.error, calls.error, focused.error, consent.error].filter(Boolean);
    const installInstructions = setup.data ? assistantInstallInstructions(setup.data.mcpUrl, setup.data.skillUrl) : "";
    return (
        <AdminPageFrame title={consentMode ? "授权 Agent 客户端" : "Agent 接入"} description={consentMode ? "确认客户端身份及访问权限，完成连接。" : "通过 MCP 或 Skill 管理后台，按模块授权并保留调用记录。"} scroll>
            <div className={`flex flex-col gap-5 p-4 sm:p-5${consentMode ? " assistant-consent-layout" : ""}`}>
                {failures.map((error, index) => (
                    <Alert key={index} type="error" showIcon title={errorLabel(error)} />
                ))}
                {consentMode ? (
                    <AssistantConsentCard consent={consent.data} loading={consent.isPending} busy={busy} onAuthorize={(approve) => void authorize(approve)} />
                ) : (
                    <>
                        <section className="rounded-xl border border-border bg-background p-5">
                            <h2 className="mb-3 text-lg font-semibold">连接与下载</h2>
                            <Typography.Paragraph copyable={Boolean(setup.data)} className="break-all">
                                {setup.data?.mcpUrl || "正在读取 MCP 地址…"}
                            </Typography.Paragraph>
                            <p className="mb-3 text-sm text-muted-foreground">MCP 选择浏览器登录授权，或使用下方创建的 Bearer Token。Skill 内附登录及管理客户端。</p>
                            {release.data && (
                                <Space wrap>
                                    <Button href={release.data.downloadUrl} download>
                                        下载 Skill · {release.data.version}
                                    </Button>
                                    <Typography.Text type="secondary">
                                        API v{release.data.apiVersion} · {Math.ceil(release.data.size / 1024)} KiB
                                    </Typography.Text>
                                </Space>
                            )}
                            <div className="mt-5 border-t border-border pt-4">
                                <Button
                                    disabled={!installInstructions}
                                    onClick={() =>
                                        void navigator.clipboard.writeText(installInstructions).then(
                                            () => message.success("已复制，粘贴给 Agent 即可开始安装"),
                                            () => message.error("复制失败，请展开安装说明手动复制"),
                                        )
                                    }
                                >
                                    复制 Agent 安装说明
                                </Button>
                                <p className="mt-2 text-sm text-muted-foreground">发送给 Codex 或其他 Agent，自动配置 MCP 并下载校验最新版 Skill。登录授权由你在浏览器完成，说明中不含 Token。</p>
                                <details className="mt-3">
                                    <summary className="cursor-pointer text-sm">查看安装说明</summary>
                                    <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-words text-xs">{installInstructions || "正在生成安装说明…"}</pre>
                                </details>
                            </div>
                        </section>
                        <section className="rounded-xl border border-border bg-background p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold">管理 Token</h2>
                                <Button
                                    type="primary"
                                    onClick={() => {
                                        setScopes((setup.data?.scopes || []).filter((scope) => scope.endsWith(":read")));
                                        setCreating(true);
                                    }}
                                    disabled={!setup.data}
                                >
                                    创建 Token
                                </Button>
                            </div>
                            {tokens.isLoading && <p>正在读取…</p>}
                            {tokens.data?.items.length === 0 && <p className="text-muted-foreground">尚未创建 Token。</p>}
                            <div className="divide-y divide-border">
                                {tokens.data?.items.map((token) => (
                                    <div key={token.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div>
                                            <strong>{token.name}</strong>
                                            <p className="text-sm text-muted-foreground">
                                                到期 {timeLabel(token.expiresAt)} · {token.scopes.length} 项权限
                                            </p>
                                            <details>
                                                <summary className="cursor-pointer text-sm">查看权限</summary>
                                                <p className="max-w-3xl break-words text-sm">{token.scopes.join("、")}</p>
                                            </details>
                                        </div>
                                        {token.revokedAt ? (
                                            <Tag>已撤销</Tag>
                                        ) : (
                                            <Popconfirm title="撤销这个 Token？" onConfirm={() => act(() => revokeAssistantToken(token.id))}>
                                                <Button danger disabled={busy}>
                                                    撤销
                                                </Button>
                                            </Popconfirm>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Space className="mt-4">
                                <Button disabled={tokenPage === 1 || tokens.isFetching} onClick={() => setTokenPage(tokenPage - 1)}>
                                    上一页
                                </Button>
                                <span>第 {tokenPage} 页</span>
                                <Button disabled={!tokens.data?.hasMore || tokens.isFetching} onClick={() => setTokenPage(tokenPage + 1)}>
                                    下一页
                                </Button>
                            </Space>
                        </section>
                        <section className="rounded-xl border border-border bg-background p-5">
                            <h2 className="mb-3 text-lg font-semibold">浏览器授权</h2>
                            {grants.data?.items.length === 0 && <p className="text-muted-foreground">尚无已授权客户端。</p>}
                            <div className="divide-y divide-border">
                                {grants.data?.items.map((grant) => (
                                    <div key={grant.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div>
                                            <p className="break-all">{grant.clientId}</p>
                                            <p className="text-sm text-muted-foreground">
                                                到期 {timeLabel(grant.expiresAt)} · {grant.scopes.length} 项权限
                                            </p>
                                        </div>
                                        {grant.revokedAt ? (
                                            <Tag>已撤销</Tag>
                                        ) : (
                                            <Popconfirm title="撤销该客户端的所有访问？" onConfirm={() => act(() => revokeAssistantGrant(grant.id))}>
                                                <Button danger disabled={busy}>
                                                    撤销授权
                                                </Button>
                                            </Popconfirm>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <Space className="mt-4">
                                <Button disabled={grantPage === 1 || grants.isFetching} onClick={() => setGrantPage(grantPage - 1)}>
                                    上一页
                                </Button>
                                <span>第 {grantPage} 页</span>
                                <Button disabled={!grants.data?.hasMore || grants.isFetching} onClick={() => setGrantPage(grantPage + 1)}>
                                    下一页
                                </Button>
                            </Space>
                        </section>
                        <section className="rounded-xl border border-border bg-background p-5">
                            <div className="mb-3 flex items-center justify-between gap-3">
                                <h2 className="text-lg font-semibold">调用与待确认操作</h2>
                                <Button onClick={() => void refresh()}>刷新</Button>
                            </div>
                            {calls.data?.items.length === 0 && <p className="text-muted-foreground">暂无调用记录。</p>}
                            <div className="divide-y divide-border">
                                {calls.data?.items.map((call) => (
                                    <div key={call.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                                        <div>
                                            <strong>{call.operation}</strong>
                                            <p className="text-sm text-muted-foreground">
                                                {timeLabel(call.createdAt)} · {call.source} · {call.durationMs} ms
                                            </p>
                                            <span className="break-all text-xs text-muted-foreground">{call.id}</span>
                                        </div>
                                        <Space>
                                            <Tag>{["running", "unknown"].includes(call.status) ? "执行中 / 结果待核实" : call.status}</Tag>
                                            <Button onClick={() => setPreview(call)}>查看{call.status === "pending" ? "并确认" : "详情"}</Button>
                                        </Space>
                                    </div>
                                ))}
                            </div>
                            <Space className="mt-4">
                                <Button disabled={page === 1} onClick={() => setPage(page - 1)}>
                                    上一页
                                </Button>
                                <span>第 {page} 页</span>
                                <Button disabled={(calls.data?.items.length || 0) < 50} onClick={() => setPage(page + 1)}>
                                    下一页
                                </Button>
                            </Space>
                        </section>
                    </>
                )}
            </div>
            <AdminModal open={creating} title="创建管理 Token" onCancel={() => setCreating(false)} onOk={() => create.mutate()} confirmLoading={create.isPending} okButtonProps={{ disabled: !name.trim() || scopes.length === 0 }}>
                <div className="flex flex-col gap-4">
                    <label>
                        名称
                        <Input value={name} maxLength={120} onChange={(event) => setName(event.target.value)} autoComplete="off" />
                    </label>
                    <label>
                        有效天数
                        <InputNumber className="ml-3" min={1} max={365} value={days} onChange={(value) => setDays(value || 30)} />
                    </label>
                    <p className="text-sm text-muted-foreground">默认只读。按需要勾选模块写入权限，危险操作仍需网页确认。</p>
                    <div className="grid max-h-72 grid-cols-2 gap-2 overflow-auto">
                        {setup.data?.scopes.map((scope) => (
                            <Checkbox key={scope} checked={scopes.includes(scope)} onChange={(event) => setScopes((prior) => (event.target.checked ? [...prior, scope] : prior.filter((value) => value !== scope)))}>
                                {scope}
                            </Checkbox>
                        ))}
                    </div>
                </div>
            </AdminModal>
            <AdminModal
                open={Boolean(secret)}
                title="Token 仅显示这一次"
                footer={
                    <Button type="primary" onClick={() => setSecret("")}>
                        已保存，关闭
                    </Button>
                }
                onCancel={() => setSecret("")}
            >
                <Alert type="warning" showIcon title="请保存到密码管理器或客户端凭据配置。关闭后无法再次查看。" />
                <Input.Password className="mt-4" value={secret} readOnly autoComplete="off" />
                <Button
                    className="mt-3"
                    onClick={() =>
                        void navigator.clipboard.writeText(secret).then(
                            () => message.success("已复制"),
                            () => message.error("复制失败，请手动保存"),
                        )
                    }
                >
                    复制 Token
                </Button>
            </AdminModal>
            <AdminModal
                open={Boolean(preview)}
                title="管理操作详情"
                onCancel={() => setPreview(null)}
                footer={
                    preview?.status === "pending" && new Date(preview.expiresAt).getTime() > Date.now() ? (
                        <Space>
                            <Button
                                disabled={busy}
                                onClick={() =>
                                    void act(async () => {
                                        await confirmAssistantCall(preview.id, false);
                                        setPreview(null);
                                    })
                                }
                            >
                                拒绝
                            </Button>
                            <Button
                                type="primary"
                                loading={busy}
                                onClick={() =>
                                    void act(async () => {
                                        await confirmAssistantCall(preview.id, true);
                                        setPreview(null);
                                    })
                                }
                            >
                                确认此操作
                            </Button>
                        </Space>
                    ) : (
                        <Button onClick={() => setPreview(null)}>关闭</Button>
                    )
                }
            >
                {preview && (
                    <div className="flex flex-col gap-3">
                        <strong>{preview.operation}</strong>
                        <p>
                            状态：{preview.status} · 确认截止 {timeLabel(preview.expiresAt)}
                        </p>
                        <p className="break-all text-xs text-muted-foreground">
                            调用 ID：{preview.id}
                            <br />
                            参数指纹：{preview.argumentsHash}
                        </p>
                        <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-xs">{preview.previewJson}</pre>
                        <Alert type="warning" showIcon title="确认只授权这次固定参数的调用。客户端需使用原幂等键和参数重试执行；敏感字段已隐藏。" />
                    </div>
                )}
            </AdminModal>
        </AdminPageFrame>
    );
}
