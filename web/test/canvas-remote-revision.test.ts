import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";
import { apiClient } from "../src/services/api/request";
import { canvasContentHash } from "../src/lib/canvas/canvas-content";
import { rebaseCanvasProjects, parseCanvasStorageDocument } from "../src/lib/canvas/canvas-storage-revision";
import { readCanvasSyncDrafts } from "../src/services/canvas-sync-drafts";
import { applyCanvasCollaborationRemoteOperation, mergeCanvasBranchWithSync, preserveCanvasLiveConflict, pullLatestCollaborativeCanvasProject, resolveCanvasConflict, applyAgentCanvasPatches, deleteCanvasProjectsWithRemoteSync, refreshCanvasAfterAgent, initializeRemoteUserDataSession, installRemoteUserDataAutoSync, loadCanvasProjectForEditing, resetRemoteUserDataSync, saveRemoteUserDataNow, syncRemoteUserData } from "../src/services/user-data-sync";
import { createAgentCanvasSync } from "../src/services/agent-canvas-sync";
import { readCanvasConflict } from "../src/services/canvas-conflicts";
import { applyCanvasCollaborationOperation } from "../src/lib/canvas/canvas-collaboration-operations";
import { readCanvasCollaborationQueue } from "../src/services/canvas-collaboration-queue";
import type { CanvasCollaborationOperation, CanvasCollaborationOperationResult } from "../src/services/api/canvas-collaboration";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence, useAssetStore } from "../src/stores/use-asset-store";
import { useSyncProgressStore } from "../src/stores/use-sync-progress-store";
import { CanvasNodeType } from "../src/types/canvas";

const originalWindow = globalThis.window;
const originalAdapter = apiClient.defaults.adapter;
const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalRemove = localforage.removeItem;
const indexed = new Map<string, string>();
let scope = "";
let sequence = 0;
let autoSave: (() => void) | undefined;
let remote = new Map<string, CanvasProject>();
let requests: Array<{ method: string; id: string; project?: CanvasProject }> = [];
let beforePut: (() => Promise<void>) | undefined;
let deleteFailureId: string | undefined;
let beforeMerge: (() => Promise<void>) | undefined;
let operationRequests: CanvasCollaborationOperation[] = [];
let receipts = new Map<string, CanvasCollaborationOperationResult>();
let loseReceipt = false;
let beforeOperation: (() => void | Promise<void>) | undefined;

