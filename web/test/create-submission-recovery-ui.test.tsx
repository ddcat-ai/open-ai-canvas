import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

const actions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };

test.each(["image", "video"] as const)("%s 首次请求仍在发送时显示提交中，不显示丢失回执的恢复提示", (mode) => {
    const item: CreationMessage = { id: "sending", role: "assistant", mode, content: "", status: "pending", submissionPending: true, createdAt: "2026-10-20T13:14:00Z" };
    const html = renderToStaticMarkup(<CreationMessageView item={item} submitting {...actions} />);
    expect(html).toContain("正在提交");
    expect(html).not.toContain("提交待确认");
    expect(html).not.toContain("原任务可能仍在运行");
    expect(html).not.toContain("查询原任务");
});

test("批次已有结果但其余请求仍在发送时保留结果，不提前显示恢复入口", () => {
    const item: CreationMessage = { id: "partial-sending", role: "assistant", mode: "image", content: "", status: "pending", submissionPending: true, resultUrls: ["https://fixture.invalid/finished.png"], createdAt: "2026-10-20T13:14:00Z" };
    const html = renderToStaticMarkup(<CreationMessageView item={item} submitting {...actions} />);
    expect(html).toContain("finished.png");
    expect(html).toContain("正在提交");
    expect(html).not.toContain("查询原任务");
});

test.each(["image", "video"] as const)("%s 创建回执未确认只提供原任务恢复，不误报失败或重新生成", (mode) => {
    const item: CreationMessage = { id: "response-lost", role: "assistant", mode, content: "", status: "pending", submissionPending: true, clientOperationId: "original-operation", createdAt: "2026-10-18T00:00:00Z", error: "网络异常。" };
    const html = renderToStaticMarkup(<CreationMessageView item={item} {...actions} />);
    expect(html).toContain("提交待确认");
    expect(html).toContain("查询原任务");
    expect(html).not.toContain("重新生成");
    expect(html).not.toContain("生成失败");
    expect(html).not.toContain("网络异常。");
});

test("图片批次部分回执未确认时保留成功结果及恢复入口", () => {
    const item: CreationMessage = {
        id: "partial",
        role: "assistant",
        mode: "image",
        content: "",
        status: "pending",
        submissionPending: true,
        clientOperationId: "original-operation",
        resultUrls: ["https://fixture.invalid/finished.png"],
        createdAt: "2026-10-18T00:00:00Z",
    };
    const html = renderToStaticMarkup(<CreationMessageView item={item} {...actions} />);
    expect(html).toContain("finished.png");
    expect(html).toContain("查询原任务");
    expect(html).not.toContain("重新生成");
});
