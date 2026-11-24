import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { TurnstileWidget } = await import("../../src/components/auth/turnstile-widget");
let root: ReturnType<typeof createRoot>;
let tokens: string[];
let renders: Array<Record<string, unknown>>;
let removed: Array<string | number>;
let width: number;
let observers: Array<{ active: boolean; callback: () => void }>;
let append: ReturnType<typeof spyOn>;
const nativeWidth = Object.getOwnPropertyDescriptor(dom.HTMLElement.prototype, "clientWidth");
Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", { configurable: true, get: () => width });

beforeEach(() => {
    tokens = [];
    renders = [];
    removed = [];
    width = 320;
    observers = [];
    Object.defineProperty(window, "ResizeObserver", {
        configurable: true,
        value: class {
            active = false;
            constructor(public callback: () => void) {
                observers.push(this);
            }
            observe() {
                this.active = true;
            }
            disconnect() {
                this.active = false;
            }
        },
    });
    delete window.turnstile;
    document.head.innerHTML = "";
    document.body.innerHTML = "<main></main>";
    const originalAppend = document.head.appendChild.bind(document.head);
    append = spyOn(document.head, "appendChild").mockImplementation((node) => {
        // Keep the actual element and lifecycle events, without loading external JavaScript.
        if (node instanceof dom.HTMLScriptElement) node.type = "application/x-turnstile-test";
        return originalAppend(node);
    });
    root = createRoot(document.querySelector("main")!);
});
afterEach(async () => {
    await act(async () => root.unmount());
    append.mockRestore();
});
afterAll(() => {
    if (nativeWidth) Object.defineProperty(dom.HTMLElement.prototype, "clientWidth", nativeWidth);
    else Reflect.deleteProperty(dom.HTMLElement.prototype, "clientWidth");
    dom.happyDOM.abort();
});

function api() {
    window.turnstile = {
        render: (_node, options) => {
            renders.push(options);
            return renders.length;
        },
        reset: () => {},
        remove: (id) => removed.push(id),
    };
}
async function mount(siteKey = "test-site", resetKey = 0) {
    await act(async () => root.render(<TurnstileWidget siteKey={siteKey} resetKey={resetKey} onToken={(token) => tokens.push(token)} />));
}
async function callback(name: string, token?: string) {
    await act(async () => (renders.at(-1)![name] as (token?: string) => void)(token));
}
async function retry() {
    const button = [...document.querySelectorAll("button")].find((node) => node.textContent === "重新加载验证")!;
    expect(button).toBeTruthy();
    expect(button.type).toBe("button");
    await act(async () => button.click());
}
async function resize(nextWidth: number) {
    width = nextWidth;
    await act(async () => {
        for (const observer of [...observers]) if (observer.active) observer.callback();
    });
}

test("关闭或缺失站点密钥不加载第三方脚本", async () => {
    await mount("");
    expect(document.querySelector("script")).toBeNull();
    expect(document.querySelector(".auth-turnstile")).toBeNull();
});

test("失败脚本移除，重新加载后可以取得令牌", async () => {
    await mount();
    const first = document.getElementById("cloudflare-turnstile-api")!;
    await act(async () => first.dispatchEvent(new dom.Event("error")));
    expect(document.querySelector('[role="status"]')!.textContent).toContain("加载失败");
    expect(document.querySelector("script")).toBeNull();
    await retry();
    const second = document.getElementById("cloudflare-turnstile-api")!;
    expect(second).not.toBe(first);
    api();
    await act(async () => second.dispatchEvent(new dom.Event("load")));
    await callback("callback", "token-after-retry");
    expect(tokens.at(-1)).toBe("token-after-retry");
    expect(document.querySelector('[role="status"]')).toBeNull();
});

