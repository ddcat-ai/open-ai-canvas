import { App, Button, Form, Input, Tag } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Cloud, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { currentLocale } from "@/i18n";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getS3PresetHints, S3_PRESET_OPTIONS, validateOSSConnectionDraft, VOLCENGINE_TOS_REGION_HINT, type OSSConnectionTestResult, type OSSProvider, type S3Preset } from "@/lib/oss-settings";
import { getUserOSSSetting, testUserOSSConnection, updateUserOSSSetting, type UserOSSSetting } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { StatusBadge } from "@/components/ui/base/badges";
import { Select } from "@/components/ui/base/select";

type OSSFormValues = {
    enabled?: boolean;
    provider: OSSProvider;
    s3Preset?: S3Preset;
    region?: string;
    endpoint?: string;
    cdnBaseUrl?: string;
    cdnAuthMode?: "" | "public" | "qiniu" | string;
    requireCDN?: boolean;
    allowPrivateProxy?: boolean;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    sessionToken?: string;
    pathPrefix?: string;
    pathStyle?: boolean;
};

export function UserOSSSettingsForm() {
    const { t } = useTranslation();
    const actor = useUserStore((state) => state.user);
    const { message } = App.useApp();
    const [form] = Form.useForm<OSSFormValues>();
    const [setting, setSetting] = useState<UserOSSSetting | null>(null);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<OSSConnectionTestResult | null>(null);
    const [testStale, setTestStale] = useState(false);
    const savedAt = formatSavedAt(setting?.updatedAt);
    const provider = Form.useWatch("provider", form) || "aliyun";
    const isTencentCOS = provider === "tencent";
    const isQiniuKodo = provider === "qiniu";
    const isVolcengineTOS = provider === "volcengine";
    const isS3 = provider === "s3";
    const s3Preset = Form.useWatch("s3Preset", form) || "custom";
    const hasCurrentProviderSecret = Boolean(setting && setting.provider === provider && setting.hasAccessKeySecret);
    const accessKeyIdLabel = isTencentCOS ? "SecretId" : isQiniuKodo ? "AccessKey" : isVolcengineTOS ? "Access Key ID" : "AccessKey ID";
    const accessKeySecretLabel = isTencentCOS ? "SecretKey" : isQiniuKodo ? "SecretKey" : isVolcengineTOS ? "Secret Access Key" : "AccessKey Secret";

    useEffect(() => {
        if (!actor?.id) return;
        let active = true;
        setLoading(true);
        void getUserOSSSetting()
            .then((data) => {
                if (!active) return;
                setSetting(data.setting);
                form.setFieldsValue(toFormValues(data.setting));
                setTestResult(data.setting.testedAt ? { ok: true, testedAt: data.setting.testedAt, testedDigest: data.setting.testedDigest } : null);
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : t("account.layout.oss.loadFailed")))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [actor?.id, form, message, t]);

    if (!actor) {
        return <div className="rounded-md border border-dashed border-border px-5 py-10 text-center text-sm text-foreground/55">{t("account.layout.oss.loginRequired")}</div>;
    }

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && values.provider === "s3" && !setting?.allowUserS3) return message.error(t("account.layout.oss.s3NotAllowed"));
        setSaving(true);
        try {
            const data = await updateUserOSSSetting({
                enabled: values.enabled === true,
                provider: values.provider || "aliyun",
                s3Preset: values.s3Preset || "custom",
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
                cdnAuthMode: values.cdnAuthMode || "",
                requireCDN: values.requireCDN === true,
                allowPrivateProxy: values.allowPrivateProxy === true,
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                sessionToken: values.sessionToken?.trim() || "",
                pathPrefix: values.pathPrefix?.trim() || DEFAULT_OSS_PATH_PREFIX,
                pathStyle: values.pathStyle === true,
            });
            setSetting(data.setting);
            form.setFieldsValue(toFormValues(data.setting));
            setTestResult(data.setting.testedAt ? { ok: true, testedAt: data.setting.testedAt, testedDigest: data.setting.testedDigest } : null);
            setTestStale(false);
            message.success(data.setting.enabled ? t("account.layout.oss.enabledSuccess") : t("account.layout.oss.disabledSuccess"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.layout.oss.saveFailed"));
        } finally {
            setSaving(false);
        }
    };

    const testConnection = async () => {
        const values = await form.validateFields();
        const validationError = validateOSSConnectionDraft(values);
        if (validationError) {
            message.error(validationError);
            return;
        }
        setTesting(true);
        try {
            const result = await testUserOSSConnection(connectionInput(values));
            setTestResult(result);
            setTestStale(false);
            result.ok ? message.success(result.message || t("account.layout.oss.testPassed")) : message.error(result.message || t("account.layout.oss.testFailed"));
        } catch (error) {
            setTestResult({ ok: false, message: error instanceof Error ? error.message : t("account.layout.oss.testFailed") });
            setTestStale(false);
        } finally {
            setTesting(false);
        }
    };

    return (
        <Form form={form} layout="vertical" requiredMark={false} disabled={loading} onValuesChange={(changed) => changesRequireOSSRetest(changed) && setTestStale(true)}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cloud className="size-4" />
                        {t("account.layout.oss.title")}
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/55">{t("account.layout.oss.description")}</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <StatusBadge tone={setting?.enabled ? "success" : "neutral"} label={setting?.enabled ? t("account.layout.oss.enabled") : t("account.layout.oss.notEnabled")} />
                    <Tag color={setting?.hasAccessKeySecret ? "processing" : "warning"} icon={<ShieldCheck className="size-3" />}>
                        {setting?.hasAccessKeySecret ? t("account.layout.oss.secretEncrypted") : t("account.layout.oss.secretMissing")}
                    </Tag>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 xl:grid-cols-3">
                <Form.Item name="enabled" label={t("account.layout.oss.enableLabel")} valuePropName="checked" className="mb-3">
                    <Switch checkedChildren={t("account.layout.oss.switchOn")} unCheckedChildren={t("account.layout.oss.switchOff")} />
                </Form.Item>
                <Form.Item name="provider" label={t("account.layout.oss.provider")} rules={[{ required: true, message: t("account.layout.oss.providerRequired") }]} className="mb-3">
                    <Select
                        options={[{ label: t("account.layout.oss.providers.aliyun"), value: "aliyun" }, { label: t("account.layout.oss.providers.tencent"), value: "tencent" }, { label: t("account.layout.oss.providers.qiniu"), value: "qiniu" }, { label: t("account.layout.oss.providers.volcengine"), value: "volcengine" }, { label: t("account.layout.oss.providers.s3"), value: "s3", disabled: setting?.allowUserS3 === false }]}
                        onChange={(nextProvider: OSSFormValues["provider"]) => {
                            if (nextProvider !== provider) form.setFieldsValue({ s3Preset: "custom", region: "", endpoint: "", cdnBaseUrl: "", cdnAuthMode: "", requireCDN: false, allowPrivateProxy: false, bucket: "", accessKeyId: "", accessKeySecret: "", sessionToken: "", pathStyle: false });
                        }}
                    />
                </Form.Item>
                {isS3 ? (
                    <Form.Item name="s3Preset" label={t("account.layout.oss.s3Preset")} className="mb-3">
                        <Select options={S3_PRESET_OPTIONS} onChange={(preset: S3Preset) => form.setFieldsValue(getS3PresetHints(preset))} />
                    </Form.Item>
                ) : null}
                <Form.Item name="region" label="Region" extra={isVolcengineTOS ? t("account.layout.oss.regionHint", { regions: VOLCENGINE_TOS_REGION_HINT }) : undefined} className="mb-3">
                    <Input spellCheck={false} placeholder={isS3 ? getS3PresetHints(s3Preset).region : isTencentCOS ? "ap-guangzhou" : isQiniuKodo ? "z0 / cn-east-1" : isVolcengineTOS ? "cn-beijing" : "oss-cn-hangzhou"} />
                </Form.Item>
                <Form.Item
                    name="endpoint"
                    label={isQiniuKodo ? t("account.layout.oss.uploadEndpoint") : "Endpoint"}
                    extra={
                        isS3
                            ? getS3PresetHints(s3Preset).help
                            : isTencentCOS
                              ? t("account.layout.oss.endpointHintTencent")
                              : isVolcengineTOS
                                ? t("account.layout.oss.endpointHintVolcengine")
                                : undefined
                    }
                    className="mb-3"
                >
                    <Input
                        inputMode="url"
                        spellCheck={false}
                        placeholder={
                            isS3
                                ? getS3PresetHints(s3Preset).endpoint
                                : isTencentCOS
                                  ? "https://cos.ap-guangzhou.myqcloud.com"
                                  : isQiniuKodo
                                    ? "https://up-z0.qiniup.com"
                                    : isVolcengineTOS
                                      ? "https://tos-s3-cn-beijing.volces.com"
                                      : "https://oss-cn-hangzhou.aliyuncs.com"
                        }
                    />
                </Form.Item>
                <Form.Item
                    name="cdnBaseUrl"
                    label={isQiniuKodo ? t("account.layout.oss.cdnQiniu") : isS3 ? t("account.layout.oss.cdnS3") : t("account.layout.oss.cdnDefault")}
                    extra={
                        isTencentCOS
                            ? t("account.layout.oss.cdnHintTencent")
                            : isQiniuKodo
                              ? t("account.layout.oss.cdnHintQiniu")
                              : isVolcengineTOS
                                ? t("account.layout.oss.cdnHintVolcengine")
                                : t("account.layout.oss.cdnHintAliyun")
                    }
                    rules={[{ type: "url", message: t("account.layout.oss.cdnInvalid") }]}
                    className="mb-3"
                >
                    <Input inputMode="url" spellCheck={false} placeholder="https://media.example.com" />
                </Form.Item>
                <Form.Item
                    name="cdnAuthMode"
                    label={t("account.layout.oss.cdnAuth")}
                    extra={isQiniuKodo ? t("account.layout.oss.cdnAuthHintQiniu") : t("account.layout.oss.cdnAuthHintDefault")}
                    className="mb-3"
                >
                    <Select options={[{ label: t("account.layout.oss.cdnAuthNone"), value: "" }, { label: t("account.layout.oss.cdnAuthPublic"), value: "public" }, { label: t("account.layout.oss.cdnAuthQiniu"), value: "qiniu", disabled: !isQiniuKodo }]} />
                </Form.Item>
                <Form.Item name="requireCDN" label={t("account.layout.oss.requireCDN")} valuePropName="checked" extra={t("account.layout.oss.requireCDNHint")} className="mb-3">
                    <Switch checkedChildren={t("account.layout.oss.requireCDNOn")} unCheckedChildren={t("account.layout.oss.requireCDNOff")} />
                </Form.Item>
                <Form.Item name="allowPrivateProxy" label={t("account.layout.oss.privateProxy")} valuePropName="checked" extra={t("account.layout.oss.privateProxyHint")} className="mb-3">
                    <Switch checkedChildren={t("account.layout.oss.allow")} unCheckedChildren={t("account.layout.oss.deny")} />
                </Form.Item>
                <Form.Item name="bucket" label="Bucket" className="mb-3">
                    <Input spellCheck={false} placeholder={isTencentCOS ? "my-canvas-assets-1250000000" : isQiniuKodo ? t("account.layout.oss.bucketQiniu") : isVolcengineTOS ? t("account.layout.oss.bucketVolcengine") : "my-canvas-assets"} />
                </Form.Item>
                <Form.Item name="pathPrefix" label={t("account.layout.oss.pathPrefix")} className="mb-3">
                    <Input spellCheck={false} placeholder={DEFAULT_OSS_PATH_PREFIX} />
                </Form.Item>
                <Form.Item name="accessKeyId" label={accessKeyIdLabel} className="mb-3 xl:col-span-1">
                    <Input autoComplete="off" spellCheck={false} placeholder={isTencentCOS ? t("account.layout.oss.keyIdTencent") : isQiniuKodo ? t("account.layout.oss.keyIdQiniu") : isVolcengineTOS ? t("account.layout.oss.keyIdVolcengine") : t("account.layout.oss.keyIdAliyun")} />
                </Form.Item>
                <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? t("account.layout.oss.keepBlank", { label: accessKeySecretLabel }) : accessKeySecretLabel} className="mb-3 xl:col-span-2">
                    <Input.Password autoComplete="new-password" spellCheck={false} placeholder={hasCurrentProviderSecret ? t("account.layout.oss.keepSecret") : isTencentCOS ? t("account.layout.oss.secretTencent") : isQiniuKodo ? t("account.layout.oss.secretQiniu") : isVolcengineTOS ? t("account.layout.oss.secretVolcengine") : t("account.layout.oss.secretAliyun")} />
                </Form.Item>
                {isS3 ? (
                    <>
                        <Form.Item name="sessionToken" label={setting?.hasSessionToken ? t("account.layout.oss.keepBlank", { label: "Session Token" }) : t("account.layout.oss.sessionTokenOptional")} className="mb-3">
                            <Input.Password autoComplete="new-password" spellCheck={false} placeholder={setting?.hasSessionToken ? t("account.layout.oss.keepToken") : t("account.layout.oss.sessionTokenPlaceholder")} />
                        </Form.Item>
                        <Form.Item name="pathStyle" label="Path Style" valuePropName="checked" extra={t("account.layout.oss.pathStyleHint")} className="mb-3">
                            <Switch checkedChildren={t("account.layout.oss.force")} unCheckedChildren={t("account.layout.oss.auto")} />
                        </Form.Item>
                    </>
                ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-foreground/50">{savedAt ? t("account.layout.oss.savedAt", { time: savedAt }) : t("account.layout.oss.notSaved")}</span><ConnectionTestStatus result={testResult} stale={testStale} /></div>
                <div className="flex flex-wrap gap-2"><Button loading={testing} onClick={() => void testConnection()}>{t("account.layout.oss.test")}</Button><Button type="primary" loading={saving} onClick={() => void save()}>{t("account.layout.oss.save")}</Button></div>
            </div>
        </Form>
    );
}

function formatSavedAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "";
    return date.toLocaleString(currentLocale());
}

function toFormValues(setting: UserOSSSetting): OSSFormValues {
    return {
        enabled: setting.enabled,
        provider: setting.provider || "aliyun",
        s3Preset: setting.s3Preset || "custom",
        region: setting.region,
        endpoint: setting.endpoint,
        cdnBaseUrl: setting.cdnBaseUrl,
        cdnAuthMode: setting.cdnAuthMode || "",
        requireCDN: setting.requireCDN === true,
        allowPrivateProxy: setting.allowPrivateProxy === true,
        bucket: setting.bucket,
        accessKeyId: setting.accessKeyId,
        accessKeySecret: "",
        sessionToken: "",
        pathPrefix: setting.pathPrefix || DEFAULT_OSS_PATH_PREFIX,
        pathStyle: setting.pathStyle === true,
    };
}

function connectionInput(values: OSSFormValues) {
    return {
        provider: values.provider,
        s3Preset: values.s3Preset,
        region: values.region?.trim() || "",
        endpoint: values.endpoint?.trim() || "",
        cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
        bucket: values.bucket?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
        sessionToken: values.sessionToken?.trim() || "",
        pathPrefix: values.pathPrefix?.trim() || DEFAULT_OSS_PATH_PREFIX,
        pathStyle: values.pathStyle === true,
    };
}

function ConnectionTestStatus({ result, stale }: { result: OSSConnectionTestResult | null; stale: boolean }) {
    const { t } = useTranslation();
    if (stale) return <StatusBadge tone="warning" label={t("account.layout.oss.retestNeeded")} />;
    if (!result) return null;
    return <StatusBadge tone={result.ok ? "success" : "error"} label={result.ok ? (result.testedAt ? t("account.layout.oss.testPassedAt", { time: formatSavedAt(result.testedAt) }) : t("account.layout.oss.testPassedShort")) : result.message || t("account.layout.oss.testFailedShort")} />;
}
