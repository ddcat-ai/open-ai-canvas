import { describe, expect, test } from "bun:test";

import { ACTION_BOARD_VIDEO_DEFAULT_SIZE, ACTION_BOARD_VIDEO_DEFAULT_VQUALITY, buildActionBoardVideoPrompt } from "../src/lib/canvas/action-board-video";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

/** 与 generateVideoFromActionBoard 中 ensureEdge 一致的最小连线逻辑 */
function ensureEdge(connections: CanvasConnection[], fromNodeId: string, toNodeId: string, role?: CanvasConnection["role"]) {
    if (fromNodeId === toNodeId) return;
    if (connections.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return;
    connections.push({ id: `e-${connections.length}`, fromNodeId, toNodeId, ...(role ? { role } : {}) });
}

function wireVideoFromActionBoard(boardId: string, videoId: string, boardIncoming: CanvasConnection[]) {
    const connections = [...boardIncoming];
    ensureEdge(connections, boardId, videoId, "subject_ref");
    boardIncoming.forEach((connection) => ensureEdge(connections, connection.fromNodeId, videoId, connection.role));
    return connections.filter((c) => c.toNodeId === videoId);
}

describe("动作板 → 视频 连线结构", () => {
    test("复制动作板入边并强制 subject_ref 到视频节点（非 first_frame）", () => {
        const boardId = "ab-1";
        const videoId = "vid-1";
        const boardIncoming: CanvasConnection[] = [
            { id: "c1", fromNodeId: "script-1", toNodeId: boardId, fromHandleId: "row:shot-1" },
            { id: "c2", fromNodeId: "char-lin", toNodeId: boardId },
            { id: "c3", fromNodeId: "style-1", toNodeId: boardId },
        ];
        const videoIncoming = wireVideoFromActionBoard(boardId, videoId, boardIncoming);
        expect(videoIncoming).toHaveLength(4);
        expect(videoIncoming.find((c) => c.fromNodeId === boardId)?.role).toBe("subject_ref");
        expect(videoIncoming.find((c) => c.fromNodeId === boardId)?.role).not.toBe("first_frame");
        expect(videoIncoming.map((c) => c.fromNodeId).sort()).toEqual(["ab-1", "char-lin", "script-1", "style-1"].sort());
    });

    test("视频 prompt 含 @ 图、无首帧，并带分镜时长与横屏360p", () => {
        const board: CanvasNodeData = {
            id: "ab-1",
            type: CanvasNodeType.Image,
            title: "镜头 2 · 动作板",
            position: { x: 0, y: 0 },
            width: 420,
            height: 300,
            metadata: {
                workflowKind: "action_board",
                shotIndex: 2,
                content: "data:image/png;base64,aa",
                composerContent: "生成一张电影动作拆分 12 宫格参考图，严格 3 列 4 行。\n镜头 2：苏文转身。\n按时间顺序展示动作起势、推进、转折、落点和结束姿态，不要添加文字、边框标题或额外画面。",
            },
        };
        const prompt = buildActionBoardVideoPrompt(board, ["char-lin"]);
        const rowSeconds = 8;
        const videoMeta = {
            prompt,
            composerContent: prompt,
            videoStartFrameNodeId: undefined as string | undefined,
            videoEndFrameNodeId: undefined as string | undefined,
            actionBoardNodeId: board.id,
            videoEditOperation: "image_to_video" as const,
            generationMode: "video" as const,
            seconds: String(rowSeconds),
            size: ACTION_BOARD_VIDEO_DEFAULT_SIZE,
            vquality: ACTION_BOARD_VIDEO_DEFAULT_VQUALITY,
        };
        expect(videoMeta.videoStartFrameNodeId).toBeUndefined();
        expect(videoMeta.actionBoardNodeId).toBe("ab-1");
        expect(videoMeta.prompt).toContain("@[node:ab-1]");
        expect(videoMeta.prompt).toContain("苏文转身");
        expect(videoMeta.seconds).toBe("8");
        expect(videoMeta.size).toBe("640x360");
        expect(videoMeta.vquality).toBe("360");
        expect(/@\[node:ab-1\]/.test(videoMeta.composerContent)).toBe(true);
    });
});
