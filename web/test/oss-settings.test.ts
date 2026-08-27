import { describe, expect, test } from "bun:test";

import { changesRequireOSSRetest, DEFAULT_OSS_PATH_PREFIX, getS3PresetHints } from "../src/lib/oss-settings";

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
});
