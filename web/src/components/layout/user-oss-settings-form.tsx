import { App, Button, Form, Input, Select, Switch, Tag } from "antd";
import { Cloud, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { getUserOSSSetting, updateUserOSSSetting, type UserOSSSetting } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";

type OSSFormValues = {
    enabled?: boolean;
    provider: "aliyun";
    region?: string;
    endpoint?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    pathPrefix?: string;
};

export function UserOSSSettingsForm() {
    const actor = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [form] = Form.useForm<OSSFormValues>();
    const [setting, setSetting] = useState<UserOSSSetting | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const savedAt = formatSavedAt(setting?.updatedAt);

    useEffect(() => {
        if (!actor?.id) return;
        let active = true;
        setLoading(true);
        void getUserOSSSetting()
            .then((data) => {
                if (!active) return;
                setSetting(data.setting);
                form.setFieldsValue(toFormValues(data.setting));
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取个人 OSS 配置失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [actor?.id, form, message]);

    if (!actor) {
        return <div className="rounded-md border border-dashed border-border px-5 py-10 text-center text-sm text-foreground/55">登录后可配置个人 OSS。</div>;
    }

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const data = await updateUserOSSSetting({
                enabled: values.enabled === true,
                provider: values.provider || "aliyun",
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                pathPrefix: values.pathPrefix?.trim() || "",
            });
            setSetting(data.setting);
            form.setFieldsValue(toFormValues(data.setting));
            message.success(data.setting.enabled ? "个人 OSS 已启用，后续上传将优先使用该存储" : "个人 OSS 已停用，后续上传将使用平台存储");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存个人 OSS 配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cloud className="size-4" />
                        我的 OSS
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/55">启用后，新上传和新生成的媒体优先写入你的 OSS；停用时回退到平台存储。历史资源固定使用创建时的配置版本。</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Tag color={setting?.enabled ? "success" : "default"}>{setting?.enabled ? "已启用" : "未启用"}</Tag>
                    <Tag color={setting?.hasAccessKeySecret ? "processing" : "warning"} icon={<ShieldCheck className="size-3" />}>
                        {setting?.hasAccessKeySecret ? "密钥已加密" : "未保存密钥"}
                    </Tag>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 xl:grid-cols-3">
                <Form.Item name="enabled" label="启用个人 OSS" valuePropName="checked" className="mb-3">
                    <Switch checkedChildren="启用" unCheckedChildren="停用" />
                </Form.Item>
                <Form.Item name="provider" label="存储服务" rules={[{ required: true, message: "请选择存储服务" }]} className="mb-3">
                    <Select options={[{ label: "阿里云 OSS", value: "aliyun" }]} />
                </Form.Item>
                <Form.Item name="region" label="Region" className="mb-3">
                    <Input spellCheck={false} placeholder="oss-cn-hangzhou" />
                </Form.Item>
                <Form.Item name="endpoint" label="Endpoint" className="mb-3">
                    <Input inputMode="url" spellCheck={false} placeholder="https://oss-cn-hangzhou.aliyuncs.com" />
                </Form.Item>
                <Form.Item name="bucket" label="Bucket" className="mb-3">
                    <Input spellCheck={false} placeholder="my-canvas-assets" />
                </Form.Item>
                <Form.Item name="pathPrefix" label="路径前缀" className="mb-3">
                    <Input spellCheck={false} placeholder="infinite-canvas" />
                </Form.Item>
                <Form.Item name="accessKeyId" label="AccessKey ID" className="mb-3 xl:col-span-1">
                    <Input autoComplete="off" spellCheck={false} placeholder="阿里云 AccessKey ID" />
                </Form.Item>
                <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? "AccessKey Secret（留空保留）" : "AccessKey Secret"} className="mb-3 xl:col-span-2">
                    <Input.Password autoComplete="new-password" spellCheck={false} placeholder={setting?.hasAccessKeySecret ? "留空保留已加密密钥" : "阿里云 AccessKey Secret"} />
                </Form.Item>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-foreground/50">{savedAt ? `上次保存：${savedAt}` : "尚未保存个人 OSS 配置"}</span>
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    保存个人 OSS
                </Button>
            </div>
        </Form>
    );
}

function formatSavedAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "";
    return date.toLocaleString("zh-CN");
}

function toFormValues(setting: UserOSSSetting): OSSFormValues {
    return {
        enabled: setting.enabled,
        provider: setting.provider || "aliyun",
        region: setting.region,
        endpoint: setting.endpoint,
        bucket: setting.bucket,
        accessKeyId: setting.accessKeyId,
        accessKeySecret: "",
        pathPrefix: setting.pathPrefix,
    };
}
