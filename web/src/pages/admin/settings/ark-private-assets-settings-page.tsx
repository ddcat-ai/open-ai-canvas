import { App, Button, Form, Input, Switch } from "antd";
import { CloudUpload, KeyRound, Save } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAdminArkPrivateAssetSetting, updateAdminArkPrivateAssetSetting, type AdminArkPrivateAssetSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";

type ArkPrivateAssetForm = {
    enabled: boolean;
    region: string;
    projectName: string;
    accessKeyId: string;
    accessKeySecret: string;
};

export default function ArkPrivateAssetsSettingsPage() {
    const { t } = useTranslation("canvas");
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
                if (!cancelled) message.error(error instanceof Error ? error.message : t("admin:failed-to-load-ark-asset-library-config"));
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [form, message]);

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && !values.accessKeySecret.trim() && !setting?.hasAccessKeySecret) {
            message.error(t("admin:enter-the-iam-secretkey"));
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
            message.success(t("admin:ark-asset-library-config-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-ark-asset-library-config"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title={t("admin:ark-asset-library")} description={t("admin:configure-backend-trusted-asset-import-for-seedance-reference-images")} scroll>
            <div className="pt-4">
                <SettingsSectionCard
                    icon={<CloudUpload className="size-4" />}
                    title={t("admin:private-virtual-human-assets")}
                    description={t("admin:the-system-uploads-with-iam-credentials-and-awaits-review-only-when-the")}
                    status={<AdminStatusBadge label={setting?.enabled ? t("admin:enabled") : t("admin:not-enabled")} tone={setting?.enabled ? "success" : "neutral"} />}
                    footer={
                        <>
                            <span className="text-xs text-foreground/45">
                                {setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : t("admin:ark-asset-library-config-not-saved-yet")}
                            </span>
                            <Button type="primary" icon={<Save className="size-4" />} loading={saving} disabled={loading} onClick={() => void save()}>
                                {t("admin:save-config-5")}
                            </Button>
                        </>
                    }
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving} className="grid gap-x-4 px-4 pb-4 pt-4 md:grid-cols-2">
                        <Form.Item name="enabled" label={t("admin:enable-trusted-asset-sync")} valuePropName="checked" className="md:col-span-2">
                            <Switch checkedChildren={t("admin:enabled-2")} unCheckedChildren={t("admin:disabled-2")} />
                        </Form.Item>
                        <Form.Item name="region" label="Region" rules={[{ required: enabled, message: t("admin:enter-the-ark-region") }]}>
                            <Input autoComplete="off" placeholder={t("admin:deployer-s-ark-region")} />
                        </Form.Item>
                        <Form.Item name="projectName" label="Ark ProjectName" rules={[{ required: enabled, message: t("admin:enter-the-ark-projectname") }]}>
                            <Input autoComplete="off" placeholder={t("admin:deployer-s-ark-projectname")} />
                        </Form.Item>
                        <Form.Item name="accessKeyId" label="IAM AccessKey" rules={[{ required: enabled, message: t("admin:enter-the-iam-accesskey") }]}>
                            <Input autoComplete="off" prefix={<KeyRound className="size-4 text-foreground/35" />} placeholder={t("admin:stored-server-side-only")} />
                        </Form.Item>
                        <Form.Item name="accessKeySecret" label={setting?.hasAccessKeySecret ? `IAM SecretKey（${configuredSecretText}）` : "IAM SecretKey"}>
                            <Input.Password autoComplete="new-password" placeholder={setting?.hasAccessKeySecret ? t("admin:leave-blank-to-keep-current-keys") : t("admin:stored-server-side-only")} />
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
