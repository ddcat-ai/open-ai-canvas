import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { applyUserSession, refreshSystemChannels, suspendUserSession } from "../src/lib/user-session";
import { setActiveUserScope } from "../src/lib/user-scope";
import { http } from "../src/services/api/request";
import type { ModelCatalogResponse } from "../src/services/api/logical-models";
import { defaultConfig, useConfigStore } from "../src/stores/use-config-store";
import { useModelCatalogStore } from "../src/stores/use-model-catalog-store";
import { useUserStore } from "../src/stores/use-user-store";

function catalog(id: string): ModelCatalogResponse {
    return { source: "system", channels: [{ id, name: id, displayName: id, models: [] }] };
}
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function enter(id: string) {
    suspendUserSession();
    setActiveUserScope(id);
    useUserStore.getState().setUser({ id, username: id, displayName: id, role: "user", status: "active" });
    useConfigStore.setState({ config: { ...defaultConfig, channels: [] } });
}
let get: ReturnType<typeof spyOn>;
beforeEach(() => {
    enter("catalog-user-a");
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path !== "/model-catalog") throw new Error(`Unexpected read: ${path}`);
        return catalog("original");
    });
});
afterEach(() => {
    get.mockRestore();
    suspendUserSession();
    useUserStore.getState().setUser(null);
    setActiveUserScope(null);
});

test("目录请求失败保留已加载的配置，重试成功后才更新", async () => {
    await refreshSystemChannels();
    const previous = useConfigStore.getState().config;
    get.mockRejectedValueOnce(new Error("offline"));
    await expect(refreshSystemChannels()).rejects.toThrow("offline");
    expect(useModelCatalogStore.getState().status).toBe("error");
    expect(useConfigStore.getState().config).toBe(previous);
    get.mockResolvedValueOnce(catalog("recovered"));
    await refreshSystemChannels();
    expect(useModelCatalogStore.getState().status).toBe("ready");
    expect(useConfigStore.getState().config.channels.map((item) => item.id)).toEqual(["recovered"]);
});

test("并发重试共用一次读取，加载中不写入空列表", async () => {
    const pending = deferred<ModelCatalogResponse>();
    get.mockReturnValueOnce(pending.promise);
    const first = refreshSystemChannels();
    const second = refreshSystemChannels();
    expect(first).toBe(second);
    expect(get).toHaveBeenCalledTimes(1);
    expect(useModelCatalogStore.getState().status).toBe("loading");
    pending.resolve(catalog("ready"));
    await first;
    expect(useModelCatalogStore.getState().status).toBe("ready");
});

test("畸形目录不能清空已有模型，只有成功空目录才进入 ready", async () => {
    await refreshSystemChannels();
    const previous = useConfigStore.getState().config;
    get.mockResolvedValueOnce({ source: "system" });
    await expect(refreshSystemChannels()).rejects.toThrow("缺少系统渠道列表");
    expect(useConfigStore.getState().config).toBe(previous);
    expect(useModelCatalogStore.getState().status).toBe("error");
    get.mockResolvedValueOnce({ source: "system", channels: [] });
    await refreshSystemChannels();
    expect(useModelCatalogStore.getState().status).toBe("ready");
    expect(useConfigStore.getState().config.channels).toEqual([]);
});

test("账号切换后迟到响应不会混入模型或结束新账号的加载", async () => {
    const previous = deferred<ModelCatalogResponse>();
    get.mockReturnValueOnce(previous.promise);
    const oldRequest = refreshSystemChannels();
    const oldResult = oldRequest.catch((error) => error);
    enter("catalog-user-b");
    const current = deferred<ModelCatalogResponse>();
    get.mockReturnValueOnce(current.promise);
    const newRequest = refreshSystemChannels();
    previous.resolve(catalog("account-a-secret"));
    expect((await oldResult).name).toBe("AbortError");
    expect(useConfigStore.getState().config.channels).toEqual([]);
    expect(useModelCatalogStore.getState().status).toBe("loading");
    expect(refreshSystemChannels()).toBe(newRequest);
    current.resolve(catalog("account-b"));
    await newRequest;
    expect(useConfigStore.getState().config.channels.map((item) => item.id)).toEqual(["account-b"]);
});

test("首次会话缺少配置时，后台失败后仍可重试初始化模型目录", async () => {
    get.mockRejectedValueOnce(new Error("offline"));
    await applyUserSession({ user: null });
    expect(useModelCatalogStore.getState().status).toBe("error");
    get.mockResolvedValueOnce(catalog("initial-retry"));
    await refreshSystemChannels();
    expect(useModelCatalogStore.getState().status).toBe("ready");
    expect(useConfigStore.getState().config.channels.map((item) => item.id)).toEqual(["initial-retry"]);
});

test("首次目录仍在加载时修改设置，结果到达不覆盖用户编辑", async () => {
    const pending = deferred<ModelCatalogResponse>();
    get.mockReturnValueOnce(pending.promise);
    await applyUserSession({ user: null });
    expect(useModelCatalogStore.getState().status).toBe("loading");
    useConfigStore.getState().updateConfig("temperature", 0.37);
    const response = refreshSystemChannels();
    pending.resolve(catalog("initial-after-edit"));
    await response;
    expect(useConfigStore.getState().config.temperature).toBe(0.37);
    expect(useConfigStore.getState().config.channels.map((item) => item.id)).toEqual(["initial-after-edit"]);
    expect(get).toHaveBeenCalledTimes(1);
});
