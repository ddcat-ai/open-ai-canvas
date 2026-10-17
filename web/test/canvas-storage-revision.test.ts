import { expect, test } from "bun:test";

import { parseCanvasStorageDocument, rebaseCanvasProjects, serializeCanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (metadata: CanvasNodeData["metadata"]): CanvasNodeData => ({
    id: "image",
    type: CanvasNodeType.Image,
    title: "Image",
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    metadata,
});

const project = (image: CanvasNodeData): CanvasProject => ({
    id: "canvas",
    title: "Canvas",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nodes: [image],
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});

function rebaseNode(base: CanvasNodeData, local: CanvasNodeData, durable = base) {
    const document = parseCanvasStorageDocument(serializeCanvasStorageDocument(parseCanvasStorageDocument(null, [project(durable)])));
    return rebaseCanvasProjects({ document, baseProjects: [project(base)], localProjects: [project(local)], baseRevision: 0 });
}

test("generated image merges after JSON storage omits undefined pending resource and task fields", () => {
    const before = node({ taskId: "task", status: "loading", taskStage: "正在应用结果", content: undefined, storageKey: undefined, assetId: undefined, taskProgress: undefined, taskCompletedAt: undefined });
    const completed = {
        ...before,
        metadata: { ...before.metadata, status: "success" as const, content: "/image.png", storageKey: "resource:image", assetId: "asset", taskProgress: 100, taskCompletedAt: "2026-01-01T00:00:01Z", generationEffectKeys: ["attach-node:task:image:0"] },
    };

    const durable = { ...before, metadata: { ...before.metadata, taskStage: "正在生成" } };
    const result = rebaseNode(before, completed, durable);

    expect(result.conflicts).toEqual([]);
    expect(result.document.state.projects[0]!.nodes[0]).toEqual({ ...completed, metadata: { ...completed.metadata, taskStage: "正在生成" } });
});

test("undefined fields on a stale local snapshot preserve durable resource edits", () => {
    const before = node({ taskId: "task", storageKey: undefined, assetId: undefined });
    const local = { ...before, title: "Renamed", metadata: { taskId: "task", prompt: "Local prompt" } };
    const durable = node({ taskId: "task", storageKey: "resource:remote", assetId: "remote-asset" });

    const result = rebaseNode(before, local, durable);

    expect(result.conflicts).toEqual([]);
    expect(result.document.state.projects[0]!.nodes[0]).toMatchObject({ title: "Renamed", metadata: { ...durable.metadata, prompt: "Local prompt" } });
});

test("clearing optional fields with undefined matches an already persisted deletion", () => {
    const before = node({ taskId: "task", errorDetails: "Previous error", resourceReloadAvailable: true });
    const cleared = node({ taskId: "task", errorDetails: undefined, resourceReloadAvailable: undefined });

    const durable = { ...cleared, metadata: { ...cleared.metadata, prompt: "Updated prompt" } };
    const result = rebaseNode(before, cleared, durable);

    expect(result.conflicts).toEqual([]);
    expect(result.document.state.projects[0]!.nodes[0]!.metadata?.errorDetails).toBeUndefined();
    expect(result.document.state.projects[0]!.nodes[0]!.metadata?.resourceReloadAvailable).toBeUndefined();
});

test("clearing optional fields preserves a genuine concurrent edit as a conflict", () => {
    const before = node({ taskId: "task", errorDetails: "Previous error" });
    const local = node({ taskId: "task", errorDetails: undefined });
    const durable = node({ taskId: "task", errorDetails: "Concurrent error" });

    const result = rebaseNode(before, local, durable);

    expect(result.conflicts).toContainEqual({ kind: "node", id: "image", projectId: "canvas", reason: "concurrent-update" });
    expect(result.document.state.projects[0]!.nodes[0]!.metadata?.errorDetails).toBe("Concurrent error");
});

test("assigning different resources from an undefined baseline remains a conflict", () => {
    const before = node({ taskId: "task", storageKey: undefined });
    const local = node({ taskId: "task", storageKey: "resource:local" });
    const durable = node({ taskId: "task", storageKey: "resource:remote" });

    const result = rebaseNode(before, local, durable);

    expect(result.conflicts).toContainEqual({ kind: "node", id: "image", projectId: "canvas", reason: "concurrent-update" });
    expect(result.document.state.projects[0]!.nodes[0]!.metadata?.storageKey).toBe("resource:remote");
});

test("updating a resource concurrently deleted from storage remains a conflict", () => {
    const before = node({ taskId: "task", storageKey: "resource:before" });
    const local = node({ taskId: "task", storageKey: "resource:local" });
    const durable = node({ taskId: "task" });

    const result = rebaseNode(before, local, durable);

    expect(result.conflicts).toContainEqual({ kind: "node", id: "image", projectId: "canvas", reason: "concurrent-update" });
});

test("a generation target deleted while the task was running still reports a deletion conflict", () => {
    const before = node({ taskId: "task", status: "loading", storageKey: undefined });
    const completed = node({ taskId: "task", status: "success", storageKey: "resource:image" });
    const document = parseCanvasStorageDocument(null, [{ ...project(before), nodes: [] }]);
    document.tombstones.nodes.canvas = { image: 1 };

    const result = rebaseCanvasProjects({ document, baseProjects: [project(before)], localProjects: [project(completed)], baseRevision: 0 });

    expect(result.conflicts).toContainEqual({ kind: "node", id: "image", projectId: "canvas" });
});
