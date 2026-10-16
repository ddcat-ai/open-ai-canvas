import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

// Isolate transport/storage without leaking module mocks into other test suites.
// Sync, resource conversion, content comparison and progress use production code.
const dir = mkdtempSync(join(tmpdir(), "canvas-sync-progress-"));
const root = new URL("../src/", import.meta.url);
const stubPath = join(dir, "dependencies.ts");
const paths: Record<string, string> = {
    "json-canonicalize": import.meta.resolve("json-canonicalize"),
    zustand: import.meta.resolve("zustand"),
    "@/services/api/resources": join(dir, "resources.ts"),
    "@/lib/canvas/canvas-content": join(dir, "content.ts"),
    "@/stores/use-sync-progress-store": join(dir, "progress.ts"),
    "@/lib/canvas/canvas-task-mutation": fileURLToPath(new URL("../src/lib/canvas/canvas-task-mutation.ts", import.meta.url)),
    "@/lib/canvas/agent-canvas-patch": new URL("../src/lib/canvas/agent-canvas-patch.ts", import.meta.url).pathname,
    "./user-data-sync-media": join(dir, "media.ts"),
    "./canvas-edit-leases": stubPath,
    "@/lib/canvas/agent-canvas-patch": fileURLToPath(new URL("lib/canvas/agent-canvas-patch.ts", root)),
};
function copySource(source: string, name: string) {
    const code = readFileSync(new URL(source, root), "utf8");
    const imports = code.replace(/"(@\/[^\"]+|\.\/user-data-sync-media|\.\/canvas-edit-leases|json-canonicalize|zustand)"/g, (_, specifier: string) => JSON.stringify(paths[specifier] ?? stubPath));
    writeFileSync(join(dir, name), `import { fixtureWindow as window } from ${JSON.stringify(stubPath)};\n` + imports);
}
writeFileSync(
    stubPath,
    `
import { createStore } from ${JSON.stringify(import.meta.resolve("zustand/vanilla"))};
export const fixture = { remote: undefined, remoteById: new Map(), writes: [], writesById: new Map(), reads: 0, readsById: new Map(), receipts: new Map(), errors: new Map(), remoteAssetsById: new Map(), assetReads: [], assetWrites: [], postHook: undefined, afterPostHook: undefined, flushes: 0, beforeFlush: undefined, readHook: undefined, flushError: undefined, setError: undefined, saveHook: undefined, scope: "sync-test-user", manualTimers: false, timers: new Map(), nextTimer: 100000, data: new Map() };
export const fixtureWindow = {
    setTimeout: (callback, delay) => { if (!fixture.manualTimers) return setTimeout(callback, delay); const id = fixture.nextTimer++; fixture.timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => { if (!fixture.timers.delete(id)) clearTimeout(id); },
    addEventListener: () => {},
};
const remoteFor = id => id === "canvas" ? fixture.remote : fixture.remoteById.get(id);
const setRemote = (id, project) => { if (id === "canvas") fixture.remote = project; fixture.remoteById.set(id, project); };
export const useCanvasStore = createStore((set, get) => ({ projects: [], openProject: id => get().projects.find(project => project.id === id) }));
export const useAssetStore = createStore(() => ({ assets: [] }));
export const getActiveUserScope = () => fixture.scope;
export const localForageStorageForScope = () => ({ getItem: async key => fixture.data.get(key) ?? null, setItem: async (key, value) => { await fixture.saveHook?.(key, value); if (fixture.setError) throw fixture.setError; fixture.data.set(key, value); }, removeItem: async key => { fixture.data.delete(key); } });
export async function flushCanvasStorePersistence() { fixture.flushes++; const hook = fixture.beforeFlush; fixture.beforeFlush = undefined; hook?.(); if (fixture.flushError) throw fixture.flushError; }
export const flushAssetStorePersistence = async () => {};
export const getGenerationAssetDefaults = () => undefined;
export const appQueryClient = { invalidateQueries: async () => {} };
export const repairMissingCanvasAssets = () => ({ createdAssets: 0, updatedProjects: 0 });
export class ApiError extends Error { retryable = false; constructor(message, options = {}) { super(message); Object.assign(this, options); } }
export const apiBaseURL = "/api";
const unexpected = () => { throw new Error("unexpected dependency call"); };
export const http = { get: unexpected, post: unexpected, put: unexpected, patch: unexpected, delete: unexpected };
export async function applyRemoteCanvasOperations(id, request) {
    fixture.writes.push(structuredClone(request));
    const writes = fixture.writesById.get(id) ?? [];
    writes.push(structuredClone(request)); fixture.writesById.set(id, writes);
    await fixture.postHook?.(id, request, writes.length);
    const error = fixture.errors.get(id + ":" + writes.length);
    if (error) throw error;
    const key = id + ":" + request.mutationId;
    const digest = JSON.stringify(request);
    const receipt = fixture.receipts.get(key);
    if (receipt) {
        if (receipt.digest !== digest) throw new ApiError("mutation ID reused", { status: 409, reason: "canvas_mutation_id_reused" });
        return structuredClone(receipt.response);
    }
    // Model server transaction/receipt boundaries, not the client fence helper.
    let project = structuredClone(remoteFor(id));
    const conflict = () => { throw new ApiError("field conflict", { status: 409, reason: "canvas_field_conflict" }); };
    const equal = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const getPath = (node, path) => path.split(".").reduce((value, key) => value?.[key], node);
    const putPath = (node, path, value) => { const keys = path.split("."); const last = keys.pop(); let target = node; for (const key of keys) target = target[key] ??= {}; target[last] = value; };
    for (const operation of request.operations) {
        if (operation.type === "create_canvas") {
            if (project || operation.id !== id) conflict();
            project = { id, revision: 0, createdAt: "2026-01-01", nodes: [], connections: [], ...operation.patch };
        } else if (operation.type === "create_node") {
            if (!project || project.nodes.some(node => node.id === operation.node.id)) conflict();
            project.nodes.push(structuredClone(operation.node));
        } else if (operation.type === "set_field") {
            if (!equal(project[operation.field], operation.beforeValue)) conflict();
            project[operation.field] = operation.value;
        } else if (operation.type === "patch_node") {
            const node = project.nodes.find(node => node.id === operation.id);
            if (!node) conflict();
            const mergeTime = Object.hasOwn(operation.patch, "metadata.taskUpdatedAt") && !Object.hasOwn(operation.patch, "metadata.taskId") && !Object.hasOwn(operation.patch, "metadata") && typeof operation.before?.["metadata.taskId"] === "string" && operation.before["metadata.taskId"] === node.metadata?.taskId;
            for (const [path, before] of Object.entries(operation.before ?? {})) {
                if (path === "metadata.taskUpdatedAt" && mergeTime) continue;
                if (!equal(getPath(node, path), before) && !(mergeTime && path !== "metadata.taskId" && Object.hasOwn(operation.patch, path) && equal(getPath(node, path), operation.patch[path]))) conflict();
            }
            for (const [path, value] of Object.entries(operation.patch)) {
                if (mergeTime && path === "metadata.taskUpdatedAt" && Date.parse(node.metadata?.taskUpdatedAt) > Date.parse(value)) continue;
                putPath(node, path, value);
            }
        } else throw new Error("unexpected operation");
    }
    project.revision++;
    const response = { project };
    setRemote(id, project);
    fixture.receipts.set(key, { digest, response: structuredClone(response) });
    await fixture.afterPostHook?.(id, request, writes.length);
    return response;
}
export async function getRemoteCanvasProject(id) { fixture.reads++; fixture.readsById.set(id, (fixture.readsById.get(id) ?? 0) + 1); const hook = fixture.readHook; fixture.readHook = undefined; await hook?.(id); return { project: structuredClone(remoteFor(id)) }; }
export async function getRemoteAsset(id) { fixture.assetReads.push(id); return { asset: structuredClone(fixture.remoteAssetsById.get(id)) }; }
export async function upsertRemoteAsset(asset) { fixture.assetWrites.push(structuredClone(asset)); fixture.remoteAssetsById.set(asset.id, structuredClone(asset)); }
export const assetForRemoteSync = asset => asset;
export const deleteRemoteAssets = unexpected, deleteRemoteCanvasProject = unexpected, getRemoteAssetsByIds = unexpected, getRemoteUserDataSnapshot = unexpected, listRemoteAssetsPage = unexpected;
export const getImageBlob = unexpected, getMediaBlob = unexpected, parseAssetRecordList = unexpected, rebaseAssetSnapshot = unexpected, canvasNodeToAsset = unexpected;
export const canvasEditLeases = { reset() {}, session: () => "test-session", versions: () => ({}), proofs: async () => [], acknowledged() {} };
export const useCanvasHistoryStore = {};
`,
);
copySource("services/api/resources.ts", "resources.ts");
copySource("services/user-data-sync-media.ts", "media.ts");
copySource("lib/canvas/canvas-content.ts", "content.ts");
copySource("stores/use-sync-progress-store.ts", "progress.ts");
copySource("services/user-data-sync.ts", "sync.ts");
const sync: typeof import("@/services/user-data-sync") = await import(join(dir, "sync.ts"));
const { useSyncProgressStore }: typeof import("@/stores/use-sync-progress-store") = await import(join(dir, "progress.ts"));
const { fixture, useCanvasStore, useAssetStore, ApiError } = await import(stubPath);
const { canvasContentHash } = await import(join(dir, "content.ts"));
sync.installRemoteUserDataAutoSync();

