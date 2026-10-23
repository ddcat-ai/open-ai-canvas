import { describe, expect, test } from "bun:test";
import { canvasCloudAgentConversation, cloudAgentFollowDecision } from "@/lib/canvas/cloud-agent-follow";
import type { AgentRun } from "@/services/api/agent";
import type { CloudAgentConversation } from "@/services/cloud-agent-conversations";

const run = (id: string, canvasId = "canvas", status: AgentRun["status"] = "completed"): AgentRun => ({
    id,
    canvasId,
    conversationId: "session",
    status,
    permissionMode: "request_approval",
    createdAt: "2026-10-23T00:00:00Z",
    updatedAt: "2026-10-23T00:00:00Z",
});
const conversation = (id: string, latest: AgentRun | null = null): CloudAgentConversation => ({
    id,
    serverConversationId: latest?.conversationId,
    run: latest,
    title: id,
    messages: [],
    permissionMode: "request_approval",
    createdAt: "2026-10-23T00:00:00Z",
    updatedAt: "2026-10-23T00:00:00Z",
});
const decision = (current: CloudAgentConversation, candidate: CloudAgentConversation, blocked = false) => cloudAgentFollowDecision({ current, candidate, canvasId: "canvas", blocked });

describe("工作区 Agent 多端接续选择", () => {
    test("手机初次打开同画布接入桌面会话，并持续接入其下一轮", () => {
        const desktop = conversation("desktop", run("first", "canvas", "running"));
        expect(decision(conversation("mobile-local"), desktop)).toBe("switch");
        const mobile = { ...desktop, id: "mobile-local", run: run("first") };
        const next = { ...desktop, run: run("second", "canvas", "running") };
        expect(decision(mobile, next)).toBe("current");
        expect(decision({ ...mobile, run: run("second") }, { ...next, run: run("third") })).toBe("current");
    });

    test("未提交草稿、未知提交和本机写请求不能被另一会话覆盖", () => {
        const candidate = conversation("cloud", run("remote"));
        expect(decision({ ...conversation("local"), draft: "尚未发送" }, candidate)).toBe("offer");
        expect(decision(conversation("local"), candidate, true)).toBe("offer");
        expect(decision(conversation("local", run("old")), candidate, true)).toBe("none");
        expect(decision({ ...conversation("local", run("old")), draft: "下一轮草稿" }, candidate)).toBe("current");
    });

    test("切页面不抢走其他画布进行中的运行，也不强制换掉通用对话", () => {
        const candidate = conversation("canvas-thread", run("canvas-run"));
        candidate.serverConversationId = "canvas-session";
        expect(decision(conversation("original", run("other-run", "other-canvas", "running")), candidate)).toBe("offer");
        expect(decision(conversation("original", run("other-run", "other-canvas")), candidate)).toBe("offer");
    });

    test("明确新建或手选历史后只跟随同一 session，刷新也不会跳回别的会话", () => {
        const candidate = conversation("cloud", { ...run("newer"), conversationId: "other-session" });
        const fresh = { ...conversation("local"), localNewCanvasId: "canvas" };
        expect(decision(fresh, candidate)).toBe("offer");
        const chosen = { ...conversation("chosen", run("old")), localSelectedCanvasId: "canvas" };
        expect(decision(chosen, candidate)).toBe("offer");
        expect(decision(chosen, conversation("same-session-new-local-id", run("child")))).toBe("current");
    });

    test("优先选择实际占用画布的 session，并识别在其他页面接续过的同一对话", () => {
        const older = conversation("older", { ...run("older"), conversationId: "older-session" });
        const active = conversation("writer", { ...run("writer", "canvas", "running"), conversationId: "writer-session" });
        const nextPage = conversation("cross-page", run("later", "other-canvas"));
        nextPage.runs = [run("first-in-canvas"), nextPage.run!];
        expect(canvasCloudAgentConversation([older, active, nextPage], "canvas", "writer")?.id).toBe("writer");
        expect(canvasCloudAgentConversation([nextPage], "canvas")?.id).toBe("cross-page");
        expect(canvasCloudAgentConversation([nextPage], "unrelated")).toBeUndefined();
    });
});
