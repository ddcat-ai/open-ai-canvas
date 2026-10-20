import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationAgentReview } from "../src/pages/create/creation-agent-review";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationCommercePlan, CreationMessage } from "../src/pages/create/creation-types";
import type { AgentApproval } from "../src/services/api/agent";

const plan: CreationCommercePlan = {
    planVersion: "2",
    planId: "output-test",
    version: 1,
    intent: "生成墨西哥站护肤产品套图",
    platform: "amazon",
    site: "MX",
    language: "es",
    productFacts: [{ id: "fact", claim: "60g 便携装", sourceIds: ["product"] }],
    references: [{ resourceId: "product", name: "产品参考图", role: "product" }],
    styleBible: "清新浅蓝与柔和日光",
    estimatedCredits: 18,
    estimateStatus: "quoted",
    items: [{ id: "hero", type: "image", purpose: "核心场景图", title: "日常护理", prompt: "柔和日光下的产品展示", targetCopy: "Cuidado diario", zhReviewCopy: "日常护理", attachmentResourceIds: ["product"], specs: { size: "1024x1024", quality: "1k" } }],
};
const actions = { submitting: false, onApprove: () => {}, onReject: () => {} };

test("简洁卡片收起明细，保留目标、数量、规格及报价", () => {
    const markup = renderToStaticMarkup(<CreationAgentReview plan={plan} outputPreference="concise" {...actions} />);
    for (const phrase of ["重要信息", "生成墨西哥站", "amazon / MX", "1 项交付", "1024x1024", "18 积分", "展开"]) expect(markup).toContain(phrase);
    expect(markup).toContain('aria-expanded="false"');
    for (const phrase of ["逐图方案", "柔和日光下的产品展示", "采用的产品事实", "清新浅蓝与柔和日光"]) expect(markup).not.toContain(phrase);
});

test("详细卡片展开现有明细，并提供收起按钮", () => {
    const markup = renderToStaticMarkup(<CreationAgentReview plan={plan} outputPreference="detailed" {...actions} />);
    for (const phrase of ["逐图方案", "柔和日光下的产品展示", "采用的产品事实", "清新浅蓝与柔和日光", "Cuidado diario", "收起"]) expect(markup).toContain(phrase);
    expect(markup).toContain('aria-expanded="true"');
});

const message: CreationMessage = { id: "answer", role: "assistant", mode: "agent", agentRunId: "run", content: "冗长的逐图结果表格与过程说明", createdAt: "2026-10-03T00:00:00Z", status: "done", commercePlan: plan };
const tasks: CreationMessage[] = [
    { id: "task-success", role: "assistant", mode: "image", agentRunId: "run", content: "核心场景图", createdAt: message.createdAt, status: "done", taskIds: ["success"], resultUrls: ["https://example.com/result.png"] },
    { id: "task-failed", role: "assistant", mode: "image", agentRunId: "run", content: "细节图", createdAt: message.createdAt, status: "error", taskIds: ["failed"], error: "模型生成失败" },
];
const messageActions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };

test("简洁交付直接展示图片、真实状态和失败项重试，完整回复按需查看", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={tasks} outputPreference="concise" agentReview={<section>主要信息</section>} {...messageActions} />);
    expect(markup).toContain("1 项完成");
    expect(markup).toContain("1 项失败");
    expect(markup).toContain("查看完整回复");
    expect(markup).not.toContain(message.content);
    expect(markup).toContain("result.png");
    expect(markup).toContain("重试失败项");
    expect(markup.indexOf("creation-agent-media-batch")).toBeLessThan(markup.indexOf("主要信息"));
});

test("详细交付保留助手全文和现有信息顺序", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={tasks} outputPreference="detailed" agentReview={<section>主要信息</section>} {...messageActions} />);
    expect(markup).toContain(message.content);
    expect(markup.indexOf("主要信息")).toBeLessThan(markup.indexOf("creation-agent-media-batch"));
});

test("简洁偏好不裁掉普通问答或待确认的问题", () => {
    const markup = renderToStaticMarkup(
        <CreationMessageView item={{ ...message, commercePlan: undefined, agentQuestion: { kind: "choice", question: "选择产品用途", options: [{ label: "护肤" }], allowFreeform: true } }} outputPreference="concise" {...messageActions} />,
    );
    expect(markup).toContain(message.content);
    expect(markup).toContain("选择产品用途");
    expect(markup).toContain("护肤");
});

