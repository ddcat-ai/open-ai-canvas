import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost:3000/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({ window: dom, document: dom.document, navigator: dom.navigator, HTMLElement: dom.HTMLElement, Element: dom.Element, Node: dom.Node, IS_REACT_ACT_ENVIRONMENT: true })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act, createContext, StrictMode, useContext } = await import("react");
const { createRoot } = await import("react-dom/client");
const { createMemoryRouter, RouterProvider } = await import("react-router");
const { useCreationHomeNavigation } = await import("../src/pages/create/use-creation-home-navigation");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function withHome(initial: string, ready: boolean, run: (state: { router: ReturnType<typeof createMemoryRouter>; render: (hydrated: boolean) => Promise<void>; starts: string[] }) => Promise<void>) {
    const starts: string[] = [];
    const Hydrated = createContext(ready);
    function Home() {
        useCreationHomeNavigation(useContext(Hydrated), () => {
            starts.push("new");
        });
        return <div>创作首页</div>;
    }
    const router = createMemoryRouter(
        [
            { path: "/", element: <Home /> },
            { path: "/skills", element: <div>技能</div> },
        ],
        { initialEntries: [initial] },
    );
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const render = async (value: boolean) => {
        await act(async () =>
            root.render(
                <StrictMode>
                    <Hydrated value={value}>
                        <RouterProvider router={router} />
                    </Hydrated>
                </StrictMode>,
            ),
        );
    };
    try {
        await render(ready);
        await run({ router, render, starts });
    } finally {
        await act(async () => root.unmount());
        router.dispose();
        host.remove();
    }
}

test("首页同路径的品牌导航也打开新创作，每次点击只执行一次", async () => {
    await withHome("/", true, async ({ router, starts }) => {
        expect(starts).toEqual([]);
        for (let i = 1; i <= 2; i++) {
            await act(async () => {
                await router.navigate("/", { state: { creationHome: true } });
            });
            expect(starts).toHaveLength(i);
            expect(router.state.location.state).toBeNull();
        }
        await act(async () => {
            await router.navigate("/");
        });
        expect(starts).toHaveLength(2);
    });
});

test("从其他页面回首页等待历史恢复后再新建，消费入口意图后刷新不重复重置", async () => {
    await withHome("/skills", false, async ({ router, render, starts }) => {
        await act(async () => {
            await router.navigate("/", { state: { creationHome: true, other: "keep" } });
        });
        expect(starts).toEqual([]);
        expect(router.state.location.state.creationHome).toBe(true);
        await render(true);
        expect(starts).toEqual(["new"]);
        expect(router.state.location.state).toEqual({ other: "keep" });
        await act(async () => {
            await router.navigate("/skills");
        });
        await act(async () => {
            await router.navigate(-1);
        });
        expect(starts).toEqual(["new"]);
    });
});

test("普通刷新和创作菜单导航继续恢复会话，不触发新建", async () => {
    await withHome("/", false, async ({ router, render, starts }) => {
        await render(true);
        await act(async () => {
            await router.navigate("/", { state: { creationHome: false } });
        });
        expect(starts).toEqual([]);
    });
});

test("Logo 的展开与收起入口、顶部品牌以及真实首页均接入回首页意图", async () => {
    const sidebar = await Bun.file(new URL("../src/components/layout/workspace-sidebar-nav.tsx", import.meta.url)).text();
    const topbar = await Bun.file(new URL("../src/components/layout/workspace-top-bar.tsx", import.meta.url)).text();
    const page = await Bun.file(new URL("../src/pages/create/index.tsx", import.meta.url)).text();
    expect(sidebar.match(/<Link to="\/" state=\{\{ creationHome: true \}\}/g)).toHaveLength(2);
    expect(topbar).toContain('<Link to="/" state={{ creationHome: true }}');
    expect(page).toContain("useCreationHomeNavigation(hydrated && composerPreferencesHydrated, startNewConversation)");
});
