import { describe, expect, test } from "bun:test";
import { applyCanvasImport } from "../src/pages/canvas/canvas-import-save";
import { CanvasSyncPendingError, waitForCanvasSync } from "../src/lib/canvas/sync-recovery";
import { CanvasNodeType, type CanvasNodeData, type CanvasConnection } from "../src/types/canvas";
import { repairMissingCanvasAssets } from "../src/services/canvas-asset-repair";
import { useAssetStore } from "../src/stores/use-asset-store";
import { useCanvasStore } from "../src/stores/canvas/use-canvas-store";

const node = (id: string, title = id): CanvasNodeData => ({ id, title, type: CanvasNodeType.Image, position: { x: 0, y: 0 }, width: 320, height: 180 });
const connection: CanvasConnection = { id: "edge", from: "old", to: "imported" };

function editor() {
    let current = { nodes: [node("old")], connections: [] as CanvasConnection[] };
    let durable = structuredClone(current);
    return {
        canvasId: "import-test",
        read: () => current,
        write: (next: typeof current) => {
            current = next;
        },
        persistLocal: async () => {
            durable = structuredClone(current);
        },
        durable: () => durable,
    };
}

describe("third-party import persistence", () => {
    test("text and empty media placeholders retain their original asset-library behavior", async () => {
        const originalAssets = useAssetStore.getState().assets;
        const state = editor();
        const text = { ...node("text"), type: CanvasNodeType.Text, metadata: { content: "TapNow text" } };
        try {
            await applyCanvasImport([text, node("placeholder")], [], { ...state, syncRemote: async () => {} });
            expect(state.read().nodes.map((n) => n.id)).toEqual(["old", "text", "placeholder"]);
            expect(state.read().nodes[1].metadata?.assetId).toBeUndefined();
            expect(useAssetStore.getState().assets).toHaveLength(originalAssets.length);
        } finally {
            useAssetStore.setState({ assets: originalAssets });
        }
    });

    test("an empty target canvas is rejected before staging nodes or assets", async () => {
        const state = editor();
        await expect(applyCanvasImport([node("imported")], [], { ...state, canvasId: "", syncRemote: async () => {} })).rejects.toThrow("有效画布");
        expect(state.read().nodes.map((n) => n.id)).toEqual(["old"]);
    });
    test("retry and editing after a pending import keep the original media asset identity", async () => {
        const originalAssets = useAssetStore.getState().assets;
        const originalProjects = useCanvasStore.getState().projects;
        const canvasId = useCanvasStore.getState().createProject("import identity regression");
        const state = editor();
        const media = { ...node("imported"), metadata: { content: "https://libtv-res.liblib.art/fixture.png" } };
        const persistence = {
            ...state,
            canvasId,
            persistLocal: async () => {
                useCanvasStore.getState().updateProject(canvasId, state.read());
            },
            syncRemote: async () => {
                repairMissingCanvasAssets(new Set([canvasId]), true);
                throw new Error("没有写入权限");
            },
        };
        try {
            await expect(applyCanvasImport([media], [], persistence)).rejects.toThrow("没有写入权限");
            const savedAssetId = useCanvasStore.getState().openProject(canvasId)!.nodes[1].metadata?.assetId;
            expect(savedAssetId).toBeTruthy();
            expect(state.read().nodes[1].metadata?.assetId).toBe(savedAssetId);
            state.write({ ...state.read(), nodes: state.read().nodes.map((n) => (n.id === "imported" ? { ...n, title: "edited" } : n)) });
            await persistence.persistLocal();
            repairMissingCanvasAssets(new Set([canvasId]), true);
            await applyCanvasImport([media], [], {
                ...persistence,
                syncRemote: async () => {
                    repairMissingCanvasAssets(new Set([canvasId]), true);
                },
            });
            expect(state.read().nodes[1].title).toBe("edited");
            expect(state.read().nodes[1].metadata?.assetId).toBe(savedAssetId);
            expect(useAssetStore.getState().assets.filter((asset) => asset.metadata?.canvasId === canvasId)).toHaveLength(1);
        } finally {
            useCanvasStore.setState({ projects: originalProjects });
            useAssetStore.setState({ assets: originalAssets });
        }
    });
    test("a timed-out save keeps imported nodes, connections and later edits while the original transaction completes", async () => {
        const state = editor();
        let finish!: () => void;
        let committed: ReturnType<typeof state.read> | undefined;
        const transaction = new Promise<void>((resolve) => {
            finish = resolve;
        });
        const result = await applyCanvasImport([node("imported")], [connection], {
            ...state,
            syncRemote: () => {
                const submitted = structuredClone(state.read());
                void transaction.then(() => {
                    committed = submitted;
                });
                return waitForCanvasSync(transaction, 5);
            },
        });
        expect(result).toBe("pending");
        expect(state.durable().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        expect(state.read().connections).toEqual([connection]);
        state.write({ ...state.read(), nodes: [...state.read().nodes, node("later")] });
        finish();
        await transaction;
        expect(committed?.nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        expect(state.read().nodes.map((n) => n.id)).toEqual(["old", "imported", "later"]);
    });

    test("only a confirmed remote save reports synced", async () => {
        const state = editor();
        let remote: ReturnType<typeof state.read> | undefined;
        expect(
            await applyCanvasImport([node("imported")], [connection], {
                ...state,
                syncRemote: async () => {
                    remote = structuredClone(state.durable());
                },
            }),
        ).toBe("synced");
        expect(remote?.nodes.map((n) => n.id)).toEqual(["old", "imported"]);
    });

    test("a rejected remote write remains an error and retrying the same batch preserves edits without duplicate nodes or connections", async () => {
        const state = editor();
        await expect(
            applyCanvasImport([node("imported")], [connection], {
                ...state,
                syncRemote: async () => {
                    throw new Error("没有写入权限");
                },
            }),
        ).rejects.toThrow("没有写入权限");
        expect(state.durable().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        state.write({ ...state.read(), nodes: state.read().nodes.map((n) => (n.id === "imported" ? { ...n, title: "edited" } : n)) });
        await applyCanvasImport([node("imported")], [connection], { ...state, syncRemote: async () => {} });
        expect(state.read().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        expect(state.read().nodes[1].title).toBe("edited");
        expect(state.read().connections).toEqual([connection]);
    });

    test("local persistence failure is never reported as pending cloud success and does not start the foreground remote save", async () => {
        const state = editor();
        let remoteStarted = false;
        await expect(
            applyCanvasImport([node("imported")], [], {
                ...state,
                persistLocal: async () => {
                    throw new CanvasSyncPendingError("本地写入超时");
                },
                syncRemote: async () => {
                    remoteStarted = true;
                },
            }),
        ).rejects.toThrow("本地");
        expect(remoteStarted).toBe(false);
        expect(state.read().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        expect(state.durable().nodes.map((n) => n.id)).toEqual(["old"]);
        await applyCanvasImport([node("imported")], [], { ...state, syncRemote: async () => {} });
        expect(state.durable().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
    });

    test("concurrent confirmation of the same batch does not append it twice", async () => {
        const state = editor();
        const save = () => applyCanvasImport([node("imported"), node("imported")], [connection, connection], { ...state, syncRemote: async () => {} });
        await Promise.all([save(), save()]);
        expect(state.read().nodes.map((n) => n.id)).toEqual(["old", "imported"]);
        expect(state.read().connections).toEqual([connection]);
    });
});
