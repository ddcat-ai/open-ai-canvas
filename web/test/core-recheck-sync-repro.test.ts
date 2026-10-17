import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";
import { apiClient, ApiError } from "../src/services/api/request";
import { canvasEditLeases } from "../src/services/canvas-edit-leases";
import { setActiveUserScope } from "../src/lib/user-scope";
import { initializeRemoteUserDataSession, loadCanvasProjectForEditing, refreshCanvasAfterAgent, resetRemoteUserDataSync, saveRemoteUserDataNow, syncRemoteUserData } from "../src/services/user-data-sync";
import { useSyncProgressStore } from "../src/stores/use-sync-progress-store";
import { flushCanvasStorePersistence, useCanvasStore, type CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { flushAssetStorePersistence, useAssetStore } from "../src/stores/use-asset-store";
import type { CanvasOperationsRequest } from "../src/services/api/user-data";
import { CanvasNodeType } from "../src/types/canvas";

const originalWindow = globalThis.window;
const originalAdapter = apiClient.defaults.adapter;
const originalGet = localforage.getItem;
const originalSet = localforage.setItem;
const originalRemove = localforage.removeItem;
const disk = new Map<string, unknown>();
let remote: CanvasProject;
let mutations: CanvasOperationsRequest[];
let onWrite: (() => void) | undefined;
let scope: string;
let sequence = 0;
let leaseBusy = false;
let readFailure = false;
let writeFailure = false;
let afterRead: (() => void) | undefined;

function node(id: string) {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
    };
}

beforeEach(async () => {
    resetRemoteUserDataSync();
    disk.clear();
    mutations = [];
    onWrite = undefined;
    leaseBusy = false;
    readFailure = false;
    writeFailure = false;
    afterRead = undefined;
    scope = `core-review-${++sequence}`;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout: () => 1,
            clearTimeout: () => {},
            localStorage: {
                getItem: (key: string) => disk.get(key) ?? null,
                setItem: (key: string, value: string) => disk.set(key, value),
            },
            addEventListener: () => {},
            removeEventListener: () => {},
        },
    });
    localforage.getItem = (async (key: string) => disk.get(key) ?? null) as typeof localforage.getItem;
    localforage.setItem = (async (key: string, value: unknown) => {
        disk.set(key, value);
        return value;
    }) as typeof localforage.setItem;
    localforage.removeItem = async (key: string) => {
        disk.delete(key);
    };
    setActiveUserScope(scope);
    remote = {
        id: "canvas",
        revision: 1,
        title: "baseline",
        createdAt: "2026-10-15",
        updatedAt: "2026-10-15",
        nodes: [node("original")],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    };
    useCanvasStore.setState({ projects: [] });
    useAssetStore.setState({ assets: [] });
    apiClient.defaults.adapter = async (config) => {
        const url = String(config.url);
        let data: unknown;
        if (url === "/user-data/snapshot") data = { projects: [structuredClone(remote)], assets: [] };
        else if (url === "/canvas-projects/canvas" && config.method === "get") {
            if (readFailure) throw new ApiError("offline read", { retryable: true });
            data = { project: structuredClone(remote) };
            const callback = afterRead;
            afterRead = undefined;
            callback?.();
        }
        else if (url === "/canvas-projects/canvas/edit-lease") {
            const body = JSON.parse(config.data);
            if (leaseBusy && body.action !== "release") throw new ApiError("another browser owns this node", { status: 409, reason: "canvas_edit_lease_conflict" });
            data = body.action === "release" ? { serverTime: new Date().toISOString() } : {
                serverTime: new Date().toISOString(), token: "lease-token",
                lease: { nodeId: body.nodeId, sessionId: body.sessionId, expiresAt: new Date(Date.now() + 30000).toISOString() },
            };
        }
        else if (url === "/canvas-projects/canvas/operations" && config.method === "patch") {
            const body = JSON.parse(config.data) as CanvasOperationsRequest;
            mutations.push(body);
            if (writeFailure) throw new ApiError("response lost", { retryable: true });
            for (const op of body.operations) {
                if (op.type === "set_field" && op.field === "title") {
                    expect(op.beforeValue).toBe(remote.title);
                    remote.title = String(op.value);
                } else if (op.type === "patch_node") {
                    const target = remote.nodes.find((item) => item.id === op.id)!;
                    if ("title" in op.patch) {
                        if (op.before?.title !== target.title) throw new ApiError("node title conflict", { status: 409, reason: "canvas_field_conflict" });
                        target.title = String(op.patch.title);
                    }
                    if ("position" in op.patch) {
                        for (const key of Object.keys(op.before!.position as object)) expect(target.position[key as "x" | "y"]).toBe((op.before!.position as Record<string, number>)[key]);
                        target.position = { ...target.position, ...(op.patch.position as object) };
                    }
                    for (const key of ["x", "y"] as const) {
                        const path = `position.${key}`;
                        if (path in op.patch) {
                            expect(target.position[key]).toBe(op.before![path] as number);
                            target.position[key] = op.patch[path] as number;
                        }
                    }
                } else if (op.type === "remove_node") {
                    expect(op.expected).toEqual(remote.nodes.find((item) => item.id === op.id));
                    remote.nodes = remote.nodes.filter((item) => item.id !== op.id);
                } else if (op.type === "create_node") {
                    expect(remote.nodes.some((item) => item.id === op.node.id)).toBe(false);
                    remote.nodes.push(structuredClone(op.node));
                } else throw new Error(`Unexpected review fixture operation: ${op.type}`);
            }
            remote.revision = (remote.revision || 0) + 1;
            const callback = onWrite;
            onWrite = undefined;
            callback?.();
            data = {
                project: { id: remote.id, revision: remote.revision },
                mutationId: body.mutationId,
            };
        } else throw new Error(`Unexpected review fixture request: ${config.method} ${url}`);
        return {
            config,
            status: 200,
            statusText: "",
            headers: {},
            data: { code: 0, data, msg: "ok" },
        };
    };
    await syncRemoteUserData(scope);
    mutations = [];
});

