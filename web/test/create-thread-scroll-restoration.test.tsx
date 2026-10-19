import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost:3001/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, useEffect, useLayoutEffect } = await import("react");
const { createRoot } = await import("react-dom/client");

// 执行首页真正的滚动 effect，在随后 layout effect（绘制前）观察位置。
const source = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
const end = source.indexOf("    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);");
const start = source.lastIndexOf("    use", end);
if (start < 0 || end < 0) throw new Error("creation thread scroll effect missing");
const code = new Bun.Transpiler({ loader: "tsx" }).transformSync(source.slice(start, end) + "    }, [activeConversation?.id, activeConversation?.messages, isEmpty]);");
const scrollEffect = new Function("useEffect", "useLayoutEffect", "activeConversation", "isEmpty", "followLatestMessageRef", "threadScrollRef", code);

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function withThread(run: (state: { render: (messages: string[], follow?: boolean) => Promise<void>; scroller: HTMLDivElement; beforePaint: number[]; frames: Array<FrameRequestCallback> }) => Promise<void>) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const scroller = document.createElement("div");
    const beforePaint: number[] = [];
    const frames: Array<FrameRequestCallback> = [];
    const previousFrame = window.requestAnimationFrame;
    window.requestAnimationFrame = (callback) => {
        frames.push(callback);
        return frames.length;
    };
    Object.defineProperties(scroller, { scrollHeight: { get: () => 1800 }, clientHeight: { get: () => 600 } });
    let top = 0;
    Object.defineProperty(scroller, "scrollTop", {
        get: () => top,
        set: (value: number) => {
            top = Math.min(1200, Math.max(0, value));
        },
    });
    const followLatestMessageRef = { current: true };
    const threadScrollRef = { current: scroller };
    function Thread({ messages }: { messages: string[] }) {
        scrollEffect(useEffect, useLayoutEffect, { id: "restored", messages }, !messages.length, followLatestMessageRef, threadScrollRef);
        useLayoutEffect(() => {
            beforePaint.push(scroller.scrollTop);
        });
        return <div>{messages.join("\n")}</div>;
    }
    const render = async (messages: string[], follow = true) => {
        followLatestMessageRef.current = follow;
        await act(async () => root.render(<Thread messages={messages} />));
    };
    try {
        await run({ render, scroller, beforePaint, frames });
    } finally {
        await act(async () => root.unmount());
        window.requestAnimationFrame = previousFrame;
        host.remove();
    }
}

test("刷新恢复失败消息时，绘制第一帧前已定位到底部，不再下一帧跳动", async () => {
    await withThread(async ({ render, beforePaint, frames }) => {
        await render(["已生成图片", "生成失败：模型服务拒绝了请求", "重试失败项"]);
        expect(beforePaint).toEqual([1200]);
        expect(frames).toHaveLength(0);
    });
});

test("任务复核和新回复在底部继续跟随，用户上翻查看历史时保留位置", async () => {
    await withThread(async ({ render, scroller, beforePaint, frames }) => {
        await render(["已生成图片", "重试失败项"]);
        scroller.scrollTop = 340;
        await render(["已生成图片", "重试失败项", "新的状态"], false);
        expect(beforePaint).toEqual([1200, 340]);
        await render(["已生成图片", "重试失败项", "后续回复"], true);
        expect(beforePaint).toEqual([1200, 340, 1200]);
        expect(frames).toHaveLength(0);
    });
});

test("空首页不执行会话底部定位", async () => {
    await withThread(async ({ render, beforePaint, frames }) => {
        await render([]);
        expect(beforePaint).toEqual([0]);
        expect(frames).toHaveLength(0);
    });
});
