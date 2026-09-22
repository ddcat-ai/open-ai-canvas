import { App, Button, Input, Popconfirm, Tag } from "antd";
import { Check, Copy, KeyRound, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { createPublicAPIKey, listPublicAPIKeys, revokePublicAPIKey, type CreatedPublicAPIKey, type PublicAPIKey } from "@/services/api/public-api";

export function PublicAPIKeysPane() {
    const { message } = App.useApp();
    const [keys, setKeys] = useState<PublicAPIKey[]>([]);
    const [name, setName] = useState("第三方调用 Key");
    const [loading, setLoading] = useState(false);
    const [creating, setCreating] = useState(false);
    const [created, setCreated] = useState<CreatedPublicAPIKey | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            const result = await listPublicAPIKeys();
            setKeys(result.keys || []);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取 API Key 失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void load();
    }, []);

    const create = async () => {
        const trimmed = name.trim();
        if (!trimmed) {
            message.warning("请填写 Key 名称");
            return;
        }
        setCreating(true);
        try {
            const result = await createPublicAPIKey({ name: trimmed });
            setCreated(result);
            setName("第三方调用 Key");
            await load();
            message.success("API Key 已创建，请立即复制明文");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "创建 API Key 失败");
        } finally {
            setCreating(false);
        }
    };

    const revoke = async (id: string) => {
        try {
            await revokePublicAPIKey(id);
            setKeys((items) => items.map((item) => item.id === id ? { ...item, status: "revoked" } : item));
            message.success("API Key 已撤销");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "撤销 API Key 失败");
        }
    };

    const copy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            message.success("已复制");
        } catch {
            message.error("复制失败，请手动复制");
        }
    };

    return (
        <div className="settings-pane">
            <div className="settings-pane-header">
                <div className="min-w-0">
                    <h2>开发者 API Key</h2>
                    <p>用平台 Key 从第三方调用已开放的生图和生视频模型。上游渠道密钥不会暴露给调用方。</p>
                </div>
                <Button icon={<RefreshCw className="size-4" />} onClick={() => void load()} loading={loading}>刷新</Button>
            </div>
            <div className="settings-section space-y-4">
                <div className="rounded-xl border border-border/70 bg-surface-secondary/60 p-4">
                    <div className="mb-3 flex items-center gap-2 text-sm font-medium"><KeyRound className="size-4" />创建一个调用 Key</div>
                    <div className="flex flex-col gap-2 sm:flex-row">
                        <Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="例如：我的工作流" onPressEnter={() => void create()} />
                        <Button type="primary" icon={<Plus className="size-4" />} loading={creating} onClick={() => void create()}>创建 Key</Button>
                    </div>
                </div>
                {created ? (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/8 p-4">
                        <div className="mb-2 text-sm font-medium">请立即复制新 Key</div>
                        <p className="mb-3 text-xs text-muted-foreground">明文只会显示这一次，关闭或刷新后无法再次查看。</p>
                        <div className="flex gap-2">
                            <Input.Password value={created.secret} readOnly visibilityToggle={false} />
                            <Button icon={<Copy className="size-4" />} onClick={() => void copy(created.secret)}>复制</Button>
                        </div>
                    </div>
                ) : null}
                <div className="space-y-2">
                    {keys.length === 0 && !loading ? <div className="rounded-xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">还没有 API Key</div> : null}
                    {keys.map((item) => (
                        <div key={item.id} className="flex flex-col gap-3 rounded-xl border border-border/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                            <div className="min-w-0">
                                <div className="flex items-center gap-2"><span className="font-medium">{item.name}</span><Tag color={item.status === "active" ? "green" : "default"}>{item.status === "active" ? "使用中" : "已撤销"}</Tag></div>
                                <div className="mt-1 font-mono text-xs text-muted-foreground">{item.prefix}••••••••</div>
                                <div className="mt-1 text-xs text-muted-foreground">创建于 {new Date(item.createdAt).toLocaleString()}</div>
                            </div>
                            {item.status === "active" ? <Popconfirm title="撤销这个 API Key？" description="撤销后，使用它的第三方请求会立即失败。" onConfirm={() => void revoke(item.id)} okText="撤销" cancelText="取消"><Button danger type="text" icon={<Trash2 className="size-4" />}>撤销</Button></Popconfirm> : <Check className="size-4 text-muted-foreground" />}
                        </div>
                    ))}
                </div>
                <div className="rounded-xl border border-border/70 bg-surface-secondary/40 p-4 text-xs leading-6 text-muted-foreground">
                    调用地址：<code>/api/v1/generations</code>；请求头使用 <code>Authorization: Bearer sk_live_...</code> 和 <code>Idempotency-Key</code>。生图、生视频任务都通过查询接口获取结果。
                </div>
            </div>
        </div>
    );
}
