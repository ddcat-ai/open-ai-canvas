import { App, Button, Form, Input, Select, Tag } from "antd";
import { Switch } from "@/components/ui/base/switch";
import { Cloud, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getCDNAuthTypeOptions, getS3PresetHints, isValidCDNBaseURL, normalizeOSSConnectionTestInput, S3_PRESET_OPTIONS, supportsCDNViewerAuth, validateCDNViewerAuth, type CDNAuthType, type OSSConnectionTestResult, type OSSProvider, type S3Preset } from "@/lib/oss-settings";
import { getUserOSSSetting, testUserOSSConnection, updateUserOSSSetting, type UserOSSSetting } from "@/services/api/resources";
import { useUserStore } from "@/stores/use-user-store";
import { StatusBadge } from "@/components/ui/base/badges";

type OSSFormValues = {
    enabled?: boolean;
    provider: OSSProvider;
    s3Preset?: S3Preset;
    region?: string;
    endpoint?: string;
    cdnBaseUrl?: string;
    cdnAuthType?: CDNAuthType;
    cdnAuthKey?: string;
    bucket?: string;
    accessKeyId?: string;
    accessKeySecret?: string;
    sessionToken?: string;
    pathPrefix?: string;
    pathStyle?: boolean;
};

export function UserOSSSettingsForm() {
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
    const isS3 = provider === "s3";
    const s3Preset = Form.useWatch("s3Preset", form) || "custom";
    const cdnBaseUrl = (Form.useWatch("cdnBaseUrl", form) || "").trim().replace(/\/+$/, "");
    const supportsCDNAuth = supportsCDNViewerAuth(provider) && cdnBaseUrl !== "";
    const hasCurrentProviderSecret = Boolean(setting && setting.provider === provider && setting.hasAccessKeySecret);
    const hasCurrentCDNAuthKey = Boolean(setting && setting.provider === provider && (setting.cdnBaseUrl || "") === cdnBaseUrl && setting.hasCdnAuthKey);
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
                setTestResult(data.setting.testedAt ? { ok: true, testedAt: data.setting.testedAt, testedDigest: data.setting.testedDigest } : null);
            })
            .catch((error) => active && message.error(error instanceof Error ? error.message : "读取个人对象存储配置失败"))
            .finally(() => active && setLoading(false));
        return () => {
            active = false;
        };
    }, [actor?.id, form, message]);

    if (!actor) {
        return <div className="rounded-md border border-dashed border-border px-5 py-10 text-center text-sm text-foreground/55">登录后可配置个人对象存储。</div>;
    }

    const save = async () => {
        const values = await form.validateFields();
        if (values.enabled && values.provider === "s3" && !setting?.allowUserS3) return message.error("平台管理员尚未允许个人 S3 兼容存储");
        const cdnAuthType = supportsCDNAuth ? values.cdnAuthType || "" : "";
        const cdnAuthKey = supportsCDNAuth ? values.cdnAuthKey?.trim() || "" : "";
        if (values.enabled) {
            const cdnAuthError = validateCDNViewerAuth({
                provider: values.provider || "aliyun",
                cdnBaseUrl,
                cdnAuthType,
                hasAuthKey: Boolean(cdnAuthKey) || hasCurrentCDNAuthKey,
            });
            if (cdnAuthError) return message.error(cdnAuthError);
        }
        setSaving(true);
        try {
            const data = await updateUserOSSSetting({
                enabled: values.enabled === true,
                provider: values.provider || "aliyun",
                s3Preset: values.s3Preset || "custom",
                region: values.region?.trim() || "",
                endpoint: values.endpoint?.trim() || "",
                cdnBaseUrl,
                cdnAuthType,
                cdnAuthKey,
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
            message.success(data.setting.enabled ? "个人对象存储已启用，后续上传将写入该存储；失败时不会降级到浏览器本地" : "个人对象存储已停用，后续上传将使用平台存储");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存个人对象存储配置失败");
        } finally {
            setSaving(false);
        }
    };

    const testConnection = async () => {
        const values = await form.validateFields();
        setTesting(true);
        try {
            const result = await testUserOSSConnection(connectionInput(values));
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
        <Form form={form} layout="vertical" requiredMark={false} disabled={loading} onValuesChange={(changed) => changesRequireOSSRetest(changed) && setTestStale(true)}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
                <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                        <Cloud className="size-4" />
                        我的对象存储
                    </div>
                    <p className="mt-1 max-w-3xl text-xs leading-5 text-foreground/55">启用后，新上传和新生成的媒体写入你的存储桶；上传失败会提示重试，不会降级到浏览器本地。</p>
                </div>
                <div className="flex shrink-0 gap-2">
                    <StatusBadge tone={setting?.enabled ? "success" : "neutral"} label={setting?.enabled ? "已启用" : "未启用"} />
                    <Tag color={setting?.hasAccessKeySecret ? "processing" : "warning"} icon={<ShieldCheck className="size-3" />}>
                        {setting?.hasAccessKeySecret ? "密钥已加密" : "未保存密钥"}
                    </Tag>
                </div>
            </div>

            <div className="grid grid-cols-1 gap-x-4 md:grid-cols-2 xl:grid-cols-3">
                <Form.Item name="enabled" label="启用个人对象存储" valuePropName="checked" className="mb-3">
                    <Switch checkedChildren="启用" unCheckedChildren="停用" />
                </Form.Item>
                <Form.Item name="provider" label="存储服务" rules={[{ required: true, message: "请选择存储服务" }]} className="mb-3">
                    <Select
                        options={[{ label: "阿里云 OSS", value: "aliyun" }, { label: "腾讯云 COS", value: "tencent" }, { label: "七牛云 Kodo", value: "qiniu" }, { label: "S3 兼容存储", value: "s3", disabled: setting?.allowUserS3 === false }]}
                        onChange={(nextProvider: OSSFormValues["provider"]) => {
                            if (nextProvider !== provider) form.setFieldsValue({ s3Preset: "custom", region: "", endpoint: "", cdnBaseUrl: "", cdnAuthType: "", cdnAuthKey: "", bucket: "", accessKeyId: "", accessKeySecret: "", sessionToken: "", pathStyle: false });
                        }}
                    />
                </Form.Item>
                {isS3 ? (
                    <Form.Item name="s3Preset" label="S3 预设" className="mb-3">
                        <Select options={S3_PRESET_OPTIONS} onChange={(preset: S3Preset) => form.setFieldsValue(getS3PresetHints(preset))} />
                    </Form.Item>
                ) : null}
                <Form.Item name="region" label="Region" className="mb-3">
                    <Input spellCheck={false} placeholder={isS3 ? getS3PresetHints(s3Preset).region : isTencentCOS ? "ap-guangzhou" : isQiniuKodo ? "z0 / cn-east-1" : "oss-cn-hangzhou"} />
                </Form.Item>
                <Form.Item name="endpoint" label={isQiniuKodo ? "上传 Endpoint" : "Endpoint"} extra={isS3 ? getS3PresetHints(s3Preset).help : isTencentCOS ? "可留空，系统会根据 Region 生成标准 COS Endpoint。" : undefined} className="mb-3">
                    <Input inputMode="url" spellCheck={false} placeholder={isS3 ? getS3PresetHints(s3Preset).endpoint : isTencentCOS ? "https://cos.ap-guangzhou.myqcloud.com" : isQiniuKodo ? "https://up-z0.qiniup.com" : "https://oss-cn-hangzhou.aliyuncs.com"} />
                </Form.Item>
                <Form.Item
                    name="cdnBaseUrl"
                    label={isQiniuKodo ? "绑定域名（可选）" : isS3 ? "公网访问域名（可选）" : "公网 CDN 域名（可选）"}
                    extra={isQiniuKodo ? "填写后使用七牛私有下载签名；留空时使用 Kodo S3 短时签名。" : isS3 ? "用于浏览器直接读取 S3 对象；该域名必须已配置公开读取或由 CDN/反向代理自行完成鉴权。留空时继续使用 S3 短时签名或同源代理。" : "配置 Viewer 鉴权后由 CDN 边缘节点分发；未配置时继续使用源站短时签名，不会返回裸 CDN 链接。"}
                    rules={[{ validator: (_, value: string) => (!value?.trim() || isValidCDNBaseURL(value.trim()) ? Promise.resolve() : Promise.reject(new Error("请填写 HTTPS 域名根地址（内网部署可用 HTTP），不能包含路径、查询参数或认证信息"))) }]}
                    className="mb-3"
                >
                    <Input
                        inputMode="url"
                        spellCheck={false}
                        placeholder="https://media.example.com"
                        onChange={(event) => {
                            const nextDomain = event.target.value.trim().replace(/\/+$/, "");
                            if (nextDomain !== cdnBaseUrl) form.setFieldsValue({ cdnAuthType: "", cdnAuthKey: "" });
                        }}
                    />
                </Form.Item>
                {supportsCDNAuth ? (
                    <>
                        <Form.Item name="cdnAuthType" label="CDN Viewer 鉴权" extra="需与 CDN 控制台中该域名启用的鉴权方式一致。" className="mb-3">
                            <Select options={getCDNAuthTypeOptions(provider)} />
                        </Form.Item>
                        <Form.Item
                            name="cdnAuthKey"
                            label={hasCurrentCDNAuthKey ? "CDN 鉴权密钥（留空保留）" : "CDN 鉴权密钥"}
                            extra="在 CDN 控制台单独配置，与对象存储 AK/SK 无关；更换域名后必须重新填写。"
                            className="mb-3"
                        >
                            <Input.Password autoComplete="new-password" spellCheck={false} placeholder={hasCurrentCDNAuthKey ? "留空保留已加密密钥" : "CDN 鉴权 Key"} />
                        </Form.Item>
                    </>
                ) : null}
                <Form.Item name="bucket" label="Bucket" className="mb-3">
                    <Input spellCheck={false} placeholder={isTencentCOS ? "my-canvas-assets-1250000000" : isQiniuKodo ? "七牛云存储空间名称" : "my-canvas-assets"} />
                </Form.Item>
                <Form.Item name="pathPrefix" label="路径前缀" className="mb-3">
                    <Input spellCheck={false} placeholder={DEFAULT_OSS_PATH_PREFIX} />
                </Form.Item>
                <Form.Item name="accessKeyId" label={accessKeyIdLabel} className="mb-3 xl:col-span-1">
                    <Input autoComplete="off" spellCheck={false} placeholder={isTencentCOS ? "腾讯云 SecretId" : isQiniuKodo ? "七牛云 AccessKey" : "阿里云 AccessKey ID"} />
                </Form.Item>
                <Form.Item name="accessKeySecret" label={hasCurrentProviderSecret ? `${accessKeySecretLabel}（留空保留）` : accessKeySecretLabel} className="mb-3 xl:col-span-2">
                    <Input.Password autoComplete="new-password" spellCheck={false} placeholder={hasCurrentProviderSecret ? "留空保留已加密密钥" : isTencentCOS ? "腾讯云 SecretKey" : isQiniuKodo ? "七牛云 SecretKey" : "阿里云 AccessKey Secret"} />
                </Form.Item>
                {isS3 ? (
                    <>
                        <Form.Item name="sessionToken" label={setting?.hasSessionToken ? "Session Token（留空保留）" : "Session Token（可选）"} className="mb-3">
                            <Input.Password autoComplete="new-password" spellCheck={false} placeholder={setting?.hasSessionToken ? "留空保留已加密 Token" : "临时凭证使用的 Session Token"} />
                        </Form.Item>
                        <Form.Item name="pathStyle" label="Path Style" valuePropName="checked" extra="开启后强制 path-style；关闭时自动选择。" className="mb-3">
                            <Switch checkedChildren="强制" unCheckedChildren="自动" />
                        </Form.Item>
                    </>
                ) : null}
            </div>

            <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2"><span className="text-xs text-foreground/50">{savedAt ? `上次保存：${savedAt}` : "尚未保存个人对象存储配置"}</span><ConnectionTestStatus result={testResult} stale={testStale} /></div>
                <div className="flex flex-wrap gap-2"><Button loading={testing} onClick={() => void testConnection()}>测试连接</Button><Button type="primary" loading={saving} onClick={() => void save()}>保存个人对象存储</Button></div>
            </div>
        </Form>
    );
}

function formatSavedAt(value?: string) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime()) || date.getFullYear() < 2000) return "";
    return date.toLocaleString("zh-CN");
}

