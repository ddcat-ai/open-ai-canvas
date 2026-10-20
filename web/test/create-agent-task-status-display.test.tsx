import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

let previousWindow: PropertyDescriptor | undefined;
let dom: Window;
beforeEach(() => {
    previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    dom = new Window({ url: "http://localhost/" });
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: dom });
});
afterEach(() => {
    dom.happyDOM.abort();
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

test("Agent 尚在编排时保留真实失败和运行计数，整套不展开子任务报错", () => {
    const at = "2026-10-20T10:00:00Z";
    const common = { role: "assistant" as const, mode: "image" as const, agentRunId: "run", createdAt: at };
    const tasks: CreationMessage[] = [
        { ...common, id: "task-failed", taskIds: ["failed"], content: "主图", status: "error", error: "不应展开的子任务上游详细报错" },
        { ...common, id: "task-running", taskIds: ["running"], content: "场景图", status: "pending" },
    ];
    const markup = renderToStaticMarkup(
        <CreationMessageView
            item={{ id: "run:assistant", role: "assistant", mode: "agent", agentRunId: "run", content: "继续处理剩余任务。", createdAt: at, status: "streaming", agentTextStreaming: false }}
            agentTasks={tasks}
            outputPreference="concise"
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
        />,
    );
    const host = dom.document.createElement("div");
    host.innerHTML = markup;
    const summary = host.querySelector(".creation-agent-output-summary")?.textContent;
    expect(summary).toContain("1 项失败");
    expect(summary).toContain("1 项生成中");
    expect(summary).not.toContain("2 项生成中");
    expect(host.textContent).toContain("1 项媒体任务生成中");
    expect(host.textContent).not.toContain("不应展开的子任务上游详细报错");
});