function canvas(id = "canvas"): CanvasProject {
    return {
        id,
        revision: 1,
        title: id,
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
        nodes: [{ id: "old-image", type: CanvasNodeType.Image, title: "image", position: { x: 0, y: 0 }, width: 100, height: 100 }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
    };
}

function addNode(project: CanvasProject, id: string) {
    return { ...project, nodes: [...project.nodes, { ...project.nodes[0], id, type: CanvasNodeType.Video }] };
}

beforeEach(async () => {
    resetRemoteUserDataSync();
    scope = `canvas-revision-test-${++sequence}`;
    indexed.clear();
    requests = [];
    autoSave = undefined;
    beforePut = undefined;
    deleteFailureId = undefined;
    operationRequests = [];
    receipts.clear();
    loseReceipt = false;
    beforeOperation = undefined;
    remote = new Map([["canvas", canvas()], ["other", canvas("other")]]);
    Object.defineProperty(globalThis, "window", { configurable: true, value: {
        setTimeout: (callback: () => void) => { autoSave = callback; return 1; },
        clearTimeout: () => { autoSave = undefined; },
        localStorage: { getItem: () => scope, setItem: () => undefined },
    } });
    localforage.getItem = (async (key: string) => indexed.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: string) => { indexed.set(key, value); return value; }) as typeof localforage.setItem;
    localforage.removeItem = (async (key: string) => { indexed.delete(key); }) as typeof localforage.removeItem;
    apiClient.defaults.adapter = async (config) => {
        const method = config.method || "get";
        const id = String(config.url).split("/").at(-1)!;
        const body = config.data ? JSON.parse(config.data) : undefined;
        requests.push({ method, id, project: body?.project });
        let data: unknown;
        let status = 200;
        if (id === "snapshot") data = { projects: structuredClone([...remote.values()]), assets: [] };
        else if (method === "delete") {
            if (id === deleteFailureId) status = 403;
            else {
                remote.delete(id);
                data = { id };
            }
        } else if (id === "batch" && method === "post") {
            data = { assets: [{
                id: "invalid-mime-asset", kind: "image", title: "历史素材", coverUrl: "", tags: [],
                createdAt: "2026-09-01", updatedAt: "2026-09-01",
                data: { dataUrl: "https://example.com/image.png", width: 100, height: 100, bytes: 1, mimeType: "image/*" },
            }] };
        }
        else if (id === "merge") {
            const saved = { ...addNode(remote.get("canvas")!, "merged-node"), revision: remote.get("canvas")!.revision! + 1 };
            remote.set("canvas", saved);
            await beforeMerge?.();
            data = { status: "merged", targetCanvasId: "canvas", targetRevision: saved.revision, project: saved };
        }
        else if (id === "events") {
            const current = remote.get("canvas")!;
            data = { events: [], currentRevision: current.revision };
        }
        else if (id === "operations") {
            const operation = body as CanvasCollaborationOperation;
            operationRequests.push(operation);
            await beforeOperation?.();
            const receipt = receipts.get(operation.opId);
            if (receipt) data = { ...receipt, status: "already_applied" };
            else {
                const current = remote.get("canvas")!;
                const applied = applyCanvasCollaborationOperation(current, { ...operation, revision: current.revision! + 1 });
                if (!applied.applied) throw new Error("mock cannot apply operation");
                const result: CanvasCollaborationOperationResult = { status: "applied", operationId: operation.opId, canvasId: "canvas", revision: applied.project.revision!, document: applied.project };
                remote.set("canvas", applied.project);
                receipts.set(operation.opId, structuredClone(result));
                data = result;
                if (loseReceipt) { loseReceipt = false; throw new Error("connection lost after commit"); }
            }
        }
        else if (id === "restore" && method === "post") {
            const current = remote.get("canvas")!;
            if (body.revision !== current.revision) status = 409;
            else {
                const saved = { ...canvas(), title: "historical content", revision: current.revision! + 1 };
                remote.set("canvas", saved);
                data = { project: saved };
            }
        } else if (method === "put") {
            await beforePut?.();
            const project = body.project as CanvasProject;
            const current = remote.get(id);
            if (project.revision !== (current?.revision ?? 0)) status = 409;
            else {
                const saved = { ...structuredClone(project), revision: project.revision! + 1 };
                remote.set(id, saved);
                data = { project: saved };
            }
        } else data = { project: structuredClone(remote.get(id)) };
        return { config, status, statusText: "", headers: {}, data: { code: status === 200 ? 0 : status, data, msg: status === 409 ? "版本冲突" : "ok" } };
    };
    useCanvasStore.setState({ projects: [] });
    useAssetStore.setState({ assets: [] });
    installRemoteUserDataAutoSync();
    await syncRemoteUserData(scope);
});

async function enableCollaboration() {
    remote.set("canvas", { ...remote.get("canvas")!, collaborationEnabled: true });
    await syncRemoteUserData(scope);
}

