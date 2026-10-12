import { expect, test } from "bun:test";

import { rebaseCanvasProjects, parseCanvasStorageDocument } from "@/lib/canvas/canvas-storage-revision";
import { commitCanvasGenerationResult } from "@/lib/canvas/canvas-generation-result";
import { buildCanvasOperations, mergeRemoteAssetsWithLocalPending, remoteUserDataRetryDelay } from "@/services/user-data-sync";
import type { Asset } from "@/stores/use-asset-store";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node = (id: string, title = id): CanvasNodeData => ({
    id,
    type: CanvasNodeType.Image,
    title,
    position: { x: 0, y: 0 },
    width: 100,
    height: 100,
    metadata: { content: title },
});

const project = (nodes: CanvasNodeData[], revision = 1): CanvasProject => ({
    id: "canvas",
    revision,
    title: "Canvas",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    nodes,
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});

test("storage rebase keeps durable-only and local-only nodes when project revisions differ", () => {
    const base = project([node("base")], 1);
    const local = project([node("base"), node("local")], 1);
    const durable = project([node("base"), node("remote")], 2);
    const document = parseCanvasStorageDocument(null, [durable]);

    const rebased = rebaseCanvasProjects({ document, baseProjects: [base], localProjects: [local], baseRevision: 1 });
    const result = rebased.document.state.projects[0]!;

    expect(result.nodes.map((item) => item.id).sort()).toEqual(["base", "local", "remote"]);
});

test("storage rebase preserves a local node recreated after a concurrent deletion", () => {
    const base = project([node("same", "before")]);
    const local = project([node("same", "recreated")]);
    const document = parseCanvasStorageDocument(null, [project([], 2)]);
    document.tombstones.nodes.canvas = { same: 2 };

    const rebased = rebaseCanvasProjects({ document, baseProjects: [base], localProjects: [local], baseRevision: 1 });
    const result = rebased.document.state.projects[0]!;

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: "same", title: "recreated" });
    expect(rebased.conflicts.some((conflict) => conflict.id === "same")).toBe(true);
});

test("storage rebase keeps a durable edit when a stale local delete races with it", () => {
    const base = project([node("same", "before")]);
    const local = project([]);
    const durable = project([node("same", "remote edit")], 2);
    const document = parseCanvasStorageDocument(null, [durable]);

    const rebased = rebaseCanvasProjects({ document, baseProjects: [base], localProjects: [local], baseRevision: 1 });
    const result = rebased.document.state.projects[0]!;

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0]).toMatchObject({ id: "same", title: "remote edit" });
    expect(rebased.conflicts.some((conflict) => conflict.id === "same")).toBe(true);
});

test("generation result refreshes an existing additional node without losing its local presentation edits", () => {
    const before = node("root", "Root");
    const child = { ...node("child", "Renamed"), position: { x: 900, y: 700 }, metadata: { content: "old" } };
    const result = { ...before, metadata: { content: "root-result" } };
    const refreshedChild = { ...child, metadata: { content: "new" } };

    const committed = commitCanvasGenerationResult([before, child], before, result, "task", [refreshedChild]);

    expect(committed).toHaveLength(2);
    expect(committed[1]).toMatchObject({ id: "child", title: "Renamed", position: { x: 900, y: 700 }, metadata: { content: "new" } });
});

test("login keeps local asset edits and new assets while retaining remote assets", () => {
    const remoteAsset = { id: "shared", kind: "text", title: "remote", coverUrl: "", tags: [], createdAt: "2026-01-01", updatedAt: "2026-01-02", data: { content: "remote" } } as Asset;
    const localEdit = { ...remoteAsset, title: "local edit", updatedAt: "2026-01-03" };
    const localNew = { ...remoteAsset, id: "local-only", title: "local only" };
    const merged = mergeRemoteAssetsWithLocalPending([remoteAsset], [localEdit, localNew]);

    expect(merged).toHaveLength(2);
    expect(merged.find((asset) => asset.id === "shared")?.title).toBe("local edit");
    expect(merged.find((asset) => asset.id === "local-only")?.title).toBe("local only");
});

test("remote sync retry keeps polling at the capped backoff instead of stopping", () => {
    expect(remoteUserDataRetryDelay(0)).toBe(2_000);
    expect(remoteUserDataRetryDelay(4)).toBe(30_000);
    expect(remoteUserDataRetryDelay(20)).toBe(30_000);
    expect(remoteUserDataRetryDelay(20, 45_000)).toBe(45_000);
});

test("new revision-zero canvas produces an explicit create mutation instead of an implicit update", () => {
    const draft = project([node("local")], 0);
    const operations = buildCanvasOperations(undefined, draft);

    expect(operations[0]).toMatchObject({ type: "create_canvas", id: "canvas" });
    expect(operations.some((operation) => operation.type === "create_node")).toBe(true);
});
