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
const { MemoryRouter, useLocation } = await import("react-router");
const antd = await import("antd");
mock.module("antd", () => ({ ...antd, App: { ...antd.App, useApp: () => ({ message: { success: () => {}, error: () => {}, warning: () => {} } }) } }));
const applied: AuthSessionPayload[] = [];
let applySessionFailure = false;
mock.module("@/lib/user-session", () => ({
    applyUserSession: async (payload: AuthSessionPayload) => {
        if (applySessionFailure) throw new Error("初始化用户空间失败");
        applied.push(payload);
    },
}));
const { WechatRegistrationForm } = await import("../../src/components/auth/wechat-registration-form");
const { ApiError, http } = await import("../../src/services/api/request");
const { invalidateAuthSessionCache } = await import("../../src/services/api/auth");
const { i18n } = await import("../../src/i18n");

const user: LocalUser = { id: "wechat-registration-fixture", username: "wechat-fixture", displayName: "测试账号", role: "user", status: "active", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
const target = "/projects?view=mine";
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
let remove: ReturnType<typeof spyOn>;
let registrations = 0;
let sessions = 0;
let registrationsRead = 0;
let cancellations = 0;
let verifications = 0;
let registerResponse: () => Promise<{ user: LocalUser; next: string }>;
let sessionResponse: () => Promise<AuthSessionPayload>;
let registrationBodies: unknown[] = [];
let challenges: Array<Record<string, unknown>> = [];

beforeEach(async () => {
    registrations = sessions = registrationsRead = cancellations = verifications = 0;
    applied.length = 0;
    applySessionFailure = false;
    registrationBodies = [];
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
    registerResponse = async () => ({ user, next: target });
    sessionResponse = async () => ({ user });
    post = spyOn(http, "post").mockImplementation(async (path, body) => {
        if (path === "/auth/wechat/registration") {
            registrations++;
            registrationBodies.push(body);
            return registerResponse();
        }
        if (path === "/auth/verification") {
            verifications++;
            return { ticket: "single-use-email-ticket", expiresIn: 600, retryAfter: 60 };
        }
        throw new Error(`Unexpected write: ${String(path)}`);
    });
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (path === "/auth/wechat/registration") {
            registrationsRead++;
            return { displayName: "微信测试账号", next: "/from-pending-ticket", acceptedTerms: true };
        }
        if (path === "/auth/session") {
            sessions++;
            return sessionResponse();
        }
        throw new Error(`Unexpected read: ${String(path)}`);
    });
    remove = spyOn(http, "delete").mockImplementation(async (path) => {
        expect(path).toBe("/auth/wechat/registration");
        cancellations++;
        return { cleared: true };
    });
    await i18n.changeLanguage("zh-CN");
});
afterEach(async () => {
    if (root) await act(async () => root!.unmount());
    root = undefined;
    document.body.innerHTML = "";
    get.mockRestore();
    post.mockRestore();
    remove.mockRestore();
    invalidateAuthSessionCache();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) value ? Object.defineProperty(globalThis, key, value) : Reflect.deleteProperty(globalThis, key);
});

function LocationProbe() {
    const location = useLocation();
    return <output data-location>{location.pathname + location.search}</output>;
}
function currentLocation() {
    return document.querySelector("[data-location]")!.textContent;
}
async function showRegistration(overrides: Partial<AuthSettings> = {}, settingsFailed = false, next = "/from-form") {
    if (!root) {
        const host = document.createElement("div");
        document.body.append(host);
        root = createRoot(host);
    }
    await act(async () => {
        root!.render(
            <antd.ConfigProvider theme={{ token: { motion: false } }}>
                <MemoryRouter initialEntries={["/wechat/register"]}>
                    <WechatRegistrationForm settings={{ ...settings, ...overrides }} settingsFailed={settingsFailed} onReloadSettings={() => {}} next={next} />
                    <LocationProbe />
                </MemoryRouter>
            </antd.ConfigProvider>,
        );
    });
}
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
async function clickButton(text: string) {
    const button = [...document.querySelectorAll("button")].find((button) => button.textContent?.replace(/\s/g, "") === text)!;
    expect(button).toBeTruthy();
    expect(button.disabled).toBe(false);
    await act(async () => button.click());
}

test("微信注册成功后多次会话失败只重试读取，最后进入回执目标", async () => {
    sessionResponse = async () => {
        if (sessions < 3) throw new Error("暂时离线");
        return { user };
    };
    await showRegistration();
    await submit();
    expect(document.body.textContent).toContain("账号已创建");
    expect(document.activeElement).toBe(document.querySelector('[role="status"]'));
    expect(document.querySelector('input[type="email"]')).toBeNull();
    expect(currentLocation()).toBe("/wechat/register");
    await showRegistration({ registrationEnabled: false }, true, "/changed-after-registration");
    await submit();
    expect(currentLocation()).toBe("/wechat/register");
    await submit();
    expect(registrations).toBe(1);
    expect(registrationsRead).toBe(1);
    expect(sessions).toBe(3);
    expect(applied).toEqual([{ user }]);
    expect(currentLocation()).toBe(target);
});

