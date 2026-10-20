import { afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

// Other DOM suites can initialize Motion's browser detection before restoring
// globals. Give this markup suite its own window when reduced-motion hooks run.
let originalWindow: PropertyDescriptor | undefined;
let dom: Window;
beforeEach(() => {
    originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    dom = new Window({ url: "http://localhost/" });
    Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: dom });
});
afterEach(() => {
    dom.happyDOM.abort();
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
});

const renderMessage = (status: CreationMessage["status"], error?: string) =>
    renderToStaticMarkup(
        <CreationMessageView
            item={{ id: "assistant", role: "assistant", mode: "agent", content: "", createdAt: "2026-10-03T00:00:00Z", status, error }}
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
        />,
    );

test("助手等待首个内容时显示可访问的进行中反馈", () => {
    expect(renderMessage("streaming")).toContain('role="status"');
    expect(renderMessage("streaming")).toContain("正在处理请求");
    expect(renderMessage("streaming")).not.toContain("正在思考");
    expect(renderMessage("streaming")).not.toContain("正在生成");
    expect(renderMessage("pending")).toContain("处理中");
    expect(renderMessage("pending")).not.toContain("生成中");
});

test("结构化提问完整展示在同一回复中，不再显示思考占位", () => {
    const markup = renderToStaticMarkup(
        <CreationMessageView
            item={{
                id: "answer",
                role: "assistant",
                mode: "agent",
                content: "有几点需要先确认：",
                createdAt: "2026-10-03T00:00:00Z",
                status: "done",
                agentQuestion: {
                    kind: "choice",
                    question: "这套配件的真实用途是什么？",
                    options: [
                        { label: "水族接头", detail: "鱼缸管路" },
                        { label: "灌溉接头", detail: "花园管路" },
                    ],
                    allowFreeform: true,
                },
            }}
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
        />,
    );
    expect(markup.match(/<article class="creation-assistant-message/g)?.length).toBe(1);
    for (const phrase of ["有几点需要先确认", "真实用途是什么", "水族接头", "鱼缸管路", "灌溉接头", "花园管路", "输入框回复"]) expect(markup).toContain(phrase);
    expect(markup).not.toContain("正在思考");
});

test("仅有表单提问时仍展示字段，不把等待用户误报为生成中", () => {
    const markup = renderToStaticMarkup(
        <CreationMessageView
            item={{
                id: "answer",
                role: "assistant",
                mode: "agent",
                content: "",
                createdAt: "2026-10-03T00:00:00Z",
                status: "streaming",
                agentQuestion: {
                    kind: "form",
                    question: "确认用途和材质",
                    options: [],
                    fields: [
                        { title: "用途", required: true, options: [{ label: "水族", detail: "鱼缸使用" }] },
                        { title: "材质", placeholder: "如实填写" },
                    ],
                },
            }}
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
        />,
    );
    for (const phrase of ["确认用途和材质", "用途", "水族", "鱼缸使用", "材质", "如实填写"]) expect(markup).toContain(phrase);
    expect(markup).not.toContain("正在思考");
    expect(markup).not.toContain("正在生成");
});

test("失败或终止的空助手消息不再一直显示生成动画", () => {
    const failed = renderMessage("error", "请求超时");
    expect(failed).toContain("请求超时");
    expect(failed).not.toContain("正在生成");
    expect(renderMessage("cancelled")).not.toContain("正在生成");
    expect(renderMessage("done")).not.toContain("正在生成");
});

test("纯图片用户消息展示实际附件与编辑入口，不造空文字气泡或复制按钮", () => {
    const markup = renderToStaticMarkup(
        <CreationMessageView
            item={{
                id: "user-image",
                role: "user",
                mode: "agent",
                content: "",
                createdAt: "2026-10-20T09:00:00Z",
                attachments: [{ id: "image", name: "新商品", type: "image/png", storageKey: "resource:new-product", previewUrl: "/product.png", url: "/product.png", bytes: 10 }],
            }}
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
        />,
    );
    expect(markup).toContain('aria-label="预览 新商品"');
    expect(markup).toContain('aria-label="编辑并重新发送"');
    expect(markup).not.toContain("creation-user-message-copy-wrap");
    expect(markup).not.toContain('aria-label="复制提示词"');
});

test("同一次 Agent 回复将审核方案和后续任务放在同一助手容器", () => {
    const markup = renderToStaticMarkup(
        <CreationMessageView
            item={{ id: "assistant", role: "assistant", mode: "agent", content: "方案已准备", createdAt: "2026-10-03T00:00:00Z", status: "done" }}
            shotNumber={0}
            onRetryFailure={() => {}}
            onCreateVariant={() => {}}
            onEditUserMessage={() => {}}
            onContinueCanvas={() => {}}
            openingCanvas={false}
            agentReview={<section aria-label="Agent 计划与审批">逐图审核</section>}
            agentTasks={[{ id: "task-1", role: "assistant", mode: "image", content: "生成主图", createdAt: "2026-10-03T00:00:00Z", status: "pending", taskIds: ["1"] }]}
        />,
    );
    expect(markup.match(/<article class="creation-assistant-message/g)?.length).toBe(1);
    expect(markup).toContain("方案已准备");
    expect(markup).toContain("逐图审核");
    expect(markup).toContain("生成主图");
});
