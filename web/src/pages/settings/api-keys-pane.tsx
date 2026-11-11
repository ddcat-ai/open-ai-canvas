import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Select, Skeleton } from "antd";
import copy from "copy-to-clipboard";
import { BookOpen, Copy, KeyRound, Plus, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { AppModal } from "@/components/ui/product/app-modal";
import { StatusBadge } from "@/components/ui/base/badges";
import { Callout } from "@/components/ui/product/callout";
import { EmptyState } from "@/components/ui/product/empty-state";
import { currentLocale } from "@/i18n";
import { apiKeyStatus, createAPIKey, listAPIKeys, revokeAPIKey, type APIKeyMetadata, type CreatedAPIKey } from "@/services/api/api-keys";
import { useUserStore } from "@/stores/use-user-store";

type KeyForm = { name: string; validDays: number };
const statusLabels = { active: "有效", expired: "已过期", revoked: "已吊销" };
const dateLabel = (value: string | null) => (value ? new Date(value).toLocaleString(currentLocale(), { dateStyle: "medium", timeStyle: "short" }) : "不过期");
const errorLabel = (error: unknown) => (error instanceof Error ? error.message : "请求失败，请稍后重试");

export function APIKeysPane() {
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const queryClient = useQueryClient();
    const queryKey = ["api-keys", userId];
    const query = useQuery({ queryKey, queryFn: ({ signal }) => listAPIKeys(signal), enabled: Boolean(userId), retry: false });
    const [form] = Form.useForm<KeyForm>();
    const [createOpen, setCreateOpen] = useState(false);
    const [issued, setIssued] = useState<(CreatedAPIKey & { ownerId?: string }) | null>(null);
    const [revoking, setRevoking] = useState<APIKeyMetadata | null>(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState("");
    const [now, setNow] = useState(Date.now());
    const busy = useRef(false);
    const mounted = useRef(false);

    useEffect(() => {
        mounted.current = true;
        const timer = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => {
            mounted.current = false;
            window.clearInterval(timer);
        };
    }, []);

    const sameAccount = () => mounted.current && useUserStore.getState().user?.id === userId;
    const begin = () => {
        if (busy.current) return false;
        busy.current = true;
        setPending(true);
        setError("");
        return true;
    };
    const finish = () => {
        busy.current = false;
        if (mounted.current) setPending(false);
    };

    const create = async (values: KeyForm) => {
        if (!begin()) return;
        try {
            // Keep the one-time secret out of React Query's mutation/read caches.
            const result = await createAPIKey({ name: values.name.trim(), ...(values.validDays ? { expiresAt: new Date(Date.now() + values.validDays * 86_400_000).toISOString() } : {}) });
            if (!sameAccount()) return;
            await queryClient.cancelQueries({ queryKey });
            if (!sameAccount()) return;
            const { key: _secret, ...metadata } = result;
            queryClient.setQueryData<{ keys: APIKeyMetadata[] }>(queryKey, (current) => ({ keys: [metadata, ...(current?.keys ?? []).filter((key) => key.id !== metadata.id)] }));
            setCreateOpen(false);
            form.resetFields();
            setIssued({ ...result, ownerId: userId });
        } catch (err) {
            if (sameAccount()) setError(`${errorLabel(err)}。若请求曾中断，请先刷新列表确认后再试。`);
        } finally {
            finish();
        }
    };

    const revoke = async () => {
        if (!revoking || !begin()) return;
        try {
            await revokeAPIKey(revoking.id);
            if (!sameAccount()) return;
            const id = revoking.id;
            await queryClient.cancelQueries({ queryKey });
            if (!sameAccount()) return;
            queryClient.setQueryData<{ keys: APIKeyMetadata[] }>(queryKey, (current) => ({ keys: (current?.keys ?? []).map((key) => (key.id === id ? { ...key, revokedAt: new Date().toISOString() } : key)) }));
            setRevoking(null);
            message.success("API Key 已吊销");
        } catch (err) {
            if (sameAccount()) setError(errorLabel(err));
        } finally {
            finish();
        }
    };

    return (
        <section className="space-y-5" aria-label="API Key 管理">
            <header className="settings-pane-header flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h2>API 访问</h2>
                    <p>让你的应用调用本账号可用的模型，调用费用与限额计入本账号。</p>
                </div>
                <div className="flex flex-wrap gap-2">
                    <Link to="/api-docs" className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm font-medium text-foreground hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-ring">
                        <BookOpen className="size-4" />
                        API 说明
                    </Link>
                    <Button
                        type="primary"
                        icon={<Plus className="size-4" />}
                        onClick={() => {
                            setError("");
                            setCreateOpen(true);
                        }}
                    >
                        创建 API Key
                    </Button>
                </div>
            </header>
            <Callout title="每个应用使用独立的 Key">Key 可调用本账号可见的模型，不具备站内登录或管理其他 Key 的权限。请保存在服务端或秘密管理器中，避免放入网页前端、公开仓库和 URL。</Callout>
            <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-medium">我的 API Key</h3>
                <Button size="small" loading={query.isFetching} icon={<RefreshCw className="size-3.5" />} onClick={() => void query.refetch()}>
                    刷新列表
                </Button>
            </div>
            {query.isError ? (
                <Callout
                    tone="error"
                    title="无法加载密钥列表"
                    action={
                        <Button size="small" onClick={() => void query.refetch()}>
                            重试
                        </Button>
                    }
                >
                    {errorLabel(query.error)}
                </Callout>
            ) : query.isPending ? (
                <Skeleton active paragraph={{ rows: 3 }} />
            ) : !query.data?.keys.length ? (
                <EmptyState icon={KeyRound} title="还没有 API Key" description="为应用创建专属密钥，再按 API 说明发起第一次调用。" />
            ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-left text-sm">
                        <thead className="bg-surface-secondary text-muted-foreground">
                            <tr>
                                {["名称 / 密钥前缀", "状态", "创建时间", "到期时间", "操作"].map((label) => (
                                    <th key={label} scope="col" className="whitespace-nowrap px-4 py-3 font-medium">
                                        {label}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {query.data.keys.map((key) => {
                                const status = apiKeyStatus(key, now);
                                return (
                                    <tr key={key.id} className="border-t border-border">
                                        <td className="px-4 py-3">
                                            <p className="max-w-xs break-words font-medium">{key.name}</p>
                                            <code className="text-xs text-muted-foreground">{key.prefix}…</code>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <StatusBadge tone={status === "active" ? "success" : "neutral"}>{statusLabels[status]}</StatusBadge>
                                        </td>
                                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{dateLabel(key.createdAt)}</td>
                                        <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">{dateLabel(key.expiresAt)}</td>
                                        <td className="whitespace-nowrap px-4 py-3">
                                            <Button
                                                size="small"
                                                danger
                                                disabled={status === "revoked" || pending}
                                                onClick={() => {
                                                    setError("");
                                                    setRevoking(key);
                                                }}
                                            >
                                                吊销
                                            </Button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">吊销会立即阻止后续请求，已入队任务继续执行和计费。同账号的新 Key 也无法查询旧 Key 创建的调用，请先保存所需结果。</p>

            <AppModal
                title="创建 API Key"
                open={createOpen}
                onCancel={() => {
                    if (!pending) {
                        setCreateOpen(false);
                        setError("");
                    }
                }}
                footer={null}
                mask={{ closable: !pending }}
                closable={!pending}
            >
                <Form form={form} layout="vertical" initialValues={{ name: "", validDays: 90 }} onFinish={(values) => void create(values)}>
                    <Form.Item name="name" label="名称" rules={[{ required: true, whitespace: true, message: "请输入便于识别的名称" }, { max: 80 }]}>
                        <Input placeholder="例如：我的自动化应用" maxLength={80} autoComplete="off" />
                    </Form.Item>
                    <Form.Item name="validDays" label="有效期">
                        <Select
                            options={[
                                { value: 7, label: "7 天" },
                                { value: 30, label: "30 天" },
                                { value: 90, label: "90 天（推荐）" },
                                { value: 365, label: "1 年" },
                                { value: 0, label: "不过期" },
                            ]}
                        />
                    </Form.Item>
                    {error ? (
                        <Callout role="alert" tone="error" className="mb-4">
                            {error}
                        </Callout>
                    ) : null}
                    <div className="flex justify-end gap-2">
                        <Button disabled={pending} onClick={() => setCreateOpen(false)}>
                            取消
                        </Button>
                        <Button type="primary" htmlType="submit" loading={pending}>
                            创建密钥
                        </Button>
                    </div>
                </Form>
            </AppModal>
            <AppModal
                title="保存你的 API Key"
                open={Boolean(issued && issued.ownerId === userId)}
                onCancel={() => setIssued(null)}
                mask={{ closable: false }}
                footer={
                    <Button type="primary" onClick={() => setIssued(null)}>
                        我已保存，关闭
                    </Button>
                }
            >
                <div className="space-y-4">
                    <Callout tone="warning" title="密钥只显示这一次">
                        关闭后无法再次查看。遗失时请吊销并重新创建。
                    </Callout>
                    <Input.TextArea aria-label="新创建的 API Key" readOnly value={issued?.key ?? ""} autoSize={{ minRows: 2, maxRows: 3 }} spellCheck={false} />
                    <Button
                        icon={<Copy className="size-4" />}
                        onClick={async () => {
                            if (issued?.ownerId === userId && issued) {
                                try {
                                    if (await copy(issued.key)) message.success("已复制 API Key");
                                    else message.error("复制失败，请手动选择密钥复制");
                                } catch {
                                    message.error("复制失败，请手动选择密钥复制");
                                }
                            }
                        }}
                    >
                        复制 API Key
                    </Button>
                </div>
            </AppModal>
            <AppModal
                title="吊销 API Key"
                open={Boolean(revoking)}
                onCancel={() => {
                    if (!pending) setRevoking(null);
                }}
                closable={!pending}
                mask={{ closable: !pending }}
                footer={
                    <>
                        <Button disabled={pending} onClick={() => setRevoking(null)}>
                            取消
                        </Button>
                        <Button danger type="primary" loading={pending} onClick={() => void revoke()}>
                            确认吊销
                        </Button>
                    </>
                }
            >
                <p className="mb-4 leading-relaxed">确认吊销“{revoking?.name}”？使用它的应用将立即失去调用和查询权限。此操作无法撤销。</p>
                {error ? (
                    <Callout role="alert" tone="error">
                        {error}
                    </Callout>
                ) : null}
            </AppModal>
        </section>
    );
}
