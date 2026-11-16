import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { AuthSessionPayload, AuthSettings, LocalUser } from "../../src/services/api/auth";

const dom = new Window({ url: "http://localhost/", settings: { disableJavaScriptFileLoading: true, disableCSSFileLoading: true } });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLInputElement: dom.HTMLInputElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
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
const antd = await import("antd");
const notifications: { kind: string; message: string }[] = [];
const message = Object.fromEntries(["success", "error", "warning"].map((kind) => [kind, (message: string) => notifications.push({ kind, message })]));
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message }) } }));
const applied: AuthSessionPayload[] = [];
mock.module("@/lib/user-session", () => ({ applyUserSession: async (payload: AuthSessionPayload) => applied.push(payload) }));
const { AuthLoginForm } = await import("../../src/components/auth/auth-login-form");
const { ApiError, http } = await import("../../src/services/api/request");
const { invalidateAuthSessionCache } = await import("../../src/services/api/auth");
const { i18n } = await import("../../src/i18n");

const user: LocalUser = { id: "registration-fixture", username: "new-user", displayName: "Test", role: "user", status: "active" };
const settings: AuthSettings = {
    firstUser: false,
    registrationEnabled: true,
    linuxdoEnabled: false,
    emailEnabled: false,
    emailCodeRequired: false,
    emailVerificationRequired: false,
    smsBindingAvailable: false,
    emailBindingAvailable: false,
    loginMode: "modal",
    smsLogin: false,
    emailLogin: false,
    smsRegistration: false,
    emailRegistration: false,
    smsAndEmailRegistration: false,
    agreementTitle: "测试服务协议",
};
let root: ReturnType<typeof createRoot> | undefined;
let get: ReturnType<typeof spyOn>;
let post: ReturnType<typeof spyOn>;
let registrations = 0;
let logins = 0;
let sessions = 0;
let authenticated = 0;
let loginExisting = false;
let registerResponse: () => Promise<{ user: LocalUser }>;
let sessionResponse: () => Promise<AuthSessionPayload>;
let challenges: Array<Record<string, unknown>> = [];

beforeEach(async () => {
    registrations = logins = sessions = authenticated = 0;
    loginExisting = false;
    notifications.length = applied.length = 0;
    challenges = [];
    window.turnstile = {
        render: (_container, options) => {
            challenges.push(options);
            return challenges.length;
        },
        reset: () => {},
        remove: () => {},
    };
    invalidateAuthSessionCache();
    registerResponse = async () => ({ user });
    sessionResponse = async () => ({ user });
    post = spyOn(http, "post").mockImplementation(async (path) => {
        if (path === "/auth/login") {
            logins++;
            if (loginExisting) return { user };
            throw new ApiError("尚未注册", { status: 404, reason: "account_not_registered", details: { accountKind: "username" } });
        }
        if (path === "/auth/register") {
            registrations++;
            return registerResponse();
        }
        throw new Error(`Unexpected write: ${String(path)}`);
    });
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path !== "/auth/session") throw new Error(`Unexpected read: ${String(path)}`);
        sessions++;
        return sessionResponse();
    });
    await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    get.mockRestore();
    post.mockRestore();
    invalidateAuthSessionCache();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

async function input(label: string, value: string) {
    const node = document.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    expect(node).toBeTruthy();
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(node, value);
        node.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}
async function submit() {
    await act(async () => document.querySelector("form")!.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true })));
}
async function showLogin(overrides: Partial<AuthSettings> = {}) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(
            <antd.ConfigProvider theme={{ token: { motion: false } }}>
                <AuthLoginForm settings={{ ...settings, ...overrides }} settingsFailed={false} onReloadSettings={() => {}} next="/" onAuthenticated={() => authenticated++} onViewChange={() => {}} />
            </antd.ConfigProvider>,
        );
    });
    await input("用户名 / 邮箱", "new-user");
    await input("密码", "local-test-only-password");
    await act(async () => document.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
}
async function completeChallenge(token: string) {
    const callback = challenges.at(-1)?.callback as (token: string) => void;
    expect(callback).toBeFunction();
    await act(async () => callback(token));
}
async function beginRegistration(overrides: Partial<AuthSettings> = {}) {
    await showLogin(overrides);
    if (overrides.turnstileEnabled) await completeChallenge("test-login-token");
    await submit();
    expect(document.body.textContent).toContain("该账号尚未注册");
    await input("确认密码", "local-test-only-password");
}

