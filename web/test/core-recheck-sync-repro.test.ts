import { afterEach, beforeEach, expect, test } from "bun:test";
import localforage from "localforage";
import { apiClient } from "../src/services/api/request";
import { setActiveUserScope } from "../src/lib/user-scope";
import { initializeRemoteUserDataSession, loadCanvasProjectForEditing, resetRemoteUserDataSync, saveRemoteUserDataNow, syncRemoteUserData } from "../src/services/user-data-sync";
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
        else if (url === "/canvas-projects/canvas" && config.method === "get") data = { project: structuredClone(remote) };
        else if (url === "/canvas-projects/canvas/operations" && config.method === "patch") {
            const body = JSON.parse(config.data) as CanvasOperationsRequest;
            mutations.push(body);
            for (const op of body.operations) {
                if (op.type === "set_field" && op.field === "title") {
                    expect(op.beforeValue).toBe(remote.title);
                    remote.title = String(op.value);
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
