import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "https://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentCollapsedAttentionCard, AgentNotificationPermissionGuide } = await import("../../src/components/canvas/canvas-agent-attention");
const { canvasThemes } = await import("../../src/lib/canvas-theme");

afterAll(() => dom.happyDOM.abort());

function button(host: HTMLElement, label: string) {
    const match = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.includes(label));
    expect(match, `missing button: ${label}; found: ${host.textContent}`).toBeDefined();
    return match!;
}

test("授权指引只通过明确按钮请求权限", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let requests = 0;
    try {
        await act(async () =>
            root.render(
                <AgentNotificationPermissionGuide
                    permission="default"
                    requesting={false}
                    onRequest={() => {
                        requests += 1;
                    }}
                />,
            ),
        );
        expect(host.textContent).toContain("仅在页面隐藏或 Agent 收起时提醒审批和提问");
        expect(requests).toBe(0);
        await act(async () => button(host, "允许通知").click());
        expect(requests).toBe(1);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("收起态审批卡只显示具体摘要并可直接同意或拒绝", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const decisions: string[] = [];
    try {
        await act(async () =>
            root.render(
                <AgentCollapsedAttentionCard
                    theme={canvasThemes.light}
                    approval={{
                        approvalId: "approval-1",
                        detail: {
                            toolName: "generate_media",
                            arguments: {
                                mode: "video",
                                title: "镜头1视频",
                                prompt: "雨夜街头的跟拍镜头",
                                channelModelKey: "seedance-test",
                                size: "9:16",
                                quality: "720p",
                                durationSeconds: 12,
                                videoGenerateAudio: true,
                                referenceNodeIds: ["image-1", "image-2"],
                            },
                        },
                        reason: "",
                    }}
                    approvalSubmitting={false}
                    onApprove={() => decisions.push("approve")}
                    onReject={() => decisions.push("reject")}
                    onAnswer={() => undefined}
                />,
            ),
        );
        expect(host.getAttribute("role")).toBeNull();
        expect(host.querySelector('[role="dialog"]')?.getAttribute("aria-label")).toContain("审批");
        expect(host.querySelector(".canvas-agent-approval-card")).not.toBeNull();
        expect(host.textContent).toContain("生成视频《镜头1视频》");
        expect(host.textContent).toContain("模型：seedance-test");
        expect(host.textContent).toContain("画幅：9:16");
        expect(host.textContent).toContain("质量：720p");
        expect(host.textContent).toContain("时长：12 秒");
        expect(host.textContent).toContain("音频：开启");
        expect(host.textContent).toContain("引用 2 个画布资产，并建立连线");
        expect(host.textContent).not.toContain("视频草稿节点和引用连线已创建");
        expect(host.textContent).not.toContain("填写拒绝理由（可选）");
        expect(host.querySelector('[aria-label="视频生成设置"]')).toBeNull();
        await act(async () => button(host, "同意执行").click());
        await act(async () => button(host, "暂不执行").click());
        expect(decisions).toEqual(["approve", "reject"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("收起态表单提问只保留完成回答所需的字段和按钮", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const answers: string[] = [];
    try {
        await act(async () =>
            root.render(
                <AgentCollapsedAttentionCard
                    theme={canvasThemes.dark}
                    question={{
                        kind: "form",
                        questionId: "question-1",
                        question: "选择画面风格",
                        fields: [
                            {
                                id: "style",
                                title: "风格",
                                type: "segmented",
                                required: true,
                                options: [
                                    { id: "real", label: "写实" },
                                    { id: "anime", label: "动画" },
                                ],
                            },
                        ],
                    }}
                    approvalSubmitting={false}
                    onApprovalReasonChange={() => undefined}
                    onApprove={() => undefined}
                    onReject={() => undefined}
                    onAnswer={(answer) => answers.push(answer)}
                />,
            ),
        );
        expect(host.querySelector(".agent-question-form")).not.toBeNull();
        expect(host.textContent).toContain("写实");
        expect(host.textContent).toContain("动画");
        expect(host.textContent).toContain("按推荐方案开始");
        expect(host.textContent).toContain("确认并继续");
        expect(host.textContent).not.toContain("已填入推荐值，可按需修改");
        expect(host.textContent).not.toContain("补充说明");
        expect(host.querySelector("#agent-question-additional-notes")).toBeNull();
        await act(async () => button(host, "动画").click());
        await act(async () => button(host, "确认并继续").click());
        expect(JSON.parse(answers[0]!)).toMatchObject({ questionId: "question-1", answers: { style: "anime" } });
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});

test("收起态选择提问只显示问题与可直接提交的答案", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const answers: string[] = [];
    try {
        await act(async () =>
            root.render(
                <AgentCollapsedAttentionCard
                    theme={canvasThemes.dark}
                    question={{
                        kind: "choice",
                        questionId: "question-2",
                        question: "片头采用哪种视觉风格？",
                        options: [
                            { label: "电影写实", detail: "强调真实摄影质感与自然光影" },
                            { label: "国风动画", detail: "强调水墨笔触与东方配色" },
                        ],
                    }}
                    approvalSubmitting={false}
                    onApprovalReasonChange={() => undefined}
                    onApprove={() => undefined}
                    onReject={() => undefined}
                    onAnswer={(answer) => answers.push(answer)}
                />,
            ),
        );
        expect(host.textContent).toContain("片头采用哪种视觉风格？");
        expect(host.textContent).toContain("电影写实");
        expect(host.textContent).toContain("国风动画");
        expect(host.textContent).not.toContain("强调真实摄影质感与自然光影");
        expect(host.querySelector('[title="强调真实摄影质感与自然光影"]')).toBeNull();
        expect(host.textContent).not.toContain("也可以在下方输入框里补充说明");
        await act(async () => button(host, "国风动画").click());
        expect(answers).toEqual(["国风动画"]);
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
