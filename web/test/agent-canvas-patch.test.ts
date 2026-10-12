import { expect, test } from "bun:test";
import { applyAgentCanvasPatch, mergeAgentCanvasEditor, type AgentCanvasPatch } from "@/lib/canvas/agent-canvas-patch";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

const node: CanvasNodeData = { id: "video-1", title: "满月动画", type: CanvasNodeType.Video, position: { x: 10, y: 20 }, width: 320, height: 180, metadata: { status: "loading", taskId: "task-1", taskStatus: "running", prompt: "原始提示词" } };
const project: CanvasProject = { id: "canvas", title: "画布", nodes: [node], connections: [], chatSessions: [], activeChatId: null, viewport: { x: 12, y: 24, k: 1 }, createdAt: "2026-09-13", updatedAt: "2026-09-13" };
const failed: CanvasNodeData = { ...node, metadata: { ...node.metadata, status: "error", taskStatus: "failed", errorDetails: "上游拒绝" } };
const patch: AgentCanvasPatch = { canvasId: project.id, updatedAt: "2026-09-13T12:00:00Z", nodes: [{ before: node, after: failed }], connections: [] };

test("failed Agent task patches only its node and unlocks generation", () => {
    expect(isCanvasNodeGenerating(node)).toBe(true);
    const result = applyAgentCanvasPatch(project, patch);
    expect(result.nodes[0]).toEqual(failed);
    expect(isCanvasNodeGenerating(result.nodes[0])).toBe(false);
    expect(result.viewport).toBe(project.viewport);
    expect(result.connections).toBe(project.connections);
    expect(project.nodes[0].metadata?.status).toBe("loading");
});

test("unrelated local edits and editor-only dragging survive completion", () => {
    const local = { ...node, position: { x: 800, y: 400 }, metadata: { ...node.metadata, prompt: "正在编辑的新提示词" } };
    const merged = mergeAgentCanvasEditor(project, applyAgentCanvasPatch(project, patch), [local], []);
    expect(merged.nodes[0].position).toEqual(local.position);
    expect(merged.nodes[0].metadata?.prompt).toBe("正在编辑的新提示词");
    expect(merged.nodes[0].metadata?.status).toBe("error");
});

test("replay is idempotent and cannot roll a completed node back to loading", () => {
    const result = applyAgentCanvasPatch(project, patch);
    expect(applyAgentCanvasPatch(result, patch)).toBe(result);
    const old: AgentCanvasPatch = { ...patch, nodes: [{ before: { ...node, metadata: { status: "idle" } }, after: node }] };
    expect(() => applyAgentCanvasPatch(result, old)).toThrow("冲突");
    expect(result.nodes[0].metadata?.status).toBe("error");
});

test("new nodes and reference connections are applied atomically", () => {
    const draft = { ...node, id: "video-2", metadata: { status: "idle" as const } };
    const edge = { id: "edge", fromNodeId: node.id, toNodeId: draft.id };
    const result = applyAgentCanvasPatch(project, { ...patch, nodes: [{ before: null, after: draft }], connections: [{ before: null, after: edge }] });
    expect(result.nodes[0]).toBe(node);
    expect(result.nodes[1]).toEqual(draft);
    expect(result.connections).toEqual([edge]);
});

test("Agent refresh applies server reference order when local connections were untouched", () => {
    const imageOne = { id: "image-one", fromNodeId: "image-one", toNodeId: node.id };
    const imageTwo = { id: "image-two", fromNodeId: "image-two", toNodeId: node.id };
    const characterOne = { id: "character-one", fromNodeId: "character-one", toNodeId: node.id };
    const characterTwo = { id: "character-two", fromNodeId: "character-two", toNodeId: node.id };
    const previous = { ...project, connections: [characterOne, characterTwo, imageOne, imageTwo] };
    const incoming = { ...previous, revision: 2, connections: [imageOne, imageTwo, characterOne, characterTwo] };
    const merged = mergeAgentCanvasEditor(previous, incoming, previous.nodes, previous.connections, previous);

    expect(merged.connections.map((connection) => connection.id)).toEqual(["image-one", "image-two", "character-one", "character-two"]);
});

test("Agent refresh preserves moving the first reference to the fifth position locally", () => {
    const roleOne = { id: "role-one", fromNodeId: "role-one", toNodeId: node.id };
    const imageTwo = { id: "image-two", fromNodeId: "image-two", toNodeId: node.id };
    const roleThree = { id: "role-three", fromNodeId: "role-three", toNodeId: node.id };
    const imageFour = { id: "image-four", fromNodeId: "image-four", toNodeId: node.id };
    const imageFive = { id: "image-five", fromNodeId: "image-five", toNodeId: node.id };
    const previous = { ...project, connections: [roleOne, imageTwo, roleThree, imageFour, imageFive] };
    const incoming = { ...previous, revision: 2, connections: [imageFive, roleOne, imageTwo, roleThree, imageFour] };
    const local = { ...previous, connections: [imageTwo, roleThree, imageFour, imageFive, roleOne] };
    const merged = mergeAgentCanvasEditor(previous, incoming, local.nodes, local.connections, local);

    expect(merged.connections.map((connection) => connection.id)).toEqual(["image-two", "role-three", "image-four", "image-five", "role-one"]);
});

