import { describe, expect, it } from "bun:test";

import { getCanvasConnection, getCanvasGenerationTasks, getCanvasNode, validateCanvasOperations } from "@/lib/canvas/canvas-context-discovery";
import { canvasOperationPostconditionMessage, type CanvasSnapshot, verifyCanvasOperations } from "@/lib/canvas/canvas-operation-contract";
import { CanvasNodeType } from "@/types/canvas";

const snapshot: CanvasSnapshot = {
    projectId: "canvas-1",
    domainProjectId: "project-1",
    title: "测试画布",
    nodes: [
        { id: "prompt-1", type: CanvasNodeType.Text, title: "提示词", position: { x: 0, y: 0 }, width: 320, height: 240 },
        { id: "ref-1", type: CanvasNodeType.Image, title: "参考图", position: { x: 420, y: 0 }, width: 320, height: 320, metadata: { status: "success", storageKey: "resource:ref-1", taskId: "task-1", taskStatus: "succeeded", taskProgress: 100, taskStage: "completed" } },
    ],
    connections: [{ id: "connection-1", fromNodeId: "prompt-1", toNodeId: "ref-1" }],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

describe("validateCanvasOperations", () => {
    it("allows deleting and recreating a connection in one batch", () => {
        const result = validateCanvasOperations(snapshot, [
            { type: "delete_connections", id: "connection-1" },
            { type: "connect_nodes", id: "connection-2", fromNodeId: "prompt-1", toNodeId: "ref-1" },
        ]);
        expect(result.ok).toBe(true);
    });

    it("rejects direct media status forgery", () => {
        const result = validateCanvasOperations(snapshot, [
            { type: "update_node", id: "ref-1", patch: { metadata: { status: "success" } } },
        ]);
        expect(result.ok).toBe(false);
        expect(result.issues[0]?.severity).toBe("error");
    });
});

describe("precise canvas reads", () => {
    it("reads one node with resource and connections", () => {
        const result = getCanvasNode(snapshot, { id: "ref-1" });
        expect(result.found).toBe(true);
        expect(result.node?.id).toBe("ref-1");
        expect(result.resource?.ready).toBe(true);
        expect(result.connections[0]?.id).toBe("connection-1");
    });

    it("reads one connection and returns explicit misses", () => {
        const result = getCanvasConnection(snapshot, { id: "connection-1" });
        expect(result.found).toBe(true);
        expect(result.connection?.fromTitle).toBe("提示词");
        expect(result.toNode?.id).toBe("ref-1");
        expect(getCanvasConnection(snapshot, { id: "missing" }).found).toBe(false);
    });

    it("projects generation task observation from node metadata", () => {
        const result = getCanvasGenerationTasks(snapshot, {});
        expect(result.total).toBe(1);
        expect(result.tasks[0]?.taskId).toBe("task-1");
        expect(result.tasks[0]?.status).toBe("succeeded");
        expect(result.tasks[0]?.resourceReady).toBe(true);
    });
});

describe("canvas write postconditions", () => {
    it("confirms created nodes and connections exist after the batch", () => {
        const after: CanvasSnapshot = {
            ...snapshot,
            nodes: [...snapshot.nodes, { id: "text-2", type: CanvasNodeType.Text, title: "输出", position: { x: 0, y: 420 }, width: 320, height: 240 }],
            connections: [...snapshot.connections, { id: "connection-2", fromNodeId: "ref-1", toNodeId: "text-2" }],
        };
        const result = verifyCanvasOperations(snapshot, after, [
            { type: "add_node", id: "text-2", nodeType: CanvasNodeType.Text },
            { type: "connect_nodes", id: "connection-2", fromNodeId: "ref-1", toNodeId: "text-2" },
        ]);
        expect(result.ok).toBe(true);
        expect(result.createdNodeIds).toEqual(["text-2"]);
        expect(result.missingConnectionIds).toEqual([]);
    });

    it("reports submitted generation without claiming completion", () => {
        const before: CanvasSnapshot = {
            ...snapshot,
            nodes: [{ ...snapshot.nodes[0], id: "image-1", type: CanvasNodeType.Image, title: "待生成", metadata: { status: "idle", generationMode: "image" } }],
            connections: [],
        };
        const after: CanvasSnapshot = {
            ...before,
            nodes: [{ ...before.nodes[0], metadata: { ...before.nodes[0].metadata, taskId: "task-2", taskStatus: "running", taskOfficialStatus: "processing" } }],
        };
        const result = verifyCanvasOperations(before, after, [{ type: "run_generation", nodeId: "image-1", mode: "image" }]);
        expect(result.ok).toBe(true);
        expect(result.generation[0]?.outcome).toBe("running");
        expect(canvasOperationPostconditionMessage(result)).toContain("尚未完成");
    });

    it("fails the tool result when generation failed or was never submitted", () => {
        const before: CanvasSnapshot = {
            ...snapshot,
            nodes: [{ ...snapshot.nodes[0], id: "image-2", type: CanvasNodeType.Image, title: "失败生成", metadata: { status: "idle" } }],
            connections: [],
        };
        const failed: CanvasSnapshot = {
            ...before,
            nodes: [{ ...before.nodes[0], metadata: { status: "error", taskId: "task-3", taskStatus: "failed" } }],
        };
        const result = verifyCanvasOperations(before, failed, [{ type: "run_generation", nodeId: "image-2", mode: "image" }]);
        expect(result.ok).toBe(false);
        expect(canvasOperationPostconditionMessage(result)).toContain("失败");
    });

    it("does not accept a silent update no-op as a successful write", () => {
        const result = verifyCanvasOperations(snapshot, snapshot, [{ type: "update_node", id: "prompt-1", patch: { title: "新标题" } }]);
        expect(result.ok).toBe(false);
        expect(result.warnings.join(" ")).toContain("未达到预期");
    });
});
