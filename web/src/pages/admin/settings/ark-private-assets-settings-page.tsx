import { App, Button, Form, Input, Switch } from "antd";
import { CloudUpload, KeyRound, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAdminArkPrivateAssetSetting, updateAdminArkPrivateAssetSetting, type AdminArkPrivateAssetSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type ArkPrivateAssetForm = {
    enabled: boolean;
    region: string;
    projectName: string;
    accessKeyId: string;
    accessKeySecret: string;
};

export default function ArkPrivateAssetsSettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminArkPrivateAssetSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<ArkPrivateAssetForm>();
    const enabled = Form.useWatch("enabled", form) ?? false;
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        let cancelled = false;
        void getAdminArkPrivateAssetSetting()
            .then(({ setting: value }) => {
                if (cancelled) return;
                setSetting(value);
                form.setFieldsValue(toFormValues(value));
            })
            .catch((error) => {
                if (!cancelled) message.error(error instanceof Error ? error.message : "读取方舟素材库配置失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && !values.accessKeySecret.trim() && !setting?.hasAccessKeySecret) {
            message.error("请填写 IAM SecretKey");
            return;
        }
        setSaving(true);
        try {
            const result = await updateAdminArkPrivateAssetSetting({
                enabled: values.enabled,
                region: values.region.trim(),
                projectName: values.projectName.trim(),
                accessKeyId: values.accessKeyId.trim(),
                accessKeySecret: values.accessKeySecret.trim(),
            });
            setSetting(result.setting);
            form.setFieldsValue(toFormValues(result.setting));
            message.success("方舟素材库配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存方舟素材库配置失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title="方舟素材库" description="为 Seedance 参考图配置后端可信素材导入" scroll>
            <div className="pt-4">
                <SettingsSectionCard
                    icon={<CloudUpload className="size-4" />}
                    title="私域虚拟人素材"
                    description="系统仅在用户启用自动同步且参考图属于当前用户素材库时，才会用 IAM 凭据上传并等待审核。"
                    status={<AdminStatusBadge label={setting?.enabled ? "已启用" : "未启用"} tone={setting?.enabled ? "success" : "neutral"} />}
                    footer={(
                        <>
                            <span className="text-xs text-foreground/45">{setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : "尚未保存方舟素材库配置"}</span>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading} onClick={() => void save()}>保存配置</Button>
                        </>
                    )}
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving} className="grid gap-x-4 px-4 pb-4 pt-4 md:grid-cols-2">
                        <Form.Item name="enabled" label="启用可信素材同步" valuePropName="checked" className="md:col-span-2">
                            <Switch checkedChildren="启用" unCheckedChildren="停用" />
                        </Form.Item>
                        <Form.Item name="region" label="Region" rules={[{ required: enabled, message: "请填写方舟 Region" }]}>
                            <Input autoComplete="off" placeholder="部署方的方舟 Region" />
                        </Form.Item>
                        <Form.Item name="projectName" label="Ark ProjectName" rules={[{ required: enabled, message: "请填写 Ark ProjectName" }]}>
                            <Input autoComplete="off" placeholder="部署方的 Ark ProjectName" />
                        </Form.Item>
                        <Form.Item name="accessKeyId" label="IAM AccessKey" rules={[{ required: enabled, message: "请填写 IAM AccessKey" }]}>
                            <Input autoComplete="off" prefix={<KeyRound className="size-4 text-foreground/35" />} placeholder="仅保存在服务端" />
                        </Form.Item>
                        <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? `IAM SecretKey（${configuredSecretText}）` : "IAM SecretKey"}>
                            <Input.Password autoComplete="new-password" placeholder={setting?.hasAccessKeySecret ? "留空保留原密钥" : "仅保存在服务端"} />
                        </Form.Item>
                    </Form>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}

function toFormValues(setting: AdminArkPrivateAssetSetting): ArkPrivateAssetForm {
    return {
        enabled: setting.enabled,
        region: setting.region || "",
        projectName: setting.projectName || "",
        accessKeyId: setting.accessKeyId || "",
        accessKeySecret: "",
    };
}

function formatTime(value: string) {
    return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