test("deleted nodes and a newer task binding are not overwritten", () => {
    expect(() => applyAgentCanvasPatch({ ...project, nodes: [] }, patch)).toThrow("冲突");
    // A replacement task can have the same running status; its task identity is a fence.
    const replacement = { ...node, metadata: { ...node.metadata, taskId: "task-2" } };
    expect(() => applyAgentCanvasPatch({ ...project, nodes: [replacement] }, patch)).toThrow();
});

test("task state covers Agent, manual submissions and historical terminal tasks", () => {
    for (const status of ["queued", "running"]) expect(isCanvasNodeGenerating({ ...node, metadata: { status: "idle", taskId: "task", taskStatus: status } })).toBe(true);
    for (const status of ["succeeded", "failed", "cancelled"]) expect(isCanvasNodeGenerating({ ...node, metadata: { status: "loading", taskId: "old", taskStatus: status } })).toBe(false);
    expect(isCanvasNodeGenerating({ ...node, metadata: { status: "loading" } })).toBe(true);
    expect(isCanvasNodeGenerating({ ...node, metadata: { status: "success", taskId: "historical" } })).toBe(false);
    expect(isCanvasNodeGenerating({ ...node, metadata: { status: "idle" } }, node.id)).toBe(true);
});


test("task progress ahead of the server checkpoint still accepts terminal state", () => {
    const queued = { ...node, metadata: { ...node.metadata, taskStatus: "queued", taskProgress: 0 } };
    const running = { ...node, metadata: { ...node.metadata, taskProgress: 67 } };
    const result = applyAgentCanvasPatch({ ...project, nodes: [running] }, { ...patch, nodes: [{ before: queued, after: failed }] });
    expect(result.nodes[0].metadata?.taskStatus).toBe("failed");
    expect(isCanvasNodeGenerating(result.nodes[0])).toBe(false);
});

test("full Previs refresh merges scene bookkeeping and preserves the local viewport", () => {
    const scene = {
        id: "scene-1",
        version: 1 as const,
        title: "镜头",
        background: "#111111",
        environmentIntensity: 0.7,
        environment: { mode: "color" as const },
        gridVisible: true,
        objects: [],
        cameras: [],
        lights: [],
        shots: [],
        activeShotId: "shot-1",
        createdAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z",
    };
    const previous = { ...project, previsScenes: [scene] };
    const incoming = {
        ...previous,
        revision: 2,
        updatedAt: "2026-09-13T12:00:00Z",
        previsScenes: [{ ...scene, updatedAt: "2026-09-13T12:00:00Z", objects: [{ id: "actor-1", name: "Agent 演员" }] }],
    };
    const local = {
        ...previous,
        viewport: { x: -480, y: -220, k: 0.72 },
        previsScenes: [{ ...scene, updatedAt: "2026-09-13T11:59:00Z" }],
    };
    const merged = mergeAgentCanvasEditor(previous, incoming, local.nodes, local.connections, local);
    expect(merged.previsScenes[0].objects).toEqual(incoming.previsScenes[0].objects);
    expect(merged.previsScenes[0].updatedAt).toBe(incoming.previsScenes[0].updatedAt);
    expect(merged.viewport).toEqual(local.viewport);
});

test("full Previs refresh still rejects a same-field scene edit", () => {
    const scene = {
        id: "scene-1",
        version: 1 as const,
        title: "镜头",
        background: "#111111",
        environmentIntensity: 0.7,
        environment: { mode: "color" as const },
        gridVisible: true,
        objects: [],
        cameras: [],
        lights: [],
        shots: [],
        activeShotId: "shot-1",
        createdAt: "2026-09-13T00:00:00Z",
        updatedAt: "2026-09-13T00:00:00Z",
    };
    const previous = { ...project, previsScenes: [scene] };
    const incoming = { ...previous, revision: 2, previsScenes: [{ ...scene, title: "云端镜头", updatedAt: "2026-09-13T12:00:00Z" }] };
    const local = { ...previous, previsScenes: [{ ...scene, title: "本地镜头", updatedAt: "2026-09-13T11:59:00Z" }] };
    expect(() => mergeAgentCanvasEditor(previous, incoming, local.nodes, local.connections, local)).toThrow("冲突");
});
