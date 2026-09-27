import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("personal storage switch", () => {
    test("admin storage settings save and verify the switch", () => {
        const page = source("../src/pages/admin/settings/storage-settings-page.tsx");

        expect(page).toContain('<Form.Item name="allowUserStorage" label="允许个人存储" valuePropName="checked"');
        expect(page).toContain("allowUserStorage: setting.allowUserStorage !== false");
        expect(page).toContain("allowUserStorage: values.allowUserStorage ?? setting.allowUserStorage !== false");
        expect(page).toContain('"allowUserS3", "allowUserStorage"];');
    });

    test("personal storage form becomes read-only when the platform closes it", () => {
        const form = source("../src/components/layout/user-oss-settings-form.tsx");

        expect(form).toContain("disabled={loading || setting?.allowUserStorage === false}");
        expect(form).toContain("平台已关闭个人存储");
    });
});
