import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CloudAgentUserQuestion } from "../src/components/canvas/canvas-cloud-agent-chat-ui";

const dom = new Window({ url: "http://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, Profiler, StrictMode } = await import("react");
const { createRoot } = await import("react-dom/client");
const { AgentQuestionBar } = await import("../src/components/canvas/canvas-cloud-agent-chat-ui");
const { canvasThemes } = await import("../src/lib/canvas-theme");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function questionFixture(initial: CloudAgentUserQuestion) {
    const host = document.createElement("div");
    document.body.append(host);
    const errors: unknown[] = [];
    const answers: string[] = [];
    const root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
    let commits = 0;
    const render = async (question: CloudAgentUserQuestion) => {
        commits = 0;
        await act(async () =>
            root.render(
                <StrictMode>
                    <Profiler
                        id="question"
                        onRender={() => {
                            // Bound a broken effect loop so the regression fails without hanging Bun.
                            if (++commits > 12) throw new Error("提问组件持续重复更新");
                        }}
                    >
                        <AgentQuestionBar question={question} theme={canvasThemes.light} onAnswer={(answer) => answers.push(answer)} />
                    </Profiler>
                </StrictMode>,
            ),
        );
    };
    const dispose = async () => {
        await act(async () => root.unmount());
        host.remove();
    };
    try {
        await render(initial);
        return { host, answers, errors, render, dispose, commits: () => commits };
    } catch (error) {
        await dispose();
        throw error;
    }
}

for (const kind of ["choice", "form"] as const) {
    test(`没有 fields 的 ${kind} 提问不会循环渲染`, async () => {
        const question: CloudAgentUserQuestion = { kind, questionId: "q1", question: "如何继续？", options: [{ label: "继续规划" }] };
        const fixture = await questionFixture(question);
        try {
            expect(fixture.errors).toEqual([]);
            expect(fixture.commits()).toBeLessThan(5);
            expect(fixture.host.textContent).toContain(question.question);
            await fixture.render({ ...question });
            expect(fixture.errors).toEqual([]);
            expect(fixture.commits()).toBeLessThan(5);
        } finally {
            await fixture.dispose();
        }
    });
}

test("选择题正常提交选项和默认方案", async () => {
    const fixture = await questionFixture({ question: "创作方向", options: [{ label: "制作短片" }] });
    try {
        expect(fixture.errors).toEqual([]);
        const buttons = Array.from(fixture.host.querySelectorAll("button"));
        await act(async () => buttons.find((button) => button.textContent?.includes("制作短片"))!.click());
        await act(async () => buttons.find((button) => button.textContent?.includes("按默认方案开始"))!.click());
        expect(fixture.answers).toEqual(["制作短片", "直接开始"]);
    } finally {
        await fixture.dispose();
    }
});

test("同一表单保留已选值，切换新问题后使用新默认值", async () => {
    const question: CloudAgentUserQuestion = {
        kind: "form",
        questionId: "q1",
        question: "选择风格",
        options: [],
        fields: [
            {
                id: "style",
                title: "风格",
                type: "segmented",
                defaultValue: "a",
                options: [
                    { id: "a", label: "写实" },
                    { id: "b", label: "动画" },
                ],
            },
        ],
    };
    const fixture = await questionFixture(question);
    const button = (label: string) => Array.from(fixture.host.querySelectorAll("button")).find((item) => item.textContent === label)!;
    try {
        expect(button("写实").getAttribute("aria-pressed")).toBe("true");
        await act(async () => button("动画").click());
        await fixture.render({ ...question });
        expect(button("动画").getAttribute("aria-pressed")).toBe("true");
        await act(async () => button("确认并继续").click());
        expect(JSON.parse(fixture.answers[0]).answers).toEqual({ style: "b" });
        await fixture.render({ ...question, questionId: "q2" });
        expect(button("写实").getAttribute("aria-pressed")).toBe("true");
        expect(fixture.errors).toEqual([]);
    } finally {
        await fixture.dispose();
    }
});

test("视频规格单选可修改，多选字段提交稳定 ID 数组", async () => {
    const fixture = await questionFixture({
        kind: "form",
        questionId: "video-specs",
        question: "确认视频参数",
        options: [],
        fields: [
            {
                id: "aspectRatio",
                title: "画幅",
                type: "single_select",
                defaultValue: "9:16",
                options: [
                    { id: "9:16", label: "9:16" },
                    { id: "16:9", label: "16:9" },
                ],
            },
            {
                id: "resolution",
                title: "清晰度",
                type: "segmented",
                defaultValue: "720P",
                options: [
                    { id: "480P", label: "480P" },
                    { id: "720P", label: "720P" },
                ],
            },
            {
                id: "outputs",
                title: "输出",
                type: "multi_select",
                defaultValue: ["video", "cover"],
                options: [
                    { id: "video", label: "视频" },
                    { id: "cover", label: "封面" },
                    { id: "subtitle", label: "字幕" },
                ],
            },
        ],
    });
    const button = (label: string) => Array.from(fixture.host.querySelectorAll("button")).find((item) => item.textContent === label)!;
    try {
        expect(button("9:16").getAttribute("aria-pressed")).toBe("true");
        expect(button("视频").getAttribute("aria-pressed")).toBe("true");
        await act(async () => button("16:9").click());
        await act(async () => button("480P").click());
        await act(async () => button("字幕").click());
        await act(async () => button("确认并继续").click());
        const answer = JSON.parse(fixture.answers[0]);
        expect(answer.answers).toEqual({ aspectRatio: "16:9", resolution: "480P", outputs: ["video", "cover", "subtitle"] });
        expect(answer.displayAnswers).toEqual({ aspectRatio: "16:9", resolution: "480P", outputs: ["视频", "封面", "字幕"] });
    } finally {
        await fixture.dispose();
    }
});

test("长表单只有内容区滚动，操作按钮位于滚动区外且提示上下位置", async () => {
    const fixture = await questionFixture({
        kind: "form",
        questionId: "long-form",
        question: "确认制作需求",
        options: [],
        fields: Array.from({ length: 16 }, (_, i) => ({ id: `field-${i}`, title: `字段${i}`, type: "text" as const })),
    });
    try {
        const scroll = fixture.host.querySelector<HTMLElement>(".agent-question-scroll")!;
        const actions = fixture.host.querySelector(".agent-question-actions")!;
        expect(scroll).not.toBeNull();
        expect(scroll.contains(actions)).toBe(false);
        expect(scroll.querySelectorAll("[data-agent-field-id]").length).toBe(16);
        expect(scroll.querySelector("#agent-question-additional-notes")).not.toBeNull();
        expect(scroll.getAttribute("tabindex")).toBe("0");
        Object.defineProperty(scroll, "clientHeight", { configurable: true, value: 120 });
        Object.defineProperty(scroll, "scrollHeight", { configurable: true, value: 700 });
        await act(async () => scroll.dispatchEvent(new dom.Event("scroll")));
        const up = fixture.host.querySelector<HTMLButtonElement>('[aria-label="向上查看表单"]')!;
        const down = fixture.host.querySelector<HTMLButtonElement>('[aria-label="向下查看更多选项"]')!;
        expect(up.disabled).toBe(true);
        expect(down.disabled).toBe(false);
        expect(fixture.host.textContent).toContain("下方还有更多选项");
        scroll.scrollTop = 580;
        await act(async () => scroll.dispatchEvent(new dom.Event("scroll")));
        expect(up.disabled).toBe(false);
        expect(down.disabled).toBe(true);
        expect(fixture.host.textContent).toContain("已到表单底部");
    } finally {
        await fixture.dispose();
    }
});

test("必填字段缺失时定位字段，保留表单并且不提交", async () => {
    const fixture = await questionFixture({ kind: "form", questionId: "required", question: "补充需求", options: [], fields: [{ id: "missing", title: "必填需求", type: "text", required: true }] });
    try {
        const field = fixture.host.querySelector<HTMLElement>('[data-agent-field-id="missing"]')!;
        let scrolled = false;
        field.scrollIntoView = () => {
            scrolled = true;
        };
        const submit = [...fixture.host.querySelectorAll("button")].find((button) => button.textContent === "确认并继续")!;
        await act(async () => submit.click());
        expect(scrolled).toBe(true);
        expect(document.activeElement?.id).toBe("agent-field-missing");
        expect(fixture.host.querySelector('[role="alert"]')?.textContent).toContain("必填需求");
        expect(fixture.answers).toHaveLength(0);
    } finally {
        await fixture.dispose();
    }
});
