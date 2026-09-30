// 对象存储设置的表单模型：表单值与接口载荷互转、变更检测与草稿校验。
//
// 服务器访问地址只校验 http/https 格式，允许本机、局域网与 HTTP 地址（产品约定，勿收紧）。

import { type AdminOSSSetting } from "@/services/api/auth";
import { DEFAULT_OSS_PATH_PREFIX, normalizeOSSConnectionTestInput } from "@/lib/oss-settings";
import { type S3Preset } from "@/lib/oss-settings";

export type StorageMode = "local" | AdminOSSSetting["provider"];

export type OSSFormValues = {
    mode: StorageMode;
    publicBaseUrl: string;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    cdnAuthMode: "" | "public" | "qiniu" | string;
    requireCDN: boolean;
    allowPrivateProxy: boolean;
    bucket: string;
    accessKeyId: string;
    accessKeySecret: string;
    sessionToken: string;
    pathPrefix: string;
    s3Preset: S3Preset;
    pathStyle: boolean;
    allowUserS3: boolean;
};

export type StoragePayload = Pick<
    AdminOSSSetting,
    | "enabled"
    | "provider"
    | "region"
    | "endpoint"
    | "cdnBaseUrl"
    | "cdnAuthMode"
    | "requireCDN"
    | "allowPrivateProxy"
    | "bucket"
    | "accessKeyId"
    | "accessKeySecret"
    | "sessionToken"
    | "publicBaseUrl"
    | "pathPrefix"
    | "s3Preset"
    | "pathStyle"
    | "allowUserS3"
>;

export function formValues(setting: AdminOSSSetting): OSSFormValues {
    return {
        mode: setting.enabled ? setting.provider : "local",
        publicBaseUrl: setting.publicBaseUrl || "",
        region: setting.region || "",
        endpoint: setting.endpoint || "",
        cdnBaseUrl: setting.cdnBaseUrl || "",
        cdnAuthMode: setting.cdnAuthMode || "",
        requireCDN: setting.requireCDN === true,
        allowPrivateProxy: setting.allowPrivateProxy === true,
        bucket: setting.bucket || "",
        accessKeyId: setting.accessKeyId || "",
        accessKeySecret: "",
        sessionToken: "",
        pathPrefix: setting.pathPrefix || DEFAULT_OSS_PATH_PREFIX,
        s3Preset: setting.s3Preset || "custom",
        pathStyle: setting.pathStyle === true,
        allowUserS3: setting.allowUserS3 === true,
    };
}

export function providerDraftValues(mode: Exclude<StorageMode, "local">, setting: AdminOSSSetting, pathPrefix: string): Partial<OSSFormValues> {
    if (mode === setting.provider) {
        return {
            region: setting.region || "",
            endpoint: setting.endpoint || "",
            cdnBaseUrl: setting.cdnBaseUrl || "",
            cdnAuthMode: setting.cdnAuthMode || "",
            requireCDN: setting.requireCDN === true,
            allowPrivateProxy: setting.allowPrivateProxy === true,
            bucket: setting.bucket || "",
            accessKeyId: setting.accessKeyId || "",
            accessKeySecret: "",
            sessionToken: "",
            pathPrefix: setting.pathPrefix || pathPrefix || "",
            s3Preset: setting.s3Preset || "custom",
            pathStyle: setting.pathStyle === true,
        };
    }
    return {
        region: "",
        endpoint: "",
        cdnBaseUrl: "",
        cdnAuthMode: "",
        requireCDN: false,
        allowPrivateProxy: false,
        bucket: "",
        accessKeyId: "",
        accessKeySecret: "",
        sessionToken: "",
        pathPrefix: pathPrefix || DEFAULT_OSS_PATH_PREFIX,
        s3Preset: "custom",
        pathStyle: false,
    };
}