const base = (): CanvasProject => ({
    id: "canvas",
    revision: 7,
    title: "Canvas",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    nodes: [{ id: "image", type: "image", title: "Image", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { storageKey: "resource:image", assetId: "asset", content: "/api/resources/image/file" } }] as CanvasProject["nodes"],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});
function withCdnUrl(project = base()): CanvasProject {
    return { ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "https://cdn.example.com/image.png" } })) };
}
function live(): CanvasProject {
    return useCanvasStore.getState().openProject("canvas");
}
function edit(patch: Partial<CanvasProject>) {
    useCanvasStore.setState({ projects: [{ ...live(), ...patch }] });
}
const journalKey = "yingce:canvas-mutation-journal";
const journal = () => JSON.parse(fixture.data.get(journalKey) ?? "[]");
function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
function taskProject(taskId = "task-1", taskUpdatedAt = "2026-01-01T00:00:00Z", prompt = "Original prompt"): CanvasProject {
    const project = base();
    return { ...project, nodes: project.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, taskId, taskUpdatedAt, prompt } })) };
}
function oldTaskEntry() {
    const baseline = taskProject();
    const prepared = { ...taskProject("task-1", "2026-01-01T00:00:01Z", "Local prompt"), title: "Local title" };
    return {
        projectId: "canvas",
        baseline,
        prepared,
        createdAt: "2026-01-01",
        request: {
            mutationId: "old-task-mutation",
            baseRevision: 7,
            operations: [
                { type: "set_field", field: "title", beforeValue: "Canvas", value: "Local title" },
                { type: "patch_node", id: "image", patch: { "metadata.taskUpdatedAt": "2026-01-01T00:00:01Z", "metadata.prompt": "Local prompt" }, before: { "metadata.taskUpdatedAt": "2026-01-01T00:00:00Z", "metadata.prompt": "Original prompt" } },
            ],
        },
    };
}
async function restoreJournal(entries: ReturnType<typeof oldTaskEntry>[], projects = entries.map((entry) => entry.prepared)) {
    sync.resetRemoteUserDataSync();
    fixture.data.set(journalKey, JSON.stringify(entries));
    useCanvasStore.setState({ projects });
    await markConfirmedFixtureSnapshots();
    await sync.initializeRemoteUserDataSession("sync-test-user");
}
async function markConfirmedFixtureSnapshots() {
    // Only snapshots identical to our server fixture are acknowledged. Pending
    // journal projections must retain their older baseline and dirty contents.
    for (const project of useCanvasStore.getState().projects) {
        const remote = project.id === "canvas" ? fixture.remote : fixture.remoteById.get(project.id);
        if (remote && (await canvasContentHash(project)) === (await canvasContentHash(remote))) {
            project.remoteContentHash = await canvasContentHash(remote);
        }
    }
}
async function reloadSession() {
    sync.resetRemoteUserDataSync();
    await markConfirmedFixtureSnapshots();
    await sync.initializeRemoteUserDataSession("sync-test-user");
}
function expectFencedRetry(original: ReturnType<typeof oldTaskEntry>["request"], replacement: typeof original) {
    expect(replacement.mutationId).not.toBe(original.mutationId);
    const expected = structuredClone(original);
    expected.mutationId = replacement.mutationId;
    Object.assign(expected.operations[1]!.before!, { "metadata.taskId": "task-1" });
    expect(replacement).toEqual(expected);
}
beforeEach(async () => {
    sync.resetRemoteUserDataSync();
    fixture.remote = base();
    fixture.data.clear();
    fixture.remoteById.clear();
    fixture.writesById.clear();
    fixture.readsById.clear();
    fixture.receipts.clear();
    fixture.errors.clear();
    fixture.remoteAssetsById.clear();
    fixture.assetReads = [];
    fixture.assetWrites = [];
    useAssetStore.setState({ assets: [] });
    fixture.scope = "sync-test-user";
    fixture.manualTimers = false;
    fixture.timers.clear();
    fixture.postHook = fixture.afterPostHook = fixture.setError = fixture.saveHook = undefined;
    fixture.writes = [];
    fixture.reads = fixture.flushes = 0;
    fixture.beforeFlush = fixture.readHook = fixture.flushError = undefined;
    useCanvasStore.setState({ projects: [base()] });
    await markConfirmedFixtureSnapshots();
    await sync.initializeRemoteUserDataSession("sync-test-user");
});
afterEach(() => sync.resetRemoteUserDataSync());
afterAll(() => {
    if (!resolve(dir).startsWith(resolve(tmpdir()) + sep)) throw new Error("unexpected fixture directory");
    rmSync(dir, { recursive: true, force: true });
});

