import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost:3000/c/first" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryRouter, RouterProvider } = await import("react-router");
const { useCreationConversationRoute } = await import("../src/pages/create/use-creation-conversation-route");
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

test("直达、前进后退准确读取路由 ID，失败不退回另一会话，切路由取消旧加载", async () => {
    const opens: string[] = [],
        signals: AbortSignal[] = [];
    const deletedIds = new Set<string>();
    let state: ReturnType<typeof useCreationConversationRoute>;
    let releaseSlow: () => void = () => {};
    function Page() {
        state = useCreationConversationRoute(
            true,
            "user",
            async (id, signal) => {
                opens.push(id);
                signals.push(signal);
                if (id === "slow")
                    await new Promise<void>((resolve) => {
                        releaseSlow = resolve;
                    });
                if (id === "missing") throw new Error("会话不存在");
            },
            deletedIds,
        );
        return <div>{state.loading ? "loading" : state.error || state.conversationId}</div>;
    }
    const router = createMemoryRouter([{ path: "/c/:conversationId", element: <Page /> }], { initialEntries: ["/c/first"] });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () => root.render(<RouterProvider router={router} />));
        expect(host.textContent).toBe("first");
        await act(async () => {
            await router.navigate("/c/second");
        });
        await act(async () => {
            await router.navigate(-1);
        });
        await act(async () => {
            await router.navigate(1);
        });
        expect(opens).toEqual(["first", "second", "first", "second"]);
        await act(async () => {
            await router.navigate("/c/missing");
        });
        expect(host.textContent).toBe("会话不存在");
        await act(async () => {
            await router.navigate("/c/slow");
        });
        expect(host.textContent).toBe("loading");
        const slow = signals.at(-1)!;
        await act(async () => {
            await router.navigate("/c/first");
        });
        expect(slow.aborted).toBe(true);
        await act(async () => releaseSlow());
        expect(host.textContent).toBe("first");
        const reads = opens.length;
        await act(async () => state!.show("selected"));
        expect(opens).toHaveLength(reads);
        expect(router.state.location.pathname).toBe("/c/selected");
        deletedIds.add("selected");
        await act(async () => {
            await router.navigate("/c/selected", { replace: true });
        });
        expect(host.textContent).toBe("会话已删除或已超过保留期限");
        expect(opens).toHaveLength(reads);
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        host.remove();
    }
});
