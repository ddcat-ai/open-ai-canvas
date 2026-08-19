import { App, Button, Form, Input, Segmented, Space } from "antd";
import { Cloud, Globe, HardDrive, LocateFixed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type StorageMode = "local" | "aliyun" | "tencent" | "qiniu";
type OSSFormValues = {
    mode: StorageMode;
    publicBaseUrl?: string;
    region?: string;
    endpoint?: string;
    cdnBaseUrl?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    pathPrefix?: string;
};

export default function StorageSettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<OSSFormValues>();
    const mode = Form.useWatch("mode", form) || "local";
    const isObjectStorage = mode !== "local";
    const isTencentCOS = mode === "tencent";
    const isQiniuKodo = mode === "qiniu";
    const accessKeyIdLabel = isTencentCOS ? "SecretId" : isQiniuKodo ? "AccessKey" : "AccessKey ID";
    const accessKeySecretLabel = isTencentCOS ? "SecretKey" : isQiniuKodo ? "SecretKey" : "AccessKey Secret";
    const hasCurrentProviderSecret = Boolean(setting && setting.provider === mode && setting.hasAccessKeySecret);
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminOSSSetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue(formValues(value));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取对象存储配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        await form.validateFields();
        const values = form.getFieldsValue(true);
        if (values.mode === "local" && !values.publicBaseUrl?.trim()) return message.error("请填写服务器访问地址");
        if (values.mode !== "local" && !values.accessKeySecret?.trim() && !hasCurrentProviderSecret) return message.error(`请填写 ${accessKeySecretLabel}`);
        if (values.mode !== "local" && !values.bucket?.trim()) return message.error("请填写对象存储 Bucket");
        if (values.mode !== "local" && !values.accessKeyId?.trim()) return message.error(`请填写 ${accessKeyIdLabel}`);
        if (values.mode === "aliyun" && !values.endpoint?.trim()) return message.error("请填写阿里云 OSS Endpoint");
        if (values.mode === "tencent" && !values.endpoint?.trim() && !values.region?.trim()) return message.error("请填写腾讯云 COS Region 或 Endpoint");
        if (values.mode === "qiniu" && !values.endpoint?.trim()) return message.error("请填写七牛云 Kodo 上传 Endpoint");
        if (values.mode === "qiniu" && !values.cdnBaseUrl?.trim()) return message.error("请填写七牛云 Kodo 绑定域名");

        setSaving(true);
        try {
            const result = await updateAdminOSSSetting({
                enabled: values.mode !== "local",
                provider: values.mode === "local" ? setting?.provider || "aliyun" : values.mode,
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                publicBaseUrl: values.publicBaseUrl?.trim() || "",
                pathPrefix: values.pathPrefix?.trim() || "",
            });
            setSetting(result.setting);
            form.setFieldsValue(formValues(result.setting));
            message.success("存储配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存存储配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置" scroll>
            <div className="space-y-4 pt-4">
                <SettingsSectionCard
                    layout="stacked"
                    contentClassName="px-4 pb-4"
                    icon={<Cloud className="size-4" />}
                    title="平台存储"
                    status={
                        <Space size={6}>
                            <AdminStatusBadge label={setting?.enabled ? storageProviderLabel(setting.provider) : "服务器本地"} tone="neutral" />
                            {setting?.enabled ? <AdminStatusBadge label={setting.hasAccessKeySecret ? configuredSecretText : "未保存密钥"} tone={setting.hasAccessKeySecret ? "success" : "warning"} /> : null}
                        </Space>
                    }
                    footer={
                        <>
                            <div className="text-xs text-foreground/45">
                                {setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "尚未保存平台存储配置"}
                            </div>
                            <Button type="primary" loading={saving} onClick={() => void save()}>保存存储配置</Button>
                        </>
                    }
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading} className="px-5 pb-2">
                        <Form.Item name="mode" label="存储类型" rules={[{ required: true, message: "请选择存储类型" }]}>
                            <Segmented<StorageMode>
                                block
                                options={[
                                    { label: <span className="inline-flex items-center gap-2"><HardDrive className="size-4" />服务器本地</span>, value: "local" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />阿里云 OSS</span>, value: "aliyun" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />腾讯云 COS</span>, value: "tencent" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />七牛云 Kodo</span>, value: "qiniu" },
                                ]}
                                onChange={(value) => {
                                    const nextMode = value as StorageMode;
                                    const switchingProvider = nextMode !== "local" && ((mode !== "local" && mode !== nextMode) || (mode === "local" && setting?.provider !== nextMode));
                                    if (switchingProvider) form.setFieldsValue({ region: "", endpoint: "", cdnBaseUrl: "", bucket: "", accessKeyId: "", accessKeySecret: "" });
                                }}
                            />
                        </Form.Item>

                        {isObjectStorage ? (
                            <div className="space-y-1">
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                                    <Form.Item name="region" label="Region">
                                        <Input autoComplete="off" placeholder={isTencentCOS ? "例如：ap-guangzhou" : isQiniuKodo ? "例如：z0 / cn-east-1" : "例如：oss-cn-hangzhou"} />
                                    </Form.Item>
                                    <Form.Item name="bucket" label="Bucket">
                                        <Input autoComplete="off" placeholder={isQiniuKodo ? "七牛云存储空间名称" : "对象存储 Bucket"} />
                                    </Form.Item>
                                    <Form.Item name="pathPrefix" label="路径前缀">
                                        <Input autoComplete="off" placeholder="可选，例如：canvas" />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                                    <Form.Item className="xl:col-span-2" name="endpoint" label={isQiniuKodo ? "上传 Endpoint" : "Endpoint"}>
                                        <Input autoComplete="off" inputMode="url" placeholder={isTencentCOS ? "https://cos.ap-guangzhou.myqcloud.com" : isQiniuKodo ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"} />
                                    </Form.Item>
                                    <Form.Item name="cdnBaseUrl" label={isQiniuKodo ? "绑定域名" : "CDN 加速域名"} rules={[{ type: "url", message: "请填写完整的 http/https 地址" }]}>
                                        <Input autoComplete="off" inputMode="url" placeholder="https://media.example.com" />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
                                    <Form.Item name="accessKeyId" label={accessKeyIdLabel}>
                                        <Input autoComplete="off" placeholder={isQiniuKodo ? "七牛云 AccessKey" : accessKeyIdLabel} />
                                    </Form.Item>
                                    <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? `${accessKeySecretLabel}（${configuredSecretText}）` : accessKeySecretLabel}>
                                        <Input.Password autoComplete="new-password" placeholder={hasCurrentProviderSecret ? "留空保留原密钥" : accessKeySecretLabel} />
                                    </Form.Item>
                                </div>
                            </div>
                        ) : (
                            <Form.Item
                                label="服务器访问地址"
                                required
                                tooltip="用于生成本地资源的短时访问链接。"
                                name="publicBaseUrl"
                                rules={[{ required: true, message: "请填写服务器访问地址" }, { type: "url", message: "请填写完整的 http/https 地址" }]}
                            >
                                <Space.Compact className="w-full">
                                    <Input className="min-w-0" autoComplete="off" placeholder="https://canvas.example.com" prefix={<Globe className="size-4 text-foreground/35" />} />
                                    <Button icon={<LocateFixed className="size-4" />} onClick={() => form.setFieldValue("publicBaseUrl", window.location.origin)}>使用当前地址</Button>
                                </Space.Compact>
                            </Form.Item>
                        )}
                    </Form>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}

function formValues(setting?: AdminOSSSetting | null): OSSFormValues {
    return {
        mode: setting?.enabled ? setting.provider : "local",
        publicBaseUrl: setting?.publicBaseUrl || "",
        region: setting?.region || "",
        endpoint: setting?.endpoint || "",
        cdnBaseUrl: setting?.cdnBaseUrl || "",
        bucket: setting?.bucket || "",
        accessKeyId: setting?.accessKeyId || "",
        accessKeySecret: "",
        pathPrefix: setting?.pathPrefix || "",
    };
}

function storageProviderLabel(provider?: AdminOSSSetting["provider"] | StorageMode) {
    return provider === "tencent" ? "腾讯云 COS" : provider === "qiniu" ? "七牛云 Kodo" : provider === "aliyun" ? "阿里云 OSS" : "服务器本地";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