for (const shared of [false, true]) {
    test(`branch merge receipt preserves edits made during the request and serializes saves (${shared ? "shared" : "private"} target)`, async () => {
        if (shared) await enableCollaboration();
        let release!: () => void;
        let entered!: () => void;
        const started = new Promise<void>((resolve) => { entered = resolve; });
        const wait = new Promise<void>((resolve) => { release = resolve; });
        beforeMerge = async () => { entered(); await wait; };
        try {
            const merging = mergeCanvasBranchWithSync("branch", { targetCanvasId: "canvas", expectedTargetRevision: 1, sourceRevision: 2 });
            await started;
            const local = useCanvasStore.getState().openProject("canvas")!;
            useCanvasStore.getState().updateProject("canvas", { nodes: local.nodes.map((node) => ({ ...node, title: "edited during merge" })) });
            const saving = saveRemoteUserDataNow("canvas");
            release();
            const result = await merging;
            expect(result.project?.revision).toBe(2);
            await saving;
            const saved = remote.get("canvas")!;
            expect(saved.revision).toBe(3);
            expect(saved.nodes.some((node) => node.id === "merged-node")).toBe(true);
            expect(saved.nodes.find((node) => node.id === "old-image")?.title).toBe("edited during merge");
            expect(useCanvasStore.getState().openProject("canvas")!.nodes).toEqual(saved.nodes);
            expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
        } finally { beforeMerge = undefined; release?.(); }
    });
}

test("remote position merges with unsent local text and only the local edit is sent", async () => {
    await enableCollaboration();
    const base = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.getState().updateProject("canvas", { nodes: base.nodes.map((n) => ({ ...n, title: "my text" })) });
    const operation = { opId: "other-move", kind: "update_node", nodeId: "old-image", revision: 2, incarnation: 1, patch: { position: { x: 300, y: 20 } } };
    remote.set("canvas", applyCanvasCollaborationOperation(base, operation).project);
    await applyCanvasCollaborationRemoteOperation("canvas", operation);
    const live = useCanvasStore.getState().openProject("canvas")!;
    expect(live.nodes[0].title).toBe("my text");
    expect(live.nodes[0].position).toEqual({ x: 300, y: 20 });
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("pending");
    await saveRemoteUserDataNow();
    expect(operationRequests).toHaveLength(1);
    expect(operationRequests[0].patch).toEqual({ title: "my text" });
    expect(remote.get("canvas")!.nodes[0].position.x).toBe(300);
});

test("unchanged polling preserves unsaved edits and does not report saved", async () => {
    await enableCollaboration();
    useCanvasStore.getState().renameProject("canvas", "unsent");
    const result = await pullLatestCollaborativeCanvasProject("canvas");
    expect(result.changed).toBe(false);
    expect(result.project).toBeUndefined();
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("unsent");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("pending");
});

for (const initializeSession of [syncRemoteUserData, initializeRemoteUserDataSession]) {
test(`lost receipt is replayed with the exact operation id after ${initializeSession.name}`, async () => {
    await enableCollaboration();
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(useCanvasStore.getState().openProject("canvas")!, "once-only").nodes });
    loseReceipt = true;
    await expect(saveRemoteUserDataNow()).rejects.toThrow("connection lost after commit");
    const queued = await readCanvasCollaborationQueue(scope, "canvas");
    expect(queued?.pending).toHaveLength(1);
    expect(remote.get("canvas")!.revision).toBe(2);
    resetRemoteUserDataSync();
    await initializeSession(scope);
    await loadCanvasProjectForEditing("canvas");
    await saveRemoteUserDataNow();
    expect(operationRequests).toHaveLength(2);
    expect(operationRequests[1]).toEqual(operationRequests[0]);
    expect(remote.get("canvas")!.nodes.filter((n) => n.id === "once-only")).toHaveLength(1);
    expect(remote.get("canvas")!.revision).toBe(2);
    expect(await readCanvasCollaborationQueue(scope, "canvas")).toBeNull();
});
}

test("a same-field remote edit keeps the draft and reports conflict", async () => {
    await enableCollaboration();
    const base = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.getState().updateProject("canvas", { nodes: base.nodes.map((n) => ({ ...n, title: "mine" })) });
    await applyCanvasCollaborationRemoteOperation("canvas", { opId: "other-title", kind: "update_node", nodeId: "old-image", revision: 2, patch: { title: "theirs" } });
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("mine");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("conflict");
    expect((await readCanvasSyncDrafts("canvas"))[0].project.nodes[0].title).toBe("mine");
});

