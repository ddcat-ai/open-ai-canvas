import { describe, expect, test } from "bun:test";

import { buildCanvasOperations, repairPendingCanvasMutationRequest } from "@/services/user-data-sync";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";

function canvas(patch: Partial<CanvasProject> = {}): CanvasProject {
    return {
        id: "canvas",
        title: "自由画布 1",
        createdAt: "",
        updatedAt: "",
        nodes: [],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots" as CanvasProject["backgroundMode"],
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
        ...patch,
    };
}

describe("画布 operations 生成", () => {
    test("节点可选字段的 undefined 在 JSON 请求中保留为 null 基线和删除值", () => {
        const node = { id: "node", metadata: { title: undefined } } as unknown as CanvasProject["nodes"][number];
        const changed = { ...node, metadata: { title: "新标题" } };
        const added = JSON.parse(JSON.stringify(buildCanvasOperations(canvas({ nodes: [node] }), canvas({ nodes: [changed] }))));
        expect(added).toEqual([{ type: "patch_node", id: "node", patch: { "metadata.title": "新标题" }, before: { "metadata.title": null } }]);
        const removed = JSON.parse(JSON.stringify(buildCanvasOperations(canvas({ nodes: [changed] }), canvas({ nodes: [node] }))));
        expect(removed).toEqual([{ type: "patch_node", id: "node", patch: { "metadata.title": null }, before: { "metadata.title": "新标题" } }]);
        expect(buildCanvasOperations(canvas({ nodes: [node] }), canvas({ nodes: [{ ...node, metadata: {} }] }))).toEqual([]);
    });

    test("旧 journal 的空节点补丁从原快照恢复，保留 mutationId 和有效请求", () => {
        const before = canvas({ nodes: [{ id: "node", metadata: {} }] as CanvasProject["nodes"] });
        const after = canvas({ nodes: [{ id: "node", metadata: { title: "新标题" } }] as CanvasProject["nodes"] });
        const broken = { mutationId: "node-mutation", operations: [{ type: "patch_node", id: "node", patch: { "metadata.title": "新标题" }, before: {} }] } as Parameters<typeof repairPendingCanvasMutationRequest>[0];
        const repaired = repairPendingCanvasMutationRequest(broken, before, after);
        expect(repaired.mutationId).toBe("node-mutation");
        expect(repaired.operations).toEqual(buildCanvasOperations(before, after));
        expect(repairPendingCanvasMutationRequest(repaired, before, after)).toBe(repaired);
        expect(repairPendingCanvasMutationRequest(broken)).toBe(broken);

        const deletion = { mutationId: "delete-field", operations: [{ type: "patch_node", id: "node", patch: {}, before: { "metadata.title": "新标题" } }] } as Parameters<typeof repairPendingCanvasMutationRequest>[0];
        expect(repairPendingCanvasMutationRequest(deletion, after, before).operations).toEqual(buildCanvasOperations(after, before));
        const noop = { ...broken, mutationId: "noop", operations: [{ ...broken.operations[0], patch: {} }] } as Parameters<typeof repairPendingCanvasMutationRequest>[0];
        expect(repairPendingCanvasMutationRequest(noop, before, before).operations).toEqual([]);
    });
    test("新画布只发 create_canvas，不追加会与创建字段冲突的 set_field", () => {
        const operations = buildCanvasOperations(undefined, canvas());
        expect(operations[0]?.type).toBe("create_canvas");
        expect(operations.some((operation) => operation.type === "set_field")).toBe(false);
    });

    test("已有画布改标题时带上 beforeValue", () => {
        const operations = buildCanvasOperations(canvas({ title: "旧" }), canvas({ title: "新" }));
        expect(operations).toEqual([{ type: "set_field", field: "title", value: "新", beforeValue: "旧" }]);
    });

    test("修复旧 journal：移除新画布中重复的 set_field，保留 mutationId", () => {
        const legacy = JSON.parse(
            JSON.stringify({
                mutationId: "m-1",
                operations: [
                    { type: "create_canvas", id: "canvas", patch: { title: "自由画布 1" } },
                    { type: "set_field", field: "title", value: "自由画布 1", beforeValue: undefined },
                ],
            }),
        );
        const repaired = repairPendingCanvasMutationRequest(legacy, undefined, canvas());
        expect(repaired.mutationId).toBe("m-1");
        expect(repaired.operations).toEqual([{ type: "create_canvas", id: "canvas", patch: { title: "自由画布 1" } }]);
    });

    test("修复旧 journal：移除空 projectId 到缺省值的语义 no-op", () => {
        const legacy = {
            mutationId: "m-3",
            operations: [
                { type: "create_node", node: { id: "node-1" } },
                { type: "set_field", field: "projectId", value: null, beforeValue: "" },
            ],
        } as never;
        const repaired = repairPendingCanvasMutationRequest(legacy, canvas({ projectId: "" }), canvas({ projectId: undefined }));
        expect(repaired.mutationId).toBe("m-3");
        expect(repaired.operations).toEqual([{ type: "create_node", node: { id: "node-1" } }]);
    });
    test("修复旧 journal：缺失的可选字段基线编码为 null", () => {
        const legacy = JSON.parse(JSON.stringify({ mutationId: "m-2", operations: [{ type: "set_field", field: "timeline", value: { tracks: [] }, beforeValue: undefined }] }));
        const repaired = repairPendingCanvasMutationRequest(legacy, canvas(), canvas());
        expect(repaired.operations).toEqual([{ type: "set_field", field: "timeline", value: { tracks: [] }, beforeValue: null }]);
    });
});