test("脚本无事件时有限超时，显示重试入口", async () => {
    let timeout: (() => void) | undefined;
    const original = window.setTimeout.bind(window);
    const timer = spyOn(window, "setTimeout").mockImplementation(((handler: () => void, delay: number) => {
        if (delay === 10000) {
            timeout = handler;
            return 123;
        }
        return original(handler, delay);
    }) as typeof window.setTimeout);
    try {
        await mount();
        expect(timeout).toBeFunction();
        await act(async () => timeout!());
        expect(document.querySelector('[role="status"]')!.textContent).toContain("加载超时");
        expect(document.querySelector("script")).toBeNull();
        api();
        await retry();
        await callback("callback", "recovered");
        expect(tokens.at(-1)).toBe("recovered");
    } finally {
        timer.mockRestore();
    }
});

for (const event of ["expired-callback", "error-callback", "timeout-callback"]) {
    test(`${event} 清除旧令牌，重试保留新的实例回调`, async () => {
        api();
        await mount();
        const stale = renders[0].callback as (token: string) => void;
        await callback("callback", "old");
        await callback(event);
        expect(tokens.at(-1)).toBe("");
        expect(document.querySelector('[role="status"]')).not.toBeNull();
        await retry();
        await callback("callback", "new");
        await act(async () => stale("late"));
        expect(tokens.at(-1)).toBe("new");
        expect(removed).toEqual([1]);
    });
}

test("窄容器使用 compact，较宽容器使用 flexible", async () => {
    api();
    width = 272;
    await mount();
    expect(renders[0].size).toBe("compact");
    width = 360;
    await mount("test-site", 1);
    expect(renders[1].size).toBe("flexible");
});

test("跨过 300px 阈值时双向重建并清除令牌，旧实例不能回填", async () => {
    api();
    await mount();
    const first = renders[0];
    await callback("callback", "wide-token");
    await resize(299);
    expect(renders.map((options) => options.size)).toEqual(["flexible", "compact"]);
    expect(tokens.at(-1)).toBe("");
    await act(async () => (first.callback as (token: string) => void)("late-wide-token"));
    expect(tokens.at(-1)).toBe("");
    await callback("callback", "compact-token");
    const second = renders[1];
    await resize(300);
    expect(renders.map((options) => options.size)).toEqual(["flexible", "compact", "flexible"]);
    expect(tokens.at(-1)).toBe("");
    await callback("callback", "new-wide-token");
    await act(async () => {
        (second.callback as (token: string) => void)("late-compact-token");
        (second["error-callback"] as () => void)();
    });
    expect(tokens.at(-1)).toBe("new-wide-token");
    expect(document.querySelector('[role="status"]')).toBeNull();
    expect(removed).toEqual([1, 2]);
});

test("同一尺寸档和暂时隐藏不重建，也不清除已通过的令牌", async () => {
    api();
    await mount();
    await callback("callback", "wide-token");
    for (const next of [480, 300, 0, 320]) await resize(next);
    expect(renders).toHaveLength(1);
    expect(removed).toEqual([]);
    expect(tokens.at(-1)).toBe("wide-token");
    await resize(272);
    await callback("callback", "compact-token");
    for (const next of [150, 299, 0, 272]) await resize(next);
    expect(renders).toHaveLength(2);
    expect(tokens.at(-1)).toBe("compact-token");
});

test("脚本加载期间改变尺寸只渲染当前档位，继续复用同一脚本", async () => {
    await mount();
    const script = document.getElementById("cloudflare-turnstile-api")!;
    await resize(272);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.getElementById("cloudflare-turnstile-api")).toBe(script);
    api();
    await act(async () => script.dispatchEvent(new dom.Event("load")));
    expect(renders.map((options) => options.size)).toEqual(["compact"]);
});

test("卸载后断开尺寸监听并忽略排队中的尺寸和验证回调", async () => {
    api();
    await mount();
    await callback("callback", "accepted-token");
    const staleObserver = observers[0];
    const staleToken = renders[0].callback as (token: string) => void;
    await act(async () => root.render(null));
    expect(observers.every((observer) => !observer.active)).toBe(true);
    await act(async () => {
        width = 272;
        staleObserver.callback();
        staleToken("late-token");
    });
    expect(tokens.at(-1)).toBe("accepted-token");
    expect(renders).toHaveLength(1);
    expect(removed).toEqual([1]);
});