test("a partial batch resumes only its unacknowledged request with the original payload", async () => {
    await enableCollaboration();
    useCanvasStore.getState().updateProject("canvas", { title: "renamed", nodes: addNode(useCanvasStore.getState().openProject("canvas")!, "batch-node").nodes });
    beforeOperation = () => { if (operationRequests.length === 2) loseReceipt = true; };
    await expect(saveRemoteUserDataNow()).rejects.toThrow("connection lost after commit");
    const queue = await readCanvasCollaborationQueue(scope, "canvas");
    expect(queue?.confirmed.title).toBe("renamed");
    expect(queue?.pending).toHaveLength(1);
    await saveRemoteUserDataNow();
    expect(operationRequests).toHaveLength(3);
    expect(operationRequests[2]).toEqual(operationRequests[1]);
    expect(remote.get("canvas")!.revision).toBe(3);
    expect(remote.get("canvas")!.nodes.filter((n) => n.id === "batch-node")).toHaveLength(1);
});

test("queue persistence failure prevents network submission and keeps the local edit", async () => {
    await enableCollaboration();
    useCanvasStore.getState().renameProject("canvas", "local edit");
    const setItem = localforage.setItem;
    localforage.setItem = (async (key: string, value: string) => {
        if (key.includes("collaboration-queue:")) throw new Error("storage quota exceeded");
        return setItem(key, value);
    }) as typeof localforage.setItem;
    await expect(saveRemoteUserDataNow()).rejects.toThrow("storage quota exceeded");
    expect(operationRequests).toHaveLength(0);
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("local edit");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("error");
    localforage.setItem = setItem;
});

test("edits made while a request is in flight are saved after its acknowledgement", async () => {
    await enableCollaboration();
    useCanvasStore.getState().renameProject("canvas", "first edit");
    beforeOperation = () => {
        beforeOperation = undefined;
        useCanvasStore.getState().renameProject("canvas", "newer edit");
    };
    await saveRemoteUserDataNow();
    expect(operationRequests).toHaveLength(2);
    expect(operationRequests[0].rootPatch).toEqual({ title: "first edit" });
    expect(operationRequests[1].rootBefore).toEqual({ title: "first edit" });
    expect(operationRequests[1].rootPatch).toEqual({ title: "newer edit" });
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("newer edit");
    expect(remote.get("canvas")!.title).toBe("newer edit");
});

test("a live editor conflict during receipt projection is not marked as saved", async () => {
    await enableCollaboration();
    useCanvasStore.getState().renameProject("canvas", "my edit");
    Object.assign(window, { dispatchEvent: () => {
        useSyncProgressStore.getState().setProjectProgress("canvas", { phase: "conflict", message: "new live conflict" });
        return true;
    } });
    await expect(saveRemoteUserDataNow()).rejects.toMatchObject({ status: 409 });
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("conflict");
    expect((await readCanvasCollaborationQueue(scope, "canvas"))?.blocked).toBe(true);
});

test("a user-selected conflict resolution does not replay the old draft over the choice", async () => {
    await enableCollaboration();
    const base = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.getState().updateProject("canvas", { nodes: base.nodes.map((n) => ({ ...n, title: "mine" })) });
    const delta = { opId: "other-title", kind: "update_node", nodeId: "old-image", revision: 2, patch: { title: "theirs" } };
    remote.set("canvas", applyCanvasCollaborationOperation(base, delta).project);
    await applyCanvasCollaborationRemoteOperation("canvas", delta);
    const snapshot = (await readCanvasConflict("canvas"))!;
    const merged = { ...snapshot.remote, nodes: snapshot.remote.nodes.map((n) => ({ ...n, title: "combined" })) };
    const result = await resolveCanvasConflict(snapshot, merged);
    expect(result.nodes[0].title).toBe("combined");
    expect(remote.get("canvas")!.nodes[0].title).toBe("combined");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    expect(await readCanvasConflict("canvas")).toBeNull();
});

