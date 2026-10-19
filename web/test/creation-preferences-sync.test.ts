import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { initializeCreationPreferencesSync, stopCreationPreferencesSync, creationPreferenceFields } from "../src/services/creation-preferences-sync";
import { defaultCreationAgentPreferences, useCreationPreferencesStore as store } from "../src/stores/use-creation-preferences-store";
import { setActiveUserScope } from "../src/lib/user-scope";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = globalThis.window;
const original = store.getState();
const disk = new Map<string, string>();
const events = new EventTarget();
function enter(userId: string) {
    stopCreationPreferencesSync();
    Object.assign(globalThis, {
        window: {
            localStorage: { getItem: (key: string) => disk.get(key) || null, setItem: (key: string, value: string) => disk.set(key, value), removeItem: (key: string) => disk.delete(key) },
            addEventListener: events.addEventListener.bind(events),
            removeEventListener: events.removeEventListener.bind(events),
        },
    });
    setActiveUserScope(userId);
    store.setState({ preferences: {}, pendingPreferenceChanges: {}, syncStatus: "local" });
}
afterEach(() => {
    stopCreationPreferencesSync();
    apiClient.defaults.adapter = originalAdapter;
    store.setState(original);
    Object.assign(globalThis, { window: originalWindow });
    disk.clear();
});

test("新浏览器恢复账号偏好，局部保存不发送草稿、参数正文或覆盖其他偏好", async () => {
    enter("first");
    const patches: any[] = [];
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") patches.push(JSON.parse(config.data));
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { models: { imageModel: "account-image" }, agent: { ...defaultCreationAgentPreferences, permissionMode: "auto" } } } } };
    };
    await initializeCreationPreferencesSync("first");
    expect(store.getState().preferences.models?.imageModel).toBe("account-image");
    expect(store.getState().preferences.agent?.permissionMode).toBe("auto");
    store.getState().rememberActiveConversation("local-draft");
    store.getState().rememberImageSettings({ ratio: "16:9", imageParameters: '{"private":"browser-only"}' });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(patches).toEqual([{ userId: "first", changes: { image: { ratio: "16:9" } } }]);
    expect(store.getState().syncStatus).toBe("synced");
    expect(creationPreferenceFields({ apiKey: "secret", activeConversationId: "draft" })).toEqual({});
});

test("切换账号后旧账号慢响应不能覆盖新账号偏好", async () => {
    enter("first");
    let release: ((value: any) => void) | undefined;
    let oldConfig: any;
    apiClient.defaults.adapter = async (config) => {
        if (config.params.userId === "first") {
            oldConfig = config;
            return await new Promise((resolve) => {
                release = resolve;
            });
        }
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { models: { imageModel: "second-model" } } } } };
    };
    const oldRead = initializeCreationPreferencesSync("first");
    await new Promise((resolve) => setTimeout(resolve, 0));
    enter("second");
    await initializeCreationPreferencesSync("second");
    release!({ config: oldConfig, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { models: { imageModel: "first-model" } } } } });
    await oldRead;
    expect(store.getState().preferences.models?.imageModel).toBe("second-model");
});

test("暂时离线保留账号隔离的待保存变更，重新连接再提交", async () => {
    enter("first");
    store.setState({ preferences: { image: { ratio: "4:3" } }, pendingPreferenceChanges: { "image.ratio": "4:3" } });
    apiClient.defaults.adapter = async () => {
        throw new Error("offline");
    };
    await initializeCreationPreferencesSync("first");
    expect(store.getState().pendingPreferenceChanges).toEqual({ "image.ratio": "4:3" });
    expect(store.getState().syncStatus).toBe("error");
    let changed: any;
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") changed = JSON.parse(config.data);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { image: { ratio: "1:1" } } } } };
    };
    await initializeCreationPreferencesSync("first");
    expect(changed.changes).toEqual({ image: { ratio: "4:3" } });
    expect(store.getState().pendingPreferenceChanges).toEqual({});
});