test("losing acquisition automatically adopts cloud text and later edits can save", async () => {
    leaseBusy = true;
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "local draft" }] });
    remote.nodes[0].title = "other browser saved";
    remote.revision = 2;
    await saveRemoteUserDataNow("canvas");
    expect(mutations).toHaveLength(0);
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("other browser saved");
    expect(canvasEditLeases.pending("canvas", "original")).toBe(false);
    expect(canvasEditLeases.state("canvas", "original").typing).toBe(false);
    expect(canvasEditLeases.state("canvas", "original").error).toBeUndefined();
    expect(useSyncProgressStore.getState().syncingProjects.canvas.phase).toBe("done");
    leaseBusy = false;
    expect(canvasEditLeases.input("canvas", "original")).toBe(true);
    const current = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...current.nodes[0], title: "new valid input", position: { x: 120, y: 90 } }] });
    await saveRemoteUserDataNow("canvas");
    expect(remote.nodes[0].title).toBe("new valid input");
    expect(remote.nodes[0].position).toEqual({ x: 120, y: 90 });
    expect(canvasEditLeases.pending("canvas", "original")).toBe(false);
});

test("server field rejection retires stale journal without overwriting the winning text", async () => {
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "losing text" }, node("independent-local")] });
    remote.nodes[0].title = "winning text";
    remote.nodes.push(node("independent-remote"));
    remote.revision = 2;
    await saveRemoteUserDataNow("canvas");
    expect(remote.nodes[0].title).toBe("winning text");
    expect(remote.nodes.map((n) => n.id).sort()).toEqual(["independent-local", "independent-remote", "original"]);
    expect(mutations).toHaveLength(2);
    expect(mutations[1].mutationId).not.toBe(mutations[0].mutationId);
    expect(mutations[1].operations.every((op) => op.type === "create_node")).toBe(true);
    expect(canvasEditLeases.pending("canvas", "original")).toBe(false);
    expect([...disk.keys()].some((key) => key.includes("canvas-mutation-journal"))).toBe(false);
    useCanvasStore.getState().renameProject("canvas", "later operation");
    await saveRemoteUserDataNow("canvas");
    expect(remote.title).toBe("later operation");
});

