import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";

const dom = new Window({ url: "http://localhost/", settings: { device: { prefersReducedMotion: "reduce" } } });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    DocumentFragment: dom.DocumentFragment,
    Event: dom.Event,
    InputEvent: dom.InputEvent,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { ChatGPTPlanConnection } = await import("../../src/pages/settings/chatgpt-plan-connection");
const { http } = await import("../../src/services/api/request");
const session = await import("../../src/lib/user-session");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;
let enabled = true;
let connected = false;
let account = "alice";
const calls: string[] = [];
const refresh = spyOn(session, "refreshSystemChannels").mockResolvedValue(undefined);
const get = spyOn(http, "get").mockImplementation(async (path: string) => {
    calls.push(path);
    if (path === "/chatgpt-plan") return { enabled, connected, email: connected ? `${account}@example.test` : undefined };
    if (path === "/chatgpt-plan/models") return { models: [{ slug: `model-${account}`, displayName: "Personal model" }] };
    throw new Error(`Unexpected GET ${path}`);
});
const post = spyOn(http, "post").mockImplementation(async (path: string) => {
    calls.push(path);
    if (path === "/chatgpt-plan/disconnect") {
        connected = false;
        return { revocationConfirmed: true };
    }
    if (path === "/chatgpt-plan/start") return { authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=test" };
    throw new Error(`Unexpected POST ${path}`);
});
beforeEach(() => {
    enabled = true;
    connected = false;
    account = "alice";
    calls.length = 0;
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
});
afterAll(() => {
    get.mockRestore();
    post.mockRestore();
    refresh.mockRestore();
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
}
async function render(userId = account) {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <ChatGPTPlanConnection key={userId} userId={userId} />
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
}
async function click(label: string) {
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
    expect(button).toBeTruthy();
    await act(async () => button!.click());
    await settle();
}
test("default-disabled authorization stays hidden and does not fetch upstream models", async () => {
    enabled = false;
    await render();
    expect(host.querySelector("section")).toBeNull();
    expect(calls).toEqual(["/chatgpt-plan"]);
});
test("disabled existing connection retains the disconnect action", async () => {
    enabled = false;
    connected = true;
    await render();
    expect(host.textContent).toContain("alice@example.test");
    expect(host.textContent).toContain("管理员已关闭");
    expect(calls).not.toContain("/chatgpt-plan/models");
    await click("断开连接");
    expect(calls).toContain("/chatgpt-plan/disconnect");
    expect(host.textContent).not.toContain("alice@example.test");
    expect(host.querySelector("section")).toBeNull();
});
test("switching users never reuses the previous user's connection", async () => {
    connected = true;
    await render();
    expect(host.textContent).toContain("alice@example.test");
    account = "bob";
    connected = false;
    await render("bob");
    expect(host.textContent).not.toContain("alice@example.test");
    expect(host.textContent).toContain("使用 ChatGPT 登录");
    expect(client.getQueryData(["chatgpt-plan", "bob"])).toMatchObject({ connected: false });
});
