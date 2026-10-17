import { expect, test } from "bun:test";
import { discardRejectedCanvasText } from "../src/lib/canvas/discard-text-draft";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";
import { CanvasNodeType } from "../src/types/canvas";

function fixture() {
    const baseline: CanvasProject = {
        id: "canvas",
        title: "canvas",
        revision: 1,
        createdAt: "2026-10-17",
        updatedAt: "2026-10-17",
        nodes: [
            { id: "text", type: CanvasNodeType.Text, title: "title", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "base", prompt: "base prompt", composerContent: "base composer", richText: "base rich" } },
            { id: "video", type: CanvasNodeType.Video, title: "video", position: { x: 200, y: 0 }, width: 100, height: 100, metadata: { content: "old media", prompt: "base prompt", taskId: "task", taskStatus: "running" } },
        ],
        connections: [],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "dots",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
        previsScenes: [],
    };
    return { baseline, local: structuredClone(baseline), remote: structuredClone(baseline) };
}

test("cloud-wins text preserves local movement, independent node text and generated results", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].metadata!.content = "rejected paste";
    local.nodes[0].position = { x: 50, y: 70 };
    local.nodes[1].metadata!.prompt = "independent video edit";
    remote.nodes[0].metadata = { content: "winner" };
    remote.nodes[1].metadata!.content = "new media";
    remote.nodes[1].metadata!.taskStatus = "succeeded";
    const result = discardRejectedCanvasText(baseline, remote, local, ["text"])!;
    expect(result.discarded).toEqual(["text"]);
    expect(result.project.nodes[0].metadata).toEqual({ content: "winner" });
    expect(result.project.nodes[0].position).toEqual({ x: 50, y: 70 });
    expect(result.project.nodes[1].metadata).toEqual({ content: "new media", prompt: "independent video edit", taskId: "task", taskStatus: "succeeded" });
    expect(local.nodes[0].metadata!.content).toBe("rejected paste");
    expect(baseline.nodes[0].metadata!.content).toBe("base");
});

test("multiple rejected nodes reconcile together, including nested prompts but not video content", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].title = "local title";
    remote.nodes[0].title = "cloud title";
    local.nodes[1].metadata!.prompt = "local prompt";
    remote.nodes[1].metadata!.prompt = "cloud prompt";
    local.nodes[1].metadata!.content = "local generated result";
    const result = discardRejectedCanvasText(baseline, remote, local, [], true)!;
    expect(result.discarded).toEqual(["text", "video"]);
    expect(result.project.nodes[0].title).toBe("cloud title");
    expect(result.project.nodes[1].metadata!.prompt).toBe("cloud prompt");
    expect(result.project.nodes[1].metadata!.content).toBe("local generated result");
});

test("same-position conflicts remain errors instead of silently discarding movement", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].metadata!.content = "local text";
    local.nodes[0].position.x = 20;
    remote.nodes[0].position.x = 30;
    expect(() => discardRejectedCanvasText(baseline, remote, local, ["text"])).toThrow();
});

test("cloud deletion and node type changes are not resurrected or replaced by text recovery", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].metadata!.content = "local text";
    remote.nodes = remote.nodes.filter((node) => node.id !== "text");
    expect(discardRejectedCanvasText(baseline, remote, local, ["text"])).toBeUndefined();
    remote.nodes = structuredClone(baseline.nodes);
    remote.nodes[0].type = CanvasNodeType.Video;
    expect(discardRejectedCanvasText(baseline, remote, local, ["text"])).toBeUndefined();
});

test("non-conflicting local text is not discarded just because remote changed another field", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].metadata!.content = "independent local text";
    remote.nodes[0].position.x = 50;
    expect(discardRejectedCanvasText(baseline, remote, local, [], true)).toBeUndefined();
});

test("new local generated video, its connection and independent cloud additions all survive text recovery", () => {
    const { baseline, local, remote } = fixture();
    local.nodes[0].metadata!.content = "rejected text";
    remote.nodes[0].metadata!.content = "cloud text";
    const generated = { ...structuredClone(local.nodes[1]), id: "new-generated-video", metadata: { content: "resource:finished-video", prompt: "generation prompt", taskId: "finished-task", taskStatus: "succeeded" as const } };
    local.nodes.push(generated);
    const link = { id: "new-link", fromNodeId: "text", toNodeId: generated.id } as CanvasProject["connections"][number];
    local.connections.push(link);
    remote.nodes.push({ ...structuredClone(remote.nodes[0]), id: "other-browser-node" });
    const result = discardRejectedCanvasText(baseline, remote, local, ["text"])!;
    expect(result.project.nodes.find((node) => node.id === generated.id)).toEqual(generated);
    expect(result.project.connections).toContainEqual(link);
    expect(result.project.nodes.some((node) => node.id === "other-browser-node")).toBe(true);
    expect(result.project.nodes.find((node) => node.id === "text")!.metadata!.content).toBe("cloud text");
});
