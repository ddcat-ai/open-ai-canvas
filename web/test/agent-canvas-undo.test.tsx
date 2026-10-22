import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentToolCard, type CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import { applyAgentEvent } from "@/components/canvas/canvas-cloud-agent-events";
import { agentCanvasUndoTarget } from "@/lib/canvas/agent-canvas-undo";
import { canvasThemes } from "@/lib/canvas-theme";
import type { AgentEvent } from "@/services/api/agent";
import type { Dispatch, SetStateAction } from "react";

const canvasHash = "a".repeat(64);

function reduceEvent(messages: CloudAgentChatMessage[], event: AgentEvent) {
    let next = messages;
    const setMessages: Dispatch<SetStateAction<CloudAgentChatMessage[]>> = (action) => {
        next = typeof action === "function" ? action(next) : action;
    };
    const noop = (() => {}) as Dispatch<SetStateAction<never>>;
    applyAgentEvent(event, setMessages, noop, noop);
    return next;
}

const event = (type: string, payload: Record<string, unknown>, seq: number): AgentEvent => ({
    eventId: `event-${seq}`,
    runId: "run-1",
    seq,
    type,
    payload,
    createdAt: new Date(0).toISOString(),
});

test("canvas mutation completion maps callId and full canvas hash into a single operation row", () => {
    let messages: CloudAgentChatMessage[] = [];
    messages = reduceEvent(
        messages,
        event(
            "canvas_updated",
            {
                callId: "call-1",
                canvasId: "canvas-1",
                operation: "canvas_apply_ops",
                actions: [{ action: "updated", nodeId: "node-1", title: "镜头提示词", nodeType: "text" }],
            },
            1,
        ),
    );
    messages = reduceEvent(
        messages,
        event(
            "tool_completed",
            {
                callId: "call-1",
                toolName: "canvas_apply_ops",
                result: { snapshotHash: canvasHash, committed: true },
                text: "画布操作已完成",
            },
            2,
        ),
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].detail).toMatchObject({ eventType: "canvas_updated", completionEventType: "tool_completed", callId: "call-1" });
    expect(agentCanvasUndoTarget(messages[0].detail)).toEqual({ runId: "run-1", canvasId: "canvas-1", stepId: "call-1", expectedSnapshotHash: canvasHash });
});

test("undo target requires successful supported canvas writes and the full-canvas hash", () => {
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_failed", toolName: "canvas_apply_ops", callId: "call-1", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "generate_media", callId: "call-2", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "image_layer_split", callId: "call-3", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "canvas_create_storyboard", callId: "call-4", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "canvas_apply_ops", callId: "call-5", result: { snapshotHash: "not-a-canvas-hash" } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "canvas_apply_ops", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "previs_apply_patch", callId: "call-6", result: { snapshotHash: canvasHash } })).toBeNull();
    expect(agentCanvasUndoTarget({ runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "previs_apply_patch", callId: "call-7", result: { canvasSnapshotHash: canvasHash } })).toEqual({
        runId: "run-1",
        canvasId: "canvas-1",
        stepId: "call-7",
        expectedSnapshotHash: canvasHash,
    });
});

test("server receipts undo structured writes using the originating run and full canvas hash", () => {
    const undo = { runId: "historical-run", canvasId: "canvas-1", stepId: "row-edit", expectedSnapshotHash: canvasHash };
    let messages = reduceEvent([], { ...event("canvas_updated", { callId: "row-edit", canvasId: "canvas-1", operation: "canvas_edit_storyboard", requiresRefresh: true, undo }, 1), runId: "historical-run" });
    expect(agentCanvasUndoTarget(messages[0].detail)).toEqual(undo);
    messages = reduceEvent(messages, { ...event("canvas_undone", { stepId: "row-edit" }, 2), runId: "historical-run" });
    expect(agentCanvasUndoTarget(messages[0].detail)).toBeNull();
    const markup = renderToStaticMarkup(<AgentToolCard title="canvas_edit_storyboard" text="已修改分镜" detail={messages[0].detail} theme={canvasThemes.dark} onUndo={() => {}} />);
    expect(markup).toContain("此步骤已撤销");
});

test("another run reusing a call id cannot mark this mutation undone", () => {
    let messages = reduceEvent([], event("canvas_updated", { callId: "call-1", canvasId: "canvas-1", actions: [], undo: { runId: "run-1", canvasId: "canvas-1", stepId: "call-1", expectedSnapshotHash: canvasHash } }, 1));
    messages = reduceEvent(messages, { ...event("canvas_undone", { stepId: "call-1" }, 2), runId: "other-run" });
    expect(agentCanvasUndoTarget(messages[0].detail)?.runId).toBe("run-1");
    expect(agentCanvasUndoTarget({ eventType: "tool_completed", toolName: "canvas_apply_ops", callId: "call-1", result: { snapshotHash: canvasHash } })).toBeNull();
});

test("tool card shows undo loading, success, and error states only for eligible writes", () => {
    const detail = { runId: "run-1", canvasId: "canvas-1", eventType: "tool_completed", toolName: "canvas_apply_ops", callId: "call-1", result: { snapshotHash: canvasHash } };
    const pending = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={detail} theme={canvasThemes.dark} onUndo={() => {}} undoStates={{ "run-1:call-1": { status: "pending" } }} />);
    expect(pending).toContain('aria-label="撤销本次画布写入"');
    expect(pending).toContain("撤销中");
    expect(pending).toContain('disabled=""');

    const done = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={detail} theme={canvasThemes.dark} onUndo={() => {}} undoStates={{ "run-1:call-1": { status: "done" } }} />);
    expect(done).toContain("已撤销");
    expect(done).not.toContain('aria-label="撤销本次画布写入"');

    const failed = renderToStaticMarkup(<AgentToolCard title="canvas_apply_ops" text="画布操作已完成" detail={detail} theme={canvasThemes.dark} onUndo={() => {}} undoStates={{ "run-1:call-1": { status: "error", error: "画布已发生后续变化" } }} />);
    expect(failed).toContain('role="alert"');
    expect(failed).toContain("画布已发生后续变化");
    expect(failed).toContain("重新撤销");

    const media = renderToStaticMarkup(<AgentToolCard title="generate_media" text="生成任务已提交" detail={{ ...detail, toolName: "generate_media" }} theme={canvasThemes.dark} onUndo={() => {}} />);
    expect(media).not.toContain('aria-label="撤销本次画布写入"');
});