test("简洁交付区分生成中和已停止，不将它们当成完成", () => {
    const pending: CreationMessage[] = [
        { ...tasks[0], status: "pending", resultUrls: [] },
        { ...tasks[1], status: "cancelled" },
    ];
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={pending} outputPreference="concise" {...messageActions} />);
    expect(markup).toContain("1 项生成中");
    expect(markup).toContain("1 项已停止");
    expect(markup).not.toContain("项完成");
});

const approval: AgentApproval = {
    approvalId: "quote",
    call: { id: "call", function: { name: "commerce_plan_submit", arguments: "{}" } },
    preview: { kind: "media", title: "确认生成", description: "预计消耗 18 积分", items: [{ operation: "generate_media", summary: "生成核心场景图", details: ["1024x1024", "1K"] }] },
};

test("简洁模式保留审批和修改操作，设置变化后仍禁止批准旧方案", () => {
    const markup = renderToStaticMarkup(<CreationAgentReview plan={plan} approval={approval} outputPreference="concise" onModify={async () => true} {...actions} />);
    for (const phrase of ["确认整套生成", "仅保留方案", "修改备注", "18 积分"]) expect(markup).toContain(phrase);
    const changed = renderToStaticMarkup(<CreationAgentReview plan={plan} approval={approval} outputPreference="concise" changed {...actions} />);
    expect(changed).toContain("设置已变更");
    expect(changed).toMatch(/<button[^>]*disabled=""[^>]*>确认整套生成<\/button>/);
});

test("没有方案卡片时，简洁模式仍完整展示审批的规格", () => {
    const markup = renderToStaticMarkup(<CreationAgentReview approval={approval} outputPreference="concise" {...actions} />);
    expect(markup).toContain("1024x1024");
    expect(markup).toContain("1K");
    expect(markup).toContain("批准执行");
});

test("模型可决定是否显示重要信息，未声明的历史方案仍展示且不会新增审批", () => {
    for (const showImportantInfo of [true, false, undefined]) {
        const markup = renderToStaticMarkup(<CreationAgentReview plan={{ ...plan, showImportantInfo }} items={[{ id: "generate", title: "生成最终图片", status: "doing" }]} onModify={async () => true} outputPreference="detailed" {...actions} />);
        expect(markup.includes("重要信息")).toBe(showImportantInfo !== false);
        expect(markup.includes("柔和日光下的产品展示")).toBe(showImportantInfo !== false);
        expect(markup.includes("修改备注")).toBe(showImportantInfo !== false);
        expect(markup).toContain("执行计划");
        expect(markup).toContain("生成最终图片");
        expect(markup).not.toContain("确认整套生成");
        expect(markup).not.toContain("批准执行");
    }
});

test("隐藏重要信息不隐藏已有审批的规格报价，不影响媒体交付计数", () => {
    const hiddenPlan = { ...plan, showImportantInfo: false };
    expect(renderToStaticMarkup(<CreationAgentReview plan={hiddenPlan} {...actions} />)).toBe("");
    const review = renderToStaticMarkup(<CreationAgentReview plan={hiddenPlan} approval={approval} outputPreference="concise" {...actions} />);
    expect(review).not.toContain("重要信息");
    for (const phrase of ["确认整套生成", "18 积分", "1024x1024", "1K"]) expect(review).toContain(phrase);
    const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, commercePlan: hiddenPlan }} agentTasks={tasks} outputPreference="concise" {...messageActions} />);
    expect(markup).toContain("2 项交付");
    expect(markup).toContain("1 项完成");
    expect(markup).toContain("result.png");
});

test("修改备注沿用当前执行权限，只有已有审批时才提示审批新版", () => {
    const automatic = renderToStaticMarkup(<CreationAgentReview plan={plan} onModify={async () => true} outputPreference="detailed" {...actions} />);
    expect(automatic).toContain("规格会按备注重新规划");
    expect(automatic).toContain("所选执行模型保持");
    expect(automatic).toContain("沿用当前执行权限与预算");
    expect(automatic).not.toContain("供你审批");
    expect(automatic).not.toContain("批准生成");
    expect(automatic).not.toContain("确认整套生成");
    const awaiting = renderToStaticMarkup(<CreationAgentReview plan={plan} approval={approval} onModify={async () => true} outputPreference="detailed" {...actions} />);
    expect(awaiting).toContain("新版会重新报价供你审批");
    expect(awaiting).toContain("确认整套生成");
    expect(awaiting).toContain("按备注修改方案");
});