for (const scenario of ["guest", "401", "wrong-account", "disabled"] as const) {
    test(`会话恢复 ${scenario} 不会虚报登录成功或再次注册`, async () => {
        sessionResponse = async () => {
            if (scenario === "401") throw new ApiError("登录已失效", { status: 401 });
            return { user: scenario === "guest" ? null : scenario === "disabled" ? { ...user, status: "disabled" } : { ...user, id: "another-account" } };
        };
        await showRegistration();
        await submit();
        await submit();
        expect(registrations).toBe(1);
        expect(sessions).toBe(2);
        expect(applied).toEqual([]);
        expect(currentLocation()).toBe("/wechat/register");
        expect(document.body.textContent).toContain("账号已创建");
    });
}

test("成功回执缺少用户身份时保持恢复状态并拒绝套用会话", async () => {
    registerResponse = async () => ({ user: { ...user, id: "" }, next: target });
    await showRegistration();
    await submit();
    await submit();
    expect(registrations).toBe(1);
    expect(applied).toEqual([]);
    expect(currentLocation()).toBe("/wechat/register");
    expect(document.body.textContent).toContain("未能确认有效的登录状态");
});

test("用户空间初始化失败只重新读取及应用会话", async () => {
    applySessionFailure = true;
    await showRegistration();
    await submit();
    expect(document.body.textContent).toContain("初始化用户空间失败");
    expect(currentLocation()).toBe("/wechat/register");
    applySessionFailure = false;
    await submit();
    expect(registrations).toBe(1);
    expect(sessions).toBe(2);
    expect(applied).toEqual([{ user }]);
    expect(currentLocation()).toBe(target);
});

test("快速重复提交以及会话恢复中的重复提交不会重放请求", async () => {
    let resolveRegistration!: (value: { user: LocalUser; next: string }) => void;
    let resolveSession!: (value: AuthSessionPayload) => void;
    registerResponse = () => new Promise((resolve) => (resolveRegistration = resolve));
    sessionResponse = () => new Promise((resolve) => (resolveSession = resolve));
    await showRegistration();
    await act(async () => {
        const form = document.querySelector("form")!;
        form.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
        form.dispatchEvent(new dom.Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(registrations).toBe(1);
    await act(async () => resolveRegistration({ user, next: target }));
    await submit();
    expect(sessions).toBe(1);
    expect([...document.querySelectorAll("form button")].every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
    await act(async () => resolveSession({ user }));
    expect(registrations).toBe(1);
    expect(currentLocation()).toBe(target);
});

test("已消费的邮件票据和 Turnstile 令牌不会阻止恢复或再次发送", async () => {
    sessionResponse = async () => {
        if (sessions === 1) throw new Error("会话读取失败");
        return { user };
    };
    await showRegistration({ emailVerificationRequired: true, emailRegistration: true, turnstileEnabled: true, turnstileSiteKey: "local-test-only" });
    await input("邮箱", "wechat-fixture@example.com");
    await clickButton("获取验证码");
    await input("邮件验证码", "123456");
    await submit();
    expect(registrations).toBe(0);
    const callback = challenges.at(-1)!.callback as (token: string) => void;
    await act(async () => callback("single-use-turnstile-token"));
    await submit();
    expect(document.querySelector(".auth-turnstile")).toBeNull();
    expect(document.querySelector('input[aria-label="邮件验证码"]')).toBeNull();
    await submit();
    expect(registrations).toBe(1);
    expect(registrationBodies).toMatchObject([{ ticket: "single-use-email-ticket", emailCode: "123456", turnstileToken: "single-use-turnstile-token" }]);
    expect(verifications).toBe(1);
    expect(challenges).toHaveLength(1);
    expect(registrationsRead).toBe(1);
    expect(sessions).toBe(2);
    expect(currentLocation()).toBe(target);
});

test("恢复失败返回普通登录保留回执目标，不再取消已消费的微信注册票据", async () => {
    sessionResponse = async () => {
        throw new Error("会话读取失败");
    };
    await showRegistration();
    await submit();
    await clickButton("去登录");
    expect(cancellations).toBe(0);
    expect(registrations).toBe(1);
    expect(currentLocation()).toBe(`/login?next=${encodeURIComponent(target)}`);
});

test("回执目标拒绝站外跳转，恢复登录后进入首页", async () => {
    registerResponse = async () => ({ user, next: "https://outside.example.com/" });
    await showRegistration();
    await submit();
    expect(currentLocation()).toBe("/");
});

test("注册请求本身失败仍允许修正后重试，未创建账号可正常取消", async () => {
    registerResponse = async () => {
        throw new Error("验证码无效");
    };
    await showRegistration();
    await submit();
    expect(document.querySelector('input[type="email"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("账号已创建");
    expect(sessions).toBe(0);
    await submit();
    expect(registrations).toBe(2);
    await clickButton("使用已有账号登录");
    expect(cancellations).toBe(1);
    expect(currentLocation()).toBe(`/login?next=${encodeURIComponent("/from-form")}`);
});