function toFormValues(setting: UserOSSSetting): OSSFormValues {
    return {
        enabled: setting.enabled,
        provider: setting.provider || "aliyun",
        s3Preset: setting.s3Preset || "custom",
        region: setting.region,
        endpoint: setting.endpoint,
        cdnBaseUrl: setting.cdnBaseUrl,
        cdnAuthType: setting.cdnAuthType || "",
        cdnAuthKey: "",
        bucket: setting.bucket,
        accessKeyId: setting.accessKeyId,
        accessKeySecret: "",
        sessionToken: "",
        pathPrefix: setting.pathPrefix || DEFAULT_OSS_PATH_PREFIX,
        pathStyle: setting.pathStyle === true,
    };
}

function connectionInput(values: OSSFormValues) {
    return normalizeOSSConnectionTestInput({
        provider: values.provider,
        s3Preset: values.s3Preset,
        region: values.region?.trim() || "",
        endpoint: values.endpoint?.trim() || "",
        cdnBaseUrl: values.cdnBaseUrl?.trim() || "",
        cdnAuthType: values.provider !== "s3" && supportsCDNViewerAuth(values.provider) ? values.cdnAuthType || "" : "",
        cdnAuthKey: values.provider !== "s3" && supportsCDNViewerAuth(values.provider) ? values.cdnAuthKey?.trim() || "" : "",
        bucket: values.bucket?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
        sessionToken: values.sessionToken?.trim() || "",
        pathPrefix: values.pathPrefix?.trim() || DEFAULT_OSS_PATH_PREFIX,
        pathStyle: values.pathStyle === true,
    });
}

function ConnectionTestStatus({ result, stale }: { result: OSSConnectionTestResult | null; stale: boolean }) {
    if (stale) return <StatusBadge tone="warning" label="需重新测试" />;
    if (!result) return null;
    return <StatusBadge tone={result.ok ? "success" : "error"} label={result.ok ? `测试通过${result.testedAt ? ` · ${formatSavedAt(result.testedAt)}` : ""}` : result.message || "测试失败"} />;
}