test("a failed recovery read retains the rejection so the next sync can recover", async () => {
    leaseBusy = true;
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "local text" }] });
    remote.nodes[0].title = "winning text";
    remote.revision = 2;
    readFailure = true;
    await expect(saveRemoteUserDataNow("canvas")).rejects.toThrow("offline read");
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("local text");
    readFailure = false;
    await saveRemoteUserDataNow("canvas");
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("winning text");
    expect(canvasEditLeases.pending("canvas", "original")).toBe(false);
});

test("a node created and populated after rejection survives recovery and is uploaded exactly once", async () => {
    leaseBusy = true;
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "losing text" }] });
    remote.nodes[0].title = "winning text";
    remote.revision = 2;
    readFailure = true;
    await expect(saveRemoteUserDataNow("canvas")).rejects.toThrow("offline read");
    const generated = { ...node("generated-after-conflict"), metadata: { content: "completed generated content", taskId: "existing-task", taskStatus: "succeeded" as const } };
    const current = useCanvasStore.getState().openProject("canvas")!;
    useCanvasStore.getState().updateProject("canvas", { nodes: [...current.nodes, generated] });
    readFailure = false;
    await saveRemoteUserDataNow("canvas");
    expect(remote.nodes.find((item) => item.id === generated.id)).toEqual(generated);
    expect(useCanvasStore.getState().openProject("canvas")!.nodes.find((item) => item.id === generated.id)).toEqual(generated);
    expect(remote.nodes[0].title).toBe("winning text");
    expect(mutations.flatMap((item) => item.operations).filter((op) => op.type === "create_node" && op.node.id === generated.id)).toHaveLength(1);
    await saveRemoteUserDataNow("canvas");
    expect(mutations).toHaveLength(1);
});

test("unknown write result keeps the exact journal and draft even when polling finds a text conflict", async () => {
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "uncertain text" }] });
    writeFailure = true;
    await expect(saveRemoteUserDataNow("canvas")).rejects.toThrow("response lost");
    const journal = [...disk.entries()].find(([key]) => key.includes("canvas-mutation-journal"))![1];
    remote.nodes[0].title = "another change";
    remote.revision = 2;
    await expect(refreshCanvasAfterAgent("canvas", "sync")).rejects.toThrow();
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("uncertain text");
    expect([...disk.entries()].find(([key]) => key.includes("canvas-mutation-journal"))![1]).toBe(journal);
    expect(canvasEditLeases.pending("canvas", "original")).toBe(true);
});

test("polling heals an older unsent conflicting text draft without a lease entry", async () => {
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "old local text" }] });
    remote.nodes[0].title = "winning text";
    remote.revision = 2;
    await refreshCanvasAfterAgent("canvas", "sync");
    expect(useCanvasStore.getState().openProject("canvas")!.nodes[0].title).toBe("winning text");
    useCanvasStore.getState().renameProject("canvas", "still editable");
    await saveRemoteUserDataNow("canvas");
    expect(remote.title).toBe("still editable");
});

test("reopening an older conflicting draft adopts cloud text before loading the editor", async () => {
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "old local text" }] });
    await flushCanvasStorePersistence();
    remote.nodes[0].title = "winning text";
    remote.revision = 2;
    resetRemoteUserDataSync();
    await initializeRemoteUserDataSession(scope);
    let loaded: CanvasProject | undefined;
    const result = await loadCanvasProjectForEditing("canvas", { onLoad: (value) => { loaded = value; } });
    expect(result?.nodes[0].title).toBe("winning text");
    expect(loaded?.nodes[0].title).toBe("winning text");
    useCanvasStore.getState().renameProject("canvas", "saved after reopening");
    await saveRemoteUserDataNow("canvas");
    expect(remote.title).toBe("saved after reopening");
});