test("Agent 仍在编排时保留真实失败计数，不展示子任务失败原因或重试按钮", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, status: "streaming" }} agentTasks={tasks} outputPreference="concise" {...messageActions} />);
    expect(markup).not.toContain("模型生成失败");
    expect(markup).not.toContain("重试失败项");
    expect(markup).toContain("1 项失败");
});

test("多项最终失败统一展示一次，已修复旧失败不再出现", () => {
    const failures = ["scene", "steps"].map((id) => ({ ...tasks[1], id, commerceItemId: id, content: id, error: "模型生成失败" }));
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={[tasks[0], ...failures]} {...messageActions} />);
    expect(markup.match(/class="creation-message-error"/g)).toHaveLength(1);
    expect(markup.match(/生成失败，请重试失败项。/g)).toHaveLength(1);
    expect(markup).not.toContain("模型生成失败");
    const recovered = { ...failures[0], id: "scene-retry", status: "done" as const, resultUrls: ["https://example.com/retry.png"], taskIds: ["retry"] };
    const after = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={[tasks[0], failures[0], recovered]} {...messageActions} />);
    expect(after).not.toContain("模型生成失败");
    expect(after).not.toContain("重试失败项");
});

test("多任务失败区只显示简短汇总，不拼接子任务名称、长进度或逐项错误", () => {
    const failures: CreationMessage[] = [
        { ...tasks[1], id: "task-scene", taskIds: ["scene"], content: "正在生成图片（0/5，失败 1）", error: "图片生成等待超时，请稍后重试。" },
        { ...tasks[1], id: "task-detail", taskIds: ["detail"], content: "产品细节特写图", error: "模型服务拒绝了请求，请检查模型和参数" },
    ];
    for (const outputPreference of ["concise", "detailed"] as const) {
        const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={[tasks[0], ...failures]} outputPreference={outputPreference} {...messageActions} />);
        const errorArea = markup.match(/<div class="creation-message-error"><span>([\s\S]*?)<\/span>/)?.[1];
        expect(errorArea).toBe("生成失败，请重试失败项。");
        expect(markup.match(/>重试失败项<\/button>/g)).toHaveLength(1);
        expect(markup).toContain("result.png");
    }
    expect(failures[0].error).toBe("图片生成等待超时，请稍后重试。");
    expect(failures[1].taskIds).toEqual(["detail"]);
});

test("单个 Agent 图片任务保留具体上游错误，不拼接任务标题", () => {
    const failed = { ...tasks[1], content: "正在生成图片（0/1，失败 1）", error: "参考图像分辨率过低，请上传宽高均不小于 300 像素的图片。" };
    for (const outputPreference of ["concise", "detailed"] as const) {
        const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, commercePlan: undefined }} agentTasks={[failed]} outputPreference={outputPreference} {...messageActions} />);
        const errorArea = markup.match(/<div class="creation-message-error"><span>([\s\S]*?)<\/span>/)?.[1];
        expect(errorArea).toBe(failed.error);
        expect(markup.match(/>重试失败项<\/button>/g)).toHaveLength(1);
        expect(markup).not.toContain("生成失败，请重试失败项。");
    }
});

test("五张套图仅首项已提交且失败时仍使用多任务简短汇总", () => {
    const failed = { ...tasks[1], batchId: "five-images", batchTotal: 5, error: "参考图像分辨率过低，请上传宽高均不小于 300 像素的图片。" };
    for (const batchTotal of [5, undefined]) {
        const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, commercePlan: undefined, batchTotal }} agentTasks={[failed]} outputPreference="concise" {...messageActions} />);
        const errorArea = markup.match(/<div class="creation-message-error"><span>([\s\S]*?)<\/span>/)?.[1];
        expect(errorArea).toBe("生成失败，请重试失败项。");
        expect(markup).not.toContain(failed.error);
        expect(markup.match(/>重试失败项<\/button>/g)).toHaveLength(1);
    }
});

test("普通单图和单视频失败仍保留上游具体错误", () => {
    const error = "参考图像分辨率过低，请上传宽高均不小于 300 像素的图片。";
    for (const mode of ["image", "video"] as const) {
        const markup = renderToStaticMarkup(<CreationMessageView item={{ ...tasks[1], mode, agentRunId: undefined, error }} {...messageActions} />);
        expect(markup).toContain(error);
        expect(markup).not.toContain("生成失败，请重试失败项。");
    }
});
