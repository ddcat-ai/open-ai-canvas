import { App, Button, Form, Input, Select, Space, Switch, Tag } from "antd";
import { Cloud, Info, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type OSSFormValues = { enabled?: boolean; provider: "aliyun"; region?: string; endpoint?: string; bucket?: string; accessKeyId?: string; accessKeySecret?: string; pathPrefix?: string };

export default function StorageSettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<OSSFormValues>();
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminOSSSetting()
            .then(({ setting: value }) => { setSetting(value); form.setFieldsValue(formValues(value)); })
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
            const result = await updateAdminOSSSetting({ enabled: values.enabled === true, provider: values.provider, region: values.region?.trim() || "", endpoint: values.endpoint?.trim() || "", bucket: values.bucket?.trim() || "", accessKeyId: values.accessKeyId?.trim() || "", accessKeySecret: values.accessKeySecret?.trim() || "", publicBaseUrl: "", pathPrefix: values.pathPrefix?.trim() || "" });
            setSetting(result.setting);
            form.setFieldsValue(formValues(result.setting));
            message.success("OSS 配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存 OSS 配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title="存储服务" description="OSS 与资源存储">
            <div className="mx-auto max-w-5xl space-y-5">
                <div className="rounded-lg border border-border bg-muted/25 p-4 text-foreground/75">
                    <div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted/60"><Info className="size-4" /></span><div><div className="text-sm font-semibold text-foreground">资源存储规则</div><p className="mt-1 text-xs leading-6 text-foreground/55">启用后，新上传和生成的媒体由后端写入 OSS；未启用时写入后端数据卷。资源统一通过登录鉴权接口读取，不直接暴露 OSS 对象地址。</p></div></div>
                </div>
                <SettingsSectionCard
                    icon={<Cloud className="size-4" />}
                    title="平台 OSS"
                    description="配置平台媒体资源的默认存储位置。"
                    status={<Space size={6}><Tag bordered={false} color={setting?.enabled ? "success" : "default"}>{setting?.enabled ? "已启用" : "未启用"}</Tag><Tag bordered={false} color={setting?.hasAccessKeySecret ? "blue" : "warning"}>{setting?.hasAccessKeySecret ? configuredSecretText : "未保存密钥"}</Tag></Space>}
                    footer={<><div className="text-xs text-foreground/45">{setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "尚未保存 OSS 配置"}</div><Button type="primary" loading={saving} onClick={() => void save()}>保存 OSS 配置</Button></>}
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                        <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 md:grid-cols-2">
                            <Form.Item name="enabled" label="启用 OSS" valuePropName="checked"><Switch /></Form.Item>
                            <Form.Item name="provider" label="存储渠道" rules={[{ required: true, message: "请选择存储渠道" }]}><Select options={[{ label: "阿里云 OSS", value: "aliyun" }]} /></Form.Item>
                            <Form.Item name="region" label="Region"><Input placeholder="例如：oss-cn-hangzhou" /></Form.Item>
                            <Form.Item name="endpoint" label="Endpoint"><Input placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Form.Item>
                            <Form.Item name="bucket" label="Bucket"><Input placeholder="例如：my-canvas-assets" /></Form.Item>
                            <Form.Item name="pathPrefix" label="路径前缀"><Input placeholder="例如：uploads/infinite-canvas" /></Form.Item>
                            <Form.Item name="accessKeyId" label="AccessKey ID"><Input placeholder="阿里云 AccessKey ID" /></Form.Item>
                            <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? `AccessKey Secret（${configuredSecretText}）` : "AccessKey Secret"}><Input.Password placeholder={setting?.hasAccessKeySecret ? "留空保留原密钥" : "阿里云 AccessKey Secret"} /></Form.Item>
                        </div>
                    </Form>
                </SettingsSectionCard>
                <div className="grid gap-3 text-xs text-foreground/55 sm:grid-cols-3"><Notice icon={<Cloud className="size-3.5" />} text="新资源优先上传 OSS" /><Notice icon={<ShieldCheck className="size-3.5" />} text="AccessKey Secret 不回显" /><Notice icon={<KeyRound className="size-3.5" />} text="异常时自动本地降级" /></div>
            </div>
        </AdminPageFrame>
    );
}

function formValues(setting?: AdminOSSSetting | null): OSSFormValues { return { enabled: setting?.enabled || false, provider: setting?.provider || "aliyun", region: setting?.region || "", endpoint: setting?.endpoint || "", bucket: setting?.bucket || "", accessKeyId: setting?.accessKeyId || "", accessKeySecret: "", pathPrefix: setting?.pathPrefix || "" }; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
function Notice({ icon, text }: { icon: ReactNode; text: string }) { return <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2"><span className="text-foreground/40">{icon}</span><span>{text}</span></div>; }