export function normalizeStoragePayload(values: Partial<OSSFormValues>, setting: AdminOSSSetting): StoragePayload {
    const mode = values.mode || "local";
    const provider = mode === "local" ? setting.provider || "aliyun" : mode;
    const region = values.region?.trim() || "";
    let endpoint = trimTrailingSlash(values.endpoint || "");
    if (provider === "tencent" && !endpoint && region) endpoint = `https://cos.${region}.myqcloud.com`;
    return {
        enabled: mode !== "local",
        provider,
        region,
        endpoint,
        cdnBaseUrl: trimTrailingSlash(values.cdnBaseUrl || ""),
        cdnAuthMode: values.cdnAuthMode || "",
        requireCDN: values.requireCDN === true,
        allowPrivateProxy: values.allowPrivateProxy === true,
        bucket: values.bucket?.trim() || "",
        accessKeyId: values.accessKeyId?.trim() || "",
        accessKeySecret: values.accessKeySecret?.trim() || "",
        sessionToken: values.sessionToken?.trim() || "",
        publicBaseUrl: trimTrailingSlash(values.publicBaseUrl || ""),
        pathPrefix: (values.pathPrefix?.trim() || DEFAULT_OSS_PATH_PREFIX).replace(/^\/+|\/+$/g, ""),
        s3Preset: values.s3Preset || "custom",
        pathStyle: values.pathStyle === true,
        allowUserS3: values.allowUserS3 === true,
    };
}

export function hasStorageChanges(values: Partial<OSSFormValues>, setting: AdminOSSSetting | null) {
    if (!setting) return false;
    const draft = normalizeStoragePayload(values, setting);
    const saved = normalizeStoragePayload(formValues(setting), setting);
    if (draft.accessKeySecret || draft.sessionToken) return true;
    return (Object.keys(saved) as Array<keyof StoragePayload>).some((key) => key !== "accessKeySecret" && key !== "sessionToken" && draft[key] !== saved[key]);
}

export function validateStorageDraft(values: OSSFormValues, setting: AdminOSSSetting) {
    const draft = normalizeStoragePayload(values, setting);
    if (!draft.enabled) return validatePublicBaseURL(draft.publicBaseUrl);
    if (!draft.bucket) return "请填写对象存储 Bucket";
    if (!draft.endpoint)
        return draft.provider === "tencent" ? "请填写腾讯云 COS Region 或 Endpoint" : draft.provider === "qiniu" ? "请填写七牛云 Kodo 上传 Endpoint" : draft.provider === "s3" ? "请填写 S3 Endpoint 服务根 URL" : "请填写阿里云 OSS Endpoint";
    if (draft.provider === "s3" && !draft.region) return "请填写 S3 Region";
    if (!isHTTPURL(draft.endpoint)) return "Endpoint 必须是完整的 http/https 地址";
    if (draft.cdnBaseUrl && !isValidCDNBaseURL(draft.cdnBaseUrl)) return "CDN 或绑定域名只能填写 http/https 根地址，不能包含认证、路径、查询参数或片段";
    if (!draft.accessKeyId) return `请填写 ${accessKeyIdLabel(draft.provider)}`;
    if (!draft.accessKeySecret && !(setting.provider === draft.provider && setting.hasAccessKeySecret)) return `请填写 ${accessKeySecretLabel(draft.provider)}`;
    return "";
}

export function validatePublicBaseURL(value: string) {
    if (!value) return "服务器本地存储需要填写服务器访问地址";
    try {
        const parsed = new URL(value);
        if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) return "服务器访问地址必须是完整的 http/https 地址";
        if (parsed.search || parsed.hash) return "服务器访问地址不能包含查询参数或片段";
        if (parsed.pathname.replace(/\/+$/, "").endsWith("/api")) return "服务器访问地址请填写站点根地址，不要包含 /api";
        return "";
    } catch {
        return "服务器访问地址必须是完整的 http/https 地址";
    }
}

export function storageResponseMatches(setting: AdminOSSSetting, expected: StoragePayload) {
    const actual = normalizeStoragePayload(formValues(setting), setting);
    const fields: Array<keyof StoragePayload> = ["enabled", "provider", "region", "endpoint", "cdnBaseUrl", "cdnAuthMode", "requireCDN", "allowPrivateProxy", "bucket", "accessKeyId", "publicBaseUrl", "pathPrefix", "s3Preset", "pathStyle", "allowUserS3"];
    if (expected.accessKeySecret && !setting.hasAccessKeySecret) return false;
    if (expected.sessionToken && !setting.hasSessionToken) return false;
    return fields.every((key) => actual[key] === expected[key]);
}

