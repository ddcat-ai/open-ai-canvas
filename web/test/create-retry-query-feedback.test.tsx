import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationConversation, CreationMessage } from "../src/pages/create/creation-types";
import { creationHasInput } from "../src/pages/create/creation-types";
import * as conversationHelpers from "../src/pages/create/creation-agent-conversation";
import { submitCreationAgentInterjection } from "../src/pages/create/creation-agent-interjection";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { CreationMessageView } = await import("../src/pages/create/creation-workspace-messages");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const begin = source.indexOf("    const retryFailedMessage = async (");
const end = source.indexOf("\n    const createVariant = (", begin);
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(begin, end));
const at = "2026-10-20T06:16:00Z";
const failed: CreationMessage = { id: "run:assistant", role: "assistant", mode: "agent", agentRunId: "run", content: "", status: "error", error: "请求回执超时", createdAt: at };
const actions = { shotNumber: 0, onCreateVariant: () => {}, onEditUserMessage: () => {}, onContinueCanvas: () => {}, openingCanvas: false };

test.each(["running", "query-error", "account-switch"])("真实重试先查原轮，延迟期间按钮立即反馈并禁止连点，结束清理：%s", async (outcome) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let scope = "owner",
        reads = 0,
        writes = 0,
        submissions = 0;
    const notices: string[] = [];
    const original: CreationConversation = { id: "conversation", agentSessionId: "session", agentRunId: "run", title: "改字", updatedAt: at, messages: [{ id: "user", role: "user", mode: "agent", content: "修改杯身文字为 IGO", createdAt: at }, failed] };
    let current = original;
    const gate = Promise.withResolvers<CreationConversation>();
    const pending = new Set<string>();
    const bindings = {
        ...conversationHelpers,
        creationHasInput,
        activeConversation: original,
        busy: false,
        retryPreparingRef: { current: pending },
        getActiveUserScope: () => scope,
        activeIdRef: { current: original.id },
        creationAgentRecoveryClient: {},
        restoreCreationAgentConversation: () => {
            reads++;
            return gate.promise;
        },
        updateConversation: (_id: string, update: (value: CreationConversation) => CreationConversation) => {
            writes++;
            current = update(current);
        },
        submitCreationAgent: () => {
            submissions++;
        },
        toast: { info: (message: string) => notices.push(message), error: (message: string) => notices.push(message) },
        generationErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    };
    const retry = new Function(...Object.keys(bindings), `${code}\nreturn retryFailedMessage;`)(...Object.values(bindings));
    let work: Promise<void> | undefined;
    try {
        await act(async () => root.render(<CreationMessageView {...actions} item={failed} onRetryFailure={() => (work = retry(failed, 1))} />));
        const button = () => host.querySelector("button")!;
        await act(async () => button().click());
        expect(button().textContent).toContain("正在核对原任务");
        expect(button().getAttribute("aria-busy")).toBe("true");
        expect(button().disabled).toBe(true);
        expect(button().querySelector("svg")?.getAttribute("width")).toBe("16");
        await act(async () => button().click());
        expect(reads).toBe(1);
        expect(submissions).toBe(0);
        if (outcome === "account-switch") scope = "another-owner";
        await act(async () => {
            if (outcome === "query-error") gate.reject(new Error("查询暂时不可用"));
            else gate.resolve({ ...original, agentRuns: [{ id: "run", surface: "creation", sessionId: "session", canvasId: "", status: "running", createdAt: at, updatedAt: at }] });
            await work;
        });
        expect(button().disabled).toBe(false);
        expect(button().textContent).toBe("重新生成");
        expect(pending.size).toBe(0);
        expect(submissions).toBe(0);
        if (outcome === "running") {
            expect(notices).toContain("原轮次仍在处理中，已恢复最新状态");
            const sent: string[] = [];
            const saved: CreationMessage[] = [];
            const run = current.agentRuns![0];
            const resumed = await submitCreationAgentInterjection(
                { conversation: current, text: "继续 IGO 改字" },
                {
                    assertCurrent: () => {},
                    createId: () => "continue-after-query",
                    read: async () => run,
                    save: async (message) => {
                        saved.push(message);
                    },
                    send: async (id, input) => {
                        sent.push(id);
                        expect(input.text).toBe("继续 IGO 改字");
                        return { accepted: true, pending: 1 };
                    },
                },
            );
            expect(sent).toEqual(["run"]);
            expect(resumed.message.agentInterjection).toBe("queued");
            expect(saved.at(-1)?.content).toBe("继续 IGO 改字");
            expect(submissions).toBe(0);
        }
        if (outcome === "query-error") expect(notices).toContain("查询暂时不可用");
        if (outcome === "account-switch") {
            expect(writes).toBe(0);
            expect(notices).toEqual([]);
        }
    } finally {
        await act(async () => {
            gate.resolve(original);
            await work;
            root.unmount();
        });
        host.remove();
    }
});

test.each(["image", "video", "image-unknown", "agent-batch"])("各失败入口查询时立即反馈且只锁当前按钮：%s", async (kind) => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const gate = Promise.withResolvers<void>();
    let queries = 0;
    const query = () => {
        queries++;
        return gate.promise;
    };
    const media: CreationMessage = { ...failed, id: "task-image", mode: kind === "video" ? "video" : "image", submissionPending: kind === "image-unknown" || undefined, status: kind === "image-unknown" ? "pending" : "error", taskIds: ["image"] };
    const item = kind === "agent-batch" ? failed : media;
    try {
        await act(async () => root.render(<CreationMessageView {...actions} item={item} onRetryFailure={query} agentTasks={kind === "agent-batch" ? [media, { ...media, id: "task-other", taskIds: ["other"] }] : undefined} onRetryAgentTasks={query} />));
        const button = () => host.querySelector<HTMLButtonElement>(kind === "agent-batch" ? ".creation-message-error button" : kind === "image-unknown" ? ".creation-media-empty button" : ".creation-media-error button")!;
        await act(async () => button().click());
        expect(button().textContent).toContain("正在核对原任务");
        expect(button().disabled).toBe(true);
        expect(button().getAttribute("aria-busy")).toBe("true");
        expect(button().querySelector("svg")?.getAttribute("width")).toBe("16");
        await act(async () => button().click());
        expect(queries).toBe(1);
        await act(async () => {
            gate.resolve();
            await gate.promise;
        });
        expect(button().disabled).toBe(false);
        expect(button().textContent).not.toContain("正在核对");
    } finally {
        await act(async () => {
            gate.resolve();
            root.unmount();
        });
        host.remove();
    }
});
