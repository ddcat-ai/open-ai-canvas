import { expect, test } from "bun:test";

import { applyCanvasCollaborationOperation } from "../src/lib/canvas/canvas-collaboration-operations";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "../src/types/canvas";
import { rebaseCanvasCollaborationProject } from "../src/lib/canvas/canvas-collaboration-rebase";

function project(revision = 4): CanvasProject {
    const nodes = [
        { id: "a", type: CanvasNodeType.Text, title: "A", position: { x: 0, y: 0 }, width: 100, height: 80 },
        { id: "b", type: CanvasNodeType.Text, title: "B", position: { x: 200, y: 0 }, width: 100, height: 80 },
    ];
    return {
        id: "canvas",
        revision,
        title: "测试",
        createdAt: "2026-01-01",
        updatedAt: "2026-01-01",
        nodes,
        connections: [{ id: "edge-a-b", fromNodeId: "a", toNodeId: "b" }],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "default",
        showImageInfo: false,
        viewport: { x: 40, y: 20, k: 1.2 },
        directorScenes: [],
    };
}

test("applies a node field delta without changing the viewport", () => {
    const before = project();
    const result = applyCanvasCollaborationOperation(before, {
        opId: "op-1",
        kind: "update_node",
        nodeId: "a",
        revision: 5,
        patch: { title: "A updated" },
    });
    expect(result.applied).toBe(true);
    expect(result.project.nodes[0].title).toBe("A updated");
    expect(result.project.viewport).toEqual(before.viewport);
    expect(before.nodes[0].title).toBe("A");
});

test("deletes a node and all incident connections atomically", () => {
    const result = applyCanvasCollaborationOperation(project(), {
        opId: "op-2",
        kind: "delete_node",
        nodeId: "a",
        revision: 5,
    });
    expect(result.applied).toBe(true);
    expect(result.project.nodes.map((node) => node.id)).toEqual(["b"]);
    expect(result.project.connections).toEqual([]);
});

test("adds a node group and its connections as one operation", () => {
    const result = applyCanvasCollaborationOperation(project(), {
        opId: "op-3",
        kind: "create_nodes",
        revision: 5,
        nodes: [{ id: "c", type: CanvasNodeType.Text, title: "C", position: { x: 400, y: 0 }, width: 100, height: 80 }],
        connections: [{ id: "edge-b-c", fromNodeId: "b", toNodeId: "c" }],
    });
    expect(result.applied).toBe(true);
    expect(result.project.nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(result.project.connections.map((connection) => connection.id)).toEqual(["edge-a-b", "edge-b-c"]);
});

test("requests a full pull when a revision is missing or an invariant breaks", () => {
    const gap = applyCanvasCollaborationOperation(project(), { opId: "op-gap", kind: "update_node", nodeId: "a", revision: 7, patch: { title: "x" } });
    expect(gap.requiresResync).toBe(true);
    const before = project();
    const invalid = applyCanvasCollaborationOperation(before, {
        opId: "op-invalid",
        kind: "update_connections",
        revision: 5,
        connections: [{ id: "broken", fromNodeId: "a", toNodeId: "missing" }],
    });
    expect(invalid.requiresResync).toBe(true);
    expect(invalid.project).toBe(before);
});

test("explicit null matches the server and unrelated node references survive", () => {
    const before = project();
    const result = applyCanvasCollaborationOperation(before, { opId: "null", kind: "update_node", nodeId: "a", revision: 5, patch: { parentId: null } });
    expect(result.project.nodes[0].parentId).toBeNull();
    expect(result.project.nodes[1]).toBe(before.nodes[1]);
    expect(result.project.connections).toBe(before.connections);
});

test("duplicate ids and old incarnations require resync without partial changes", () => {
    const before = project();
    expect(applyCanvasCollaborationOperation(before, { opId: "stale", kind: "update_node", nodeId: "a", incarnation: 2, revision: 5, patch: { title: "x" } }).requiresResync).toBe(true);
    const node = { ...before.nodes[0], id: "new" };
    expect(applyCanvasCollaborationOperation(before, { opId: "dupe", kind: "create_nodes", revision: 5, nodes: [node, node] }).requiresResync).toBe(true);
});

test("rebase preserves independent edits, rich text and local viewport", () => {
    const base = project();
    const local = { ...base, nodes: base.nodes.map((node) => (node.id === "a" ? { ...node, metadata: { prompt: "new", richText: { type: "doc" } } } : node)), viewport: { x: 99, y: 88, k: 2 } } as CanvasProject;
    const remote = { ...base, revision: 5, nodes: base.nodes.map((node) => (node.id === "a" ? { ...node, position: { x: 55, y: 44 } } : node)) };
    const result = rebaseCanvasCollaborationProject(base, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(result.project.nodes[0].metadata).toEqual(local.nodes[0].metadata);
    expect(result.project.nodes[0].position).toEqual({ x: 55, y: 44 });
    expect(result.project.viewport).toEqual(local.viewport);
});

test("delete/edit, delete/new child and restore/old edit remain explicit conflicts", () => {
    const base = project();
    const deleted = { ...base, revision: 5, nodes: base.nodes.slice(1), connections: [] };
    const edited = { ...base, nodes: base.nodes.map((node) => ({ ...node, title: "local" })) };
    expect(rebaseCanvasCollaborationProject(base, edited, deleted).conflicts).toContain("nodes.a");
    const child = { ...base.nodes[0], id: "child" };
    const newChild = { ...base, nodes: [...base.nodes, child], connections: [...base.connections, { id: "a-child", fromNodeId: "a", toNodeId: "child" }] };
    expect(rebaseCanvasCollaborationProject(base, newChild, deleted).conflicts).toContain("connections.endpoints");
    expect(rebaseCanvasCollaborationProject(base, deleted, newChild).conflicts).toContain("nodes.a.relations");
    const restored = { ...base, revision: 7, nodes: base.nodes.map((node) => ({ ...node, metadata: { collaborationIncarnation: 2 } })) } as CanvasProject;
    expect(rebaseCanvasCollaborationProject(base, edited, restored).conflicts).toContain("nodes.a.incarnation");
});
