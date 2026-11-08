import { afterAll, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/admin" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    HTMLTextAreaElement: dom.HTMLTextAreaElement,
    HTMLInputElement: dom.HTMLInputElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    KeyboardEvent: dom.KeyboardEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation } = await import("react-router");
const { AdminGlobalSearch } = await import("../../src/pages/admin/components/admin-global-search");
afterAll(() => dom.happyDOM.abort());

function Page() {
    const location = useLocation();
    return (
        <>
            <AdminGlobalSearch
                entries={[
                    { path: "/admin/settings/email", label: "邮件服务", group: "系统设置", keywords: "SMTP" },
                    { path: "/admin/users", label: "用户管理", group: "用户与运营" },
                ]}
            />
            <output>{location.pathname}</output>
        </>
    );
}

test("搜索并点击跳转，输入被清空；无结果不会跳转；Enter 选择结果", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
        await act(async () =>
            root.render(
                <MemoryRouter initialEntries={["/admin"]}>
                    <Page />
                </MemoryRouter>,
            ),
        );
        const input = host.querySelector<HTMLInputElement>('[aria-label="搜索后台页面"]')!;
        const type = async (value: string) => {
            await act(async () => {
                input.focus();
                Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
        };
        await type("smtp");
        const result = [...document.querySelectorAll<HTMLElement>(".ant-select-item-option")].find((item) => item.textContent?.includes("邮件服务"));
        expect(result).toBeDefined();
        await act(async () => result!.click());
        expect(host.querySelector("output")?.textContent).toBe("/admin/settings/email");
        expect(input.value).toBe("");
        await type("没有这个功能");
        expect(document.body.textContent).toContain("未找到对应后台页面");
        await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })));
        await act(async () => input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", keyCode: 13, bubbles: true })));
        expect(host.querySelector("output")?.textContent).toBe("/admin/settings/email");
        await type("用户");
        await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", keyCode: 40, bubbles: true })));
        await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", keyCode: 13, which: 13, bubbles: true })));
        expect(host.querySelector("output")?.textContent).toBe("/admin/users");
    } finally {
        await act(async () => root.unmount());
        host.remove();
    }
});
