import { App, Button, Form, Input, Select, Switch, Tag } from "antd";
import { Cloud, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { formatLocale } from "@/lib/format-locale";
import { getUserOSSSetting, updateUserOSSSetting, type UserOSSSetting } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { useTranslation } from "react-i18next";

type OSSFormValues = {
    enabled?: boolean;
    provider: "aliyun" | "tencent" | "qiniu";
    region?: string;
    endpoint?: string;
    cdnBaseUrl?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    pathPrefix?: string;
};

export function UserOSSSettingsForm() {
    const { t } = useTranslation("canvas");
    const actor = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [form] = Form.useForm<OSSFormValues>();
    const [setting, setSetting] = useState<UserOSSSetting | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const savedAt = formatSavedAt(setting?.updatedAt);
    const provider = Form.useWatch("provider", form) || "aliyun";
    const isTencentCOS = provider === "tencent";
    const isQiniuKodo = provider === "qiniu";
    const hasCurrentProviderSecret = Boolean(setting && setting.provider === provider && setting.hasAccessKeySecret);
    const accessKeyIdLabel = isTencentCOS ? "SecretId" : isQiniuKodo ? "AccessKey" : "AccessKey ID";
    const accessKeySecretLabel = isTencentCOS ? "SecretKey" : isQiniuKodo ? "SecretKey" : "AccessKey Secret";

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
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("domain:failed-to-read-personal-object-storage-settings")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [actor?.id, form, message]);

    if (!actor) {
        return <div className="rounded-md border border-dashed border-border px-5 py-10 text-center text-sm text-foreground/55">{t("domain:sign-in-to-configure-personal-object-storage")}</div>;
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
                cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                pathPrefix: values.pathPrefix?.trim() || "",
            });
            setSetting(data.setting);
            form.setFieldsValue(toFormValues(data.setting));
            message.success(data.setting.enabled ? t("domain:personal-object-storage-enabled-future-uploads-will-use-it-first") : t("domain:personal-object-storage-disabled-future-uploads-will-use-platform-storag"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("domain:failed-to-save-personal-object-storage-settings"));
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
                        {t("domain:my-object-storage-2")}
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/55">{t("domain:when-enabled-newly-uploaded-and-generated-media-goes-to-your-bucket-firs")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <Tag color={setting?.enabled ? "success" : "default"}>{setting?.enabled ? t("domain:enabled") : t("domain:not-enabled")}</Tag>
                    <Tag color={setting?.hasAccessKeySecret ? "processing" : "warning"} icon={<ShieldCheck className="size-3" />}>
                        {setting?.hasAccessKeySecret ? t("domain:secret-keys-are-stored-encrypted") : t("domain:keys-not-saved-yet")}
                    </Tag>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 xl:grid-cols-3">
                <Form.Item name="enabled" label={t("domain:enable-personal-object-storage")} valuePropName="checked" className="mb-3">
                    <Switch checkedChildren={t("domain:enabled-2")} unCheckedChildren={t("domain:disabled")} />
                </Form.Item>
                <Form.Item name="provider" label={t("domain:storage-services")} rules={[{ required: true, message: t("domain:choose-a-storage-provider") }]} className="mb-3">
                    <Select
                        options={[
                            { label: t("domain:aliyun-oss"), value: "aliyun" },
                            { label: t("domain:tencent-cos"), value: "tencent" },
                            { label: t("domain:qiniu-kodo"), value: "qiniu" },
                        ]}
                        onChange={(nextProvider: OSSFormValues["provider"]) => {
                            if (nextProvider !== provider) form.setFieldsValue({ region: "", endpoint: "", cdnBaseUrl: "", bucket: "", accessKeyId: "", accessKeySecret: "" });
                        }}
                    />
                </Form.Item>
                <Form.Item name="region" label="Region" className="mb-3">
                    <Input spellCheck={false} placeholder={isTencentCOS ? "ap-guangzhou" : isQiniuKodo ? "z0 / cn-east-1" : "oss-cn-hangzhou"} />
                </Form.Item>
                <Form.Item name="endpoint" label={isQiniuKodo ? t("domain:upload-endpoint") : "Endpoint"} extra={isTencentCOS ? t("domain:optional-a-standard-cos-endpoint-is-generated-from-the-region") : undefined} className="mb-3">
                    <Input inputMode="url" spellCheck={false} placeholder={isTencentCOS ? "https://cos.ap-guangzhou.myqcloud.com" : isQiniuKodo ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"} />
                </Form.Item>
                <Form.Item
                    name="cdnBaseUrl"
                    label={isQiniuKodo ? t("domain:bound-domain-optional") : t("domain:cdn-domain")}
                    extra={
                        isTencentCOS
                            ? t("domain:optional-uploads-still-use-the-endpoint-downloads-and-previews-go-throug")
                            : isQiniuKodo
                              ? t("domain:optional-when-filled-the-browser-connects-directly-to-the-qiniu-private")
                              : t("domain:optional-uploads-still-use-the-endpoint-downloads-and-previews-go-throug-2")
                    }
                    rules={[{ type: "url", message: t("domain:enter-a-full-http-https-cdn-domain") }]}
                    className="mb-3"
                >
                    <Input inputMode="url" spellCheck={false} placeholder="https://media.example.com" />
                </Form.Item>
                <Form.Item name="bucket" label="Bucket" className="mb-3">
                    <Input spellCheck={false} placeholder={isTencentCOS ? "my-canvas-assets-1250000000" : isQiniuKodo ? t("domain:qiniu-bucket-name") : "my-canvas-assets"} />
                </Form.Item>
                <Form.Item name="pathPrefix" label={t("domain:path-prefix")} className="mb-3">
                    <Input spellCheck={false} placeholder="infinite-canvas" />
                </Form.Item>
                <Form.Item name="accessKeyId" label={accessKeyIdLabel} className="mb-3 xl:col-span-1">
                    <Input autoComplete="off" spellCheck={false} placeholder={isTencentCOS ? t("domain:tencent-cloud-secretid") : isQiniuKodo ? t("domain:qiniu-accesskey") : t("domain:alibaba-cloud-accesskey-id")} />
                </Form.Item>
                <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? t("domain:param-leave-empty-to-keep", { accessKeySecretLabel: accessKeySecretLabel }) : accessKeySecretLabel} className="mb-3 xl:col-span-2">
                    <Input.Password
                        autoComplete="new-password"
                        spellCheck={false}
                        placeholder={
                            hasCurrentProviderSecret ? t("domain:leave-empty-to-keep-the-encrypted-secret") : isTencentCOS ? t("domain:tencent-cloud-secretkey") : isQiniuKodo ? t("domain:qiniu-secretkey") : t("domain:alibaba-cloud-accesskey-secret")
                        }
                    />
                </Form.Item>
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <span className="text-xs text-foreground/50">{savedAt ? t("domain:last-saved-param", { savedAt: savedAt }) : t("domain:personal-object-storage-not-saved-yet")}</span>
                <Button type="primary" loading={saving} onClick={() => void save()}>
                    {t("domain:save-personal-object-storage")}
                </Button>
            </div>
        </Form>
    );
}

function formatSavedAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "";
    return date.toLocaleString(formatLocale());
}

function toFormValues(setting: UserOSSSetting): OSSFormValues {
    return {
        enabled: setting.enabled,
        provider: setting.provider || "aliyun",
        region: setting.region,
        endpoint: setting.endpoint,
        cdnBaseUrl: setting.cdnBaseUrl,
        bucket: setting.bucket,
        accessKeyId: setting.accessKeyId,
        accessKeySecret: "",
        pathPrefix: setting.pathPrefix,
    };
}
