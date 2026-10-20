import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Window } from "happy-dom";
import { CreationMessageView } from "../src/pages/create/creation-workspace-messages";
import type { CreationMessage } from "../src/pages/create/creation-types";

test("用户补充气泡按真实回执显示待确认、排队、送达或未送达，查询操作复用小按钮", () => {
    const dom = new Window();
    const actions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false, onQueryInterjection: async () => {} };
    const message: CreationMessage = { id: "follow-up", role: "user", mode: "agent", agentRunId: "run", content: "背景改为蓝色", createdAt: "2026-10-20T10:00:00Z" };
    try {
        for (const [state, label] of [
            ["pending", "补充说明回执待确认"],
            ["queued", "已排队，等待本轮下一步"],
            ["delivered", "补充说明已送达"],
            ["undelivered", "补充说明未送达：本轮已停止"],
        ] as const) {
            dom.document.body.innerHTML = renderToStaticMarkup(<CreationMessageView {...actions} item={{ ...message, agentInterjection: state, error: state === "undelivered" ? "本轮已停止" : undefined }} />);
            expect(dom.document.querySelector('[role="status"]')?.textContent).toContain(label);
            expect(dom.document.body.textContent).toContain("背景改为蓝色");
            expect(dom.document.body.textContent).not.toContain("重新生成");
            const query = dom.document.querySelector(".creation-agent-plan-toggle");
            if (state === "pending") {
                expect(query?.textContent).toBe("核对并重试原消息");
                expect(query?.querySelector("svg")).not.toBeNull();
            } else expect(query).toBeNull();
        }
    } finally {
        dom.close();
    }
});

test("续答只展示正文，计划和媒体不在每个续答气泡中重复", () => {
    const dom = new Window();
    const actions = { shotNumber: 0, onRetryFailure: () => {}, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };
    const base: CreationMessage = { id: "run:assistant", role: "assistant", mode: "agent", agentRunId: "run", content: "原回复", createdAt: "2026-10-20T10:00:00Z", status: "streaming" };
    const task: CreationMessage = { ...base, id: "task-image", mode: "image", content: "商品图", taskIds: ["image"], status: "pending" };
    try {
        dom.document.body.innerHTML = renderToStaticMarkup(
            <>
                <CreationMessageView {...actions} item={base} agentTasks={[task]} agentReview={<section data-plan="true">执行计划</section>} />
                <CreationMessageView {...actions} item={{ ...base, id: "follow-up", role: "user", content: "用户补充", agentInterjection: "delivered" }} />
                <CreationMessageView {...actions} item={{ ...base, id: "run:assistant:next", content: "续答正文", agentContinuation: true, status: "done" }} agentTasks={[task]} agentReview={<section data-plan="true">执行计划</section>} />
            </>,
        );
        expect(dom.document.querySelectorAll("[data-plan]")).toHaveLength(1);
        expect(dom.document.querySelectorAll(".creation-agent-media-batch")).toHaveLength(1);
        const text = dom.document.body.textContent || "";
        expect(text.indexOf("用户补充")).toBeLessThan(text.indexOf("续答正文"));
    } finally {
        dom.close();
    }
});
