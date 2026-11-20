import { describe, expect, test } from "bun:test";

import type { PluginManifest } from "../src/lib/plugins/plugin-types";
import { pluginMatchesSearch } from "../src/lib/plugins/plugin-search";

const manifest: PluginManifest = {
    apiVersion: "yingce.plugin/v1",
    id: "volcengine-ark-seedance",
    name: "火山方舟 Seedance 官方视频生成",
    version: "1.0.0",
    description: "火山方舟官方 Seedance 视频生成接口。",
    author: "影策",
    permissions: [],
    contributes: {
        providers: [
            {
                id: "volcengine-ark-video",
                label: "火山方舟 Seedance 官方视频生成",
                capabilities: ["video"],
                scopes: [],
                create: { method: "POST", path: "/api/v3/contents/generations/tasks" },
                poll: { method: "GET", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
                cancel: { method: "DELETE", path: "/api/v3/contents/generations/tasks/{{taskId}}" },
                response: {},
            },
        ],
    },
};

describe("plugin search", () => {
    test("matches separated Chinese words across the manifest identity and provider label", () => {
        expect(pluginMatchesSearch(manifest, "火山视频")).toBe(true);
    });

    test("matches provider IDs, capabilities, and operation paths", () => {
        expect(pluginMatchesSearch(manifest, "volcengine-ark-video")).toBe(true);
        expect(pluginMatchesSearch(manifest, "video")).toBe(true);
        expect(pluginMatchesSearch(manifest, "/api/v3")).toBe(true);
    });

    test("requires every query token and ignores unindexed fields", () => {
        expect(pluginMatchesSearch(manifest, "火山 其他不存在")).toBe(false);
        expect(pluginMatchesSearch(manifest, "720p")).toBe(false);
    });
});
