import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";
import { setActiveUserScope } from "@/lib/user-scope";
import { apiClient } from "@/services/api/request";
import { buildCanvasOperations, deleteCanvasProjectsWithRemoteSync, loadCanvasProjectForEditing, prepareCanvasForCloudAction, resetRemoteUserDataSync, syncRemoteUserData } from "@/services/user-data-sync";
import { canvasDraftNavigationState, flushCanvasStorePersistence, useCanvasStore, withCanvasStorePersistenceSuppressed } from "@/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence, useAssetStore } from "@/stores/use-asset-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const originalWindow = globalThis.window;
const originalAdapter = apiClient.defaults.adapter;
const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalRemove = localforage.removeItem;
const disk = new Map<string, unknown>();
const local = new Map<string, string>();
let writes = 0;
let requests: string[] = [];
let sequence = 0;
let scope: string;
const node = (id: string, metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData => ({ id, type: CanvasNodeType.Text, title: `${id}.txt`, position: { x: 0, y: 0 }, width: 200, height: 100, metadata });

beforeEach(async () => {
    resetRemoteUserDataSync();
    disk.clear();
    local.clear();
    requests = [];
    scope = `canvas-draft-test-${++sequence}`;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => {},
            addEventListener: () => {},
            removeEventListener: () => {},
            localStorage: {
                getItem: (key: string) => local.get(key) ?? null,
                setItem: (key: string, value: string) => local.set(key, value),
                removeItem: (key: string) => local.delete(key),
                key: (index: number) => [...local.keys()][index] ?? null,
                get length() {
                    return local.size;
                },
            },
        },
    });
    localforage.getItem = (async (key: string) => disk.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        writes += 1;
        disk.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = async (key: string) => {
        disk.delete(key);
    };
    setActiveUserScope(scope);
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [], drafts: {} }));
    useAssetStore.setState({ assets: [] });
    await useCanvasStore.persist.rehydrate();
    await flushCanvasStorePersistence();
    await flushAssetStorePersistence();
    writes = 0;
    apiClient.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        if (config.url !== "/user-data/snapshot") throw new Error(`Unexpected request: ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { projects: [], assets: [] }, msg: "ok" } };
    };
});

afterEach(async () => {
    await flushCanvasStorePersistence();
    await flushAssetStorePersistence();
    resetRemoteUserDataSync();
    apiClient.defaults.adapter = originalAdapter;
    localforage.getItem = originalGet;
    localforage.setItem = originalSet;
    localforage.removeItem = originalRemove;
    Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

test("opening, panning, zooming and empty assistant sessions never write a draft", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject("Untitled");
    expect((await loadCanvasProjectForEditing(id))?.id).toBe(id);
    store.updateProject(id, { viewport: { x: 100, y: -50, k: 2 }, backgroundMode: "dots", chatSessions: [{ id: "chat", title: "Chat", messages: [], createdAt: "2026-01-01", updatedAt: "2026-01-01" }] });
    await flushCanvasStorePersistence();
    expect(useCanvasStore.getState().projects).toHaveLength(0);
    expect(writes).toBe(0);
    expect(requests).toEqual([]);
    expect([...local.keys()].some((key) => key.includes("canvas_store_journal"))).toBe(false);
});

test("failed, cancelled and still-pending uploads do not materialize an empty canvas", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject();
    store.updateProject(id, { nodes: [node("pending", { fileUpload: "uploading" })] });
    store.updateProject(id, { nodes: [node("pending", { fileUpload: "error" })] });
    store.updateProject(id, { nodes: [] });
    await flushCanvasStorePersistence();
    expect(store.getDraftProject(id)?.nodes).toHaveLength(0);
    expect(useCanvasStore.getState().projects).toHaveLength(0);
    expect(writes).toBe(0);
    await deleteCanvasProjectsWithRemoteSync([id]);
    expect(store.openProject(id)).toBeNull();
    expect(requests).toEqual([]);
});

test("browser-history refresh intent recreates only the same in-memory draft ID", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject("剧本.v2.md");
    const intent = canvasDraftNavigationState(id)!;
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ drafts: {} }));
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().projects).toHaveLength(0);
    expect(store.createDraftProject(intent.canvasDraft.title, intent.canvasDraft.id)).toBe(id);
    expect(store.openProject(id)?.title).toBe("剧本.v2.md");
    expect(writes).toBe(0);
});

test("concurrent successful operations and first-save retries share one ID and survive rehydrate", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject("创作");
    await Promise.all(
        ["one", "two"].map(async (key) => {
            await Promise.resolve();
            store.updateProject(id, { nodes: [...store.openProject(id)!.nodes, node(key, { content: key })] });
            store.materializeDraft(id);
        }),
    );
    await flushCanvasStorePersistence();
    expect(store.getDraftProject(id)).toBeNull();
    expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual([id]);
    expect(buildCanvasOperations(undefined, store.openProject(id)!)[0]).toMatchObject({ type: "create_canvas", id });
    withCanvasStorePersistenceSuppressed(() => useCanvasStore.setState({ projects: [], drafts: {} }));
    await useCanvasStore.persist.rehydrate();
    expect(store.openProject(id)?.nodes.map((item) => item.id)).toEqual(["one", "two"]);
    store.updateProject(id, { nodes: [] });
    await flushCanvasStorePersistence();
    await useCanvasStore.persist.rehydrate();
    expect(store.openProject(id)).not.toBeNull();
    expect(store.openProject(id)?.nodes).toHaveLength(0);
});

test("explicit save retains an empty canvas and a rejected cloud submission retains the same local ID", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject();
    store.materializeDraft(id);
    store.materializeDraft(id);
    await flushCanvasStorePersistence();
    expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual([id]);
    const submitted = store.createDraftProject("Agent submission");
    await expect(prepareCanvasForCloudAction(submitted)).rejects.toThrow();
    expect(store.getDraftProject(submitted)).toBeNull();
    expect(store.openProject(submitted)?.id).toBe(submitted);
    await expect(prepareCanvasForCloudAction(submitted)).rejects.toThrow();
    expect(useCanvasStore.getState().projects.filter((project) => project.id === submitted)).toHaveLength(1);
});

test("remote synchronization excludes untouched drafts across repeated syncs", async () => {
    await syncRemoteUserData(scope);
    const store = useCanvasStore.getState();
    const id = store.createDraftProject();
    await syncRemoteUserData(scope);
    expect(store.getDraftProject(id)).not.toBeNull();
    expect(requests.every((request) => request === "get /user-data/snapshot")).toBe(true);
});

test("concurrent first cloud saves create exactly one canvas using the editor ID", async () => {
    await syncRemoteUserData(scope);
    const store = useCanvasStore.getState();
    const id = store.createDraftProject("Cloud draft");
    let creates = 0;
    let remote: ReturnType<typeof store.openProject>;
    apiClient.defaults.adapter = async (config) => {
        let data: unknown;
        if (config.url === `/canvas-projects/${id}/operations` && config.method === "patch") {
            const body = JSON.parse(config.data);
            expect(body.operations.filter((op: { type: string }) => op.type === "create_canvas")).toEqual([expect.objectContaining({ type: "create_canvas", id })]);
            creates += 1;
            remote = { ...structuredClone(store.openProject(id)!), revision: 1 };
            data = { project: { id, revision: 1 }, mutationId: body.mutationId };
        } else if (config.url === `/canvas-projects/${id}` && config.method === "get") {
            data = { project: remote };
        } else throw new Error(`Unexpected request: ${config.method} ${config.url}`);
        return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data, msg: "ok" } };
    };
    await Promise.all([prepareCanvasForCloudAction(id), prepareCanvasForCloudAction(id)]);
    expect(creates).toBe(1);
    expect(store.openProject(id)?.revision).toBe(1);
    expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual([id]);
});

test("a restored saved canvas takes precedence over stale draft navigation state", async () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject("Draft title");
    const saved = { ...store.openProject(id)!, title: "Saved title", revision: 2, nodes: [node("saved")] };
    store.replaceProjects([saved]);
    expect(store.getDraftProject(id)).toBeNull();
    expect(store.createDraftProject("Stale navigation title", id)).toBe(id);
    store.materializeDraft(id);
    expect(store.openProject(id)?.title).toBe("Saved title");
    expect(store.openProject(id)?.nodes).toHaveLength(1);
    await flushCanvasStorePersistence();
    expect(useCanvasStore.getState().projects).toHaveLength(1);
});

test("account changes hide drafts belonging to the previous user", () => {
    const store = useCanvasStore.getState();
    const id = store.createDraftProject();
    setActiveUserScope("another-canvas-draft-user");
    expect(store.openProject(id)).toBeNull();
    store.materializeDraft(id);
    expect(useCanvasStore.getState().projects).toHaveLength(0);
    setActiveUserScope(scope);
});
