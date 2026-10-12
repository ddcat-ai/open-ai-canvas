import { expect, test } from "bun:test";
import { apiClient } from "@/services/api/request";
import { buildCanvasOperations, saveRemoteUserDataNow, syncRemoteUserData } from "@/services/user-data-sync";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useAssetStore } from "@/stores/use-asset-store";
import { useSyncProgressStore } from "@/stores/use-sync-progress-store";
import { resourceFileUrl } from "@/services/api/resources";
import { CanvasNodeType } from "@/types/canvas";

test("没有可提交操作时仍结束同步，不留下 saving 状态", async () => {
    const remote: CanvasProject = {
        id: "sync-test",
        title: "测试",
        createdAt: "remote-time",
        updatedAt: "",
        revision: 3,
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    };
    const previousAdapter = apiClient.defaults.adapter;
    const previousProjects = useCanvasStore.getState().projects;
    const previousAssets = useAssetStore.getState().assets;
    const previousProgress = useSyncProgressStore.getState().syncingProjects;
    const requests: string[] = [];
    let failRead = false;
    apiClient.defaults.adapter = async (config) => {
        const path = config.url || "";
        requests.push(path);
        let data: unknown;
        if (path === "/user-data/snapshot") data = { projects: [remote], assets: [] };
        else if (path === "/canvas-projects/sync-test") {
            if (failRead) throw new Error("模拟云端读取失败");
            data = { project: remote };
        } else throw new Error(`意外请求：${path}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
    try {
        useCanvasStore.setState({ projects: [] });
        useAssetStore.setState({ assets: [] });
        await syncRemoteUserData("sync-test-user");
        const baseline = useCanvasStore.getState().projects[0];
        // createdAt 不属于可编辑字段，但内容比较会发现差异，进入“无操作”的保存分支。
        const local = { ...baseline, createdAt: "local-time" };
        expect(buildCanvasOperations(baseline, local)).toEqual([]);
        useCanvasStore.setState({ projects: [local] });
        await saveRemoteUserDataNow("sync-test");
        expect(useSyncProgressStore.getState().syncingProjects[remote.id]).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 3 });
        expect(requests.some((path) => path.endsWith("/operations"))).toBe(false);
        expect(requests).toContain("/canvas-projects/sync-test");
        expect(useCanvasStore.getState().projects[0].createdAt).toBe("remote-time");

        // 没有操作不等于已确认云端；读取失败仍显示错误，恢复后再结束同步。
        useCanvasStore.setState({ projects: [{ ...useCanvasStore.getState().projects[0], createdAt: "local-again" }] });
        failRead = true;
        await expect(saveRemoteUserDataNow("sync-test")).rejects.toThrow("模拟云端读取失败");
        expect(useSyncProgressStore.getState().syncingProjects[remote.id]).toMatchObject({ phase: "error", pendingChanges: 1 });
        failRead = false;
        await saveRemoteUserDataNow("sync-test");
        expect(useSyncProgressStore.getState().syncingProjects[remote.id]).toMatchObject({ phase: "done", pendingChanges: 0 });
    } finally {
        await syncRemoteUserData(null);
        apiClient.defaults.adapter = previousAdapter;
        useCanvasStore.setState({ projects: previousProjects });
        useAssetStore.setState({ assets: previousAssets });
        useSyncProgressStore.setState({ syncingProjects: previousProgress });
    }
});

test("媒体预览地址转换成资源地址后只同步一次，不反复重写本地画布", async () => {
    const url = resourceFileUrl("image-test");
    const remote: CanvasProject = {
        id: "media-sync",
        title: "测试",
        createdAt: "",
        updatedAt: "",
        revision: 95,
        nodes: [{ id: "image", type: CanvasNodeType.Image, title: "图片", width: 100, height: 100, position: { x: 0, y: 0 }, metadata: { content: url, storageKey: "resource:image-test", assetId: "asset-test" } }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    };
    const asset = { id: "asset-test", kind: "image" as const, title: "图片", coverUrl: url, tags: [], createdAt: "", updatedAt: "", data: { dataUrl: url, storageKey: "resource:image-test", width: 100, height: 100, bytes: 100, mimeType: "image/png" } };
    const previousAdapter = apiClient.defaults.adapter;
    const previousProjects = useCanvasStore.getState().projects;
    const previousAssets = useAssetStore.getState().assets;
    const previousProgress = useSyncProgressStore.getState().syncingProjects;
    let reads = 0;
    let editDuringRead = false;
    let writes = 0;
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === "/user-data/snapshot") data = { projects: [remote], assets: [asset] };
        else if (config.url === "/canvas-projects/media-sync") {
            // 让错误循环有明确上限，测试不能无限运行。
            if (++reads > 3) throw new Error("媒体地址被误判为新编辑，重复读取云端");
            if (editDuringRead) {
                editDuringRead = false;
                useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === remote.id ? { ...project, title: "等待期间的新编辑" } : project)) }));
            }
            data = { project: remote };
        } else if (config.url === "/canvas-projects/media-sync/operations") {
            writes += 1;
            const request = JSON.parse(config.data);
            expect(request.operations).toEqual([{ type: "set_field", field: "title", value: "等待期间的新编辑", beforeValue: "测试" }]);
            remote.title = "等待期间的新编辑";
            remote.revision = 96;
            data = { project: remote };
        } else throw new Error(`意外请求：${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "" } };
    };
    try {
        useCanvasStore.setState({ projects: [] });
        useAssetStore.setState({ assets: [] });
        await syncRemoteUserData("media-sync-user");
        const local = useCanvasStore.getState().projects[0];
        useCanvasStore.setState({ projects: [{ ...local, nodes: local.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "blob:local-preview" } })) }] });
        await saveRemoteUserDataNow("media-sync");
        expect(reads).toBe(1);
        expect(useSyncProgressStore.getState().syncingProjects[remote.id]).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 95 });
        expect(useCanvasStore.getState().projects[0].nodes[0].metadata?.content).toBe(url);

        // 保存回执到达前发生的真实编辑不能因为采用云端资源地址而被覆盖。
        reads = 0;
        editDuringRead = true;
        useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => ({ ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "blob:another-preview" } })) })) }));
        await saveRemoteUserDataNow("media-sync");
        expect(writes).toBe(1);
        expect(reads).toBe(2);
        expect(useCanvasStore.getState().projects[0].title).toBe("等待期间的新编辑");
        expect(useSyncProgressStore.getState().syncingProjects[remote.id]).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 96 });
    } finally {
        await syncRemoteUserData(null);
        apiClient.defaults.adapter = previousAdapter;
        useCanvasStore.setState({ projects: previousProjects });
        useAssetStore.setState({ assets: previousAssets });
        useSyncProgressStore.setState({ syncingProjects: previousProgress });
    }
});
