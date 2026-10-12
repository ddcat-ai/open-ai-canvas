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
