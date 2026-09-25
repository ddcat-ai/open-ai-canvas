import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
    return readFileSync(resolve(import.meta.dir, path), "utf8");
}

describe("outbound policy panel", () => {
    test("is mounted on the runtime policy page outside the runtime policy form", () => {
        const page = source("../src/pages/admin/settings/runtime-policy-settings-page.tsx");

        expect(page).toContain('import OutboundPolicyPanel from "../components/outbound-policy-panel";');
        expect(page.indexOf("<OutboundPolicyPanel />")).toBeGreaterThan(page.indexOf("</Form>"));
    });

    test("saves one origin per line to the admin outbound policy API", () => {
        const panel = source("../src/pages/admin/components/outbound-policy-panel.tsx");
        const api = source("../src/services/api/outbound-policy.ts");

        expect(panel).toContain("updateOutboundPolicy({ allowedModelOrigins: splitOrigins(draft.allowedModelOrigins");
        expect(panel).toContain(".split(/\\r?\\n/)");
        expect(api).toContain('http.patch<{ setting: OutboundPolicy }>("/admin/settings/outbound-policy", setting)');
        expect(panel).toContain("Base URL 不在列表内的系统渠道会立即无法调用");
    });
});
