import { expect, test } from "bun:test";
import * as preferences from "../src/stores/use-creation-preferences-store";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";

test("首页默认模型偏好单独保存，规范化后仍能恢复三类模型", () => {
    const saved = preferences.normalizeCreationComposerPreferences({ models: { textModel: "home-text", imageModel: "home-image", videoModel: "home-video", canvasModel: "ignore" }, activeConversationId: "local-1" });
    expect(saved).toMatchObject({ models: { textModel: "home-text", imageModel: "home-image", videoModel: "home-video" }, activeConversationId: "local-1" });
    expect((saved as any).models.canvasModel).toBeUndefined();
});

test("输出偏好只接受简洁和详细，旧偏好及无效值保持可恢复", () => {
    for (const outputPreference of ["concise", "detailed"] as const) {
        expect(preferences.normalizeCreationComposerPreferences({ outputPreference })).toEqual({ outputPreference });
    }
    for (const outputPreference of ["verbose", null, 1]) {
        expect(preferences.normalizeCreationComposerPreferences({ outputPreference })).toEqual({});
    }
    expect(preferences.normalizeCreationComposerPreferences({ image: { ratio: "1:1" } })).toEqual({ image: { ratio: "1:1" } });
});

test("首页模型偏好覆盖当前创作配置而不修改画布全局配置", () => {
    const canvas = { ...defaultConfig, imageModel: "canvas-image", videoModel: "canvas-video" };
    const config = (preferences as any).creationConfigWithPreferences?.(canvas, { models: { imageModel: "home-image", videoModel: "home-video" } });
    expect(config?.imageModel).toBe("home-image");
    expect(config?.videoModel).toBe("home-video");
    expect(config?.textModel).toBe(canvas.textModel);
    expect(canvas.imageModel).toBe("canvas-image");
    expect(canvas.videoModel).toBe("canvas-video");
});

test("真实偏好 store 写入与重新水合后保留默认模型和历史选择，不修改全局模型", async () => {
    const store = preferences.useCreationPreferencesStore;
    const original = store.getState();
    const options = store.persist.getOptions();
    const globalConfig = useConfigStore.getState().config;
    let disk: unknown;
    store.persist.setOptions({ storage: { getItem: () => disk as any, setItem: (_key, value) => { disk = structuredClone(value); }, removeItem: () => { disk = undefined; } } });
    try {
        store.setState({ preferences: {} });
        store.getState().rememberModel("imageModel", "home-image");
        store.getState().rememberModel("videoModel", "home-video");
        store.getState().rememberActiveConversation("existing-image");
        store.getState().rememberOutputPreference("detailed");
        const persisted = structuredClone(disk);
        store.setState({ preferences: {} });
        disk = persisted;
        await store.persist.rehydrate();
        expect(store.getState().preferences).toMatchObject({ models: { imageModel: "home-image", videoModel: "home-video" }, activeConversationId: "existing-image", outputPreference: "detailed" });
        expect(useConfigStore.getState().config).toBe(globalConfig);
        expect(preferences.creationConfigWithPreferences(globalConfig, store.getState().preferences)).toMatchObject({ imageModel: "home-image", videoModel: "home-video" });
    } finally {
        store.persist.setOptions(options);
        store.setState(original);
    }
});
