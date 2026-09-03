import { describe, expect, it } from "bun:test";

import { buildCanvasAgentContext } from "@/lib/canvas/canvas-agent-context";
import type { CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { readCanvasAgentAutoMediaPreference } from "@/stores/canvas/use-canvas-agent-store";
import { runCanvasAgentGenerationOps } from "@/pages/canvas/use-canvas-agent-operations";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

function memoryStore(initial: Record<string, string> = {}) {
    const data = new Map(Object.entries(initial));
    return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value) };
}

const snapshot: CanvasAgentSnapshot = {
    projectId: "c1",
    title: "t",
    nodes: [{ id: "img", type: CanvasNodeType.Image, title: "图", position: { x: 0, y: 0 }, width: 240, height: 240, metadata: { composerContent: "猫" } }],
    connections: [],
    selectedNodeIds: [],
    viewport: { x: 0, y: 0, k: 1 },
};

describe("媒体自动生成偏好", () => {
    it("默认开启；显式关闭记为 false；损坏值回退为开启", () => {
        expect(readCanvasAgentAutoMediaPreference(memoryStore())).toBe(true);
        expect(readCanvasAgentAutoMediaPreference(memoryStore({ "canvas-agent-auto-generate-media": "false" }))).toBe(false);
        expect(readCanvasAgentAutoMediaPreference(memoryStore({ "canvas-agent-auto-generate-media": "true" }))).toBe(true);
        expect(readCanvasAgentAutoMediaPreference(memoryStore({ "canvas-agent-auto-generate-media": "garbage" }))).toBe(true);
    });
});

describe("上下文反映开关状态", () => {
    it("关闭时 canvas.autoGenerateMedia=false 且给出仅建节点告警", () => {
        const off = buildCanvasAgentContext(snapshot, { autoGenerateMedia: false });
        expect(off.canvas.autoGenerateMedia).toBe(false);
        expect(off.warnings.some((w) => w.includes("仅建节点") || w.includes("不产生生成费用"))).toBe(true);
    });

    it("开启/未传时不出现仅建节点告警，且默认不强制写该字段", () => {
        const on = buildCanvasAgentContext(snapshot, { autoGenerateMedia: true });
        expect(on.canvas.autoGenerateMedia).toBe(true);
        expect(on.warnings.some((w) => w.includes("仅建节点"))).toBe(false);
        const def = buildCanvasAgentContext(snapshot);
        expect("autoGenerateMedia" in def.canvas).toBe(false);
    });
});

describe("关闭自动生成时提交层只建节点", () => {
    it("autoGenerateMedia=false 不调用 generate，全部记为 auto-media-off", async () => {
        const node = { id: "img", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, title: "图", metadata: { generationMode: "image", composerContent: "猫" } } as unknown as CanvasNodeData;
        let called = 0;
        const result = await runCanvasAgentGenerationOps({
            generationOps: [{ type: "run_generation", nodeId: "img" }],
            nodes: [node],
            autoGenerateMedia: false,
            generate: async () => {
                called += 1;
            },
            subscribeTasks: (() => () => undefined) as never,
        });
        expect(called).toBe(0);
        expect(result.submittedNodeIds).toEqual([]);
        expect(result.skipped[0]).toEqual({ nodeId: "img", reason: "auto-media-off" });
    });

    it("autoGenerateMedia=true（默认）保持既有提交行为", async () => {
        const node = { id: "img", type: CanvasNodeType.Image, position: { x: 0, y: 0 }, title: "图", metadata: { generationMode: "image", composerContent: "猫" } } as unknown as CanvasNodeData;
        const called: string[] = [];
        await runCanvasAgentGenerationOps({
            generationOps: [{ type: "run_generation", nodeId: "img" }],
            nodes: [node],
            autoGenerateMedia: true,
            generate: async (nodeId) => {
                called.push(nodeId);
            },
            subscribeTasks: (() => () => undefined) as never,
        });
        expect(called).toEqual(["img"]);
    });
});
