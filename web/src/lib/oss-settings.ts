export type OSSProvider = "aliyun" | "tencent" | "qiniu" | "s3";

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

const CONNECTION_FIELDS = new Set([
    "provider",
    "s3Preset",
    "region",
    "endpoint",
    "cdnBaseUrl",
    "bucket",
    "accessKeyId",
    "accessKeySecret",
    "sessionToken",
    "pathPrefix",
    "pathStyle",
]);

export function getS3PresetHints(preset?: S3Preset) {
    return S3_PRESET_HINTS[preset || "custom"];
}

export function changesRequireOSSRetest(changedValues: Record<string, unknown>) {
    return Object.keys(changedValues).some((key) => CONNECTION_FIELDS.has(key));
}
