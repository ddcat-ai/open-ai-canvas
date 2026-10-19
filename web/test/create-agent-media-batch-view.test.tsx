import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

const at = "2026-10-03T00:00:00Z";
const tasks: CreationMessage[] = Array.from({ length: 6 }, (_, i) => ({ id: `task-${i}`, role: "assistant", mode: "image", content: `图片 ${i + 1}`, createdAt: at, status: "pending", taskIds: [`${i}`], agentRunId: "run-1" }));
const parent: CreationMessage = { id: "run-1:assistant", role: "assistant", mode: "agent", content: "六图方案", createdAt: at, status: "streaming", agentRunId: "run-1" };
const succeeded = (task: CreationMessage): CreationMessage => ({ ...task, status: "done", resultUrls: [`/images/${task.id}.png`] });
const render = (messages: CreationMessage[], item = parent) =>
    renderToStaticMarkup(createElement(CreationMessageView, { item, agentTasks: messages, shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false }));

test("尚未成功的六图只渲染一个占位卡和0/6进度", () => {
    const html = render(tasks);
    expect(html.match(/<strong>图像生成<\/strong>/g)).toHaveLength(1);
    expect(html.match(/class="creation-media-pending /g)).toHaveLength(1);
    expect(html).toContain("0/6");
    expect(html).not.toContain("creation-image-result-stack");
});

test("普通上下文批次第一张刚提交时，卡片及简洁摘要都使用五张交付总数", () => {
    const html = renderToStaticMarkup(
        createElement(CreationMessageView, {
            item: { ...parent, batchTotal: 5 },
            outputPreference: "concise",
            agentTasks: [{ ...tasks[0], batchId: "edit-five", batchTotal: 5 }],
            shotNumber: 0,
            onRetryFailure: () => {},
            onCreateVariant: () => {},
            onEditUserMessage: () => {},
            onContinueCanvas: () => {},
            openingCanvas: false,
        }),
    );
    expect(html).toContain("0/5");
    expect(html).toContain("5 项交付");
    expect(html).not.toContain("0/1");
});

test("第一张成功就能预览和下载，其余任务继续生成", () => {
    const html = render(tasks.map((task, i) => (i === 0 ? succeeded(task) : task)));
    expect(html.match(/<strong>图像生成<\/strong>/g)).toHaveLength(1);
    expect(html).toContain('aria-label="预览生成图片"');
    expect(html).toContain('<img src="/images/task-0.png"');
    expect(html).toContain('aria-label="下载生成图片 1"');
    expect(html).toContain("批量下载");
    expect(html).toContain("1 张图片 · 成功 1/6");
    expect(html).toContain("is-pending");
    expect(html).not.toContain("creation-media-pending");
    expect(html).not.toContain("你的图像已创建");
});

test("4/5成功时同一张聚合卡立即展示四张成功图片和下载入口", () => {
    const html = render(tasks.slice(0, 5).map((task, i) => (i < 4 ? succeeded(task) : task)));
    expect(html.match(/<strong>图像生成<\/strong>/g)).toHaveLength(1);
    expect(html).toContain("creation-image-result-stack");
    expect(html).toContain("4 张图片 · 成功 4/5");
    expect(html).toContain("is-pending");
    expect(html).toContain("展开");
    expect(html).toContain("批量下载");
    expect(html).toContain('aria-label="下载当前生成图片"');
    expect(html).not.toContain("下载 2</a>");
    expect(html).not.toContain("/images/task-4.png");
    expect(html).not.toContain("creation-media-pending");
});

test("最后一张结束后保留先前成功结果并聚合为5/5", () => {
    const html = render(tasks.slice(0, 5).map(succeeded));
    expect(html.match(/<strong>图像生成<\/strong>/g)).toHaveLength(1);
    expect(html).toContain("5 张图片 · 成功 5/5");
    expect(html).toContain("你的图像已创建");
    expect(html).toContain("批量下载");
    expect(html).toContain('aria-label="下载当前生成图片"');
    expect(html).not.toContain("creation-media-pending");
});

test("还有任务生成且某项失败时展示成功图片，静默恢复不提前报错", () => {
    const html = render(tasks.map((task, i) => (i < 3 ? succeeded(task) : i === 3 ? { ...task, status: "error", error: "模型失败" } : task)));
    expect(html).toContain("3 张图片 · 成功 3/6");
    expect(html).toContain("is-pending");
    expect(html).not.toContain("图片 4：");
    expect(html).not.toContain("重试此项");
    expect(html).toContain("批量下载");
    expect(html).not.toContain("creation-media-pending");
});

test("一个成功任务返回多张图片时进度仍按任务统计，所有成功输出可下载", () => {
    const html = render(tasks.map((task, i) => (i === 0 ? { ...succeeded(task), resultUrls: ["/images/a.png", "/images/b.png"] } : task)));
    expect(html).toContain("2 张图片 · 成功 1/6");
    expect(html).toContain("批量下载");
    expect(html).toContain('aria-label="下载当前生成图片"');
    expect(html).not.toContain("creation-media-pending");
});

test("六项完成后保留堆叠、图片点击预览，并提供单图与 ZIP 批量下载", () => {
    const html = render(tasks.map(succeeded));
    expect(html.match(/<strong>图像生成<\/strong>/g)).toHaveLength(1);
    expect(html).toContain("creation-image-result-stack");
    expect(html).toContain("6 张图片 · 成功 6/6");
    expect(html).toContain("展开");
    expect(html).toContain('aria-label="展开预览第 1 张图片"');
    expect(html).toContain('aria-label="下载当前生成图片"');
    expect(html).toContain('title="下载当前图片"');
    expect(html).not.toContain('title="展开预览"');
    expect(html.match(/批量下载/g)).toHaveLength(1);
    expect(html).not.toContain("下载 6</a>");
});

test("整轮结束后部分失败保留成功图并提供失败项重试", () => {
    const html = render(
        tasks.map((task, i) => (i === 2 ? { ...task, status: "error", error: "模型失败" } : succeeded(task))),
        { ...parent, status: "done" },
    );
    expect(html).toContain("5 张图片 · 成功 5/6");
    expect(html).toContain("生成失败，请重试失败项。");
    expect(html).not.toContain("图片 3：");
    expect(html.match(/>重试失败项<\/button>/g)).toHaveLength(1);
    expect(html).not.toContain("重试此项");
});

test("多项失败只展示一个重试入口，整轮失败也不出现嵌套重新生成按钮", () => {
    for (const successCount of [0, 2]) {
        const html = render(
            tasks.map((task, i) => (i < successCount ? succeeded(task) : { ...task, status: "error", error: "网络异常" })),
            { ...parent, status: "error", error: "网络异常" },
        );
        expect(html.match(/>重试失败项<\/button>/g)).toHaveLength(1);
        expect(html).not.toContain("重试此项");
        expect(html).not.toContain("重新生成");
    }
});