test("equal concurrent text does not leave a stale rejected journal blocking later saves", async () => {
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "same new text" }] });
    remote.nodes[0].title = "same new text";
    remote.revision = 2;
    await saveRemoteUserDataNow("canvas");
    expect(canvasEditLeases.pending("canvas", "original")).toBe(false);
    useCanvasStore.getState().renameProject("canvas", "later title");
    await saveRemoteUserDataNow("canvas");
    expect(remote.title).toBe("later title");
});

test("switching accounts during recovery cannot replace the next account's project", async () => {
    leaseBusy = true;
    canvasEditLeases.input("canvas", "original");
    useCanvasStore.getState().updateProject("canvas", { nodes: [{ ...remote.nodes[0], title: "local text" }] });
    afterRead = () => {
        resetRemoteUserDataSync();
        setActiveUserScope("another-account");
        useCanvasStore.setState({ projects: [{ ...remote, title: "private other account" }] });
    };
    await expect(saveRemoteUserDataNow("canvas")).rejects.toThrow("账号已切换");
    expect(useCanvasStore.getState().openProject("canvas")!.title).toBe("private other account");
});

afterEach(async () => {
    await flushCanvasStorePersistence();
    await flushAssetStorePersistence();
    resetRemoteUserDataSync();
    apiClient.defaults.adapter = originalAdapter;
    localforage.getItem = originalGet;
    localforage.setItem = originalSet;
    localforage.removeItem = originalRemove;
    if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: originalWindow,
        });
});

test("reopening a dirty local draft preserves a node added remotely", async () => {
    useCanvasStore.getState().renameProject("canvas", "local edit");
    await flushCanvasStorePersistence();
    remote.nodes.push(node("other-editor"));
    remote.revision = 2;
    resetRemoteUserDataSync();
    await initializeRemoteUserDataSession(scope);
    await loadCanvasProjectForEditing("canvas");
    await saveRemoteUserDataNow("canvas");
    expect(mutations.flatMap((item) => item.operations).some((op) => op.type === "remove_node" && op.id === "other-editor")).toBe(false);
    expect(remote.nodes.map((item) => item.id)).toEqual(["original", "other-editor"]);
    expect(remote.title).toBe("local edit");
});

test("another local edit during save rebases over remote additions", async () => {
    useCanvasStore.getState().renameProject("canvas", "first local edit");
    onWrite = () => {
        remote.nodes.push(node("other-editor"));
        remote.revision = (remote.revision || 0) + 1;
        useCanvasStore.getState().renameProject("canvas", "second local edit");
    };
    await saveRemoteUserDataNow("canvas");
    expect(mutations).toHaveLength(2);
    expect(mutations[1].operations.some((op) => op.type === "remove_node" && op.id === "other-editor")).toBe(false);
    expect(remote.nodes.map((item) => item.id)).toEqual(["original", "other-editor"]);
    expect(remote.title).toBe("second local edit");
});

test("independent new nodes and an unfinished task survive reopening and save", async () => {
    const pending = {
        ...node("local-task"),
        type: CanvasNodeType.Video,
        metadata: {
            taskId: "original-task-id",
            taskStatus: "running" as const,
            prompt: "local prompt",
        },
    };
    useCanvasStore.getState().updateProject("canvas", { nodes: [...remote.nodes, pending] });
    await flushCanvasStorePersistence();
    remote.nodes.push({ ...node("remote-node"), position: { x: 600, y: 300 } });
    remote.revision = 2;
    resetRemoteUserDataSync();
    await initializeRemoteUserDataSession(scope);
    const reopened = await loadCanvasProjectForEditing("canvas");
    expect(reopened?.nodes.find((item) => item.id === pending.id)?.metadata?.taskId).toBe("original-task-id");
    await saveRemoteUserDataNow("canvas");
    expect(remote.nodes.map((item) => item.id).sort()).toEqual(["local-task", "original", "remote-node"]);
    expect(remote.nodes.find((item) => item.id === pending.id)?.metadata).toEqual(pending.metadata);
    expect(mutations.flatMap((item) => item.operations).some((op) => op.type === "remove_node")).toBe(false);
});
