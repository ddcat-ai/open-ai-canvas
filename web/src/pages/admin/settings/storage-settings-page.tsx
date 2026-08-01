import { App, Button, Form, Input, Select, Space, Switch, Tag } from "antd";
import { Cloud, Info, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type OSSFormValues = {
    enabled?: boolean;
    defaultUpload?: boolean;
    provider: "aliyun" | "s3";
    region?: string;
    endpoint?: string;
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
    const provider = Form.useWatch("provider", form) || setting?.provider || "aliyun";
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminOSSSetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue(formValues(value));
            })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取 OSS 配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && !values.accessKeySecret?.trim() && !setting?.hasAccessKeySecret) return message.error("请填写 AccessKey Secret");
        if (values.enabled && !values.endpoint?.trim()) return message.error("请填写 OSS Endpoint");
        if (values.enabled && !values.bucket?.trim()) return message.error("请填写 OSS Bucket");
        if (values.enabled && !values.accessKeyId?.trim()) return message.error("请填写 AccessKey ID");
        setSaving(true);
        try {
            const result = await updateAdminOSSSetting({
                enabled: values.enabled === true,
                defaultUpload: values.defaultUpload === true,
                provider: values.provider,
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                publicBaseUrl: "",
                pathPrefix: values.pathPrefix?.trim() || "",
            });
            setSetting(result.setting);
            form.setFieldsValue(formValues(result.setting));
            message.success("对象存储配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 OSS 配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title="存储服务" description="OSS / S3 与资源存储">
            <div className="mx-auto max-w-5xl space-y-5">
                <div className="rounded-lg border border-border bg-muted/25 p-4 text-foreground/75">
                    <div className="flex items-start gap-3">
                        <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted/60">
                            <Info className="size-4" />
                        </span>
                        <div>
                            <div className="text-sm font-semibold text-foreground">资源存储规则</div>
                            <p className="mt-1 text-xs leading-6 text-foreground/55">
                                支持阿里云 OSS 与通用 S3 兼容存储（含 Cloudflare R2）。开启“默认上传素材”后，新上传和生成媒体直接写入对象存储；关闭后先写本机，仅在需要公网 URL 的生成协议中按需上传。
                            </p>
                        </div>
                    </div>
                </div>
                <SettingsSectionCard
                    icon={<Cloud className="size-4" />}
                    title="平台对象存储"
                    description="配置平台媒体资源的默认对象存储。"
                    status={
                        <Space size={6}>
                            <Tag variant="filled" color={setting?.enabled ? "success" : "default"}>
                                {setting?.enabled ? "已启用" : "未启用"}
                            </Tag>
                            <Tag variant="filled" color={setting?.defaultUpload ? "blue" : "default"}>
                                {setting?.defaultUpload ? "默认上传" : "按需上传"}
                            </Tag>
                            <Tag variant="filled" color={setting?.hasAccessKeySecret ? "blue" : "warning"}>
                                {setting?.hasAccessKeySecret ? configuredSecretText : "未保存密钥"}
                            </Tag>
                        </Space>
                    }
                    footer={
                        <>
                            <div className="text-xs text-foreground/45">
                                {setting?.updatedAt
                                    ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}`
                                    : "尚未保存对象存储配置"}
                            </div>
                            <Button type="primary" loading={saving} onClick={() => void save()}>
                                保存对象存储配置
                            </Button>
                        </>
                    }
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                        <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 md:grid-cols-2">
                            <Form.Item name="enabled" label="启用对象存储" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                            <Form.Item
                                name="defaultUpload"
                                label="默认上传素材"
                                valuePropName="checked"
                                extra="关闭后日常素材先存本机，仅公网协议按需上传，更省对象存储费用。"
                            >
                                <Switch checkedChildren="默认上传" unCheckedChildren="按需上传" />
                            </Form.Item>
                            <Form.Item name="provider" label="存储渠道" rules={[{ required: true, message: "请选择存储渠道" }]}>
                                <Select
                                    options={[
                                        { label: "阿里云 OSS", value: "aliyun" },
                                        { label: "通用 S3 / Cloudflare R2", value: "s3" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="region" label="Region" extra={provider === "s3" ? "R2 通常填 auto" : undefined}>
                                <Input autoComplete="off" placeholder={provider === "s3" ? "auto" : "例如：oss-cn-hangzhou"} />
                            </Form.Item>
                            <Form.Item name="endpoint" label="Endpoint">
                                <Input
                                    autoComplete="off"
                                    placeholder={provider === "s3" ? "https://<accountid>.r2.cloudflarestorage.com" : "https://oss-cn-hangzhou.aliyuncs.com"}
                                />
                            </Form.Item>
                            <Form.Item name="bucket" label="Bucket">
                                <Input autoComplete="off" placeholder="例如：my-canvas-assets" />
                            </Form.Item>
                            <Form.Item name="pathPrefix" label="路径前缀">
                                <Input autoComplete="off" placeholder="例如：uploads/infinite-canvas" />
                            </Form.Item>
                            <Form.Item name="accessKeyId" label="AccessKey ID">
                                <Input autoComplete="off" placeholder={provider === "s3" ? "R2 / S3 Access Key ID" : "阿里云 AccessKey ID"} />
                            </Form.Item>
                            <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? `AccessKey Secret（${configuredSecretText}）` : "AccessKey Secret"}>
                                <Input.Password
                                    autoComplete="new-password"
                                    placeholder={setting?.hasAccessKeySecret ? "留空保留原密钥" : provider === "s3" ? "R2 / S3 Secret Access Key" : "阿里云 AccessKey Secret"}
                                />
                            </Form.Item>
                        </div>
                    </Form>
                </SettingsSectionCard>
                <div className="grid gap-3 text-xs text-foreground/55 sm:grid-cols-3">
                    <Notice icon={<Cloud className="size-3.5" />} text="S3 兼容含 R2" />
                    <Notice icon={<ShieldCheck className="size-3.5" />} text="AccessKey Secret 不回显" />
                    <Notice icon={<KeyRound className="size-3.5" />} text="可按需上传省费用" />
                </div>
            </div>
        </AdminPageFrame>
    );
}

function formValues(setting?: AdminOSSSetting | null): OSSFormValues {
    return {
        enabled: setting?.enabled || false,
        defaultUpload: setting?.defaultUpload ?? setting?.provider !== "s3",
        provider: setting?.provider || "aliyun",
        region: setting?.region || "",
        endpoint: setting?.endpoint || "",
        bucket: setting?.bucket || "",
        accessKeyId: setting?.accessKeyId || "",
        accessKeySecret: "",
        pathPrefix: setting?.pathPrefix || "",
    };
}
function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
function Notice({ icon, text }: { icon: ReactNode; text: string }) {
    return (
        <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2">
            <span className="text-foreground/40">{icon}</span>
            <span>{text}</span>
        </div>
    );
}
