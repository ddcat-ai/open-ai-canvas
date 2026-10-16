import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { changeAgentPanelLayout, clampAgentPanelLayout, defaultAgentPanelLayout, restoreAgentPanelLayout } from "@/lib/canvas/agent-panel-layout";
import { agentErrorPresentation, agentSubmissionErrorTitle } from "@/lib/canvas/agent-error-presentation";
import { ApiError } from "@/services/api/request";

const viewport = { width: 1280, height: 800 };
const start = { left: 816, top: 68, width: 448, height: 720 };

describe("Agent window layout", () => {
    it("restores the saved size and position", () => {
        expect(restoreAgentPanelLayout(JSON.stringify(start), viewport)).toEqual(start);
    });
    it("starts within the visible viewport instead of an invisible 840px height", () => {
        const layout = restoreAgentPanelLayout(null, { width: 1024, height: 650 });
        expect(layout.height).toBe(626);
        expect(layout.top).toBe(12);
    });
    it("offers a compact reset without altering a saved window until requested", () => {
        expect(restoreAgentPanelLayout(JSON.stringify(start), viewport)).toEqual(start);
        expect(defaultAgentPanelLayout(viewport)).toEqual({ left: 848, top: 148, width: 420, height: 640 });
    });
    it("keeps the bottom/right anchor when resizing from top/left", () => {
        const layout = changeAgentPanelLayout(start, "northwest", -120, 60, viewport);
        expect(layout).toEqual({ left: 696, top: 128, width: 568, height: 660 });
        expect(layout.left + layout.width).toBe(start.left + start.width);
        expect(layout.top + layout.height).toBe(start.top + start.height);
    });
    it("resizes one axis at a time on an edge", () => {
        expect(changeAgentPanelLayout(start, "west", -60, 150, viewport)).toEqual({ ...start, left: 756, width: 508 });
        expect(changeAgentPanelLayout(start, "north", -60, 150, viewport)).toEqual({ ...start, top: 218, height: 570 });
    });
    it("limits resize to viewport and minimum readable size", () => {
        expect(changeAgentPanelLayout(start, "northwest", -10000, -10000, viewport)).toEqual({ left: 12, top: 12, width: 1252, height: 776 });
        const small = changeAgentPanelLayout(start, "northwest", 10000, 10000, viewport);
        expect(small.width).toBe(360);
        expect(small.height).toBe(420);
    });
    it("keeps the title bar reachable when dragging beyond the screen", () => {
        expect(changeAgentPanelLayout(start, "move", -10000, -10000, viewport)).toEqual({ ...start, left: 12, top: 12 });
        expect(changeAgentPanelLayout(start, "move", 10000, 10000, viewport)).toEqual({ ...start, left: 820, top: 68 });
    });
    it("clamps stale preferences after changing display size", () => {
        const layout = clampAgentPanelLayout(start, { width: 320, height: 300 });
        expect(layout).toEqual({ width: 296, height: 276, left: 12, top: 12 });
    });
    it("discards malformed, partial and nonnumeric stored preferences", () => {
        for (const raw of ["invalid json", "null", "{}", '{"width":"448"}', '{"left":12,"top":12,"width":1e999,"height":720}']) {
            expect(restoreAgentPanelLayout(raw, viewport)).toEqual(restoreAgentPanelLayout(null, viewport));
        }
    });
});

describe("Agent capability rejection details", () => {
    it.each(["同步音频", "水印设置", "视频时长", "输出分辨率"])("shows the specific rejected %s option", (field) => {
        const message = `参数 ${field}超出支持范围`;
        const error = new ApiError("所选模型不支持当前请求", { status: 400, reason: "model_capability_not_supported", details: { message, request: { apiKey: "private-key" }, field } });
        expect(agentErrorPresentation(error, "审批未确认，请重试")).toEqual({ title: "审批未确认，请重试", text: message });
    });
    it("ignores malformed or unrelated details and preserves the ordinary public message", () => {
        for (const message of [undefined, {}, " "]) {
            expect(agentErrorPresentation(new ApiError("所选模型不支持当前请求", { reason: "model_capability_not_supported", details: { message } })).text).toBe("所选模型不支持当前请求");
        }
        expect(agentErrorPresentation(new ApiError("积分不足", { reason: "insufficient_credits", details: { message: "private detail" } })).text).toBe("积分不足");
    });
});

describe("Agent submission sync preflight contract", () => {
    it("scopes submit and approval saves to the active canvas before Agent POST", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-cloud-agent-panel.tsx"), "utf8");
        expect(source).toContain("await saveRemoteUserDataNow(canvasId);");
        expect(source).toContain('if (decision === "approve") await saveRemoteUserDataNow(canvasId);');
        expect(source).toContain("requestSent = true;\n            const result = submission.parentRunId ? await sendAgentMessage");
        expect(source).toContain("agentSubmissionErrorTitle(cause, accepted, requestSent)");
    });

    it("reports a sync failure as unsent while keeping POST ambiguity idempotent", () => {
        expect(agentSubmissionErrorTitle(new Error("canvas sync failed"), false, false)).toBe("画布同步未完成，Agent 请求尚未发送");
        expect(agentSubmissionErrorTitle(new TypeError("network failed"), false, true)).toBe("未收到服务端确认；重试将核对原请求，不重复创建");
    });

    it("syncs project assets without syncing any canvas", () => {
        const source = readFileSync(resolve(import.meta.dir, "../src/services/project-asset-sync.ts"), "utf8");
        expect(source).toContain("await saveRemoteUserDataNow([]);");
        expect(source).not.toContain("await saveRemoteUserDataNow();");
    });
});

describe("Agent error semantics", () => {
    it("uses HTTP status rather than matching error wording", () => {
        expect(agentErrorPresentation(new ApiError("Not found", { status: 404 })).title).toBe("Agent 接口或资源不存在");
        expect(agentErrorPresentation(new Error("HTTP 404"))).toEqual({ title: "Agent 执行失败", text: "HTTP 404" });
    });
    it("does not falsely claim that a disabled model channel is still enabled", () => {
        const result = agentErrorPresentation(new ApiError("系统渠道不存在或已停用", { status: 404 }));
        expect(result.text).toBe("系统渠道不存在或已停用");
        expect(JSON.stringify(result)).not.toContain("没有被停用");
    });
    it("preserves authentication, quota, and model errors", () => {
        for (const status of [401, 403, 429, 500]) {
            expect(agentErrorPresentation(new ApiError("真实业务错误", { status }), "请求失败")).toEqual({ title: "请求失败", text: "真实业务错误" });
        }
    });
    it("reports unimplemented endpoints without retry promises", () => {
        expect(agentErrorPresentation(new ApiError("Not implemented", { status: 501 })).title).toBe("当前 Agent 能力尚未开放");
    });
    it("distinguishes confirmed server failures from missing responses", () => {
        expect(agentSubmissionErrorTitle(new ApiError("系统处理失败", { status: 500 }), false)).toBe("服务端已返回错误；重试将核对原请求，不重复创建");
        expect(agentSubmissionErrorTitle(new ApiError("参数错误", { status: 400 }), false)).toBe("请求已被服务端拒绝");
        expect(agentSubmissionErrorTitle(new TypeError("network failed"), false, false)).toBe("画布同步未完成，Agent 请求尚未发送");
        expect(agentSubmissionErrorTitle(new TypeError("network failed"), false)).toBe("未收到服务端确认；重试将核对原请求，不重复创建");
        expect(agentSubmissionErrorTitle(undefined, true)).toBe("运行已接收，但本地提交记录清理失败");
    });
});
