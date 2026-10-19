import { afterEach, expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { initializeCreationPreferencesSync, stopCreationPreferencesSync, creationPreferenceFields } from "../src/services/creation-preferences-sync";
import { defaultCreationAgentPreferences, useCreationPreferencesStore as store } from "../src/stores/use-creation-preferences-store";
import { setActiveUserScope } from "../src/lib/user-scope";

const originalAdapter = apiClient.defaults.adapter;
const originalWindow = globalThis.window;
const originalDocument = globalThis.document;
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
        document: { visibilityState: "visible" },
    });
    setActiveUserScope(userId);
    store.setState({ preferences: {}, pendingPreferenceChanges: {}, syncStatus: "local" });
}
afterEach(() => {
    stopCreationPreferencesSync();
    apiClient.defaults.adapter = originalAdapter;
    store.setState(original);
    Object.assign(globalThis, { window: originalWindow, document: originalDocument });
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
    const patches: any[] = [];
    let release: ((value: any) => void) | undefined;
    let oldConfig: any;
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") patches.push(JSON.parse(config.data));
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
    store.getState().rememberImageSettings({ ratio: "16:9" });
    enter("second");
    await initializeCreationPreferencesSync("second");
    release!({ config: oldConfig, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { models: { imageModel: "first-model" } } } } });
    await oldRead;
    expect(store.getState().preferences.models?.imageModel).toBe("second-model");
    expect(store.getState().pendingPreferenceChanges).toEqual({});
    expect(patches).toEqual([]);
});

test("聚焦刷新中的旧快照不能覆盖随后保存的新偏好", async () => {
    enter("first");
    let reads = 0;
    let release: (() => void) | undefined;
    let serverRatio = "1:1";
    const patches: any[] = [];
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") {
            const patch = JSON.parse(config.data);
            patches.push(patch);
            serverRatio = patch.changes.image.ratio;
        }
        const response = { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { image: { ratio: serverRatio } } } } };
        if (config.method === "get" && ++reads === 2)
            return await new Promise((resolve) => {
                release = () => resolve(response);
            });
        return response;
    };
    await initializeCreationPreferencesSync("first");
    events.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().rememberImageSettings({ ratio: "16:9" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    try {
        expect(patches).toEqual([]);
        expect(store.getState().pendingPreferenceChanges).toEqual({ "image.ratio": "16:9" });
    } finally {
        release!();
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(patches).toEqual([{ userId: "first", changes: { image: { ratio: "16:9" } } }]);
    expect(serverRatio).toBe("16:9");
    expect(store.getState().preferences.image?.ratio).toBe("16:9");
    expect(store.getState().pendingPreferenceChanges).toEqual({});
    expect(store.getState().syncStatus).toBe("synced");
});

test("已就绪会话刷新失败后仍提交读取期间暂缓的本地修改", async () => {
    enter("first");
    let reads = 0;
    let rejectRead: ((reason: Error) => void) | undefined;
    const patches: any[] = [];
    apiClient.defaults.adapter = async (config) => {
        if (config.method === "patch") patches.push(JSON.parse(config.data));
        if (config.method === "get" && ++reads === 2)
            return await new Promise((_resolve, reject) => {
                rejectRead = reject;
            });
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { image: { ratio: "1:1" } } } } };
    };
    await initializeCreationPreferencesSync("first");
    events.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    store.getState().rememberImageSettings({ ratio: "4:3" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    try {
        expect(patches).toEqual([]);
    } finally {
        rejectRead!(new Error("refresh unavailable"));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(patches).toEqual([{ userId: "first", changes: { image: { ratio: "4:3" } } }]);
    expect(store.getState().preferences.image?.ratio).toBe("4:3");
    expect(store.getState().pendingPreferenceChanges).toEqual({});
    expect(store.getState().syncStatus).toBe("synced");
});

test("保存期间再次编辑保留后续变更并在第一笔完成后继续保存", async () => {
    enter("first");
    let release: (() => void) | undefined;
    const patches: any[] = [];
    apiClient.defaults.adapter = async (config) => {
        const response = { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { preferences: { image: { ratio: "1:1" } } } } };
        if (config.method === "patch") {
            patches.push(JSON.parse(config.data));
            if (patches.length === 1)
                return await new Promise((resolve) => {
                    release = () => resolve(response);
                });
        }
        return response;
    };
    await initializeCreationPreferencesSync("first");
    store.getState().rememberImageSettings({ ratio: "16:9" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    store.getState().rememberImageSettings({ ratio: "4:3" });
    store.getState().rememberModel("imageModel", "new-model");
    release!();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(store.getState().pendingPreferenceChanges).toEqual({ "image.ratio": "4:3", "models.imageModel": "new-model" });
    await new Promise((resolve) => setTimeout(resolve, 550));
    expect(patches).toEqual([
        { userId: "first", changes: { image: { ratio: "16:9" } } },
        { userId: "first", changes: { image: { ratio: "4:3" }, models: { imageModel: "new-model" } } },
    ]);
    expect(store.getState().preferences.image?.ratio).toBe("4:3");
    expect(store.getState().preferences.models?.imageModel).toBe("new-model");
    expect(store.getState().pendingPreferenceChanges).toEqual({});
    expect(store.getState().syncStatus).toBe("synced");
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
    events.dispatchEvent(new Event("online"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(changed.changes).toEqual({ image: { ratio: "4:3" } });
    expect(store.getState().pendingPreferenceChanges).toEqual({});
});
