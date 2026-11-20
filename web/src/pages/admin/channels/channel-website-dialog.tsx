import { useEffect, useState } from "react";
import { App, Button, Form, Input } from "antd";
import { Select } from "@/components/ui/base/select";
import { ChannelHeadersEditor } from "@/components/channel-headers-editor";
import { AdminModal } from "../ui/overlays";
import { saveAdminChannelWebsite, type ChannelWebsite, type ChannelWebsiteInput } from "@/services/api/channel-websites";

export function ChannelWebsiteDialog({ website, onClose, onSaved }: { website?: ChannelWebsite; onClose: () => void; onSaved: (website: ChannelWebsite) => Promise<void> }) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<ChannelWebsiteInput>();
    const [saving, setSaving] = useState(false);
    useEffect(() => {
        form.setFieldsValue(website ?? { name: "", baseUrl: "", apiFormat: "openai", proxyUrl: "", headers: [] });
    }, [website, form]);
    const save = async () => {
        const values = await form.validateFields();
        const apply = async () => {
            setSaving(true);
            try {
                const { website: saved } = await saveAdminChannelWebsite(website?.id, { ...values, expectedUpdatedAt: website?.updatedAt });
                await onSaved(saved);
                onClose();
            } catch (error) {
                message.error(error instanceof Error ? error.message : "保存网站失败");
            } finally {
                setSaving(false);
            }
        };
        if (website && website.keyCount > 0) {
            modal.confirm({
                title: "更新网站公共连接？",
                content: `将同步 ${website.keyCount} 个 Key 分组的地址、目录格式、代理和公共请求头。各组凭据、私有请求头、模型及价格保留；旧目录会在重新读取时重建基线。`,
                okText: "更新全部分组",
                cancelText: "取消",
                onOk: apply,
            });
        } else {
            await apply();
        }
    };
    return (
        <AdminModal
            open
            title={website ? "编辑 API 网站" : "新增 API 网站"}
            onCancel={() => !saving && onClose()}
            width={680}
            footer={
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存网站
                </Button>
            }
        >
            <Form form={form} layout="vertical" requiredMark={false}>
                <Form.Item name="name" label="网站名称" rules={[{ required: true, max: 80 }]}>
                    <Input placeholder="例如：我的 API 网站" />
                </Form.Item>
                <Form.Item name="baseUrl" label="API Base URL" rules={[{ required: true }]} extra="保留实际版本及租户路径，不会按域名合并。">
                    <Input placeholder="https://api.example.com/v1" />
                </Form.Item>
                <Form.Item name="apiFormat" label="模型目录格式">
                    <Select
                        options={[
                            { value: "openai", label: "OpenAI /models" },
                            { value: "gemini", label: "Gemini models" },
                        ]}
                    />
                </Form.Item>
                <Form.Item name="proxyUrl" label="出站代理" extra="留空跟随系统代理。">
                    <Input placeholder="socks5://127.0.0.1:1080" />
                </Form.Item>
                <Form.Item name="headers" label="公共请求头" extra="仅支持 Anthropic-Version、OpenAI-Beta；其他请求头在各 Key 分组内填写。">
                    <ChannelHeadersEditor />
                </Form.Item>
            </Form>
        </AdminModal>
    );
}
