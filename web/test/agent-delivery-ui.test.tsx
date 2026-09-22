import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CanvasAgentDelivery } from "../src/components/canvas/canvas-agent-delivery";
import { canvasThemes } from "../src/lib/canvas-theme";
import type { AgentDelivery, AgentRun } from "../src/services/api/agent";

const noop = () => {};
const run: AgentRun = { id: "run", canvasId: "canvas", status: "completed", permissionMode: "auto", createdAt: "", updatedAt: "" };
const recoverable: AgentDelivery = {
    status: "needs_attention",
    pendingTitles: [],
    items: [{ taskId: "task", kind: "image", status: "restore_available" }],
};

function render(delivery: AgentDelivery, options: { disabled?: boolean; restoring?: string | null; cleanupPending?: boolean } = {}) {
    return renderToStaticMarkup(<CanvasAgentDelivery
        run={{ ...run, delivery, cleanupPending: options.cleanupPending }}
        theme={canvasThemes.dark}
        restoring={options.restoring ?? null}
        disabled={options.disabled}
        onRestore={noop}
        onFocus={noop}
        onContinue={noop}
    />);
}

test("historical failed attempts stay visible without prompting another continuation", () => {
    const html = render({
        status: "has_failures",
        pendingTitles: [],
        items: [
            { taskId: "failed", kind: "image", status: "failed" },
            { taskId: "success", nodeId: "node", kind: "image", status: "delivered" },
        ],
    });
    expect(html).toContain("共 2 次尝试");
    expect(html).toContain("生成未成功");
    expect(html.replace(/\s+/g, "")).toContain("定位");
    expect(html).not.toContain("继续处理剩余项");
    expect(html).not.toContain("待完成：");
});

test("an undone or edited restoration explains how to recover without offering a rejected operation", () => {
    const html = render({
        status: "needs_attention",
        pendingTitles: [],
        items: [{ taskId: "task", kind: "video", status: "restored_then_changed" }],
    });
    expect(html).toContain("恢复后已修改或移除，可从素材库重新添加");
    expect(html).not.toContain("恢复到画布（不收费）");
});

test("recoverable outputs expose an enabled recovery action when idle", () => {
    const html = render(recoverable);
    expect(html).toContain("恢复到画布（不收费）");
    expect(html).not.toContain('disabled=""');
});

test.each([
    { disabled: true },
    { restoring: "another-task" },
])("recovery and continuation controls are disabled during another request: %j", (options) => {
    const html = render(recoverable, options);
    const buttons = html.match(/<button\b[^>]*>/g) ?? [];
    expect(buttons).toHaveLength(2);
    expect(buttons.every((button) => button.includes('disabled=""'))).toBe(true);
});

test("results are hidden while the run is still working", () => {
    expect(render({ ...recoverable, status: "running" })).toBe("");
});
