import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CreationAgentReview } from "../src/pages/create/creation-agent-review";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationCommercePlan, CreationMessage } from "../src/pages/create/creation-types";
import type { AgentApproval } from "../src/services/api/agent";

const plan: CreationCommercePlan = {
    planVersion: "2", planId: "output-test", version: 1, intent: "生成墨西哥站护肤产品套图", platform: "amazon", site: "MX", language: "es",
    productFacts: [{ id: "fact", claim: "60g 便携装", sourceIds: ["product"] }],
    references: [{ resourceId: "product", name: "产品参考图", role: "product" }],
    styleBible: "清新浅蓝与柔和日光", estimatedCredits: 18, estimateStatus: "quoted",
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

test("简洁交付直接展示图片、真实状态和单项重试，完整回复按需查看", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={tasks} outputPreference="concise" agentReview={<section>主要信息</section>} {...messageActions} />);
    expect(markup).toContain("1 项完成");
    expect(markup).toContain("1 项失败");
    expect(markup).toContain("查看完整回复");
    expect(markup).not.toContain(message.content);
    expect(markup).toContain("result.png");
    expect(markup).toContain("重试此项");
    expect(markup.indexOf("creation-agent-media-batch")).toBeLessThan(markup.indexOf("主要信息"));
});

test("详细交付保留助手全文和现有信息顺序", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={tasks} outputPreference="detailed" agentReview={<section>主要信息</section>} {...messageActions} />);
    expect(markup).toContain(message.content);
    expect(markup.indexOf("主要信息")).toBeLessThan(markup.indexOf("creation-agent-media-batch"));
});

test("简洁偏好不裁掉普通问答或待确认的问题", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, commercePlan: undefined, agentQuestion: { kind: "choice", question: "选择产品用途", options: [{ label: "护肤" }], allowFreeform: true } }} outputPreference="concise" {...messageActions} />);
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

const approval: AgentApproval = { approvalId: "quote", call: { id: "call", function: { name: "commerce_plan_submit", arguments: "{}" } }, preview: { kind: "media", title: "确认生成", description: "预计消耗 18 积分", items: [{ operation: "generate_media", summary: "生成核心场景图", details: ["1024x1024", "1K"] }] } };

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

test("静默恢复期间不展示失败原因或重试按钮", () => {
    const markup = renderToStaticMarkup(<CreationMessageView item={{ ...message, status: "streaming" }} agentTasks={tasks} outputPreference="concise" {...messageActions} />);
    expect(markup).not.toContain("模型生成失败");
    expect(markup).not.toContain("重试此项");
    expect(markup).not.toContain("1 项失败");
});

test("多项最终失败统一展示一次，已修复旧失败不再出现", () => {
    const failures = ["scene", "steps"].map((id) => ({ ...tasks[1], id, commerceItemId: id, content: id, error: "模型生成失败" }));
    const markup = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={[tasks[0], ...failures]} {...messageActions} />);
    expect(markup.match(/class="creation-message-error"/g)).toHaveLength(1);
    expect(markup.match(/模型生成失败/g)).toHaveLength(1);
    expect(markup).toContain("scene");
    expect(markup).toContain("steps");
    const recovered = { ...failures[0], id: "scene-retry", status: "done" as const, resultUrls: ["https://example.com/retry.png"], taskIds: ["retry"] };
    const after = renderToStaticMarkup(<CreationMessageView item={message} agentTasks={[tasks[0], failures[0], recovered]} {...messageActions} />);
    expect(after).not.toContain("模型生成失败");
    expect(after).not.toContain("重试此项");
});
