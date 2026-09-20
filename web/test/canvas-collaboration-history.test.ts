import { expect, test } from "bun:test";
import { applyCanvasHistoryPatch, createCanvasHistoryPatch, reconcileHistoryLifecycles, type CanvasHistorySnapshot } from "../src/pages/canvas/use-canvas-history";
import { buildCollaborativeOperations } from "../src/services/user-data-sync";
import { applyCanvasCollaborationOperation } from "../src/lib/canvas/canvas-collaboration-operations";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "../src/types/canvas";

function snapshot(): CanvasHistorySnapshot {
    return {
        nodes: [{ id: "a", type: CanvasNodeType.Text, title: "A", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { prompt: "original", style: "old", collaborationIncarnation: 1 } }],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        canvasAppearance: {} as CanvasHistorySnapshot["canvasAppearance"],
        backgroundMode: "default",
        showImageInfo: false,
    };
}

test("undo preserves remote leaves in the same node; redo reapplies only what undo changed", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.nodes[0].metadata!.prompt = "my prompt";
    after.nodes[0].metadata!.style = "my style";
    const latest = structuredClone(after);
    latest.nodes[0].metadata!.style = "remote style";
    latest.nodes[0].position = { x: 45, y: 99 };
    const undone = applyCanvasHistoryPatch(latest, createCanvasHistoryPatch(before, after)!, "before");
    expect(undone.nodes[0].metadata).toMatchObject({ prompt: "original", style: "remote style" });
    expect(undone.nodes[0].position).toEqual(latest.nodes[0].position);
    const inverse = createCanvasHistoryPatch(undone, latest)!;
    const newer = structuredClone(undone);
    newer.nodes[0].metadata!.style = "another change";
    const redone = applyCanvasHistoryPatch(newer, inverse, "after");
    expect(redone.nodes[0].metadata).toMatchObject({ prompt: "my prompt", style: "another change" });
});

test("undo leaves remote additions and refuses to edit a new incarnation", () => {
    const before = snapshot();
    const after = structuredClone(before);
    after.nodes[0].title = "mine";
    const patch = createCanvasHistoryPatch(before, after)!;
    const latest = structuredClone(after);
    latest.nodes[0].metadata!.collaborationIncarnation = 2;
    latest.nodes.push({ ...latest.nodes[0], id: "other" });
    expect(applyCanvasHistoryPatch(latest, patch, "before")).toEqual(latest);
    expect(applyCanvasHistoryPatch({ ...latest, nodes: latest.nodes.slice(1) }, patch, "before").nodes.map((n) => n.id)).toEqual(["other"]);
});

test("undo deletion records explicit restore intent and preserves unrelated nodes", () => {
    const before = snapshot();
    const after = { ...before, nodes: [] };
    const latest = { ...after, nodes: [{ ...before.nodes[0], id: "remote" }] };
    const undone = applyCanvasHistoryPatch(latest, createCanvasHistoryPatch(before, after)!, "before");
    expect(undone.nodes.map((n) => n.id)).toEqual(["a", "remote"]);
    expect(undone.nodes[0].metadata?.collaborationRestoreIncarnation).toBe(1);
});

test("undo creation preserves a node with new remote connections", () => {
    const before = snapshot();
    const after = { ...before, nodes: [...before.nodes, { ...before.nodes[0], id: "new" }] };
    const latest = { ...after, connections: [{ id: "remote-edge", fromNodeId: "a", toNodeId: "new" }] };
    expect(applyCanvasHistoryPatch(latest, createCanvasHistoryPatch(before, after)!, "before")).toEqual(latest);
});

test("delete, undo, acknowledgement, redo and undo again use fresh server lifecycles", async () => {
    const initial = { ...snapshot(), id: "canvas", title: "Canvas", revision: 1, collaborationEnabled: true, directorScenes: [], viewport: { x: 0, y: 0, k: 1 } } as unknown as CanvasProject;
    const before = snapshot();
    const deleted = { ...before, nodes: [] };
    const [deletion] = await buildCollaborativeOperations(initial, { ...initial, nodes: [] });
    expect(deletion.kind).toBe("delete_node");
    let confirmed = applyCanvasCollaborationOperation(initial, { ...deletion, revision: 2 }).project;
    const undone = applyCanvasHistoryPatch(deleted, createCanvasHistoryPatch(before, deleted)!, "before");
    const redo = createCanvasHistoryPatch(undone, deleted)!;
    const [restore] = await buildCollaborativeOperations(confirmed, { ...confirmed, nodes: undone.nodes });
    expect(restore.kind).toBe("restore_nodes");
    confirmed = applyCanvasCollaborationOperation(confirmed, { ...restore, revision: 3 }).project;
    reconcileHistoryLifecycles([redo], undone.nodes, confirmed.nodes);
    const redone = applyCanvasHistoryPatch({ ...before, nodes: confirmed.nodes }, redo, "after");
    expect(redone.nodes).toEqual([]);
    const [deleteAgain] = await buildCollaborativeOperations(confirmed, { ...confirmed, nodes: redone.nodes });
    expect(deleteAgain.incarnation).toBe(2);
    const undoAgain = applyCanvasHistoryPatch(redone, redo, "before");
    expect(undoAgain.nodes[0].metadata?.collaborationRestoreIncarnation).toBe(2);
});

test("undo before deletion is sent clears the restore marker and can still redo", () => {
    const before = snapshot();
    const deleted = { ...before, nodes: [] };
    const undone = applyCanvasHistoryPatch(deleted, createCanvasHistoryPatch(before, deleted)!, "before");
    const redo = createCanvasHistoryPatch(undone, deleted)!;
    reconcileHistoryLifecycles([redo], undone.nodes, before.nodes);
    expect(applyCanvasHistoryPatch(before, redo, "after").nodes).toEqual([]);
});
