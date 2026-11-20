import { SUPPORTED_LOCALES } from "../src/i18n/locales";
import { afterAll, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { agentAvatarBundleFileURL, live2DModelURL, uploadAgentAvatarBundle, uploadLive2D } from "../src/services/api/appearance";
import { personalAvatarMessages } from "../src/i18n/personal-avatar-messages";

const original = apiClient.defaults.adapter;
afterAll(() => {
    apiClient.defaults.adapter = original;
});

test("ordinary uploads and playback use authenticated personal endpoints", async () => {
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.url!);
        return { status: 200, statusText: "OK", headers: {}, config, data: { code: 0, data: { bundle: { resourceId: "my-bundle" }, model: { resourceId: "my-model", entry: "model/avatar.model3.json" } } } };
    };
    const file = new File(["zip"], "avatar.zip", { type: "application/zip" });
    expect((await uploadAgentAvatarBundle(file, "personal")).resourceId).toBe("my-bundle");
    expect((await uploadLive2D(file, "personal")).resourceId).toBe("my-model");
    expect(requests).toEqual(["/appearance/avatar-bundles", "/appearance/live2d"]);
    expect(agentAvatarBundleFileURL("my-bundle", "idle.mp4", "personal")).toContain("/api/appearance/avatar/my-bundle/idle.mp4");
    expect(live2DModelURL("my-model", "model/avatar.model3.json", "personal")).toContain("/api/appearance/live2d/my-model/model/avatar.model3.json");
    expect(agentAvatarBundleFileURL("site", "idle.mp4")).toContain("/api/public/appearance/avatar/site/idle.mp4");
    expect(agentAvatarBundleFileURL("draft", "idle.mp4", "admin")).toContain("/api/admin/settings/appearance/avatar/draft/idle.mp4");
});

test("failed personal uploads propagate errors", async () => {
    apiClient.defaults.adapter = async (config) => ({ status: 200, statusText: "OK", headers: {}, config, data: { code: 403, msg: "quota exceeded" } });
    await expect(uploadAgentAvatarBundle(new File(["zip"], "avatar.zip"), "personal")).rejects.toThrow("quota exceeded");
});

test("all supported languages explain material formats and generic creation steps", () => {
    expect(Object.keys(personalAvatarMessages)).toHaveLength(SUPPORTED_LOCALES.length);
    for (const messages of Object.values(personalAvatarMessages)) {
        expect(Object.keys(messages).sort()).toEqual(Object.keys(personalAvatarMessages["zh-CN"]).sort());
        expect(messages.bundleHelp).toContain("avatar.json");
        expect(messages.live2dHelp).toContain(".model3.json");
        expect(messages.exampleSteps).toContain("MP4");

        expect(Object.keys(messages.states)).toHaveLength(8);
    }
});