test("conflict snapshots stay in the original account when switching during persistence", async () => {
    await enableCollaboration();
    const originalScope = scope;
    const base = useCanvasStore.getState().openProject("canvas")!;
    const local = { ...base, title: "mine" };
    const latest = { ...base, title: "theirs", revision: 2 };
    const saving = preserveCanvasLiveConflict(base, local, latest);
    scope = "switched-account";
    await saving;
    expect((await readCanvasConflict("canvas", originalScope))?.local.title).toBe("mine");
    expect(await readCanvasConflict("canvas", scope)).toBeNull();
    expect(await readCanvasCollaborationQueue(scope, "canvas")).toBeNull();
});

afterEach(async () => {
    resetRemoteUserDataSync();
    await Promise.all([flushCanvasStorePersistence(), flushAssetStorePersistence()]);
    apiClient.defaults.adapter = originalAdapter;
    localforage.getItem = originalGet;
    localforage.setItem = originalSet;
    localforage.removeItem = originalRemove;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

test("deletion skips editing and invalid MIME assets, including an uncached canvas", async () => {
    const project = canvas();
    project.nodes[0].metadata = { assetId: "invalid-mime-asset" };
    remote.set(project.id, project);
    await initializeRemoteUserDataSession(scope);
    await expect(loadCanvasProjectForEditing(project.id)).rejects.toThrow("具体 MIME");
    useCanvasStore.getState().deleteProjects(["other"]);
    await flushCanvasStorePersistence();
    requests = [];

    await deleteCanvasProjectsWithRemoteSync([" canvas ", "canvas", "other"]);

    expect(requests.map(({ method, id }) => ({ method, id }))).toEqual([
        { method: "delete", id: "canvas" }, { method: "delete", id: "other" },
    ]);
    expect(remote.size).toBe(0);
    expect(useCanvasStore.getState().projects).toEqual([]);
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().projects).toEqual([]);
});

test("batch deletion retains failed canvases and persists successful deletions", async () => {
    await initializeRemoteUserDataSession(scope);
    deleteFailureId = "other";

    await expect(deleteCanvasProjectsWithRemoteSync(["canvas", "other"])).rejects.toThrow();

    expect([...remote.keys()]).toEqual(["other"]);
    expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual(["other"]);
    await useCanvasStore.persist.rehydrate();
    expect(useCanvasStore.getState().projects.map((project) => project.id)).toEqual(["other"]);
});

test("stale viewport, no-op restore and open do not submit old content", async () => {
    const old = useCanvasStore.getState().openProject("canvas")!;
    remote.set("canvas", { ...addNode(canvas(), "afternoon-video"), revision: 2 });
    useCanvasStore.getState().updateProject("canvas", { viewport: { x: 100, y: 40, k: 2 } });
    useCanvasStore.getState().updateProject("canvas", { nodes: structuredClone(old.nodes), connections: [] });
    expect(autoSave).toBeUndefined();
    expect(useCanvasStore.getState().openProject("canvas")!.updatedAt).toBe(old.updatedAt);
    await flushCanvasStorePersistence();
    await saveRemoteUserDataNow();
    const latest = await loadCanvasProjectForEditing("canvas");
    expect(latest.nodes.map((node) => node.id)).toEqual(["old-image", "afternoon-video"]);
    expect(latest.revision).toBe(2);
    expect(latest.viewport).toEqual({ x: 100, y: 40, k: 2 });
    await saveRemoteUserDataNow();
    expect(requests.filter((request) => request.method === "put")).toHaveLength(0);
});

test("load latest, save and reload stay synced when Agent history replays an unversioned delta", async () => {
    remote.set("canvas", { ...canvas(), revision: 9 });
    await loadCanvasProjectForEditing("canvas", { latest: true });
    useCanvasStore.getState().renameProject("canvas", "已保存的标题");
    await saveRemoteUserDataNow("canvas");
    expect(remote.get("canvas")!.revision).toBe(10);

    for (let reload = 0; reload < 3; reload++) {
        resetRemoteUserDataSync();
        await useCanvasStore.persist.rehydrate();
        await initializeRemoteUserDataSession(scope);
        await loadCanvasProjectForEditing("canvas");
        let resolve!: () => void;
        let reject!: (error: unknown) => void;
        const reconciled = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        const sync = createAgentCanvasSync({
            canvasId: "canvas", batchMs: 0,
            applyPatches: (patches) => applyAgentCanvasPatches("canvas", patches),
            refresh: async () => { await refreshCanvasAfterAgent("canvas"); resolve(); },
            onError: reject,
        });
        try {
            sync.receive({ eventId: "historical-event", runId: "completed-run", seq: 1, type: "canvas_updated", createdAt: "2026-09-17", payload: {
                canvasId: "canvas",
                canvasPatch: { canvasId: "canvas", updatedAt: "2026-09-17", nodes: [{ before: null, after: { ...canvas().nodes[0], id: "stale-node" } }], connections: [] },
            } });
            await reconciled;
            expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
            await saveRemoteUserDataNow("canvas");
            expect(useCanvasStore.getState().openProject("canvas")).toMatchObject({ revision: 10, title: "已保存的标题", nodes: canvas().nodes });
            expect(await readCanvasSyncDrafts("canvas")).toHaveLength(0);
        } finally { sync.dispose(); }
    }
    expect(requests.filter((request) => request.method === "put")).toHaveLength(1);
});

test("a conflict preserves drafts, stops retries and does not block another canvas", async () => {
    remote.set("canvas", { ...addNode(canvas(), "remote-video"), revision: 2 });
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(canvas(), "local-video").nodes });
    useCanvasStore.getState().renameProject("other", "other edit");
    await expect(saveRemoteUserDataNow()).rejects.toThrow("版本冲突");
    expect(remote.get("canvas")!.nodes.map((node) => node.id)).toEqual(["old-image", "remote-video"]);
    expect(remote.get("other")!.title).toBe("other edit");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("conflict");
    expect((await readCanvasSyncDrafts("canvas"))[0].project.nodes.at(-1)!.id).toBe("local-video");
    useCanvasStore.getState().renameProject("canvas", "more local edits");
    await expect(saveRemoteUserDataNow()).rejects.toMatchObject({ status: 409 });
    useCanvasStore.getState().renameProject("other", "still saves independently");
    await saveRemoteUserDataNow("other");
    expect(remote.get("other")!.title).toBe("still saves independently");
    await expect(saveRemoteUserDataNow(["canvas", "other"])).rejects.toMatchObject({ status: 409 });
    expect(requests.filter((request) => request.method === "put" && request.id === "canvas")).toHaveLength(1);
    await expect(saveRemoteUserDataNow("canvas")).rejects.toMatchObject({ status: 409 });
    await loadCanvasProjectForEditing("canvas", { latest: true });
    expect(useCanvasStore.getState().openProject("canvas")!.nodes.at(-1)!.id).toBe("remote-video");
    expect((await readCanvasSyncDrafts("canvas")).some((draft) => draft.project.title === "more local edits")).toBe(true);
    resetRemoteUserDataSync();
    await useCanvasStore.persist.rehydrate();
    await syncRemoteUserData(scope);
    expect(useSyncProgressStore.getState().syncingProjects.canvas.draftCount).toBe(2);
});

