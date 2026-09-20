import { expect, test } from "bun:test";
import { applyCanvasConflictField, autoMergeIndependentCanvasChanges, buildCanvasConflictFields, type CanvasConflictField } from "../src/services/canvas-conflicts";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";

function project(node: Record<string, unknown>, revision: number): CanvasProject {
    return {
        id: "canvas",
        title: "测试画布",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        nodes: [node] as CanvasProject["nodes"],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "default" as CanvasProject["backgroundMode"],
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        directorScenes: [],
        revision,
    };
}

function node(title: string, prompt: string, id = "node-a") {
    return { id, title, type: "text", position: { x: 0, y: 0 }, width: 320, height: 180, metadata: { prompt, composerContent: prompt } };
}

test("three-way merge keeps independent local and remote edits", () => {
    const base = project(node("原名称", "原提示词"), 10);
    const local = project(node("我的名称", "我的提示词"), 10);
    const remote = project(node("原名称", "云端提示词"), 11);
    const fields = buildCanvasConflictFields(base, local, remote);
    expect(fields.map((field) => field.key)).toEqual(["prompt"]);
    const merged = autoMergeIndependentCanvasChanges(base, local, remote);
    expect(merged.nodes[0].title).toBe("我的名称");
    expect(merged.nodes[0].metadata?.prompt).toBe("云端提示词");
    const prompt = fields.find((field) => field.key === "prompt") as CanvasConflictField;
    const resolved = applyCanvasConflictField(merged, prompt, prompt.localValue);
    expect(resolved.nodes[0].metadata?.prompt).toBe("我的提示词");
});

test("three-way merge preserves a local-only new node", () => {
    const base = project(node("原名称", "原提示词"), 10);
    const local = { ...base, nodes: [...base.nodes, node("新增节点", "新增提示词", "node-new") as CanvasProject["nodes"][number]] };
    const remote = project(node("原名称", "云端提示词"), 11);
    const merged = autoMergeIndependentCanvasChanges(base, local, remote);
    expect(merged.nodes.map((item) => item.title)).toEqual(["原名称", "新增节点"]);
});

test("keeping a remote node deletion also removes invalid local edges", () => {
    const base = project(node("原节点", "原提示词"), 10);
    const child = node("新增子节点", "子节点提示词", "node-child") as CanvasProject["nodes"][number];
    const local = {
        ...base,
        nodes: [...base.nodes, child],
        connections: [{ id: "edge-a-child", fromNodeId: "node-a", toNodeId: "node-child" }] as CanvasProject["connections"],
    };
    const remote = { ...base, nodes: [], connections: [], revision: 11 };
    const fields = buildCanvasConflictFields(base, local, remote);
    const merged = autoMergeIndependentCanvasChanges(base, local, remote);
    expect(fields).toHaveLength(0);
    expect(merged.nodes.map((item) => item.id)).toEqual(["node-child"]);
    expect(merged.connections).toHaveLength(0);
});

test("merges independent connection additions by connection id", () => {
    const child = node("子节点", "子提示词", "node-child") as CanvasProject["nodes"][number];
    const base = { ...project(node("原节点", "原提示词"), 10), nodes: [node("原节点", "原提示词") as CanvasProject["nodes"][number], child] };
    const local = { ...base, connections: [{ id: "edge-local", fromNodeId: "node-a", toNodeId: "node-child" }] as CanvasProject["connections"] };
    const remote = { ...base, revision: 11, connections: [{ id: "edge-remote", fromNodeId: "node-child", toNodeId: "node-a" }] as CanvasProject["connections"] };
    expect(buildCanvasConflictFields(base, local, remote)).toHaveLength(0);
    const merged = autoMergeIndependentCanvasChanges(base, local, remote);
    expect(merged.connections.map((item) => item.id).sort()).toEqual(["edge-local", "edge-remote"]);
});

test("local-only node deletion is applied without a false conflict", () => {
    const base = project(node("原节点", "原提示词"), 10);
    const local = { ...base, nodes: [] };
    const remote = { ...base, revision: 11 };
    expect(buildCanvasConflictFields(base, local, remote)).toHaveLength(0);
    expect(autoMergeIndependentCanvasChanges(base, local, remote).nodes).toHaveLength(0);
});

test("node delete versus edit exposes a structure conflict and supports either side", () => {
    const base = project(node("原节点", "原提示词"), 10);
    const local = { ...base, nodes: [] };
    const remote = { ...base, revision: 11, nodes: [node("云端改名", "云端提示词") as CanvasProject["nodes"][number]] };
    const fields = buildCanvasConflictFields(base, local, remote);
    const structure = fields.find((item) => item.key === "structure");
    expect(structure).toBeDefined();
    const keptRemote = applyCanvasConflictField(autoMergeIndependentCanvasChanges(base, local, remote), structure!, structure!.remoteValue);
    expect(keptRemote.nodes[0].title).toBe("云端改名");
    const keptLocal = applyCanvasConflictField(autoMergeIndependentCanvasChanges(base, local, remote), structure!, structure!.localValue);
    expect(keptLocal.nodes).toHaveLength(0);
});

test("same id concurrent node creation is surfaced instead of silently dropping local content", () => {
    const base = project(node("原节点", "原提示词"), 10);
    const local = { ...base, nodes: [...base.nodes, node("本地新增", "本地提示词", "node-new") as CanvasProject["nodes"][number]] };
    const remote = { ...base, revision: 11, nodes: [...base.nodes, node("云端新增", "云端提示词", "node-new") as CanvasProject["nodes"][number]] };
    const fields = buildCanvasConflictFields(base, local, remote);
    expect(fields.some((item) => item.nodeId === "node-new" && item.key === "structure")).toBe(true);
});

test("metadata selection does not resurrect a deleted rich text field", () => {
    const source = node("原节点", "提示词") as CanvasProject["nodes"][number];
    source.metadata = { prompt: "提示词", composerContent: "提示词", richText: "旧富文本", style: "原样式" };
    const base = project(source, 10);
    const localNode = structuredClone(source);
    localNode.metadata = { prompt: "提示词", composerContent: "提示词", style: "本地样式" };
    const remoteNode = structuredClone(source);
    remoteNode.metadata = { prompt: "提示词", composerContent: "提示词", style: "云端样式" };
    const local = { ...base, nodes: [localNode] };
    const remote = { ...base, revision: 11, nodes: [remoteNode] };
    const field = buildCanvasConflictFields(base, local, remote).find((item) => item.key === "metadata");
    expect(field).toBeDefined();
    const merged = applyCanvasConflictField(autoMergeIndependentCanvasChanges(base, local, remote), field!, field!.localValue);
    expect(merged.nodes[0].metadata?.richText).toBeUndefined();
    expect(merged.nodes[0].metadata?.style).toBe("本地样式");
});
