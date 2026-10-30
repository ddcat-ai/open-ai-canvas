import { describe, expect, test } from "bun:test";

import { normalizeVolcengineTOSLocation } from "../src/lib/oss-settings";
import { formValues, isAdminOSSSetting, normalizeStoragePayload, storageResponseMatches, validateStorageDraft } from "../src/pages/admin/settings/storage-settings-model";
import type { AdminOSSSetting } from "../src/services/api/auth";

describe("Volcengine TOS storage settings", () => {
    test("matches the backend endpoint normalization", () => {
        const cases: Array<[{ region: string; endpoint: string; bucket: string }, { region: string; endpoint: string }]> = [
            [{ region: "cn-beijing", endpoint: "", bucket: "" }, { region: "cn-beijing", endpoint: "https://tos-s3-cn-beijing.volces.com" }],
            [{ region: "", endpoint: "tos-cn-shanghai.volces.com", bucket: "" }, { region: "cn-shanghai", endpoint: "https://tos-s3-cn-shanghai.volces.com" }],
            [{ region: "", endpoint: "https://My-Bucket.tos-cn-guangzhou.volces.com", bucket: "my-bucket" }, { region: "cn-guangzhou", endpoint: "https://tos-s3-cn-guangzhou.volces.com" }],
            [{ region: "AP-SOUTHEAST-1", endpoint: "https://tos-s3-ap-southeast-1.ivolces.com", bucket: "" }, { region: "ap-southeast-1", endpoint: "https://tos-s3-ap-southeast-1.ivolces.com" }],
            [{ region: "", endpoint: "https://other.tos-cn-beijing.volces.com", bucket: "my-bucket" }, { region: "", endpoint: "https://other.tos-cn-beijing.volces.com" }],
            [{ region: "cn-beijing", endpoint: "https://tos.example.com", bucket: "" }, { region: "cn-beijing", endpoint: "https://tos.example.com" }],
        ];
        for (const [input, expected] of cases) expect(normalizeVolcengineTOSLocation(input)).toEqual(expected);
    });

    test("saves a normalized draft that matches the server response", () => {
        const saved: AdminOSSSetting = {
            enabled: true,
            provider: "volcengine",
            s3Preset: "custom",
            region: "cn-beijing",
            endpoint: "https://tos-s3-cn-beijing.volces.com",
            cdnBaseUrl: "",
            cdnAuthMode: "",
            requireCDN: false,
            allowPrivateProxy: false,
            bucket: "assets",
            accessKeyId: "access-id",
            hasAccessKeySecret: true,
            hasSessionToken: false,
            pathStyle: false,
            allowUserS3: false,
            publicBaseUrl: "",
            pathPrefix: "open-ai-canvas",
        };
        expect(isAdminOSSSetting(saved)).toBe(true);
        const payload = normalizeStoragePayload({ ...formValues(saved), endpoint: "tos-cn-beijing.volces.com", region: "", sessionToken: "x", pathStyle: true }, saved);
        expect(payload).toMatchObject({ provider: "volcengine", region: "cn-beijing", endpoint: "https://tos-s3-cn-beijing.volces.com", sessionToken: "", pathStyle: false });
        expect(storageResponseMatches(saved, payload)).toBe(true);
        expect(validateStorageDraft({ ...formValues(saved), endpoint: "", region: "" }, saved)).toBe("请填写火山引擎 TOS Region 或 Endpoint");
        expect(validateStorageDraft({ ...formValues(saved), endpoint: "https://tos.example.com", region: "" }, saved)).toBe("请填写火山引擎 TOS Region");
        expect(validateStorageDraft({ ...formValues(saved), endpoint: "", region: "cn-shanghai" }, saved)).toBe("");
    });
});