export function isAdminOSSSetting(value: unknown): value is AdminOSSSetting {
    if (!value || typeof value !== "object") return false;
    const setting = value as Partial<AdminOSSSetting>;
    return (
        typeof setting.enabled === "boolean" &&
        ["aliyun", "tencent", "qiniu", "s3"].includes(setting.provider || "") &&
        ["aws", "r2", "b2", "rustfs", "custom"].includes(setting.s3Preset || "") &&
        typeof setting.region === "string" &&
        typeof setting.endpoint === "string" &&
        typeof setting.cdnBaseUrl === "string" &&
        typeof setting.cdnAuthMode === "string" &&
        typeof setting.requireCDN === "boolean" &&
        typeof setting.allowPrivateProxy === "boolean" &&
        typeof setting.bucket === "string" &&
        typeof setting.accessKeyId === "string" &&
        typeof setting.hasAccessKeySecret === "boolean" &&
        typeof setting.hasSessionToken === "boolean" &&
        typeof setting.pathStyle === "boolean" &&
        typeof setting.allowUserS3 === "boolean" &&
        typeof setting.publicBaseUrl === "string" &&
        typeof setting.pathPrefix === "string"
    );
}

export function storageConfigurationReady(mode: StorageMode, values: StoragePayload, setting: AdminOSSSetting) {
    if (mode === "local") return !validatePublicBaseURL(values.publicBaseUrl);
    return !validateStorageDraft({ ...formValues(setting), ...values, mode }, setting);
}

export function storageProviderLabel(provider?: StorageMode) {
    return provider === "s3" ? "S3 兼容存储" : provider === "tencent" ? "腾讯云 COS" : provider === "qiniu" ? "七牛云 Kodo" : provider === "aliyun" ? "阿里云 OSS" : "服务器本地";
}

export function providerGuidance(mode: Exclude<StorageMode, "local">) {
    if (mode === "s3") return "使用预设快速填写 Region 与 Endpoint，也可以选择自定义；自托管 S3 仍受服务端私网主机白名单约束。";
    if (mode === "tencent") return "腾讯云可只填写 Region，由服务端生成标准 COS Endpoint；也可填写完整 Endpoint 覆盖。";
    if (mode === "qiniu") return "七牛上传必须配置上传 Endpoint；绑定域名可选，留空时资源由当前后端使用 AK/SK 代理读取。";
    return "阿里云需要完整 OSS Endpoint、Bucket 和访问密钥；CDN 域名可选。";
}

export function accessKeyIdLabel(mode: Exclude<StorageMode, "local"> | AdminOSSSetting["provider"]) {
    return mode === "tencent" ? "SecretId" : mode === "qiniu" ? "AccessKey" : "AccessKey ID";
}

export function accessKeySecretLabel(mode: Exclude<StorageMode, "local"> | AdminOSSSetting["provider"]) {
    return mode === "tencent" || mode === "qiniu" ? "SecretKey" : "AccessKey Secret";
}

export function isHTTPURL(value: string) {
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol);
    } catch {
        return false;
    }
}

export function isValidCDNBaseURL(value: string) {
    try {
        const parsed = new URL(value);
        return Boolean(parsed.hostname) && ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && !parsed.pathname.replace(/\/+$/, "");
    } catch {
        return false;
    }
}

export function trimTrailingSlash(value: string) {
    return value.trim().replace(/\/+$/, "");
}

export function connectionInput(values: Partial<OSSFormValues>) {
    return normalizeOSSConnectionTestInput({
        provider: !values.mode || values.mode === "local" ? ("aliyun" as const) : values.mode,
        s3Preset: values.s3Preset,
        region: values.region,
        endpoint: values.endpoint,
        cdnBaseUrl: values.cdnBaseUrl,
        bucket: values.bucket,
        accessKeyId: values.accessKeyId,
        accessKeySecret: values.accessKeySecret,
        sessionToken: values.sessionToken,
        pathPrefix: values.pathPrefix,
        pathStyle: values.pathStyle === true,
    });
}

export function hasValidSettingTime(value?: string) {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date.getFullYear() >= 2000;
}

export function formatSettingTime(value: string | undefined, fallback: string) {
    if (!hasValidSettingTime(value)) return fallback;
    return `更新于 ${new Date(value as string).toLocaleString("zh-CN", { hour12: false })}`;
}
