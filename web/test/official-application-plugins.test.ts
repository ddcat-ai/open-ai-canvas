import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
    OFFICIAL_APPLICATION_PLUGIN_IDS,
    isOfficialApplicationPluginId,
} from "../src/lib/plugins/official-applications";

describe("official application plugin classification", () => {
    test("covers every built-in application plugin, including editor and art critique", () => {
        // Regression: the admin plugin page kept its own list and missed these
        // two, so both rendered as disabled system protocols.
        expect(isOfficialApplicationPluginId("editor-shell")).toBe(true);
        expect(isOfficialApplicationPluginId("ai-art-critique")).toBe(true);
        expect(isOfficialApplicationPluginId("portrait-clearance")).toBe(true);
        expect(isOfficialApplicationPluginId("media-conversion")).toBe(true);
        expect(isOfficialApplicationPluginId("prompt-optimizer")).toBe(true);
        expect(isOfficialApplicationPluginId("eagle-asset-connector")).toBe(true);
        expect(isOfficialApplicationPluginId("runninghub-workflow-provider")).toBe(true);
        expect(isOfficialApplicationPluginId("comfyui-workflow-provider")).toBe(true);
    });

    test("does not treat uploaded or unknown plugins as official applications", () => {
        expect(isOfficialApplicationPluginId("some-uploaded-plugin")).toBe(false);
        expect(isOfficialApplicationPluginId("")).toBe(false);
    });

    test("exposes a single de-duplicated id list", () => {
        const ids = [...OFFICIAL_APPLICATION_PLUGIN_IDS];
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(8);
    });

    test("both plugin pages consume the shared list instead of a local copy", () => {
        const adminPage = readFileSync(
            resolve(import.meta.dir, "../src/pages/admin/plugins/plugins-page.tsx"),
            "utf8",
        );
        const userPage = readFileSync(
            resolve(import.meta.dir, "../src/pages/plugins/index.tsx"),
            "utf8",
        );

        expect(adminPage).toContain("isOfficialApplicationPluginId");
        expect(userPage).toContain("isOfficialApplicationPluginId");

        // No page may reintroduce a hand-maintained id array.
        expect(adminPage).not.toContain("const officialApplicationIds = new Set([");
        expect(userPage).not.toContain("function isOfficialApplicationPlugin(pluginId: string) {");
    });
});
