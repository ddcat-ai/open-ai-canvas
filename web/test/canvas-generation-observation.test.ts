import { expect, test } from "bun:test";
import { completedGenerationObservationBase } from "@/lib/canvas/canvas-generation-result";
import { parseCanvasStorageDocument, rebaseCanvasProjects } from "@/lib/canvas/canvas-storage-revision";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const base: CanvasNodeData = {
    id: "video",
    type: CanvasNodeType.Video,
    title: "Video",
    position: { x: 0, y: 0 },
    width: 320,
    height: 180,
    metadata: { taskId: "task", status: "loading", taskStage: "reload", prompt: "original", content: "old" },
};
const result: CanvasNodeData = { ...base, metadata: { ...base.metadata, status: "success", taskStatus: "succeeded", content: "generated", generationEffectKeys: ["effect"] } };
const saved: CanvasNodeData = { ...base, metadata: { ...base.metadata, status: "error", taskStage: "failed", errorDetails: "previous failure" } };
const project = (nodes: CanvasNodeData[]): CanvasProject => ({
    id: "canvas",
    revision: 1,
    title: "Canvas",
    createdAt: "",
    updatedAt: "",
    nodes,
    connections: [],
    chatSessions: [],
    activeChatId: null,
    backgroundMode: "dots",
    showImageInfo: false,
    viewport: { x: 0, y: 0, k: 1 },
    previsScenes: [],
});
function rebase(durableNodes: CanvasNodeData[], local = result) {
    const document = parseCanvasStorageDocument(null, [project(durableNodes)]);
    if (!durableNodes.length) document.tombstones.nodes.canvas = { video: 2 };
    return rebaseCanvasProjects({
        document,
        baseRevision: 1,
        baseProjects: [project(completedGenerationObservationBase([base], [local], durableNodes, "task", "effect"))],
        localProjects: [project([local])],
    });
}

test("completed observations converge without mutating the original baseline", () => {
    const merged = rebase([saved]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.document.state.projects[0].nodes[0].metadata).toMatchObject({ status: "success", taskStatus: "succeeded", content: "generated" });
    expect(base.metadata?.status).toBe("loading");
});

test("a replaced or cleared task binding rejects the old completed task", () => {
    for (const taskId of ["new-task", undefined]) {
        expect(() => rebase([{ ...saved, metadata: { ...saved.metadata, taskId } }])).toThrow("旧任务结果不能覆盖");
    }
});

test("actual media and prompt conflicts still prevent a clean rebase", () => {
    for (const field of ["content", "prompt"] as const) {
        const local = { ...result, metadata: { ...result.metadata, [field]: "generated change" } };
        const durable = { ...saved, metadata: { ...saved.metadata, [field]: "user change" } };
        const merged = rebase([durable], local);
        expect(merged.conflicts.some((conflict) => conflict.id === base.id)).toBe(true);
        expect(merged.document.state.projects[0].nodes[0].metadata?.[field]).toBe("user change");
    }
});

test("concurrent deletion stays a conflict, so persistence cannot resurrect the result node", () => {
    expect(rebase([]).conflicts.some((conflict) => conflict.id === base.id)).toBe(true);
});

test("unrelated user edits and newly saved nodes survive completed task recovery", () => {
    const durable = { ...saved, title: "Renamed", position: { x: 450, y: 350 }, metadata: { ...saved.metadata, prompt: "user prompt" } };
    const added = { ...base, id: "new", metadata: {} };
    const merged = rebase([durable, added]);
    expect(merged.conflicts).toHaveLength(0);
    expect(merged.document.state.projects[0].nodes).toHaveLength(2);
    expect(merged.document.state.projects[0].nodes[0]).toMatchObject({ title: "Renamed", position: { x: 450, y: 350 }, metadata: { prompt: "user prompt", status: "success" } });
});

test("unfinished tasks and results without the matching effect retain strict conflict checks", () => {
    for (const metadata of [
        { ...result.metadata, taskStatus: "running" as const },
        { ...result.metadata, generationEffectKeys: [] },
    ]) {
        expect(rebase([saved], { ...result, metadata }).conflicts.length).toBeGreaterThan(0);
    }
});