test("edits during a save retain the right ancestor revision and are saved next", async () => {
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    beforePut = async () => {
        started();
        await waiting;
    };
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(canvas(), "first-video").nodes });
    const saving = saveRemoteUserDataNow();
    await entered;
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(useCanvasStore.getState().openProject("canvas")!, "second-video").nodes });
    release();
    await saving;
    expect(requests.filter((request) => request.method === "put").map((request) => request.project!.revision)).toEqual([1, 2]);
    expect(remote.get("canvas")!.revision).toBe(3);
    expect(remote.get("canvas")!.nodes.map((node) => node.id)).toEqual(["old-image", "first-video", "second-video"]);
    expect(useCanvasStore.getState().openProject("canvas")!.remoteContentHash).toBe(await canvasContentHash(useCanvasStore.getState().openProject("canvas")!));
    expect(requests.filter((request) => request.method === "put").every((request) => !("viewport" in request.project!) && !("remoteContentHash" in request.project!))).toBe(true);
});

test("login archives unsynced changes before replacing cache and keeps user scopes separate", async () => {
    useCanvasStore.getState().renameProject("canvas", "unsaved draft");
    await flushCanvasStorePersistence();
    resetRemoteUserDataSync();
    await useCanvasStore.persist.rehydrate();
    await syncRemoteUserData(scope);
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("canvas");
    expect((await readCanvasSyncDrafts("canvas"))[0].project.title).toBe("unsaved draft");
    expect(await readCanvasSyncDrafts("canvas", "another-user")).toEqual([]);
    expect(requests.some((request) => request.method === "put")).toBe(false);
});

