import { createClientId } from "@/lib/client-id";
import { App, Button, Form, Input, Skeleton } from "antd";
import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import { AppModal } from "@/components/ui/product/app-modal";
import type { WalletLink } from "@/services/api/payments";
import { fetchAdminPluginConfiguration, updateAdminPluginConfiguration } from "@/services/api/plugins";

export function WalletLinksSettings({ plugin, onClose }: { plugin: { id: string; name: string; links: WalletLink[] } | null; onClose: () => void }) {
    const { message } = App.useApp();
    const [links, setLinks] = useState<WalletLink[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!plugin) return;
        let cancelled = false;
        setLoading(true);
        setLoaded(false);
        setLinks([]);
        fetchAdminPluginConfiguration(plugin.id)
            .then((config) => {
                const parsed: unknown = config.values.links ? JSON.parse(config.values.links) : plugin.links;
                if (!Array.isArray(parsed)) throw new Error("购买入口配置格式错误");
                if (!cancelled) {
                    setLinks(parsed);
                    setLoaded(true);
                }
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取配置失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [message, plugin]);

    const update = (index: number, field: keyof WalletLink, value: string) => setLinks((current) => current.map((link, itemIndex) => (itemIndex === index ? { ...link, [field]: value } : link)));

    const save = async () => {
        if (!plugin || !loaded) return;
        try {
            const values = links.map((link) => ({ ...link, label: link.label.trim(), price: link.price?.trim(), description: link.description?.trim(), url: link.url.trim() }));
            for (const link of values) {
                const url = new URL(link.url);
                if (!link.label || !["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error("请填写套餐名称和有效的 http(s) 购买地址");
            }
            setSaving(true);
            await updateAdminPluginConfiguration(plugin.id, { links: JSON.stringify(values) });
            message.success("购买入口已保存");
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal
            open={Boolean(plugin)}
            title={`${plugin?.name || "兑换码"}设置`}
            width={720}
            centered
            destroyOnHidden
            onCancel={() => {
                if (!saving) onClose();
            }}
            footer={
                <>
                    <Button disabled={saving} onClick={onClose}>
                        取消
                    </Button>
                    <Button type="primary" icon={<Save size={16} />} loading={saving} disabled={loading || !loaded} onClick={() => void save()}>
                        保存配置
                    </Button>
                </>
            }
        >
            {loading ? (
                <Skeleton active />
            ) : (
                <Form layout="vertical" disabled={saving || !loaded}>
                    <div className="max-h-[60vh] overflow-y-auto">
                        {links.map((link, index) => (
                            <section key={link.id} className="border-b border-border py-3">
                                <div className="mb-3 flex items-center justify-between">
                                    <strong>套餐 {index + 1}</strong>
                                    <Button type="text" danger title="删除套餐" aria-label={`删除套餐 ${index + 1}`} icon={<Trash2 size={16} />} onClick={() => setLinks((current) => current.filter((_, itemIndex) => itemIndex !== index))} />
                                </div>
                                <div className="grid gap-x-3 sm:grid-cols-2">
                                    <Form.Item label="积分 / 名称" required>
                                        <Input aria-label={`套餐 ${index + 1} 名称`} maxLength={120} value={link.label} placeholder="500 积分" onChange={(event) => update(index, "label", event.target.value)} />
                                    </Form.Item>
                                    <Form.Item label="价格">
                                        <Input aria-label={`套餐 ${index + 1} 价格`} maxLength={40} value={link.price || ""} placeholder="¥ 50.00" onChange={(event) => update(index, "price", event.target.value)} />
                                    </Form.Item>
                                </div>
                                <Form.Item label="介绍">
                                    <Input aria-label={`套餐 ${index + 1} 介绍`} maxLength={240} value={link.description || ""} onChange={(event) => update(index, "description", event.target.value)} />
                                </Form.Item>
                                <Form.Item label="购买链接" required>
                                    <Input aria-label={`套餐 ${index + 1} 链接`} maxLength={2048} value={link.url} placeholder="https://" onChange={(event) => update(index, "url", event.target.value)} />
                                </Form.Item>
                            </section>
                        ))}
                    </div>
                    <Button className="mt-3" icon={<Plus size={16} />} disabled={links.length >= 100} onClick={() => setLinks((current) => [...current, { id: `link-${createClientId()}`, label: "", price: "", description: "", url: "" }])}>
                        添加套餐
                    </Button>
                </Form>
            )}
        </AppModal>
    );
}