describe("定向保存与旧 journal 的真实同步集成", () => {
    test("旧空缓存打开更新的云端画布不能转成删除节点操作", async () => {
        fixture.manualTimers = true;
        const cached = { ...base(), nodes: [], revision: 7 };
        useCanvasStore.setState({ projects: [cached] });
        await reloadSession();
        fixture.remote = { ...base(), revision: 8 };
        delete fixture.remote.nodes[0].metadata.assetId;
        let displayed: CanvasProject | undefined;
        await sync.loadCanvasProjectForEditing("canvas", {
            onLoad: (project) => {
                displayed = project;
            },
        });
        expect(displayed?.nodes.map((node) => node.id)).toEqual(["image"]);
        expect(live().nodes.map((node) => node.id)).toEqual(["image"]);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(0);
        expect(fixture.remote.nodes).toHaveLength(1);
        const recovery = JSON.parse(fixture.data.get("yingce:canvas-unverified-recovery:canvas"));
        expect(recovery.at(-1).project.nodes).toEqual([]);
    });

    test("打开期间的标题修改与云端新增节点三方合并，只提交真实标题修改", async () => {
        fixture.manualTimers = true;
        const cached = { ...base(), nodes: [], revision: 7 };
        useCanvasStore.setState({ projects: [cached] });
        await reloadSession();
        fixture.remote = { ...base(), revision: 8 };
        delete fixture.remote.nodes[0].metadata.assetId;
        edit({ title: "Local title" });
        const displayed = await sync.loadCanvasProjectForEditing("canvas");
        expect(displayed?.title).toBe("Local title");
        expect(displayed?.nodes.map((node) => node.id)).toEqual(["image"]);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(1);
        expect(fixture.writes[0].operations).toEqual([{ type: "set_field", field: "title", beforeValue: "Canvas", value: "Local title" }]);
        expect(fixture.remote.nodes).toHaveLength(1);
    });

    test("已落盘的明确删除意图仍保留，但不会删除其他设备新增的节点", async () => {
        fixture.manualTimers = true;
        const baseline = base();
        delete baseline.nodes[0]!.metadata!.assetId;
        const prepared = { ...baseline, nodes: [] };
        const request = { mutationId: "explicit-delete", baseRevision: 7, operations: [{ type: "remove_node", id: "image", expected: baseline.nodes[0] }] };
        sync.resetRemoteUserDataSync();
        fixture.data.set(journalKey, JSON.stringify([{ projectId: "canvas", baseline, prepared, request, createdAt: "2026-01-01" }]));
        useCanvasStore.setState({ projects: [prepared] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        fixture.remote = { ...baseline, revision: 8, nodes: [...baseline.nodes, { ...baseline.nodes[0], id: "remote-new" }] };
        const loaded = await sync.loadCanvasProjectForEditing("canvas");
        expect(loaded?.nodes.map((node) => node.id)).toEqual(["remote-new"]);
        expect(journal()[0].request).toEqual(request);
        expect(fixture.writes).toHaveLength(0);
    });

    test("旧缓存恢复副本写入失败时不覆盖本地、不向云端发送删除请求", async () => {
        fixture.manualTimers = true;
        useCanvasStore.setState({ projects: [{ ...base(), nodes: [] }] });
        await reloadSession();
        fixture.remote = { ...base(), revision: 8 };
        delete fixture.remote.nodes[0].metadata.assetId;
        fixture.setError = new Error("recovery write failed");
        await expect(sync.loadCanvasProjectForEditing("canvas")).rejects.toThrow("recovery write failed");
        expect(live().nodes).toEqual([]);
        expect(fixture.remote.nodes).toHaveLength(1);
        expect(fixture.writes).toHaveLength(0);
    });

    test("本地与云端修改同一标题时保留两边内容，拒绝静默覆盖", async () => {
        fixture.manualTimers = true;
        edit({ title: "Local title" });
        fixture.remote = { ...base(), revision: 8, title: "Remote title" };
        delete fixture.remote.nodes[0].metadata.assetId;
        await expect(sync.loadCanvasProjectForEditing("canvas")).rejects.toThrow("冲突");
        expect(live().title).toBe("Local title");
        expect(fixture.remote.title).toBe("Remote title");
        expect(fixture.writes).toHaveLength(0);
    });

    test("A 全局后台 409 失败不复用给已排队 B，B 自己的新编辑必须提交", async () => {
        const entry = oldTaskEntry();
        const b = { ...base(), id: "canvas-b", title: "B" };
        fixture.remote = taskProject("rebound-task", "2026-01-01T00:00:02Z");
        fixture.remoteById.set(b.id, structuredClone(b));
        await restoreJournal([entry], [entry.prepared, b]);
        const entered = deferred();
        const release = deferred();
        fixture.postHook = async (id: string) => {
            if (id === "canvas") {
                entered.resolve();
                await release.promise;
            }
        };
        const background = sync.saveRemoteUserDataNow().then(
            () => undefined,
            (error: unknown) => error,
        );
        await entered.promise;
        useCanvasStore.setState({ projects: [entry.prepared, { ...b, title: "B own edit" }] });
        const foreground = sync.saveRemoteUserDataNow(b.id);
        release.resolve();
        expect(await background).toMatchObject({ message: "field conflict" });
        await foreground;
        expect(fixture.writesById.get(b.id)).toHaveLength(1);
        expect(fixture.writesById.get(b.id)[0].operations).toContainEqual({ type: "set_field", field: "title", beforeValue: "B", value: "B own edit" });
        expect(fixture.remoteById.get(b.id).title).toBe("B own edit");
        expect(fixture.writesById.get("canvas")).toHaveLength(2);
        expect(journal()).toHaveLength(1);
        expect(journal()[0].projectId).toBe("canvas");
        expect(useSyncProgressStore.getState().syncingProjects[b.id]).toMatchObject({ phase: "done", pendingChanges: 0 });
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("error");
    });

    test("A 旧冲突后台在途时，revision0 且无 remote 的新建 B 仍能 scoped create_canvas 成功", async () => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject("rebound-task", "2026-01-01T00:00:02Z");
        await restoreJournal([entry]);
        const entered = deferred();
        const release = deferred();
        fixture.postHook = async (id: string) => {
            if (id === "canvas") {
                entered.resolve();
                await release.promise;
            }
        };
        const background = sync.saveRemoteUserDataNow().then(
            () => undefined,
            (error: unknown) => error,
        );
        await entered.promise;
        // Insert only after session initialization: B has no acknowledged or remote baseline.
        const b = { ...base(), id: "new-canvas-b", revision: 0, title: "Brand new B" };
        useCanvasStore.setState({ projects: [entry.prepared, b] });
        expect(fixture.remoteById.has(b.id)).toBe(false);
        expect(useCanvasStore.getState().openProject(b.id).revision).toBe(0);
        const creating = sync.saveRemoteUserDataNow(b.id);
        release.resolve();
        expect(await background).toMatchObject({ message: "field conflict" });
        await creating;
        const writes = fixture.writesById.get(b.id);
        expect(writes).toHaveLength(1);
        expect(writes[0].baseRevision).toBeUndefined();
        expect(writes[0].operations.map((operation: { type: string }) => operation.type)).toEqual(["create_canvas", "create_node"]);
        expect(writes[0].operations[0]).toMatchObject({ type: "create_canvas", id: b.id, patch: { title: b.title } });
        expect(writes[0].operations[1]).toEqual({ type: "create_node", node: b.nodes[0] });
        expect(fixture.remoteById.get(b.id)).toMatchObject({ id: b.id, title: b.title, revision: 1, nodes: b.nodes });
        expect(useCanvasStore.getState().openProject(b.id)).toMatchObject({ id: b.id, title: b.title, revision: 1 });
        expect(fixture.readsById.get(b.id)).toBe(1);
        expect(fixture.writesById.get("canvas")).toHaveLength(2);
        expect(journal()).toEqual([{ ...entry, request: fixture.writesById.get("canvas")[1] }]);
        expect(useSyncProgressStore.getState().syncingProjects[b.id]).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 1 });
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("error");
    });

    test("单独保存 B 不读取、不提交或重写 A pending entry", async () => {
        const entry = oldTaskEntry();
        const b = { ...base(), id: "canvas-b" };
        fixture.remoteById.set(b.id, structuredClone(b));
        await restoreJournal([entry], [entry.prepared, b]);
        useCanvasStore.setState({ projects: [entry.prepared, { ...b, title: "B edit" }] });
        await sync.saveRemoteUserDataNow(b.id);
        expect(fixture.writesById.has("canvas")).toBe(false);
        expect(fixture.readsById.has("canvas")).toBe(false);
        expect(journal()).toEqual([entry]);
    });

    test("B 定向保存忙时 A 的新编辑会另排全局自动保存，不被 scoped drain 消费", async () => {
        const b = { ...base(), id: "canvas-b" };
        fixture.remoteById.set(b.id, structuredClone(b));
        useCanvasStore.setState({ projects: [base(), b] });
        await reloadSession();
        fixture.manualTimers = true;
        useCanvasStore.setState({ projects: [base(), { ...b, title: "B edit" }] });
        const entered = deferred();
        const release = deferred();
        fixture.postHook = async (id: string) => {
            if (id === b.id) {
                entered.resolve();
                await release.promise;
            }
        };
        const saving = sync.saveRemoteUserDataNow(b.id);
        await entered.promise;
        // Model a consumed background timer: only the edit during B can re-arm it.
        fixture.timers.clear();
        useCanvasStore.setState({ projects: [{ ...base(), title: "A while B saving" }, useCanvasStore.getState().openProject(b.id)] });
        release.resolve();
        await saving;
        expect(fixture.writesById.has("canvas")).toBe(false);
        expect(fixture.writesById.get(b.id)).toHaveLength(1);
        expect(fixture.timers.size).toBe(1);
        const [timerId, timer] = [...fixture.timers][0];
        expect(timer.delay).toBe(1200);
        fixture.timers.delete(timerId);
        const autoPosted = deferred();
        fixture.postHook = (id: string) => {
            if (id === "canvas") autoPosted.resolve();
        };
        timer.callback();
        await autoPosted.promise;
        await sync.withRemoteUserDataSyncExclusive(async () => {});
        expect(fixture.writesById.get("canvas")).toHaveLength(1);
        expect(fixture.remote.title).toBe("A while B saving");
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("B 定向保存不继承 A 正在进行的 load 失败", async () => {
        const b = { ...base(), id: "canvas-b" };
        fixture.remoteById.set(b.id, structuredClone(b));
        useCanvasStore.setState({ projects: [base(), b] });
        await reloadSession();
        useCanvasStore.setState({ projects: [base(), { ...b, title: "B edit" }] });
        const entered = deferred();
        const release = deferred();
        fixture.readHook = async () => {
            entered.resolve();
            await release.promise;
            throw new Error("A load failed");
        };
        const loading = sync.loadCanvasProjectForEditing("canvas").then(
            () => undefined,
            (error: unknown) => error,
        );
        await entered.promise;
        const saving = sync.saveRemoteUserDataNow(b.id);
        release.resolve();
        expect(await loading).toMatchObject({ message: "A load failed" });
        await saving;
        expect(fixture.writesById.get(b.id)).toHaveLength(1);
        expect(fixture.remoteById.get(b.id).title).toBe("B edit");
        expect(useSyncProgressStore.getState().syncingProjects[b.id].phase).toBe("done");
    });

    test("B 仅同步 dirty 且引用或 own 的 assets，不碰 A 或无关素材", async () => {
        const b = { ...base(), id: "canvas-b" };
        fixture.remoteById.set(b.id, structuredClone(b));
        const assets = [
            { id: "asset", metadata: {}, title: "Referenced" },
            { id: "owned", metadata: { canvasId: b.id }, title: "Owned" },
            { id: "clean-owned", metadata: { canvasId: b.id }, title: "Clean owned" },
            { id: "a-only", metadata: { canvasId: "canvas" }, title: "A only" },
            { id: "unrelated", metadata: {}, title: "Unrelated" },
        ].map((asset) => ({ ...asset, kind: "text", data: { content: "Original" }, createdAt: "2026-01-01", updatedAt: "2026-01-01" }));
        for (const asset of assets) fixture.remoteAssetsById.set(asset.id, structuredClone(asset));
        useAssetStore.setState({ assets });
        useCanvasStore.setState({ projects: [base(), b] });
        await reloadSession();
        useAssetStore.setState({ assets: assets.map((asset) => (asset.id === "clean-owned" ? asset : { ...asset, title: asset.title + " edited" })) });
        useCanvasStore.setState({ projects: [base(), { ...b, title: "B edit" }] });
        await sync.saveRemoteUserDataNow(b.id);
        expect(fixture.assetReads).toEqual(["asset", "owned"]);
        expect(fixture.assetWrites.map((asset: { id: string }) => asset.id)).toEqual(["asset", "owned"]);
        expect(fixture.writesById.has("canvas")).toBe(false);
        expect(fixture.writesById.get(b.id)).toHaveLength(1);
    });

    test("assets-only [] 保存 dirty asset，但即使有 dirty canvas 与 pending journal 也不 POST 画布", async () => {
        const entry = oldTaskEntry();
        const asset = { id: "library", kind: "text", title: "Library asset", data: { content: "Original" }, metadata: {}, createdAt: "2026-01-01", updatedAt: "2026-01-01" };
        fixture.remoteAssetsById.set(asset.id, structuredClone(asset));
        useAssetStore.setState({ assets: [asset] });
        await restoreJournal([entry]);
        useAssetStore.setState({ assets: [{ ...asset, title: "Edited asset" }] });
        await sync.saveRemoteUserDataNow([]);
        expect(fixture.assetWrites).toHaveLength(1);
        expect(fixture.assetWrites[0].title).toBe("Edited asset");
        expect(fixture.writes).toHaveLength(0);
        expect(fixture.reads).toBe(0);
        expect(journal()).toEqual([entry]);
    });

    test("旧无 fence timestamp journal 409 后先持久化新 ID 与 fence，业务 before 原封不动", async () => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject("task-1", "2026-01-01T00:00:02Z");
        await restoreJournal([entry]);
        fixture.postHook = (_id: string, request: unknown) => {
            expect(journal()[0].request).toEqual(request);
        };
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(2);
        expectFencedRetry(entry.request, fixture.writes[1]);
        expect(fixture.remote.title).toBe("Local title");
        expect(fixture.remote.nodes[0].metadata).toMatchObject({ taskId: "task-1", taskUpdatedAt: "2026-01-01T00:00:02Z", prompt: "Local prompt" });
        expect(fixture.receipts.size).toBe(1);
        expect(journal()).toEqual([]);
    });

    test("同 task 业务字段已精确收敛时仍保留旧 before，补 fence 后完成旧 journal", async () => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject("task-1", "2026-01-01T00:00:02Z", "Local prompt");
        await restoreJournal([entry]);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(2);
        expectFencedRetry(entry.request, fixture.writes[1]);
        expect(fixture.writes[1].operations[1].before["metadata.prompt"]).toBe("Original prompt");
        expect(fixture.remote.nodes[0].metadata.prompt).toBe("Local prompt");
        expect(journal()).toEqual([]);
    });

    test("journal 自身 task 换绑时不补 fence，也不换 ID 重试", async () => {
        const entry = oldTaskEntry();
        entry.prepared.nodes[0]!.metadata!.taskId = "new-task";
        Object.assign(entry.request.operations[1]!.patch!, { "metadata.taskId": "new-task" });
        Object.assign(entry.request.operations[1]!.before!, { "metadata.taskId": "task-1" });
        fixture.remote = taskProject("task-1", "2026-01-01T00:00:02Z");
        const originalRemote = structuredClone(fixture.remote);
        await restoreJournal([entry]);
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("field conflict");
        expect(fixture.writes).toEqual([entry.request]);
        expect(journal()).toEqual([entry]);
        expect(fixture.remote).toEqual(originalRemote);
        expect(fixture.receipts.size).toBe(0);
    });

    test("补 fence 第二 POST 已提交但响应 unknown，reload 后按 exact same ID/body receipt 重放", async () => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject("task-1", "2026-01-01T00:00:02Z");
        await restoreJournal([entry]);
        fixture.afterPostHook = (_id: string, _request: unknown, ordinal: number) => {
            if (ordinal === 2) throw new Error("response lost");
        };
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("response lost");
        const retry = structuredClone(fixture.writes[1]);
        expectFencedRetry(entry.request, retry);
        expect(journal()[0].request).toEqual(retry);
        const revision = fixture.remote.revision;
        fixture.afterPostHook = undefined;
        await reloadSession();
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(3);
        expect(fixture.writes[2]).toEqual(retry);
        expect(fixture.remote.revision).toBe(revision);
        expect(fixture.receipts.size).toBe(1);
        expect(journal()).toEqual([]);
    });

    test("原请求第一次 unknown 不补 fence、不换 ID，reload 仍逐字重放", async () => {
        const entry = oldTaskEntry();
        fixture.remote = structuredClone(entry.baseline);
        await restoreJournal([entry]);
        fixture.afterPostHook = () => {
            throw new Error("response lost");
        };
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("response lost");
        expect(fixture.writes).toEqual([entry.request]);
        expect(journal()).toEqual([entry]);
        const revision = fixture.remote.revision;
        fixture.afterPostHook = undefined;
        await reloadSession();
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toEqual([entry.request, entry.request]);
        expect(fixture.remote.revision).toBe(revision);
    });

    test("新 journal 落盘失败不发送第二 POST，原内存 entry 下次安全重试", async () => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject("task-1", "2026-01-01T00:00:02Z");
        await restoreJournal([entry]);
        fixture.saveHook = (_key: string, value: string) => {
            if (JSON.parse(value)[0].request.mutationId !== entry.request.mutationId) throw new Error("journal disk full");
        };
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("journal disk full");
        expect(fixture.writes).toEqual([entry.request]);
        expect(journal()).toEqual([entry]);
        expect(fixture.receipts.size).toBe(0);
        fixture.saveHook = undefined;
        fixture.postHook = (_id: string, request: unknown) => {
            expect(journal()[0].request).toEqual(request);
        };
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(3);
        expect(fixture.writes[1]).toEqual(entry.request);
        expectFencedRetry(entry.request, fixture.writes[2]);
        expect(journal()).toEqual([]);
    });

    test("首次 journal persist 失败也不 POST，下次先持久化才发送", async () => {
        edit({ title: "New edit" });
        fixture.setError = new Error("journal unavailable");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("journal unavailable");
        expect(fixture.writes).toHaveLength(0);
        fixture.setError = undefined;
        fixture.postHook = (_id: string, request: unknown) => {
            expect(journal()[0].request).toEqual(request);
        };
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(1);
        expect(fixture.remote.title).toBe("New edit");
    });

    test.each(["task", "prompt"])("%s 真实业务冲突不会被 timestamp fence 吞掉或部分 apply", async (kind) => {
        const entry = oldTaskEntry();
        fixture.remote = taskProject(kind === "task" ? "other-task" : "task-1", "2026-01-01T00:00:02Z", kind === "prompt" ? "Remote prompt" : "Original prompt");
        const originalRemote = structuredClone(fixture.remote);
        await restoreJournal([entry]);
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("field conflict");
        expect(fixture.writes).toHaveLength(2);
        const fenced = structuredClone(fixture.writes[1]);
        expectFencedRetry(entry.request, fenced);
        expect(fixture.remote).toEqual(originalRemote);
        expect(fixture.receipts.size).toBe(0);
        expect(journal()[0].request).toEqual(fenced);
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("field conflict");
        expect(fixture.writes).toHaveLength(3);
        expect(fixture.writes[2]).toEqual(fenced);
    });

    test("v1.6.8.5 journal 把新 taskId 写进 before 时，409 后按原快照修复基线并提交", async () => {
        const baseline = taskProject("task-1", "2026-01-01T00:00:00Z");
        baseline.nodes = baseline.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, taskId: undefined, taskUpdatedAt: undefined, status: "idle" } }));
        const prepared = taskProject("task-new", "2026-01-01T00:00:05Z");
        prepared.nodes = prepared.nodes.map((node) => ({ ...node, metadata: { ...node.metadata, status: "loading" } }));
        fixture.remote = structuredClone(baseline);
        const entry = {
            projectId: "canvas",
            baseline,
            prepared,
            createdAt: "2026-01-01",
            request: {
                mutationId: "legacy-bind",
                baseRevision: 7,
                operations: [
                    {
                        type: "patch_node",
                        id: "image",
                        patch: { "metadata.taskId": "task-new", "metadata.taskUpdatedAt": "2026-01-01T00:00:05Z", "metadata.status": "loading" },
                        before: { "metadata.taskId": "task-new", "metadata.taskUpdatedAt": null, "metadata.status": "idle" },
                    },
                ],
            },
        };
        await restoreJournal([entry as unknown as ReturnType<typeof oldTaskEntry>]);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toHaveLength(2);
        expect(fixture.writes[1].mutationId).not.toBe("legacy-bind");
        expect(fixture.writes[1].operations[0].before["metadata.taskId"]).toBeNull();
        expect(fixture.remote.nodes[0].metadata).toMatchObject({ taskId: "task-new", status: "loading", taskUpdatedAt: "2026-01-01T00:00:05Z" });
        expect(journal()).toEqual([]);
    });

    test.each([
        { status: 409, reason: "canvas_mutation_id_reused" },
        { status: 500, reason: "canvas_field_conflict" },
    ])("非明确 canvas_field_conflict 409 不升级请求：%j", async (options) => {
        const entry = oldTaskEntry();
        await restoreJournal([entry]);
        fixture.errors.set("canvas:1", new ApiError("other rejection", options));
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("other rejection");
        expect(fixture.writes).toEqual([entry.request]);
        expect(journal()).toEqual([entry]);
    });

    test("一条 canvas 失败不妨碍同批另一个 canvas POST 并结束 progress", async () => {
        const b = { ...base(), id: "canvas-b", title: "B" };
        fixture.remoteById.set(b.id, structuredClone(b));
        useCanvasStore.setState({ projects: [base(), b] });
        await reloadSession();
        useCanvasStore.setState({
            projects: [
                { ...base(), title: "A edit" },
                { ...b, title: "B edit" },
            ],
        });
        fixture.errors.set("canvas:1", new ApiError("A conflict", { status: 409, reason: "canvas_field_conflict" }));
        await expect(sync.saveRemoteUserDataNow()).rejects.toThrow("A conflict");
        expect(fixture.writesById.get(b.id)).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("error");
        expect(useSyncProgressStore.getState().syncingProjects[b.id]).toMatchObject({ phase: "done", pendingChanges: 0 });
        expect(journal().map((entry: { projectId: string }) => entry.projectId)).toEqual(["canvas"]);
    });

    test("本地 flush 失败保留已提交 journal，reload receipt 重放不重复 apply", async () => {
        edit({ title: "Saved remotely" });
        fixture.flushError = new Error("local flush failed");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("local flush failed");
        expect(journal()).toHaveLength(1);
        const request = structuredClone(journal()[0].request);
        const revision = fixture.remote.revision;
        fixture.flushError = undefined;
        await reloadSession();
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.writes).toEqual([request, request]);
        expect(fixture.remote.revision).toBe(revision);
        expect(journal()).toEqual([]);
    });

    test.each(["persist", "get", "flush"])("会话在 %s 期间切换后不再 POST 或写新会话状态", async (stage) => {
        edit({ title: "Old account edit" });
        let switchedState: unknown;
        const switchScope = () => {
            fixture.scope = "other-user";
            sync.resetRemoteUserDataSync();
            useCanvasStore.setState({ projects: [{ ...base(), title: "Other account canvas" }] });
            switchedState = useCanvasStore.getState().projects;
        };
        if (stage === "persist")
            fixture.saveHook = () => {
                fixture.saveHook = undefined;
                switchScope();
            };
        if (stage === "get") fixture.readHook = switchScope;
        if (stage === "flush") fixture.beforeFlush = switchScope;
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("账号已切换");
        expect(fixture.writes).toHaveLength(stage === "persist" ? 0 : 1);
        expect(useCanvasStore.getState().projects).toBe(switchedState);
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toBeUndefined();
    });
});

