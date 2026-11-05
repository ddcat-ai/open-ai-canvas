import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import localforage from "localforage";

import { apiClient } from "@/services/api/request";
import { parseAssetRecordList, parseAssetRecordListLenient } from "@/lib/asset-record";
import { initializeRemoteUserDataSession, loadAssetLibraryPage, resetRemoteUserDataSync } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";

// 素材库／画布素材面板／素材选择器共用 loadAssetLibraryPage：单条历史坏记录不能让整页变 0 个素材。
const originalAdapter = apiClient.defaults.adapter;
let originalWindow: PropertyDescriptor | undefined;
const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalRemove = localforage.removeItem;
const asset = (id: string): Asset =>
    ({
        id,
        kind: "text",
        title: id,
        coverUrl: "",
        tags: [],
        createdAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
        data: { content: "测试素材" },
    }) as Asset;

beforeEach(async () => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const storage = new Map<string, string>();
    const indexed = new Map<string, unknown>();
    localforage.getItem = (async (key: string) => indexed.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        indexed.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = async (key: string) => {
        indexed.delete(key);
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: globalThis.setTimeout,
            clearTimeout: globalThis.clearTimeout,
            localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) },
        },
    });
    useAssetStore.setState({ assets: [] });
    await flushAssetStorePersistence();
    await initializeRemoteUserDataSession("asset-page-lenient-user");
});

afterEach(async () => {
    try {
        apiClient.defaults.adapter = originalAdapter;
        resetRemoteUserDataSync();
        useAssetStore.setState({ assets: [] });
        await flushAssetStorePersistence();
    } finally {
        localforage.getItem = originalGet;
        localforage.setItem = originalSet;
        localforage.removeItem = originalRemove;
        if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
        else delete (globalThis as { window?: unknown }).window;
    }
});

test("分页列表遇单条坏记录只略过该条并告警，其余素材照常返回", async () => {
    const broken = { ...asset("broken"), data: { text: "旧格式文字" } };
    const local = asset("local-pending");
    useAssetStore.setState({ assets: [local] });
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(config.method ?? "");
        return {
            config,
            headers: {},
            status: 200,
            statusText: "OK",
            data: {
                code: 0,
                data: { assets: [asset("a"), broken, asset("b")], total: 42, page: 1, pageSize: 3, kindCounts: { text: 42 }, categoryCounts: {}, folderCounts: {}, hasMore: true },
                msg: "ok",
            },
        };
    };
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
        const page = await loadAssetLibraryPage({ page: 1, pageSize: 3 });
        expect(page.assets.map((item) => item.id)).toEqual(["a", "b"]);
        expect(page.total).toBe(42);
        expect(page.page).toBe(1);
        expect(page.pageSize).toBe(3);
        expect(page.hasMore).toBe(true);
        expect(page.kindCounts).toEqual({ text: 42 });
        expect(useAssetStore.getState().assets).toEqual([local]);
        expect(requests).toEqual(["get"]);
        expect(broken.data).toEqual({ text: "旧格式文字" });
        expect(warning).toHaveBeenCalledWith(expect.stringMatching(/素材 broken 合同无效.*content/));
    } finally {
        warning.mockRestore();
    }
});

test("展示解析保留有效记录顺序，空页正常，缺少 ID 的坏记录按位置告警", () => {
    const warning = spyOn(console, "warn").mockImplementation(() => {});
    try {
        expect(parseAssetRecordListLenient([])).toEqual([]);
        expect(parseAssetRecordListLenient([asset("a"), asset("b")]).map((item) => item.id)).toEqual(["a", "b"]);
        expect(warning).not.toHaveBeenCalled();
        expect(parseAssetRecordListLenient([null, {}, asset("c")]).map((item) => item.id)).toEqual(["c"]);
        expect(warning).toHaveBeenCalledTimes(2);
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("素材 #0 合同无效"));
        expect(warning).toHaveBeenCalledWith(expect.stringContaining("素材 #1 合同无效"));
        expect(parseAssetRecordListLenient([null])).toEqual([]);
    } finally {
        warning.mockRestore();
    }
});

test("列表结构错误仍报错，严格解析及 store 写入不吞掉坏记录", () => {
    for (const value of [null, undefined, {}, "invalid"]) {
        expect(() => parseAssetRecordListLenient(value)).toThrow("素材列表无效");
    }
    const broken = { ...asset("broken"), data: { text: "旧格式文字" } };
    expect(() => parseAssetRecordList([asset("a"), broken, asset("b")])).toThrow(/素材 broken 合同无效/);
    useAssetStore.setState({ assets: [asset("local")] });
    expect(() => useAssetStore.getState().replaceAssets([broken as unknown as Asset])).toThrow(/content/);
    expect(useAssetStore.getState().assets.map((item) => item.id)).toEqual(["local"]);
});

test("分页请求失败不会伪装成空列表", async () => {
    const failure = new Error("network unavailable");
    apiClient.defaults.adapter = async () => { throw failure; };
    await expect(loadAssetLibraryPage({ page: 1, pageSize: 20 })).rejects.toThrow("network unavailable");
});
