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
