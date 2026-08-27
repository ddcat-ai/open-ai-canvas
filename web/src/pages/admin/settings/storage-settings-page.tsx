import { App, Button, Form, Input, Segmented, Select, Space, Switch, Tag } from "antd";
import { Cloud, Globe, HardDrive, LocateFixed, Wifi } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getS3PresetHints, S3_PRESET_OPTIONS, type OSSConnectionTestResult, type S3Preset } from "@/lib/oss-settings";
import { getAdminOSSSetting, testAdminOSSConnection, updateAdminOSSSetting, type AdminOSSSetting } from "@/services/api/auth";
import { useAdminContext } from "../admin-context";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminStatusBadge, configuredSecretText, SettingsSectionCard } from "../components/admin-ui";

type StorageMode = "local" | AdminOSSSetting["provider"];
type OSSFormValues = {
    mode: StorageMode;
    s3Preset?: S3Preset;
    publicBaseUrl?: string;
    region?: string;
    endpoint?: string;
    cdnBaseUrl?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    sessionToken?: string;
    pathPrefix?: string;
    pathStyle?: boolean;
    allowUserS3?: boolean;
};

export default function StorageSettingsPage() {
    const { message } = App.useApp();
    const { references } = useAdminContext();
    const [setting, setSetting] = useState<AdminOSSSetting | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<OSSConnectionTestResult | null>(null);
    const [testStale, setTestStale] = useState(false);
    const [form] = Form.useForm<OSSFormValues>();
    const mode = Form.useWatch("mode", form) || "local";
    const isObjectStorage = mode !== "local";
    const isTencentCOS = mode === "tencent";
    const isQiniuKodo = mode === "qiniu";
    const isS3 = mode === "s3";
    const s3Preset = Form.useWatch("s3Preset", form) || "custom";
    const accessKeyIdLabel = isTencentCOS ? "SecretId" : isQiniuKodo ? "AccessKey" : "AccessKey ID";
    const accessKeySecretLabel = isTencentCOS ? "SecretKey" : isQiniuKodo ? "SecretKey" : "AccessKey Secret";
    const hasCurrentProviderSecret = Boolean(setting && setting.provider === mode && setting.hasAccessKeySecret);
    const userNameById = useMemo(() => new Map(references.users.map((user) => [user.id, user.displayName || user.username])), [references.users]);

    useEffect(() => {
        void getAdminOSSSetting()
            .then(({ setting: value }) => {
                setSetting(value);
                form.setFieldsValue(formValues(value));
                setTestResult(value.testedAt ? { ok: true, testedAt: value.testedAt, testedDigest: value.testedDigest } : null);
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
        if (values.mode === "s3" && !values.region?.trim()) return message.error("请填写 S3 Region");
        if (values.mode === "s3" && !values.endpoint?.trim()) return message.error("请填写 S3 Endpoint 服务根 URL");

        setSaving(true);
        try {
            const result = await updateAdminOSSSetting({
                enabled: values.mode !== "local",
                provider: values.mode === "local" ? setting?.provider || "aliyun" : values.mode,
                s3Preset: values.s3Preset || "custom",
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
                bucket: values.bucket?.trim() || "",
                accessKeyId: values.accessKeyId?.trim() || "",
                accessKeySecret: values.accessKeySecret?.trim() || "",
                sessionToken: values.sessionToken?.trim() || "",
                pathStyle: values.pathStyle === true,
                allowUserS3: values.allowUserS3 === true,
                publicBaseUrl: values.publicBaseUrl?.trim() || "",
                pathPrefix: values.pathPrefix?.trim() || DEFAULT_OSS_PATH_PREFIX,
            });
            setSetting(result.setting);
            form.setFieldsValue(formValues(result.setting));
            setTestResult(result.setting.testedAt ? { ok: true, testedAt: result.setting.testedAt, testedDigest: result.setting.testedDigest } : null);
            setTestStale(false);
            message.success("存储配置已保存");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存存储配置失败");
        } finally {
            setSaving(false);
        }
    };

    const testConnection = async () => {
        const values = await form.validateFields();
        if (values.mode === "local") return;
        setTesting(true);
        try {
            const result = await testAdminOSSConnection(connectionInput(values));
            setTestResult(result);
            setTestStale(false);
            result.ok ? message.success(result.message || "连接测试通过") : message.error(result.message || "连接测试失败");
        } catch (error) {
            setTestResult({ ok: false, message: error instanceof Error ? error.message : "连接测试失败" });
            setTestStale(false);
        } finally {
            setTesting(false);
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
                    <Form form={form} layout="vertical" requiredMark={false} disabled={loading} className="px-5 pb-2" onValuesChange={(changed) => changesRequireOSSRetest(changed) && setTestStale(true)}>
                        <Form.Item name="mode" label="存储类型" rules={[{ required: true, message: "请选择存储类型" }]}>
                            <Segmented<StorageMode>
                                block
                                options={[
                                    { label: <span className="inline-flex items-center gap-2"><HardDrive className="size-4" />服务器本地</span>, value: "local" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />阿里云 OSS</span>, value: "aliyun" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />腾讯云 COS</span>, value: "tencent" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />七牛云 Kodo</span>, value: "qiniu" },
                                    { label: <span className="inline-flex items-center gap-2"><Cloud className="size-4" />S3 兼容存储</span>, value: "s3" },
                                ]}
                                onChange={(value) => {
                                    const nextMode = value as StorageMode;
                                    const switchingProvider = nextMode !== "local" && ((mode !== "local" && mode !== nextMode) || (mode === "local" && setting?.provider !== nextMode));
                                    if (switchingProvider) form.setFieldsValue({ s3Preset: "custom", region: "", endpoint: "", cdnBaseUrl: "", bucket: "", accessKeyId: "", accessKeySecret: "", sessionToken: "", pathStyle: false });
                                }}
                            />
                        </Form.Item>

                        {isObjectStorage ? (
                            <div className="space-y-1">
                                {isS3 ? (
                                    <Form.Item name="s3Preset" label="S3 预设">
                                        <Select
                                            options={S3_PRESET_OPTIONS}
                                            onChange={(preset: S3Preset) => {
                                                const hints = getS3PresetHints(preset);
                                                form.setFieldsValue({ region: hints.region, endpoint: hints.endpoint });
                                            }}
                                        />
                                    </Form.Item>
                                ) : null}
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                                    <Form.Item name="region" label="Region">
                                        <Input autoComplete="off" placeholder={isS3 ? getS3PresetHints(s3Preset).region : isTencentCOS ? "例如：ap-guangzhou" : isQiniuKodo ? "例如：z0 / cn-east-1" : "例如：oss-cn-hangzhou"} />
                                    </Form.Item>
                                    <Form.Item name="bucket" label="Bucket">
                                        <Input autoComplete="off" placeholder={isQiniuKodo ? "七牛云存储空间名称" : "对象存储 Bucket"} />
                                    </Form.Item>
                                    <Form.Item name="pathPrefix" label="路径前缀">
                                        <Input autoComplete="off" placeholder={DEFAULT_OSS_PATH_PREFIX} />
                                    </Form.Item>
                                </div>
                                <div className="grid gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                                    <Form.Item className="xl:col-span-2" name="endpoint" label={isQiniuKodo ? "上传 Endpoint" : "Endpoint"} extra={isS3 ? getS3PresetHints(s3Preset).help : undefined}>
                                        <Input autoComplete="off" inputMode="url" placeholder={isS3 ? getS3PresetHints(s3Preset).endpoint : isTencentCOS ? "https://cos.ap-guangzhou.myqcloud.com" : isQiniuKodo ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"} />
                                    </Form.Item>
                                    <Form.Item
                                        name="cdnBaseUrl"
                                        label={isQiniuKodo ? "绑定域名（可选）" : isS3 ? "公开 CDN（可选）" : "CDN 加速域名"}
                                        extra={isQiniuKodo ? "可选。填写后浏览器直连七牛私有下载地址；留空时采用“浏览器 → 当前后端 /api/resources/:id/file → 七牛 S3 Endpoint”的代理链路，后端使用 AK/SK 读取并返回文件，无需绑定域名。" : undefined}
                                        rules={[{ type: "url", message: "请填写完整的 http/https 地址" }]}
                                    >
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
                                {isS3 ? (
                                    <div className="grid gap-x-4 gap-y-1 md:grid-cols-2">
                                        <Form.Item name="sessionToken" label={setting?.hasSessionToken ? `Session Token（${configuredSecretText}，留空保留）` : "Session Token（可选）"}>
                                            <Input.Password autoComplete="new-password" placeholder={setting?.hasSessionToken ? "留空保留原 Token" : "临时凭证使用的 Session Token"} />
                                        </Form.Item>
                                        <Form.Item name="pathStyle" label="Path Style" valuePropName="checked" extra="开启后强制使用 path-style；关闭时由后端自动选择。">
                                            <Switch checkedChildren="强制" unCheckedChildren="自动" />
                                        </Form.Item>
                                    </div>
                                ) : null}
                                <div className="mb-4 flex flex-wrap items-center gap-3">
                                    <Button icon={<Wifi className="size-4" />} loading={testing} onClick={() => void testConnection()}>测试连接</Button>
                                    <ConnectionTestStatus result={testResult} stale={testStale} />
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
                        <Form.Item name="allowUserS3" label="允许个人 S3 兼容存储" valuePropName="checked" extra="开启后，用户可配置个人 S3；个人配置启用时优先于平台存储，停用时回退平台存储。">
                            <Switch checkedChildren="允许" unCheckedChildren="不允许" />
                        </Form.Item>
                    </Form>
                </SettingsSectionCard>
            </div>
        </AdminPageFrame>
    );
}

function formValues(setting?: AdminOSSSetting | null): OSSFormValues {
    return {
        mode: setting?.enabled ? setting.provider : "local",
        s3Preset: setting?.s3Preset || "custom",
        publicBaseUrl: setting?.publicBaseUrl || "",
        region: setting?.region || "",
        endpoint: setting?.endpoint || "",
        cdnBaseUrl: setting?.cdnBaseUrl || "",
        bucket: setting?.bucket || "",
        accessKeyId: setting?.accessKeyId || "",
        accessKeySecret: "",
        sessionToken: "",
        pathPrefix: setting?.pathPrefix || DEFAULT_OSS_PATH_PREFIX,
        pathStyle: setting?.pathStyle === true,
        allowUserS3: setting?.allowUserS3 === true,
    };
}

function storageProviderLabel(provider?: AdminOSSSetting["provider"] | StorageMode) {
    return provider === "s3" ? "S3 兼容存储" : provider === "tencent" ? "腾讯云 COS" : provider === "qiniu" ? "七牛云 Kodo" : provider === "aliyun" ? "阿里云 OSS" : "服务器本地";
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function connectionInput(values: OSSFormValues) {
    return {
        provider: values.mode === "local" ? "aliyun" as const : values.mode,
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
    if (stale) return <Tag color="warning">关键配置已变更，需重新测试</Tag>;
    if (!result) return <span className="text-xs text-foreground/50">尚未测试连接</span>;
    return <Tag color={result.ok ? "success" : "error"}>{result.ok ? `测试通过${result.testedAt ? ` · ${formatTime(result.testedAt)}` : ""}` : result.message || "测试失败"}</Tag>;
}
