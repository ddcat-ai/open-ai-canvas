import { describe, expect, test } from "bun:test";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getS3PresetHints, normalizeOSSConnectionTestInput, validateOSSConnectionDraft } from "../src/lib/oss-settings";
import { connectionInput, formValues, isAdminOSSSetting, normalizeStoragePayload, storageProviderLabel, storageResponseMatches } from "../src/pages/admin/settings/storage-settings-model";
import type { AdminOSSSetting } from "../src/services/api/auth";

describe("OSS settings helpers", () => {
    test("provides editable S3 endpoint hints for known presets", () => {
        expect(getS3PresetHints("r2")).toMatchObject({ region: "auto" });
        expect(getS3PresetHints("b2").endpoint).toContain("backblazeb2.com");
    });

    test("only connection fields invalidate a previous test", () => {
        expect(changesRequireOSSRetest({ endpoint: "https://s3.example.com" })).toBe(true);
        expect(changesRequireOSSRetest({ enabled: true })).toBe(false);
        expect(changesRequireOSSRetest({ allowUserS3: true })).toBe(false);
    });

    test("uses the product path prefix by default", () => {
        expect(DEFAULT_OSS_PATH_PREFIX).toBe("open-ai-canvas");
    });

    test("rejects a connection test draft without a bucket", () => {
        expect(validateOSSConnectionDraft({ provider: "aliyun", bucket: "  " })).toBe("请填写对象存储 Bucket");
        expect(validateOSSConnectionDraft({ provider: "aliyun", bucket: "canvas-assets" })).toBe("");
    });

    test("defaults only Rainyun's empty region without rewriting the stored path-style flag", () => {
        expect(normalizeOSSConnectionTestInput({ provider: "rainyun", region: "  ", pathStyle: false })).toMatchObject({ provider: "rainyun", region: "rainyun", pathStyle: false });
        expect(normalizeOSSConnectionTestInput({ provider: "rainyun", region: " custom-region ", pathStyle: true })).toMatchObject({ region: "custom-region", pathStyle: true });
        expect(normalizeOSSConnectionTestInput({ provider: "aliyun", region: "  " }).region).toBe("");
    });

    test("accepts Rainyun settings and matches the backend's default region after saving", () => {
        const setting: AdminOSSSetting = {
            enabled: true,
            provider: "rainyun",
            s3Preset: "custom",
            region: "",
            endpoint: "https://ros.example.com",
            cdnBaseUrl: "",
            cdnAuthMode: "",
            requireCDN: false,
            allowPrivateProxy: false,
            bucket: "fixture-bucket",
            accessKeyId: "fixture-key-id",
            hasAccessKeySecret: true,
            hasSessionToken: false,
            pathStyle: false,
            allowUserS3: false,
            publicBaseUrl: "",
            pathPrefix: DEFAULT_OSS_PATH_PREFIX,
        };
        const values = formValues(setting);
        const payload = normalizeStoragePayload(values, setting);
        expect(isAdminOSSSetting(setting)).toBe(true);
        expect(storageProviderLabel(setting.provider)).toBe("雨云 OSS");
        expect(payload).toMatchObject({ provider: "rainyun", region: "rainyun", pathStyle: false });
        expect(connectionInput(values)).toMatchObject({ provider: "rainyun", region: "rainyun", pathStyle: false });
        expect(storageResponseMatches({ ...setting, region: "rainyun" }, payload)).toBe(true);
    });

    test("normalizes a Tencent COS test draft when S3-only fields are not mounted", () => {
        const input = normalizeOSSConnectionTestInput({
            provider: "tencent",
            region: " ap-guangzhou ",
            endpoint: " https://cos.ap-guangzhou.myqcloud.com/ ",
            bucket: " example-1250000000 ",
            accessKeyId: " secret-id ",
            accessKeySecret: " secret-key ",
            pathPrefix: " /canvas/ ",
        });

        expect(input).toMatchObject({
            provider: "tencent",
            region: "ap-guangzhou",
            endpoint: "https://cos.ap-guangzhou.myqcloud.com",
            cdnBaseUrl: "",
            bucket: "example-1250000000",
            accessKeyId: "secret-id",
            accessKeySecret: "secret-key",
            sessionToken: "",
            pathPrefix: "canvas",
            s3Preset: "custom",
            pathStyle: false,
        });
    });
});
