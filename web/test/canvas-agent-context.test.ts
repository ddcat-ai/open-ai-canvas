import { describe, expect, it } from "bun:test";

import { buildCanvasAgentContext, getCanvasAgentConnection, getCanvasAgentGenerationTasks, getCanvasAgentNode, selectContextNodes, validateCanvasAgentOps } from "@/lib/canvas/canvas-agent-context";
import { canvasAgentPostconditionMessage, type CanvasAgentSnapshot, verifyCanvasAgentOps } from "@/lib/canvas/canvas-agent-ops";
import { CanvasNodeType } from "@/types/canvas";

const snapshot: CanvasAgentSnapshot = {
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

describe("validateCanvasAgentOps", () => {
    it("allows deleting and recreating a connection in one batch", () => {
        const result = validateCanvasAgentOps(snapshot, [
            { type: "delete_connections", id: "connection-1" },
            { type: "connect_nodes", id: "connection-2", fromNodeId: "prompt-1", toNodeId: "ref-1" },
        ]);
        expect(result.ok).toBe(true);
    });

    it("rejects direct media status forgery", () => {
        const result = validateCanvasAgentOps(snapshot, [
            { type: "update_node", id: "ref-1", patch: { metadata: { status: "success" } } },
        ]);
        expect(result.ok).toBe(false);
        expect(result.issues[0]?.severity).toBe("error");
    });
});

describe("precise canvas reads", () => {
    it("reads one node with resource and connections", () => {
        const result = getCanvasAgentNode(snapshot, { id: "ref-1" });
        expect(result.found).toBe(true);
        expect(result.node?.id).toBe("ref-1");
        expect(result.resource?.ready).toBe(true);
        expect(result.connections[0]?.id).toBe("connection-1");
    });

    it("reads one connection and returns explicit misses", () => {
        const result = getCanvasAgentConnection(snapshot, { id: "connection-1" });
        expect(result.found).toBe(true);
        expect(result.connection?.fromTitle).toBe("提示词");
        expect(result.toNode?.id).toBe("ref-1");
        expect(getCanvasAgentConnection(snapshot, { id: "missing" }).found).toBe(false);
    });

    it("projects generation task observation from node metadata", () => {
        const result = getCanvasAgentGenerationTasks(snapshot, {});
        expect(result.total).toBe(1);
        expect(result.tasks[0]?.taskId).toBe("task-1");
        expect(result.tasks[0]?.status).toBe("succeeded");
        expect(result.tasks[0]?.resourceReady).toBe(true);
    });
});

describe("canvas write postconditions", () => {
    it("confirms created nodes and connections exist after the batch", () => {
        const after: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [...snapshot.nodes, { id: "text-2", type: CanvasNodeType.Text, title: "输出", position: { x: 0, y: 420 }, width: 320, height: 240 }],
            connections: [...snapshot.connections, { id: "connection-2", fromNodeId: "ref-1", toNodeId: "text-2" }],
        };
        const result = verifyCanvasAgentOps(snapshot, after, [
            { type: "add_node", id: "text-2", nodeType: CanvasNodeType.Text },
            { type: "connect_nodes", id: "connection-2", fromNodeId: "ref-1", toNodeId: "text-2" },
        ]);
        expect(result.ok).toBe(true);
        expect(result.createdNodeIds).toEqual(["text-2"]);
        expect(result.missingConnectionIds).toEqual([]);
    });

    it("reports submitted generation without claiming completion", () => {
        const before: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ ...snapshot.nodes[0], id: "image-1", type: CanvasNodeType.Image, title: "待生成", metadata: { status: "idle", generationMode: "image" } }],
            connections: [],
        };
        const after: CanvasAgentSnapshot = {
            ...before,
            nodes: [{ ...before.nodes[0], metadata: { ...before.nodes[0].metadata, taskId: "task-2", taskStatus: "running", taskOfficialStatus: "processing" } }],
        };
        const result = verifyCanvasAgentOps(before, after, [{ type: "run_generation", nodeId: "image-1", mode: "image" }]);
        expect(result.ok).toBe(true);
        expect(result.generation[0]?.outcome).toBe("running");
        expect(canvasAgentPostconditionMessage(result)).toContain("尚未完成");
    });

    it("fails the tool result when generation failed or was never submitted", () => {
        const before: CanvasAgentSnapshot = {
            ...snapshot,
            nodes: [{ ...snapshot.nodes[0], id: "image-2", type: CanvasNodeType.Image, title: "失败生成", metadata: { status: "idle" } }],
            connections: [],
        };
        const failed: CanvasAgentSnapshot = {
            ...before,
            nodes: [{ ...before.nodes[0], metadata: { status: "error", taskId: "task-3", taskStatus: "failed" } }],
        };
        const result = verifyCanvasAgentOps(before, failed, [{ type: "run_generation", nodeId: "image-2", mode: "image" }]);
        expect(result.ok).toBe(false);
        expect(canvasAgentPostconditionMessage(result)).toContain("失败");
    });

    it("does not accept a silent update no-op as a successful write", () => {
        const result = verifyCanvasAgentOps(snapshot, snapshot, [{ type: "update_node", id: "prompt-1", patch: { title: "新标题" } }]);
        expect(result.ok).toBe(false);
        expect(result.warnings.join(" ")).toContain("未达到预期");
    });
});

