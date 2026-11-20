import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";

const dom = new Window({ url: "http://localhost/projects" });
const globals = ["document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "SVGElement", "ShadowRoot", "Event", "KeyboardEvent", "MutationObserver", "ResizeObserver"] as const;
for (const key of globals) Object.defineProperty(globalThis, key, { configurable: true, value: dom[key] });
Object.assign(globalThis, { window: dom, getComputedStyle: dom.getComputedStyle.bind(dom), IS_REACT_ACT_ENVIRONMENT: true });
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ListSearchInput } = await import("../../src/components/ui/base/list-search-input");
const { PaginationBar } = await import("../../src/components/layout/workspace-page");
const { Switch } = await import("../../src/components/ui/base/switch");

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
});
afterAll(() => dom.happyDOM.abort());

async function inputText(input: HTMLInputElement, value: string) {
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

test("list search commits only the confirmed IME text and Escape clears just the keyword", async () => {
    const commits: string[] = [];
    function Form() {
        const [value, setValue] = useState("");
        return (
            <ListSearchInput
                value={value}
                onValueChange={(keyword) => {
                    commits.push(keyword);
                    setValue(keyword);
                }}
            />
        );
    }
    await act(async () => root.render(<Form />));
    const input = host.querySelector("input")!;
    await act(async () => input.focus());
    await act(async () => input.dispatchEvent(new Event("compositionstart", { bubbles: true })));
    await inputText(input, "hai");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("hai");
    expect(commits).toEqual([]);
    await inputText(input, "海");
    await act(async () => input.dispatchEvent(new Event("compositionend", { bubbles: true })));
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(commits).toEqual(["海", ""]);
    expect(document.activeElement).toBe(input);
});

test("pagination skips only hidden pages, ignores the current page and cancels an unfinished jump", async () => {
    const changes: number[] = [];
    function List() {
        const [current, setPage] = useState(4);
        return (
            <PaginationBar
                current={current}
                pageSize={10}
                pageSizeOptions={[10]}
                total={80}
                onChange={(page) => {
                    changes.push(page);
                    setPage(page);
                }}
            />
        );
    }
    await act(async () => root.render(<List />));
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-current="page"]')!.click());
    await act(async () => host.querySelector<HTMLButtonElement>(".app-pagination-skip")!.click());
    expect(changes).toEqual([7]);
    const input = host.querySelector("input")!;
    await inputText(input, "3");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(input.value).toBe("");
    await inputText(input, "99");
    await act(async () => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(changes).toEqual([7, 8]);
    expect(host.querySelector<HTMLButtonElement>(".app-pagination-next")!.disabled).toBe(true);
});

test("a pending switch retains its thumb and checked state and cannot fire a second change", async () => {
    const changes: boolean[] = [];
    const control = (loading: boolean) => <Switch checked loading={loading} onChange={(value) => changes.push(value)} aria-label="通知" />;
    await act(async () => root.render(control(false)));
    const thumb = host.querySelector(".sc-switch-thumb");
    await act(async () => root.render(control(true)));
    const button = host.querySelector("button")!;
    expect(host.querySelector(".sc-switch-thumb")).toBe(thumb);
    expect(button.getAttribute("aria-checked")).toBe("true");
    expect(button.getAttribute("aria-busy")).toBe("true");
    await act(async () => button.click());
    expect(changes).toEqual([]);
    await act(async () => root.render(control(false)));
    await act(async () => button.click());
    expect(changes).toEqual([false]);
});
