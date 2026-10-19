import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationMessage } from "../src/pages/create/creation-types";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationMessageView } = await import("../src/pages/create/creation-workspace-messages");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("点击唯一重试按钮一次提交全部失败项，处理中禁止重复点击", async () => {
    const at = "2026-10-16T00:00:00Z";
    const parent: CreationMessage = { id: "run:assistant", role: "assistant", mode: "agent", content: "", createdAt: at, status: "error", error: "网络异常", agentRunId: "run" };
    const tasks: CreationMessage[] = ["error", "error", "done", "cancelled"].map((status, index) => ({
        id: `task-${index}`,
        role: "assistant",
        mode: "image",
        content: `图片 ${index + 1}`,
        createdAt: at,
        status: status as CreationMessage["status"],
        taskIds: [`task-${index}`],
        agentRunId: "run",
        ...(status === "done" ? { resultUrls: ["/images/success.png"] } : {}),
    }));
    const calls: string[][] = [];
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
        finish = resolve;
    });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <CreationMessageView
                    item={parent}
                    agentTasks={tasks}
                    shotNumber={0}
                    onRetryFailure={() => {
                        throw new Error("不应重试整轮");
                    }}
                    onRetryAgentTasks={(failed) => {
                        calls.push(failed.flatMap((task) => task.taskIds || []));
                        return pending;
                    }}
                    onCreateVariant={() => {}}
                    onEditUserMessage={() => {}}
                    onContinueCanvas={() => {}}
                    openingCanvas={false}
                />,
            ),
        );
        const buttons = Array.from(host.querySelectorAll("button")).filter((button) => button.textContent === "重试失败项");
        expect(buttons).toHaveLength(1);
        const button = buttons[0];
        await act(async () => button.click());
        expect(calls).toEqual([["task-0", "task-1"]]);
        expect(button.disabled).toBe(true);
        expect(button.getAttribute("aria-busy")).toBe("true");
        await act(async () => button.click());
        expect(calls).toHaveLength(1);
        expect(host.querySelector('img[src="/images/success.png"]')).not.toBeNull();
        await act(async () => finish());
        expect(button.disabled).toBe(false);
    } finally {
        finish();
        await act(async () => root.unmount());
        host.remove();
    }
});

test("缓存失败复核中断后只刷新任务状态，不调用重新生成", async () => {
    const parent: CreationMessage = { id: "run:assistant", role: "assistant", mode: "agent", content: "", status: "done", agentRunId: "run" };
    const pending: CreationMessage = { id: "task-image", role: "assistant", mode: "image", content: "场景图", status: "error", error: "旧超时", taskIds: ["image"], agentRunId: "run", taskStatePending: true };
    let refreshed = 0;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <CreationMessageView
                    item={parent}
                    agentTasks={[pending]}
                    taskSyncFailed
                    onRefreshAgentTasks={() => {
                        refreshed++;
                    }}
                    shotNumber={0}
                    onRetryFailure={() => {
                        throw new Error("不能重新生成");
                    }}
                    onRetryAgentTasks={() => {
                        throw new Error("不能重试未确认失败");
                    }}
                    onCreateVariant={() => {}}
                    onEditUserMessage={() => {}}
                    onContinueCanvas={() => {}}
                    openingCanvas={false}
                />,
            ),
        );
        expect(host.textContent).not.toContain("旧超时");
        expect(host.textContent).not.toContain("正在生成图像");
        const button = Array.from(host.querySelectorAll("button")).find((item) => item.textContent === "刷新状态");
        expect(button).toBeDefined();
        await act(async () => button!.click());
        expect(refreshed).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
