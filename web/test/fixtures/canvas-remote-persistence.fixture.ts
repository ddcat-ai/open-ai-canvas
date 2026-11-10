import assert from "node:assert/strict";
import localforage from "localforage";
import { Window } from "happy-dom";
import type { CanvasProject } from "../../src/stores/canvas/use-canvas-store";

// 只替换最终存储驱动与网络传输，读边界、Zustand 日志和序列化均使用真实实现。
const dom = new Window({ url: "http://localhost/" });
Object.defineProperty(globalThis, "window", { configurable: true, value: dom });
Object.defineProperty(globalThis, "localStorage", { configurable: true, value: dom.localStorage });
const saved = new Map<string, unknown>();
localforage.getItem = (async (key: string) => structuredClone(saved.get(key) ?? null)) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: unknown) => {
    saved.set(key, structuredClone(value));
    return value;
}) as typeof localforage.setItem;
localforage.removeItem = (async (key: string) => {
    saved.delete(key);
}) as typeof localforage.removeItem;

const { setActiveUserScope, scopedStorageKey } = await import("../../src/lib/user-scope");
setActiveUserScope("remote-persistence-fixture");
const { apiClient } = await import("../../src/services/api/request");
const { getRemoteCanvasProject } = await import("../../src/services/api/user-data");
const { useCanvasStore, flushCanvasStorePersistence, CANVAS_STORE_KEY, withCanvasStorePersistenceSuppressed } = await import("../../src/stores/canvas/use-canvas-store");
const { parseCanvasStorageDocument } = await import("../../src/lib/canvas/canvas-storage-revision");
try {
    await useCanvasStore.persist.rehydrate();
    const raw = {
        id: "canvas",
        revision: 1,
        title: "远端画布",
        createdAt: "2026-11-10T00:00:00Z",
        updatedAt: "2026-11-10T00:00:00Z",
        nodes: [],
        connections: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    } as unknown as CanvasProject;
    apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { project: raw } } });
    const { project } = await getRemoteCanvasProject(raw.id);
    // 不经过 importProject 的默认值，让测试覆盖真实同步 replaceProjects 入口。
    useCanvasStore.getState().replaceProjects([project]);
    await flushCanvasStorePersistence();
    const key = scopedStorageKey(CANVAS_STORE_KEY);
    assert.ok(saved.has(key), "必须实际写入存储驱动");
    assert.deepEqual(parseCanvasStorageDocument(saved.get(key) as string).state.projects[0].chatSessions, []);
    useCanvasStore.getState().renameProject(raw.id, "保存后重开");
    await flushCanvasStorePersistence();
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [] }));
    await useCanvasStore.persist.rehydrate();
    const reopened = useCanvasStore.getState().openProject(raw.id)!;
    assert.equal(reopened.title, "保存后重开");
    assert.deepEqual(reopened.chatSessions, []);
    assert.equal(raw.chatSessions, undefined);
    console.log("remote persistence: passed");
} finally {
    await flushCanvasStorePersistence();
    await dom.happyDOM.abort();
}
