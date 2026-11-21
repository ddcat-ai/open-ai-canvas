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
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider, useQuery } = await import("@tanstack/react-query");
const { ChatGPTPlanConnection } = await import("../../src/pages/settings/chatgpt-plan-connection");
const { ChannelSettingsPane } = await import("../../src/pages/settings/channel-settings-pane");
const { http } = await import("../../src/services/api/request");
const { getChatGPTPlanStatus } = await import("../../src/services/api/chatgpt-plan");
const session = await import("../../src/lib/user-session");
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;
let enabled = true;
let connected = false;
let account = "alice";
let selectedSlugs: string[] = [];
let saveWait: Promise<void> | undefined;
let disconnectWait: Promise<void> | undefined;
const calls: string[] = [];
const refresh = spyOn(session, "refreshSystemChannels").mockResolvedValue(undefined);
const get = spyOn(http, "get").mockImplementation(async (path: string) => {
    calls.push(path);
    if (path === "/chatgpt-plan") return { enabled, connected, selectedModelSlugs: selectedSlugs, email: connected ? `${account}@example.test` : undefined };
    if (path === "/chatgpt-plan/models") return { models: [`model-${account}`, `extra-${account}`].map((slug) => ({ slug, displayName: slug, selected: selectedSlugs.includes(slug), available: true })) };
    throw new Error(`Unexpected GET ${path}`);
});
const post = spyOn(http, "post").mockImplementation(async (path: string) => {
    calls.push(path);
    if (path === "/chatgpt-plan/disconnect") {
        await disconnectWait;
        connected = false;
        return { revocationConfirmed: true };
    }
    if (path === "/chatgpt-plan/start") return { authorizationUrl: "https://auth.openai.com/api/accounts/authorize?state=test" };
    throw new Error(`Unexpected POST ${path}`);
});
const put = spyOn(http, "put").mockImplementation(async (path: string, body: { slugs: string[] }) => {
    calls.push(path);
    if (path !== "/chatgpt-plan/models") throw new Error(`Unexpected PUT ${path}`);
    await saveWait;
    selectedSlugs = [...body.slugs];
    return { saved: true };
});
beforeEach(() => {
    enabled = true;
    connected = false;
    account = "alice";
    selectedSlugs = [];
    saveWait = undefined;
    disconnectWait = undefined;
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
    put.mockRestore();
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
function AuthorizationPane({ userId, customChannelsEnabled }: { userId: string; customChannelsEnabled: boolean }) {
    const [open, setOpen] = useState(false);
    const status = useQuery({ queryKey: ["chatgpt-plan", userId], queryFn: () => getChatGPTPlanStatus() });
    return (
        <ChannelSettingsPane customChannelsEnabled={customChannelsEnabled} hasPersonalAuthorization={status.data?.connected} onAddChatGPT={status.data?.enabled ? () => setOpen(true) : undefined} onOpenModels={() => {}}>
            <ChatGPTPlanConnection key={userId} userId={userId} authorizationOpen={open} onAuthorizationClose={() => setOpen(false)} />
        </ChannelSettingsPane>
    );
}
async function render(userId = account, withPane = false, customChannelsEnabled = false) {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>{withPane ? <AuthorizationPane key={userId} userId={userId} customChannelsEnabled={customChannelsEnabled} /> : <ChatGPTPlanConnection key={userId} userId={userId} />}</QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
}
async function click(label: string) {
    const button = [...document.querySelectorAll("button")].find((item) => item.textContent?.includes(label));
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
    expect(document.body.textContent).not.toContain("使用 ChatGPT 登录");
    expect(client.getQueryData(["chatgpt-plan", "bob"])).toMatchObject({ connected: false });
});

test("personal channels retains authorization when API key channels are disabled", async () => {
    await render("alice", true);
    expect(document.body.textContent).not.toContain("使用 ChatGPT 登录");
    expect(host.querySelector('[aria-label="ChatGPT 个人方案渠道"]')).toBeNull();
    expect(host.textContent).not.toContain("拉取全部");
    await click("新增渠道");
    expect(document.body.textContent).toContain("ChatGPT 个人方案 · 账号授权");
    expect(document.body.textContent).not.toContain("OpenAI 兼容 · API Key");
    await click("ChatGPT 个人方案");
    expect(document.body.textContent).toContain("使用 ChatGPT 登录");
    expect(calls).not.toContain("/chatgpt-plan/start");
});

test("new channel offers ChatGPT and creates its row only after successful authorization", async () => {
    await render("alice", true, true);
    expect(document.body.textContent).not.toContain("使用 ChatGPT 登录");
    await click("新增渠道");
    expect(document.body.textContent).toContain("OpenAI 兼容 · API Key");
    expect(document.body.textContent).toContain("Gemini · API Key");
    await click("ChatGPT 个人方案");
    expect(host.querySelector('[aria-label="ChatGPT 个人方案渠道"]')).toBeNull();
    const popup = { location: { href: "about:blank" }, close() {} };
    const open = spyOn(window, "open").mockReturnValue(popup as unknown as globalThis.Window);
    try {
        await click("使用 ChatGPT 登录");
        expect(popup.location.href).toContain("https://auth.openai.com/");
        expect(host.querySelector('[aria-label="ChatGPT 个人方案渠道"]')).toBeNull();
        connected = true;
        await act(async () => {
            await client.invalidateQueries({ queryKey: ["chatgpt-plan", "alice"] });
        });
        await settle();
        expect(host.querySelector('[aria-label="ChatGPT 个人方案渠道"]')).toBeTruthy();
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    } finally {
        open.mockRestore();
    }
});

test("feature disabled removes ChatGPT from the new-channel choices", async () => {
    enabled = false;
    await render("alice", true, true);
    await click("新增渠道");
    expect(document.body.textContent).toContain("OpenAI 兼容 · API Key");
    expect(document.body.textContent).not.toContain("ChatGPT 个人方案");
});

test("personal channels retains disconnect when both feature switches are disabled", async () => {
    enabled = false;
    connected = true;
    await render("alice", true);
    expect(host.textContent).toContain("alice@example.test");
    expect(host.textContent).toContain("断开连接");
    expect(calls).not.toContain("/chatgpt-plan/models");
    await click("断开连接");
    expect(host.textContent).not.toContain("alice@example.test");
});

test("authorized account becomes a channel row with persisted multi-model selection", async () => {
    connected = true;
    selectedSlugs = ["model-alice"];
    await render("alice", true);
    expect(host.querySelector('[aria-label="ChatGPT 个人方案渠道"]')).toBeTruthy();
    expect(host.textContent).toContain("已选择 1 个模型");
    expect(host.textContent).not.toContain("当前没有个人模型渠道");
    expect(host.textContent).not.toContain("API Key / Access Key");
    await click("选择模型");
    const inputs = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(inputs.length).toBe(2);
    expect(inputs[0]!.checked).toBe(true);
    await act(async () => inputs[1]!.click());
    await click("保存选择");
    expect(selectedSlugs).toEqual(["model-alice", "extra-alice"]);
    expect(host.textContent).toContain("已选择 2 个模型");
    await click("选择模型");
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.checked)).toBe(true);
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
    await click("保存选择");
    expect(selectedSlugs).toEqual(["extra-alice"]);
    expect(host.textContent).toContain("已选择 1 个模型");
});

