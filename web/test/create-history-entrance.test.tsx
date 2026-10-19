import { expect, test } from "bun:test";
import { Window } from "happy-dom";
import postcss from "postcss";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

test("重新挂载历史会话时，失败提示随消息列表直接展示，不执行淡入位移动画", async () => {
    const dom = new Window();
    try {
        const css = postcss.parse(await Bun.file(new URL("../src/styles/globals.css", import.meta.url)).text());
        // happy-dom 尚不计算 @layer；展开容器以检查真实选择器和动画声明。
        css.walkAtRules("layer", (rule) => {
            if (rule.nodes) rule.replaceWith(...rule.nodes);
        });
        const style = dom.document.createElement("style");
        style.textContent = css.toString();
        dom.document.head.append(style);
        const failed: CreationMessage = {
            id: "task-failed",
            role: "assistant",
            mode: "image",
            content: "生成失败",
            status: "error",
            error: "模型服务拒绝了请求，请检查模型和参数",
            agentRunId: "restored-run",
            taskIds: ["failed"],
            createdAt: "2026-10-17T00:00:00Z",
        };
        const html = renderToStaticMarkup(
            <CreationMessageView
                item={{ ...failed, id: "restored-run:assistant", mode: "agent", content: "" }}
                agentTasks={[failed]}
                shotNumber={0}
                onRetryFailure={() => {}}
                onCreateVariant={() => {}}
                onEditUserMessage={() => {}}
                onContinueCanvas={() => {}}
                openingCanvas={false}
            />,
        );
        for (const dark of [false, true]) {
            dom.document.documentElement.classList.toggle("dark", dark);
            dom.document.body.innerHTML = `<div class="app-user-workspace app-product-workspace"><div class="creation-home"><main class="creation-thread-scroll"><section class="creation-thread-stage"><div class="creation-results">${html}</div></section></main></div></div>`;
            const results = dom.document.querySelector(".creation-results")!;
            const error = results.querySelector(".creation-message-error")!;
            expect(error.textContent).toContain("模型服务拒绝了请求，请检查模型和参数");
            expect(error.textContent).toContain("重试失败项");
            expect(["", "none"]).toContain(dom.getComputedStyle(results).animation);
            expect(["", "none"]).toContain(dom.getComputedStyle(error).animation);
            expect(["", "none"]).toContain(dom.getComputedStyle(results).transform);
        }
    } finally {
        dom.happyDOM.abort();
    }
});
