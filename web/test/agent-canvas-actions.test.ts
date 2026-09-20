import { expect, test } from "bun:test";
import { agentCanvasActions, agentCanvasActionLabel } from "@/lib/canvas/agent-canvas-actions";

test("persisted node actions retain human-readable titles without a live canvas", () => {
    const detail = JSON.parse(JSON.stringify({ actions: [
        { action: "created", nodeId: "video", title: "满月动画", nodeType: "video" },
        { action: "referenced", nodeId: "image", title: "满月照片", nodeType: "image" },
    ] }));
    expect(agentCanvasActions("canvas_apply_ops", detail).map(agentCanvasActionLabel)).toEqual(["创建了视频节点《满月动画》", "引用了图片节点《满月照片》"]);
});

test("server-authored canvas actions explain updated fields, renamed nodes, and both connection endpoints", () => {
    const detail = JSON.parse(JSON.stringify({ actions: [
        {
            action: "updated",
            nodeId: "video",
            title: "旧名",
            nodeType: "video",
            fields: ["节点名称", "下一版提示词"],
            resultTitle: "新名",
        },
        {
            action: "referenced",
            nodeId: "image",
            title: "参考图",
            nodeType: "image",
            targetNodeId: "video",
            targetTitle: "目标视频",
            targetNodeType: "video",
        },
    ] }));
    expect(agentCanvasActions("canvas_apply_ops", detail).map(agentCanvasActionLabel)).toEqual([
        "更新了视频节点《旧名》（修改：节点名称、下一版提示词），名称改为《新名》",
        "建立引用：图片节点《参考图》 → 视频节点《目标视频》",
    ]);
});

test("legacy generation failures retain node name and never claim creation or reference success", () => {
    const detail = { eventType: "tool_failed", arguments: JSON.stringify({ nodeId: "video", title: "满月动画", mode: "video", referenceNodeIds: ["image"] }), result: { phase: "admission", taskSubmitted: false } };
    expect(agentCanvasActions("generate_media", detail).map(agentCanvasActionLabel)).toEqual(["生成未完成：视频节点《满月动画》"]);
});

test("malformed historical arguments do not break the conversation", () => {
    expect(agentCanvasActions("generate_media", { arguments: "{" })).toEqual([]);
});