test("failed draft storage prevents replacement by the latest server content", async () => {
    const working = localforage.setItem;
    useCanvasStore.getState().renameProject("canvas", "must survive");
    localforage.setItem = (async (key: string, value: unknown) => {
        if (key.includes("sync-drafts")) throw new Error("disk full");
        return working(key, value);
    }) as typeof localforage.setItem;
    await expect(loadCanvasProjectForEditing("canvas", { latest: true })).rejects.toThrow("disk full");
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("must survive");
});

test("local storage rebase cannot pair old edits with another tab's newer revision", () => {
    const base = canvas();
    const local = addNode(base, "unsaved-local");
    const durable = { ...addNode(base, "remote-video"), revision: 2 };
    const document = parseCanvasStorageDocument(null, [durable]);
    const rebased = rebaseCanvasProjects({ document, baseProjects: [base], localProjects: [local], baseRevision: 0 }).document.state.projects[0];
    expect(rebased.revision).toBe(1);
    expect(rebased.nodes.at(-1)!.id).toBe("unsaved-local");
});

test("loading aligns live editor content before publishing its server revision", async () => {
    remote.set("canvas", { ...addNode(canvas(), "new-cloud-node"), revision: 2 });
    let applied = false;
    await loadCanvasProjectForEditing("canvas", {
        onLoad: (project) => {
            expect(useCanvasStore.getState().openProject("canvas")!.revision).toBe(1);
            expect(project.revision).toBe(2);
            expect(project.nodes.at(-1)!.id).toBe("new-cloud-node");
            applied = true;
        },
    });
    expect(applied).toBe(true);
    expect(useCanvasStore.getState().openProject("canvas")!.revision).toBe(2);
});

test("viewport-only updates during latest load still adopt cloud content", async () => {
    remote.set("canvas", { ...addNode(canvas(), "remote-video"), revision: 2 });
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(canvas(), "local-video").nodes });
    const working = localforage.setItem;
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    localforage.setItem = (async (key: string, value: unknown) => {
        if (key.includes("sync-drafts:")) {
            started();
            await waiting;
        }
        return working(key, value);
    }) as typeof localforage.setItem;
    const loading = loadCanvasProjectForEditing("canvas", { latest: true });
    await entered;
    useCanvasStore.getState().updateProject("canvas", { viewport: { x: 40, y: 12, k: 1.5 } });
    release();
    const loaded = await loading;
    expect(loaded.nodes.at(-1)!.id).toBe("remote-video");
    expect(useCanvasStore.getState().openProject("canvas")!.revision).toBe(2);
    expect(useCanvasStore.getState().openProject("canvas")!.viewport).toEqual({ x: 40, y: 12, k: 1.5 });
});

test("edits arriving during draft backup prevent replacement of the live canvas", async () => {
    useCanvasStore.getState().renameProject("canvas", "first local edit");
    const working = localforage.setItem;
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
        started = resolve;
    });
    localforage.setItem = (async (key: string, value: unknown) => {
        if (key.includes("sync-drafts:")) {
            started();
            await waiting;
        }
        return working(key, value);
    }) as typeof localforage.setItem;
    const loading = loadCanvasProjectForEditing("canvas", { latest: true });
    await entered;
    useCanvasStore.getState().renameProject("canvas", "second local edit");
    release();
    await expect(loading).rejects.toThrow("画布仍在更新");
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("second local edit");
});