describe("画布云端同步状态收尾", () => {
    test("资源地址差异产生空操作时结束同步，后续保存不再重复处理", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", total: 0, pendingChanges: 0, cloudRevision: 7 });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(false);
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(0);
        expect(fixture.reads).toBe(0);
        expect(fixture.flushes).toBe(1);
        await sync.saveRemoteUserDataNow("canvas");
        expect(fixture.flushes).toBe(1);
    });

    test("实际提交后采用云端资源地址，只保存一次并结束同步", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe("Renamed");
        expect(live().nodes[0].metadata?.content).toBe("/api/resources/image/file");
        expect(fixture.writes).toHaveLength(1);
        expect(fixture.reads).toBe(1);
        expect(fixture.flushes).toBe(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "done", pendingChanges: 0, cloudRevision: 8 });
    });

    test("空操作收尾期间的新编辑保留并继续提交", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.beforeFlush = () => edit({ title: "Edited during persistence" });
        const phases: string[] = [];
        const stop = useSyncProgressStore.subscribe((state) => phases.push(state.syncingProjects.canvas?.phase));
        try {
            await sync.saveRemoteUserDataNow("canvas");
        } finally {
            stop();
        }
        expect(phases).toContain("pending");
        expect(live().title).toBe("Edited during persistence");
        expect(fixture.remote.title).toBe(live().title);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("云端回读期间的视口更新保留", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title: "Renamed" })] });
        const viewport = { x: 40, y: 90, k: 2 };
        fixture.readHook = () => edit({ viewport });
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().viewport).toEqual(viewport);
        expect(fixture.writes).toHaveLength(1);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });

    test("空操作收尾的本地保存失败仍显示错误", async () => {
        useCanvasStore.setState({ projects: [withCdnUrl()] });
        fixture.flushError = new Error("local persistence failed");
        await expect(sync.saveRemoteUserDataNow("canvas")).rejects.toThrow("local persistence failed");
        expect(useSyncProgressStore.getState().syncingProjects.canvas).toMatchObject({ phase: "error", pendingChanges: 1, errorKind: "local" });
        expect(useSyncProgressStore.getState().isAnySyncing()).toBe(true);
    });

    test.each([false, true])("重放 journal 时保留后续编辑（有新编辑：%s）", async (newerEdit) => {
        sync.resetRemoteUserDataSync();
        const prepared = { ...base(), title: "Queued edit" };
        fixture.data.set(
            "yingce:canvas-mutation-journal",
            JSON.stringify([
                { projectId: "canvas", request: { mutationId: "pending-mutation", baseRevision: 7, operations: [{ type: "set_field", field: "title", value: prepared.title, beforeValue: "Canvas" }] }, baseline: base(), prepared, createdAt: "2026-01-01" },
            ]),
        );
        const title = newerEdit ? "Newer edit" : prepared.title;
        useCanvasStore.setState({ projects: [withCdnUrl({ ...base(), title })] });
        await sync.initializeRemoteUserDataSession("sync-test-user");
        await sync.saveRemoteUserDataNow("canvas");
        expect(live().title).toBe(title);
        expect(fixture.remote.title).toBe(title);
        expect(fixture.writes).toHaveLength(newerEdit ? 2 : 1);
        expect(fixture.writes[0].mutationId).toBe("pending-mutation");
        expect(fixture.data.has("yingce:canvas-mutation-journal")).toBe(false);
        expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    });
});
