import { App, Button, Form, Input, Segmented, Space, Tag } from "antd";
import { Cloud, HardDrive, Info, KeyRound, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type StorageMode = "local" | "oss";
type OSSFormValues = { mode: StorageMode; region?: string; endpoint?: string; bucket?: string; accessKeyId?: string; accessKeySecret?: string; pathPrefix?: string };

export default function StorageSettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<OSSFormValues>();
    const mode = Form.useWatch("mode", form) || "local";
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminOSSSetting()
            .then(({ setting: value }) => { setSetting(value); form.setFieldsValue(formValues(value)); })
            .catch((error) => message.error(error instanceof Error ? error.message : "读取 OSS 配置失败"))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        await form.validateFields();
        // 本地模式会卸载 OSS 字段，读取完整 store 才能保留已保存的 OSS 配置。
        const values = form.getFieldsValue(true);
        if (values.mode === "oss" && !values.accessKeySecret?.trim() && !setting?.hasAccessKeySecret) return message.error("请填写 AccessKey Secret");
        if (values.mode === "oss" && !values.endpoint?.trim()) return message.error("请填写 OSS Endpoint");
        if (values.mode === "oss" && !values.bucket?.trim()) return message.error("请填写 OSS Bucket");
        if (values.mode === "oss" && !values.accessKeyId?.trim()) return message.error("请填写 AccessKey ID");
        setSaving(true);
        try {
            const result = await updateAdminOSSSetting({ enabled: values.mode === "oss", provider: "aliyun", region: values.region?.trim() || "", endpoint: values.endpoint?.trim() || "", bucket: values.bucket?.trim() || "", accessKeyId: values.accessKeyId?.trim() || "", accessKeySecret: values.accessKeySecret?.trim() || "", publicBaseUrl: "", pathPrefix: values.pathPrefix?.trim() || "" });
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
        <AdminPageFrame title="存储服务" description="配置新增资源的默认存储位置">
            <div className="space-y-4 pt-4">
                <div className="border-b border-border px-1 pb-4 text-foreground/75">
                    <div className="flex items-start gap-3"><span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-md bg-muted/60"><Info className="size-4" /></span><div><div className="text-sm font-semibold text-foreground">资源存储规则</div><p className="mt-1 text-xs leading-6 text-foreground/55">存储类型只影响之后新增的媒体资源，不迁移或改写历史文件。服务器本地与 OSS 资源均通过登录鉴权接口读取。</p></div></div>
                </div>
                <SettingsSectionCard
                    icon={<Cloud className="size-4" />}
                    title="平台存储"
                    description="选择平台新增媒体资源的默认写入方式。"
                    status={<Space size={6}><Tag variant="filled" color={setting?.enabled ? "blue" : "default"}>{setting?.enabled ? "阿里云 OSS" : "服务器本地"}</Tag>{setting?.enabled ? <Tag variant="filled" color={setting.hasAccessKeySecret ? "success" : "warning"}>{setting.hasAccessKeySecret ? configuredSecretText : "未保存密钥"}</Tag> : null}</Space>}
                    footer={<><div className="text-xs text-foreground/45">{setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "尚未保存平台存储配置"}</div><Button type="primary" loading={saving} onClick={() => void save()}>保存存储配置</Button></>}
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading}>
                        <div className="grid grid-cols-1 gap-x-5 px-5 pt-5 md:grid-cols-2">
                            <Form.Item className="md:col-span-2" name="mode" label="存储类型" rules={[{ required: true, message: "请选择存储类型" }]}>
                                <Segmented<StorageMode>
                                    block
                                    options={[
                                        { label: <span className="inline-flex items-center gap-2"><HardDrive className="size-4" />服务器本地</span>, value: "local" },
                                        { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />阿里云 OSS</span>, value: "oss" },
                                    ]}
                                />
                            </Form.Item>
                            {mode === "oss" ? (
                                <>
                                    <Form.Item name="region" label="Region"><Input autoComplete="off" placeholder="例如：oss-cn-hangzhou" /></Form.Item>
                                    <Form.Item name="endpoint" label="Endpoint"><Input autoComplete="off" placeholder="https://oss-cn-hangzhou.aliyuncs.com" /></Form.Item>
                                    <Form.Item name="bucket" label="Bucket"><Input autoComplete="off" placeholder="例如：my-canvas-assets" /></Form.Item>
                                    <Form.Item name="pathPrefix" label="路径前缀"><Input autoComplete="off" placeholder="例如：uploads/infinite-canvas" /></Form.Item>
                                    <Form.Item name="accessKeyId" label="AccessKey ID"><Input autoComplete="off" placeholder="阿里云 AccessKey ID" /></Form.Item>
                                    <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? `AccessKey Secret（${configuredSecretText}）` : "AccessKey Secret"}><Input.Password autoComplete="new-password" placeholder={setting?.hasAccessKeySecret ? "留空保留原密钥" : "阿里云 AccessKey Secret"} /></Form.Item>
                                </>
                            ) : (
                                <div className="md:col-span-2 border-t border-border py-4 text-sm text-foreground/65">
                                    新增资源将写入后端数据目录的 <code className="text-foreground">resources/</code>，部署时需持久化该数据卷。
                                </div>
                            )}
                        </div>
                    </Form>
                </SettingsSectionCard>
                <div className="grid border-y border-border text-xs text-foreground/55 sm:grid-cols-3 sm:divide-x sm:divide-border"><Notice icon={mode === "oss" ? <Cloud className="size-3.5" /> : <HardDrive className="size-3.5" />} text={mode === "oss" ? "新资源写入阿里云 OSS" : "新资源写入服务器数据卷"} /><Notice icon={<ShieldCheck className="size-3.5" />} text="历史资源位置保持不变" /><Notice icon={<KeyRound className="size-3.5" />} text="资源读取继续校验登录态" /></div>
            </div>
        </AdminPageFrame>
    );
}

function formValues(setting?: AdminOSSSetting | null): OSSFormValues { return { mode: setting?.enabled ? "oss" : "local", region: setting?.region || "", endpoint: setting?.endpoint || "", bucket: setting?.bucket || "", accessKeyId: setting?.accessKeyId || "", accessKeySecret: "", pathPrefix: setting?.pathPrefix || "" }; }
function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
function Notice({ icon, text }: { icon: ReactNode; text: string }) { return <div className="flex items-center gap-2 px-3 py-2.5"><span className="text-foreground/40">{icon}</span><span>{text}</span></div>; }
