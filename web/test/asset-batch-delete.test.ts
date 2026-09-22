import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { QueryObserver } from "@tanstack/react-query";
import { readFileSync } from "node:fs";

import { apiClient } from "@/services/api/request";
import { deleteAssetsWithRemoteSync, initializeRemoteUserDataSession, loadAssetLibraryPage, resetRemoteUserDataSync } from "@/services/user-data-sync";
import { flushAssetStorePersistence, useAssetStore, type Asset } from "@/stores/use-asset-store";
import { appQueryClient } from "@/lib/query-client";

const originalAdapter = apiClient.defaults.adapter;
async function within<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("删除或刷新链路未结束")), 1000);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
const asset = (id: string): Asset =>
    ({
        id,
        kind: "text",
        title: id,
        coverUrl: "",
        tags: [],
        createdAt: "2026-09-21T00:00:00.000Z",
        updatedAt: "2026-09-21T00:00:00.000Z",
        data: { content: "测试素材" },
    }) as Asset;

beforeEach(async () => {
    useAssetStore.setState({ assets: [] });
    await flushAssetStorePersistence();
    await initializeRemoteUserDataSession("batch-test-user");
});

afterEach(async () => {
    await appQueryClient.cancelQueries();
    appQueryClient.clear();
    apiClient.defaults.adapter = originalAdapter;
    resetRemoteUserDataSync();
    useAssetStore.setState({ assets: [] });
    await flushAssetStorePersistence();
});