test("注册成功后多次会话失败只重试读取，最后正常进入", async () => {
    sessionResponse = async () => {
        if (sessions < 3) throw new Error("暂时离线");
        return { user };
    };
    await beginRegistration();
    await submit();
    expect(document.body.textContent).toContain("账号已创建");
    expect(document.activeElement).toBe(document.querySelector('[role="status"]'));
    expect(document.querySelector('input[aria-label="确认密码"]')).toBeNull();
    expect(authenticated).toBe(0);
    await submit();
    expect(authenticated).toBe(0);
    await submit();
    expect(registrations).toBe(1);
    expect(logins).toBe(1);
    expect(sessions).toBe(3);
    expect(applied).toEqual([{ user }]);
    expect(authenticated).toBe(1);
    expect(notifications.filter((notice) => notice.kind === "success")).toEqual([{ kind: "success", message: "注册成功" }]);
});

for (const scenario of ["guest", "401", "wrong-account", "disabled"] as const) {
    test(`恢复会话 ${scenario} 不会虚报登录成功或重复注册`, async () => {
        sessionResponse = async () => {
            if (scenario === "401") throw new ApiError("登录已失效", { status: 401 });
            return { user: scenario === "guest" ? null : scenario === "disabled" ? { ...user, status: "disabled" } : { ...user, id: "other-account" } };
        };
        await beginRegistration();
        await submit();
        await submit();
        expect(registrations).toBe(1);
        expect(sessions).toBe(2);
        expect(authenticated).toBe(0);
        expect(applied).toEqual([]);
        expect(notifications.some((notice) => notice.kind === "success")).toBe(false);
        expect(document.body.textContent).toContain("账号已创建");
    });
}

test("恢复失败可以回到密码登录，保留账号并清除注册步骤", async () => {
    sessionResponse = async () => {
        throw new Error("会话读取失败");
    };
    await beginRegistration();
    await submit();
    const back = [...document.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s/g, "") === "去登录")!;
    await act(async () => back.click());
    expect(document.querySelector<HTMLInputElement>('input[aria-label="用户名 / 邮箱"]')!.value).toBe("new-user");
    expect(document.querySelector('input[aria-label="确认密码"]')).toBeNull();
    loginExisting = true;
    sessionResponse = async () => ({ user });
    await submit();
    expect(logins).toBe(2);
    expect(registrations).toBe(1);
    expect(authenticated).toBe(1);
});

test("注册请求失败仍可修正后重试，首位管理员保留成功提示", async () => {
    registerResponse = async () => {
        if (registrations === 1) throw new Error("注册请求失败");
        return { user: { ...user, role: "admin" } };
    };
    sessionResponse = async () => ({ user: { ...user, role: "admin" } });
    await beginRegistration({ firstUser: true });
    await submit();
    expect(document.querySelector('input[aria-label="确认密码"]')).not.toBeNull();
    expect(sessions).toBe(0);
    await submit();
    expect(registrations).toBe(2);
    expect(authenticated).toBe(1);
    expect(notifications.filter((notice) => notice.kind === "success")).toEqual([{ kind: "success", message: "管理员账号已创建" }]);
});

test("同一轮快速提交和恢复中重复提交不会重复发请求", async () => {
    let resolveRegistration!: (value: { user: LocalUser }) => void;
    let resolveSession!: (value: AuthSessionPayload) => void;
    registerResponse = () => new Promise((resolve) => (resolveRegistration = resolve));
    sessionResponse = () => new Promise((resolve) => (resolveSession = resolve));
    await beginRegistration();
    await act(async () => {
        const form = document.querySelector("form")!;
        form.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(registrations).toBe(1);
    await act(async () => resolveRegistration({ user }));
    await submit();
    expect(sessions).toBe(1);
    expect(registrations).toBe(1);
    await act(async () => resolveSession({ user }));
    expect(authenticated).toBe(1);
});

test("Turnstile 登录转注册重新验证，注册失败可重试，已创建后仅恢复会话", async () => {
    const tokens: unknown[] = [];
    post.mockImplementation(async (path, body) => {
        tokens.push((body as { turnstileToken?: string }).turnstileToken);
        if (path === "/auth/login") {
            logins++;
            throw new ApiError("尚未注册", { status: 404, reason: "account_not_registered", details: { accountKind: "username" } });
        }
        expect(path).toBe("/auth/register");
        registrations++;
        if (registrations === 1) throw new Error("暂时离线");
        return { user };
    });
    sessionResponse = async () => {
        if (sessions === 1) throw new Error("会话暂时离线");
        return { user };
    };
    await beginRegistration({ turnstileEnabled: true, turnstileSiteKey: "test-site" });
    await submit();
    expect(registrations).toBe(0);
    await completeChallenge("registration-token-1");
    await submit();
    expect(registrations).toBe(1);
    await submit();
    expect(registrations).toBe(1);
    await completeChallenge("registration-token-2");
    await submit();
    expect(document.body.textContent).toContain("账号已创建");
    expect(document.querySelector(".auth-turnstile")).toBeNull();
    await submit();
    expect(tokens).toEqual(["test-login-token", "registration-token-1", "registration-token-2"]);
    expect(registrations).toBe(2);
    expect(sessions).toBe(2);
    expect(authenticated).toBe(1);
});
