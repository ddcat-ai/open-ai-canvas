import { describe, expect, it } from "bun:test";

import { agentApprovalPresentation } from "@/lib/canvas/agent-approval-presentation";

describe("Agent approval presentation", () => {
    const args = JSON.stringify({ snapshotHash: "private-hash", ops: [
        { type: "add_node", id: "image-node", nodeType: "image", title: "开场分镜", content: "private script" },
        { type: "update_node", id: "video-node-1789310237935", patch: { title: "结尾台词", content: "private dialogue" } },
    ] });

    it("prefers the server-authored preview and exposes the target and changed fields", () => {
        const view = agentApprovalPresentation({
            call: { function: { name: "canvas_apply_ops", arguments: args } },
            preview: {
                kind: "canvas_mutation",
                title: "确认画布修改",
                description: "请确认目标节点和修改字段；批准后才会写入画布。",
                items: [{ operation: "update_node", nodeId: "video-node-1789310237935", nodeTitle: "满月庆祝视频草稿", nodeType: "video", nodeTypeLabel: "视频", fields: ["节点名称", "下一版提示词"], resultTitle: "满月庆祝视频草稿（舒缓呼吸感）", summary: "修改视频《满月庆祝视频草稿》的节点名称、下一版提示词" }],
            },
        });
        expect(view.source).toBe("server");
        expect(view.items[0]).toMatchObject({ nodeTitle: "满月庆祝视频草稿", nodeTypeLabel: "视频", fields: ["节点名称", "下一版提示词"] });
        expect(view.items[0].summary).toContain("满月庆祝视频草稿");
        expect(JSON.stringify(view)).not.toContain("private");
    });

    it("summarizes a legacy persisted approval without exposing content or tool names", () => {
        const view = agentApprovalPresentation({ call: { function: { name: "canvas_apply_ops", arguments: args } } });
        expect(view.title).toBe("确认画布修改");
        expect(view.description).toContain("新增 1 个节点，修改 1 个节点");
        expect(view.items.map((item) => item.summary).join(" ")).toContain("目标节点");
        expect(view.items.find((item) => item.operation === "update_node")?.fields).toEqual(["节点名称", "正文"]);
        expect(JSON.stringify(view)).not.toContain("private");
        expect(JSON.stringify(view)).not.toContain("canvas_apply_ops");
        expect(JSON.stringify(view)).not.toContain("video-node-1789310237935");
    });

    it("shows both endpoints for legacy reference connections", () => {
        const view = agentApprovalPresentation({ toolName: "canvas_apply_ops", arguments: { ops: [
            { type: "connect_nodes", fromNodeId: "reference-image-node", toNodeId: "video-node" },
        ] } });
        expect(view.items[0].summary).toContain("来源");
        expect(view.items[0].summary).toContain("目标");
        expect(view.description).toContain("建立 1 条引用连线");
    });

    it("summarizes an event approval and media request", () => {
        expect(agentApprovalPresentation({ toolName: "generate_media", arguments: { mode: "video" } }).title).toBe("确认生成视频");
    });

    it("uses an explicit safe state when arguments are malformed", () => {
        const view = agentApprovalPresentation({ toolName: "canvas_apply_ops", arguments: "{" });
        expect(view.description).toContain("无法确认具体修改目标");
        expect(view.description).not.toContain("修改当前画布");
    });

    it("shows approved media specifications and references without exposing prompts or IDs", () => {
        const view = agentApprovalPresentation({ toolName: "generate_media", arguments: {
            mode: "video", title: "镜头1", durationSeconds: 12, size: "9:16", quality: "720p",
            videoGenerateAudio: false, referenceNodeIds: ["private-cat", "private-hero"], prompt: "private prompt",
        } });
        expect(view.description).toContain("结果自动回写画布");
        expect(view.items[0].details).toEqual(["引用 2 个画布资产，并建立连线", "时长：12 秒", "画幅：9:16", "质量：720p", "音频：关闭"]);
        expect(JSON.stringify(view)).not.toContain("private");
    });

    it("keeps an arrange_nodes preview item instead of dropping it as an unknown operation", () => {
        // 未知 operation 会被 operation() 判成 null 并丢掉整条预览项，因此新增的
        // arrange_nodes 必须同时进联合类型与判据，否则审批卡只剩"生成"这个兜底标签。
        const view = agentApprovalPresentation({ preview: {
            kind: "canvas_mutation",
            title: "确认整理画布",
            description: "请确认要整理的节点。",
            items: [{ operation: "arrange_nodes", nodeId: "text-1", nodeTitle: "开场分镜", nodeTypeLabel: "文本", summary: "整理《开场分镜》" }],
        } });
        expect(view.items).toHaveLength(1);
        expect(view.items[0].operation).toBe("arrange_nodes");
        expect(view.items[0].nodeTitle).toBe("开场分镜");
    });

    it("states when an unknown approval cannot identify a target", () => {
        const view = agentApprovalPresentation({ toolName: "unknown_tool", arguments: {} });
        expect(view.items).toHaveLength(0);
        expect(view.description).toContain("无法识别");
    });
});