describe("素材批量删除", () => {
    test("100 个素材只发一个 POST 数组请求，成功后只更新一次本地素材集合", async () => {
        const ids = Array.from({ length: 100 }, (_, i) => `asset-${i}`);
        useAssetStore.setState({ assets: [...ids.map(asset), asset("keep")] });
        const requests: unknown[] = [];
        apiClient.defaults.adapter = async (config) => {
            requests.push({ method: config.method, url: config.url, body: JSON.parse(config.data) });
            expect(useAssetStore.getState().assets).toHaveLength(101);
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { ids }, msg: "ok" } };
        };
        let updates = 0;
        const stop = useAssetStore.subscribe((state, previous) => {
            if (state.assets !== previous.assets) updates++;
        });
        try {
            await deleteAssetsWithRemoteSync(ids);
            expect(requests).toEqual([{ method: "post", url: "/assets/batch-delete", body: ids }]);
            expect(useAssetStore.getState().assets.map((item) => item.id)).toEqual(["keep"]);
            expect(updates).toBe(1);
        } finally {
            stop();
        }
    });

    test.each([false, true])("真实分页查询刷新不阻塞删除完成（刷新失败：%s）", async (failRefresh) => {
        const initialPage = {
            assets: [asset("first"), asset("keep")],
            total: 2,
            page: 1,
            pageSize: 20,
            kindCounts: {},
            categoryCounts: {},
            folderCounts: {},
            hasMore: false,
        };
        useAssetStore.setState({ assets: initialPage.assets });
        let releaseRefresh!: () => void;
        const refreshGate = new Promise<void>((resolve) => {
            releaseRefresh = resolve;
        });
        const requests: string[] = [];
        apiClient.defaults.adapter = async (config) => {
            requests.push(`${config.method} ${config.url}`);
            if (config.method === "post") {
                return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { ids: ["first"] }, msg: "ok" } };
            }
            await refreshGate;
            if (failRefresh) throw new Error("列表暂时不可用");
            return {
                config,
                headers: {},
                status: 200,
                statusText: "OK",
                data: {
                    code: 0,
                    data: { ...initialPage, assets: [asset("keep")], total: 1 },
                    msg: "ok",
                },
            };
        };
        const warning = spyOn(console, "warn").mockImplementation(() => {});
        const observers = ["asset-library", "asset-picker"].map(
            (key) =>
                new QueryObserver(appQueryClient, {
                    queryKey: [key, "delete-regression"],
                    queryFn: () => loadAssetLibraryPage({ page: 1, pageSize: 20 }),
                    initialData: initialPage,
                }),
        );
        const stops: (() => void)[] = [];
        const refreshed = observers.map(
            (observer) =>
                new Promise<void>((resolve) => {
                    stops.push(
                        observer.subscribe((result) => {
                            if (result.fetchStatus === "idle" && (result.isError || result.data?.total === 1)) resolve();
                        }),
                    );
                }),
        );
        try {
            // GET 尚未返回，删除必须已返回，调用方才能关闭 Modal / Popconfirm。
            await within(deleteAssetsWithRemoteSync(["first"]));
            expect(useAssetStore.getState().assets.map((item) => item.id)).toEqual(["keep"]);
            expect(requests).toEqual(["post /assets/batch-delete", "get /assets", "get /assets"]);
            for (const observer of observers) expect(observer.getCurrentResult().fetchStatus).toBe("fetching");

            releaseRefresh();
            // 真实 loadAssetLibraryPage 要再次进入同步队列；不能与删除互相等待。
            await within(Promise.all(refreshed));
            for (const observer of observers) {
                const result = observer.getCurrentResult();
                if (failRefresh) expect(result.error?.message).toBe("列表暂时不可用");
                else expect(result.data?.assets.map((item) => item.id)).toEqual(["keep"]);
            }
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (failRefresh) expect(warning).toHaveBeenCalledWith("素材删除后列表刷新失败", expect.any(Error));
            expect(requests.filter((request) => request.startsWith("post"))).toHaveLength(1);
        } finally {
            releaseRefresh();
            await appQueryClient.cancelQueries();
            stops.forEach((stop) => stop());
            observers.forEach((observer) => observer.destroy());
            warning.mockRestore();
        }
    });

    test("业务失败不会先删本地素材或回退到逐条请求", async () => {
        useAssetStore.setState({ assets: [asset("first"), asset("second")] });
        let requests = 0;
        apiClient.defaults.adapter = async (config) => {
            requests++;
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 400, data: null, msg: "拒绝删除", reason: "invalid_argument" } };
        };
        await expect(deleteAssetsWithRemoteSync(["first", "second"])).rejects.toThrow("拒绝删除");
        expect(requests).toBe(1);
        expect(useAssetStore.getState().assets.map((item) => item.id)).toEqual(["first", "second"]);
    });

    test("删除响应返回前切换账号，不删除新账号本地素材", async () => {
        useAssetStore.setState({ assets: [asset("same-id")] });
        apiClient.defaults.adapter = async (config) => {
            resetRemoteUserDataSync();
            useAssetStore.setState({ assets: [asset("same-id")] });
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { ids: ["same-id"] }, msg: "ok" } };
        };
        await expect(deleteAssetsWithRemoteSync(["same-id"])).rejects.toThrow("账号已切换");
        expect(useAssetStore.getState().assets).toHaveLength(1);
    });

    test("空 ID 不发请求，重复 ID 合并到一个请求", async () => {
        const bodies: string[][] = [];
        apiClient.defaults.adapter = async (config) => {
            const ids = JSON.parse(config.data);
            bodies.push(ids);
            return { config, headers: {}, status: 200, statusText: "OK", data: { code: 0, data: { ids }, msg: "ok" } };
        };
        await expect(deleteAssetsWithRemoteSync(["good", " "])).rejects.toThrow("素材 ID 不能为空");
        expect(bodies).toHaveLength(0);
        await deleteAssetsWithRemoteSync([" first ", "first", "second"]);
        expect(bodies).toEqual([["first", "second"]]);
    });

    test("素材页和选择器的批量及清空入口使用数组同步方法", () => {
        const page = readFileSync(new URL("../src/pages/assets/index.tsx", import.meta.url), "utf8");
        const picker = readFileSync(new URL("../src/components/assets/asset-library-picker-modal.tsx", import.meta.url), "utf8");
        expect(page).toContain("deleteAssetsWithRemoteSync(trashAssets.map");
        expect(page).toContain("deleteAssetsWithRemoteSync(selectedAssets.map");
        expect(picker).toContain("deleteAssetsWithRemoteSync(archivedSelectedIds)");
        expect(picker).toContain("deleteAssetsWithRemoteSync(toDelete.map");
    });
});