test("saving models does not spin the disconnect button", async () => {
    connected = true;
    selectedSlugs = ["model-alice", "extra-alice"];
    await render("alice", true);
    await click("选择模型");
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => input.checked)).toBe(true);
    let release!: () => void;
    saveWait = new Promise<void>((resolve) => {
        release = resolve;
    });
    try {
        await click("保存选择");
        const disconnect = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("断开连接"))!;
        expect(disconnect.classList.contains("ant-btn-loading")).toBe(false);
        expect(disconnect.disabled).toBe(true);
        const save = [...document.querySelectorAll("button")].find((button) => button.textContent?.includes("保存选择"))!;
        expect(save.classList.contains("ant-btn-loading")).toBe(true);
    } finally {
        await act(async () => release());
        await settle();
    }
    expect(host.textContent).toContain("已选择 2 个模型");
});

test("disconnect spins only its own action", async () => {
    connected = true;
    await render();
    let release!: () => void;
    disconnectWait = new Promise<void>((resolve) => {
        release = resolve;
    });
    try {
        await click("断开连接");
        const disconnect = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("断开连接"))!;
        const select = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("选择模型"))!;
        expect(disconnect.classList.contains("ant-btn-loading")).toBe(true);
        expect(select.classList.contains("ant-btn-loading")).toBe(false);
        expect(select.disabled).toBe(true);
    } finally {
        await act(async () => release());
        await settle();
    }
});
