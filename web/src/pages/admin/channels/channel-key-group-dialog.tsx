import { App, Form, Input, Switch } from "antd";
import { useRef, useState } from "react";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { createAdminChannelKeyGroup } from "@/services/api/auth";
import type { ModelChannel } from "@/stores/use-config-store";

export function ChannelKeyGroupDialog({ source, onClose, onCreated }: { source: ModelChannel; onClose: () => void; onCreated: (channel: ModelChannel) => Promise<void> }) {
    const [form] = Form.useForm<{ name: string; apiKey: string; secretKey?: string; copyModels: boolean }>();
    const [saving, setSaving] = useState(false);
    const submitting = useRef(false);
    const { message } = App.useApp();
    const save = async () => {
        if (submitting.current) return;
        submitting.current = true;
        const values = await form.validateFields().catch(() => null);
        if (!values) {
            submitting.current = false;
            return;
        }
        setSaving(true);
        try {
            const { channel } = await createAdminChannelKeyGroup(source.id, values);
            onClose();
            message.success("分组 Key 已添加；请检查模型价格并启用需要的线路");
            await onCreated(channel);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "添加失败");
        } finally {
            submitting.current = false;
            setSaving(false);
        }
    };
    return (
        <AdminModal title="添加分组 Key" open onCancel={() => !saving && onClose()} onOk={() => void save()} okText="添加分组" confirmLoading={saving} mask={{ closable: !saving }}>
            <p className="mb-4 break-all text-foreground/60">上游地址：{source.baseUrl}</p>
            <Form form={form} layout="vertical" initialValues={{ copyModels: true }}>
                <Form.Item name="name" label="分组名称 / 线路名称" rules={[{ required: true, whitespace: true, message: "请输入分组名称" }, { max: 80 }]}>
                    <Input placeholder="例如：特惠、标准、稳定" maxLength={80} />
                </Form.Item>
                <Form.Item name="apiKey" label="此分组的 API Key" rules={[{ required: true, whitespace: true, message: "请输入此分组的 Key" }]}>
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="secretKey" label="Secret Key（仅 AK/SK 认证需要）">
                    <Input.Password autoComplete="new-password" />
                </Form.Item>
                <Form.Item name="copyModels" label={`复制「${source.name}」的模型与价格作为草稿`} valuePropName="checked">
                    <Switch />
                </Form.Item>
                <p className="text-sm text-foreground/60">连接设置沿用当前渠道。复制的模型默认停用，价格可独立修改。保留相同模型展示名、设置不同线路名称，用户就能在同一个模型下选择线路。</p>
            </Form>
        </AdminModal>
    );
}
