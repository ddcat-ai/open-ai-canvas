export type OSSProvider = "aliyun" | "tencent" | "qiniu" | "volcengine" | "s3";

export type S3Preset = "aws" | "r2" | "b2" | "rustfs" | "custom";

export const DEFAULT_OSS_PATH_PREFIX = "open-ai-canvas";

export type OSSConnectionTestInput = {
    provider: OSSProvider;
    s3Preset?: S3Preset;
    region: string;
    endpoint: string;
    cdnBaseUrl: string;
    bucket: string;
    accessKeyId: string;
    accessKeySecret?: string;
    sessionToken?: string;
    pathPrefix: string;
    pathStyle?: boolean;
};

export type OSSConnectionTestDraft = Omit<Partial<OSSConnectionTestInput>, "provider"> & Pick<OSSConnectionTestInput, "provider">;

export type OSSConnectionTestResult = {
    ok: boolean;
    message?: string;
    testedAt?: string;
    testedDigest?: string;
};

export const S3_PRESET_OPTIONS: Array<{ label: string; value: S3Preset }> = [
    { label: "AWS S3", value: "aws" },
    { label: "Cloudflare R2", value: "r2" },
    { label: "Backblaze B2", value: "b2" },
    { label: "RustFS", value: "rustfs" },
    { label: "自定义", value: "custom" },
];

const S3_PRESET_HINTS: Record<S3Preset, { region: string; endpoint: string; help: string }> = {
    aws: {
        region: "us-east-1",
        endpoint: "https://s3.us-east-1.amazonaws.com",
        help: "填写 AWS 区域对应的 S3 服务根 URL。",
    },
    r2: {
        region: "auto",
        endpoint: "https://<account-id>.r2.cloudflarestorage.com",
        help: "Endpoint 使用 R2 控制台提供的账户级 S3 API 根 URL。",
    },
    b2: {
        region: "us-west-004",
        endpoint: "https://s3.us-west-004.backblazeb2.com",
        help: "Region 和 Endpoint 应与 Backblaze B2 Bucket 所在区域一致。",
    },
    rustfs: {
        region: "us-east-1",
        endpoint: "http://127.0.0.1:9000",
        help: "填写后端可访问的 RustFS S3 服务根 URL。",
    },
    custom: {
        region: "us-east-1",
        endpoint: "https://s3.example.com",
        help: "填写兼容 S3 API 的服务根 URL，不要包含 Bucket 或对象路径。",
    },
};

const CONNECTION_FIELDS = new Set(["provider", "s3Preset", "region", "endpoint", "cdnBaseUrl", "bucket", "accessKeyId", "accessKeySecret", "sessionToken", "pathPrefix", "pathStyle"]);

// 火山引擎 TOS 官方地域，见 https://docs.volcengine.com/docs/6349/107356 。
export const VOLCENGINE_TOS_REGION_HINT = "cn-beijing、cn-shanghai、cn-guangzhou、cn-hongkong、ap-southeast-1、ap-southeast-3";

const VOLCENGINE_TOS_HOST_PATTERN = /^(?:([a-z0-9][a-z0-9-]*)\.)?tos-(?:s3-)?([a-z0-9-]+)\.(volces\.com|ivolces\.com)$/;

/**
 * 与后端 storage.normalizeVolcengineTOSLocation 保持一致：Region 生成 S3 兼容 Endpoint，
 * 控制台的原生域名或 Bucket 域名换算为同地域 tos-s3 服务根地址；无法确定的输入保持原值，由后端拒绝。
 */
export function normalizeVolcengineTOSLocation(input: { region: string; endpoint: string; bucket: string }) {
    let region = input.region.toLowerCase();
    let endpoint = input.endpoint;
    if (!endpoint) return { region, endpoint: region ? `https://tos-s3-${region}.volces.com` : "" };
    if (!endpoint.includes("://")) endpoint = `https://${endpoint}`;
    let parsed: URL;
    try {
        parsed = new URL(endpoint);
    } catch {
        return { region, endpoint };
    }
    const match = VOLCENGINE_TOS_HOST_PATTERN.exec(parsed.hostname.replace(/\.$/, ""));
    if (!match || (match[1] && match[1] !== input.bucket.toLowerCase())) return { region, endpoint };
    if (!region) region = match[2];
    const host = `tos-s3-${match[2]}.${match[3]}${parsed.port ? `:${parsed.port}` : ""}`;
    const path = parsed.pathname === "/" ? "" : parsed.pathname;
    return { region, endpoint: `${parsed.protocol}//${host}${path}${parsed.search}${parsed.hash}`.replace(/\/+$/, "") };
}

export function getS3PresetHints(preset?: S3Preset) {
    return S3_PRESET_HINTS[preset || "custom"];
}

export function changesRequireOSSRetest(changedValues: Record<string, unknown>) {
    return Object.keys(changedValues).some((key) => CONNECTION_FIELDS.has(key));
}

export function validateOSSConnectionDraft(input: OSSConnectionTestDraft) {
    if (!trimConnectionValue(input.bucket)) return "请填写对象存储 Bucket";
    return "";
}

export function normalizeOSSConnectionTestInput(input: OSSConnectionTestDraft): OSSConnectionTestInput {
    return {
        provider: input.provider,
        s3Preset: input.s3Preset || "custom",
        region: trimConnectionValue(input.region),
        endpoint: trimConnectionURL(input.endpoint),
        cdnBaseUrl: trimConnectionURL(input.cdnBaseUrl),
        bucket: trimConnectionValue(input.bucket),
        accessKeyId: trimConnectionValue(input.accessKeyId),
        accessKeySecret: trimConnectionValue(input.accessKeySecret),
        sessionToken: trimConnectionValue(input.sessionToken),
        pathPrefix: (trimConnectionValue(input.pathPrefix) || DEFAULT_OSS_PATH_PREFIX).replace(/^\/+|\/+$/g, ""),
        pathStyle: input.pathStyle === true,
    };
}

function trimConnectionValue(value?: string) {
    return (value || "").trim();
}

function trimConnectionURL(value?: string) {
    return trimConnectionValue(value).replace(/\/+$/, "");
}