test("unknown revision cannot borrow the latest revision to submit stale content", async () => {
    const local = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.setState((state) => ({ projects: state.projects.map((project) => (project.id === local.id ? { ...local, revision: undefined, title: "legacy draft" } : project)) }));
    await expect(saveRemoteUserDataNow()).rejects.toThrow("缺少画布版本");
    expect(requests.filter((request) => request.method === "put")).toHaveLength(0);
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("conflict");
    expect((await readCanvasSyncDrafts("canvas"))[0].project.title).toBe("legacy draft");
});

test("HTTP environments without Web Crypto still distinguish unsaved content", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto")!;
    Object.defineProperty(globalThis, "crypto", { configurable: true, value: undefined });
    try {
        const baseline = await canvasContentHash(canvas());
        expect(baseline).toBe(await canvasContentHash({ ...canvas(), viewport: { x: 100, y: 0, k: 2 } }));
        expect(baseline).not.toBe(await canvasContentHash(addNode(canvas(), "new-video")));
    } finally {
        Object.defineProperty(globalThis, "crypto", descriptor);
    }
});

test("history restore preserves the draft and installs a new revision without an extra content PUT", async () => {
    useCanvasStore.getState().updateProject("canvas", { nodes: addNode(canvas(), "unsaved-video").nodes });
    let applied = false;
    const restored = await loadCanvasProjectForEditing("canvas", {
        historyRestore: { snapshotId: "historical", revision: 1 },
        onLoad: (project) => {
            expect(useCanvasStore.getState().openProject("canvas")!.revision).toBe(1);
            expect(project.revision).toBe(2);
            applied = true;
        },
    });
    expect(applied).toBe(true);
    expect(restored.title).toBe("historical content");
    expect((await readCanvasSyncDrafts("canvas")).some((draft) => draft.project.nodes.some((node) => node.id === "unsaved-video"))).toBe(true);
    await saveRemoteUserDataNow("canvas");
    expect(requests.filter((request) => request.method === "post")).toHaveLength(1);
    expect(requests.filter((request) => request.method === "put")).toHaveLength(0);
});

test("a stale history restore preserves both current cloud content and local edits", async () => {
    remote.set("canvas", { ...addNode(canvas(), "new-cloud-video"), revision: 2 });
    useCanvasStore.getState().renameProject("canvas", "local draft");
    await expect(loadCanvasProjectForEditing("canvas", { historyRestore: { snapshotId: "historical", revision: 1 } })).rejects.toThrow("版本冲突");
    expect(remote.get("canvas")!.nodes.at(-1)!.id).toBe("new-cloud-video");
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("local draft");
    expect((await readCanvasSyncDrafts("canvas"))[0].project.title).toBe("local draft");
});

test("reopened dirty cache with the same ancestor stays pending until actually saved", async () => {
    useCanvasStore.getState().renameProject("canvas", "offline draft");
    await flushCanvasStorePersistence();
    await initializeRemoteUserDataSession(scope);
    const loaded = await loadCanvasProjectForEditing("canvas");
    expect(loaded.title).toBe("offline draft");
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("pending");
    expect(remote.get("canvas")!.title).toBe("canvas");
    await saveRemoteUserDataNow("canvas");
    expect(remote.get("canvas")!.title).toBe("offline draft");
    expect(remote.get("canvas")!.revision).toBe(2);
});

test("failed draft backup prevents a history restore request", async () => {
    const working = localforage.setItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        if (key.includes("sync-drafts:")) throw new Error("disk full");
        return working(key, value);
    }) as typeof localforage.setItem;
    await expect(loadCanvasProjectForEditing("canvas", { historyRestore: { snapshotId: "historical", revision: 1 } })).rejects.toThrow("disk full");
    expect(requests.some((request) => request.method === "post")).toBe(false);
    expect(remote.get("canvas")!.revision).toBe(1);
});
