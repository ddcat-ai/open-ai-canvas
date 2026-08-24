import { App, Button, Form, Input, Segmented, Space } from "antd";
import { Cloud, Globe, HardDrive, LocateFixed } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { getAdminOSSSetting, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

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
    const { t } = useTranslation("canvas");
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
            .catch((error) => message.error(error instanceof Error ? error.message : t("admin:failed-to-read-object-storage-config")))
            .finally(() => setLoading(false));
    }, [form, message]);

    const save = async () => {
        await form.validateFields();
        const values = form.getFieldsValue(true);
        if (values.mode === "local" && !values.publicBaseUrl?.trim()) return message.error(t("admin:enter-the-server-access-address"));
        if (values.mode !== "local" && !values.accessKeySecret?.trim() && !hasCurrentProviderSecret) return message.error(t("admin:enter-param-2", { accessKeySecretLabel: accessKeySecretLabel }));
        if (values.mode !== "local" && !values.bucket?.trim()) return message.error(t("admin:enter-the-object-storage-bucket"));
        if (values.mode !== "local" && !values.accessKeyId?.trim()) return message.error(t("admin:enter-param-3", { accessKeyIdLabel: accessKeyIdLabel }));
        if (values.mode === "aliyun" && !values.endpoint?.trim()) return message.error(t("admin:enter-the-aliyun-oss-endpoint"));
        if (values.mode === "tencent" && !values.endpoint?.trim() && !values.region?.trim()) return message.error(t("admin:enter-the-tencent-cos-region-or-endpoint"));
        if (values.mode === "qiniu" && !values.endpoint?.trim()) return message.error(t("admin:enter-the-qiniu-kodo-upload-endpoint"));

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
            message.success(t("admin:storage-config-saved"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-storage-config"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <AdminPageFrame title={t("admin:storage-services")} description={t("admin:set-the-default-storage-location-for-new-assets")} scroll>
            <div className="space-y-4 pt-4">
                <SettingsSectionCard
                    layout="stacked"
                    contentClassName="px-4 pb-4"
                    icon={<Cloud className="size-4" />}
                    title={t("admin:platform-storage")}
                    status={
                        <Space size={6}>
                            <AdminStatusBadge label={setting?.enabled ? storageProviderLabel(setting.provider) : t("admin:server-local-2")} tone="neutral" />
                            {setting?.enabled ? <AdminStatusBadge label={setting.hasAccessKeySecret ? configuredSecretText : t("admin:keys-not-saved-yet")} tone={setting.hasAccessKeySecret ? "success" : "warning"} /> : null}
                        </Space>
                    }
                    footer={
                        <>
                            <div className="text-xs text-foreground/45">
                                {setting?.updatedAt ? `上次更新：${formatTime(setting.updatedAt)}${setting.updatedBy ? ` · ${userNameById.get(setting.updatedBy) || setting.updatedBy}` : ""}` : t("admin:platform-storage-config-not-saved-yet")}
                            </div>
                            <Button type="primary" loading={saving} onClick={() => void save()}>
                                {t("admin:save-storage-config")}
                            </Button>
                        </>
                    }
                >
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading} className="px-5 pb-2">
                        <Form.Item name="mode" label={t("admin:storage-type")} rules={[{ required: true, message: t("admin:select-a-storage-type") }]}>
                            <Segmented<StorageMode>
                                block
                                options={[
                                    {
                                        label: (
                                            <span className="inline-flex items-center gap-2">
                                                <HardDrive className="size-4" />
                                                {t("admin:server-local-2")}
                                            </span>
                                        ),
                                        value: "local",
                                    },
                                    {
                                        label: (
                                            <span className="inline-flex items-center gap-2">
                                                <Cloud className="size-4" />
                                                {t("admin:aliyun-oss-2")}
                                            </span>
                                        ),
                                        value: "aliyun",
                                    },
                                    {
                                        label: (
                                            <span className="inline-flex items-center gap-2">
                                                <Cloud className="size-4" />
                                                {t("admin:tencent-cos-2")}
                                            </span>
                                        ),
                                        value: "tencent",
                                    },
                                    {
                                        label: (
                                            <span className="inline-flex items-center gap-2">
                                                <Cloud className="size-4" />
                                                {t("admin:qiniu-kodo-2")}
                                            </span>
                                        ),
                                        value: "qiniu",
                                    },
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
                                        <Input autoComplete="off" placeholder={isTencentCOS ? t("admin:e-g-ap-guangzhou") : isQiniuKodo ? t("admin:e-g-z0-cn-east-1") : t("admin:e-g-oss-cn-hangzhou")} />
                                    </Form.Item>
                                    <Form.Item name="bucket" label="Bucket">
                                        <Input autoComplete="off" placeholder={isQiniuKodo ? t("admin:qiniu-bucket-name") : t("admin:object-storage-bucket")} />
                                    </Form.Item>
                                    <Form.Item name="pathPrefix" label={t("admin:path-prefix")}>
                                        <Input autoComplete="off" placeholder={t("admin:optional-e-g-canvas")} />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                                    <Form.Item className="xl:col-span-2" name="endpoint" label={isQiniuKodo ? t("admin:upload-endpoint") : "Endpoint"}>
                                        <Input autoComplete="off" inputMode="url" placeholder={isTencentCOS ? "https://cos.ap-guangzhou.myqcloud.com" : isQiniuKodo ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"} />
                                    </Form.Item>
                                    <Form.Item
                                        name="cdnBaseUrl"
                                        label={isQiniuKodo ? t("admin:bound-domain-optional") : t("admin:cdn-domain")}
                                        extra={isQiniuKodo ? t("admin:optional-if-set-browsers-connect-directly-to-qiniu-private-download-urls") : undefined}
                                        rules={[{ type: "url", message: t("admin:enter-a-full-http-https-address") }]}
                                    >
                                        <Input autoComplete="off" inputMode="url" placeholder="https://media.example.com" />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
                                    <Form.Item name="accessKeyId" label={accessKeyIdLabel}>
                                        <Input autoComplete="off" placeholder={isQiniuKodo ? t("admin:qiniu-accesskey") : accessKeyIdLabel} />
                                    </Form.Item>
                                    <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? `${accessKeySecretLabel}（${configuredSecretText}）` : accessKeySecretLabel}>
                                        <Input.Password autoComplete="new-password" placeholder={hasCurrentProviderSecret ? t("admin:leave-blank-to-keep-current-keys") : accessKeySecretLabel} />
                                    </Form.Item>
                                </div>
                            </div>
                        ) : (
                            <Form.Item
                                label={t("admin:server-access-address")}
                                required
                                tooltip={t("admin:used-to-generate-short-lived-links-for-local-resources")}
                                name="publicBaseUrl"
                                rules={[
                                    { required: true, message: t("admin:enter-the-server-access-address") },
                                    { type: "url", message: t("admin:enter-a-full-http-https-address") },
                                ]}
                            >
                                <Space.Compact className="w-full">
                                    <Input className="min-w-0" autoComplete="off" placeholder="https://canvas.example.com" prefix={<Globe className="size-4 text-foreground/35" />} />
                                    <Button icon={<LocateFixed className="size-4" />} onClick={() => form.setFieldValue("publicBaseUrl", window.location.origin)}>
                                        {t("admin:use-current-address")}
                                    </Button>
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
    return provider === "tencent" ? t("admin:tencent-cos-2") : provider === "qiniu" ? t("admin:qiniu-kodo-2") : provider === "aliyun" ? t("admin:aliyun-oss-2") : t("admin:server-local-2");
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}