describe("context window prioritization", () => {
    function makeNodes(count: number) {
        return Array.from({ length: count }, (_, index) => ({
            id: `n-${index}`,
            type: CanvasNodeType.Text,
            title: `节点${index}`,
            position: { x: index * 10, y: 0 },
            width: 200,
            height: 120,
        }));
    }

    it("does not truncate when node count is within budget", () => {
        const nodes = makeNodes(10);
        const result = selectContextNodes(nodes, [], new Set(), 120);
        expect(result.truncated).toBe(false);
        expect(result.included).toBe(10);
        expect(result.total).toBe(10);
        expect(result.nodes).toHaveLength(10);
    });

    it("keeps selected nodes and their one-hop neighbors first when truncated", () => {
        const nodes = makeNodes(12);
        const connections = [{ id: "c-1", fromNodeId: "n-11", toNodeId: "n-3" }];
        // max=5：选中 n-11、其邻居 n-3 优先，其余按原始顺序补位
        const result = selectContextNodes(nodes, connections, new Set(["n-11"]), 5);
        expect(result.truncated).toBe(true);
        expect(result.included).toBe(5);
        const ids = result.nodes.map((node) => node.id);
        expect(ids).toContain("n-11"); // 选中
        expect(ids).toContain("n-3");  // 一跳邻居
        // 保持画布原始顺序
        const indices = ids.map((id) => Number(id.slice(2)));
        const sorted = [...indices].sort((a, b) => a - b);
        expect(indices).toEqual(sorted);
    });

    it("keeps loading/error nodes even when they are not selected", () => {
        const nodes = makeNodes(10).map((node, index) =>
            index === 9 ? { ...node, metadata: { status: "error" } } : node,
        );
        const result = selectContextNodes(nodes, [], new Set(), 4);
        expect(result.nodes.map((node) => node.id)).toContain("n-9");
    });

    it("buildCanvasAgentContext limits nodes and dangling connections and reports truncation", () => {
        const nodes = makeNodes(10);
        const bigSnapshot: CanvasAgentSnapshot = {
            projectId: "p",
            title: "大画布",
            nodes,
            // c-a：两端都在窗口内（n-0,n-1 会被保留）；c-out：一端 n-9 会被裁掉
            connections: [
                { id: "c-a", fromNodeId: "n-0", toNodeId: "n-1" },
                { id: "c-out", fromNodeId: "n-0", toNodeId: "n-9" },
            ],
            selectedNodeIds: [],
            viewport: { x: 0, y: 0, k: 1 },
        };
        const ctx = buildCanvasAgentContext(bigSnapshot, { maxNodes: 5 });
        expect(ctx.nodes).toHaveLength(5);
        expect(ctx.canvas.nodeCount).toBe(10); // 统计仍是真实总数
        expect(ctx.canvas.contextIncluded).toBe(5);
        expect(ctx.canvas.contextTruncated).toBe(true);
        // 悬空连线被过滤
        const connIds = ctx.connections.map((connection) => connection.id);
        expect(connIds).toContain("c-a");
        expect(connIds).not.toContain("c-out");
        // 截断告警
        expect(ctx.warnings.join(" ")).toContain("canvas_find_nodes");
    });

    it("buildCanvasAgentContext keeps full context unchanged below the limit", () => {
        const ctx = buildCanvasAgentContext(snapshot);
        expect(ctx.canvas.contextTruncated).toBe(false);
        expect(ctx.nodes).toHaveLength(2);
        expect(ctx.connections).toHaveLength(1);
    });
});
