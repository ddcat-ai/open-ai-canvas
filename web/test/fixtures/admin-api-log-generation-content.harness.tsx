import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { ApiLogGenerationContent as GenerationContent } from "../../src/services/api/auth";

const dom = new Window({ url: "http://localhost/admin/logs" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ApiLogGenerationContent } = await import("../../src/pages/admin/components/api-log-generation-content");
const { adminApiLogReferenceMediaURL } = await import("../../src/services/api/auth");

const content: GenerationContent = {
    prompt: "让@图片1中的商品跟随@视频1，使用@音频1。未知@图片9保留。<script>原文</script>",
    source: "snapshot",
    incomplete: false,
    references: [
        { id: "image-1", kind: "image", label: "图片1", name: "商品原图.png", available: true, mediaUrl: "https://untrusted.example/original.png" },
        { id: "video-1", kind: "video", label: "视频1", name: "参考动作.mp4", available: true },
        { id: "audio-1", kind: "audio", label: "音频1", name: "原始配音.wav", available: true },
    ],
};
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
    mock.restore();
});
afterAll(() => dom.happyDOM.abort());
async function render(value: GenerationContent | undefined = content, logId = "log-1") {
    await act(async () => root.render(<ApiLogGenerationContent key={logId} logId={logId} content={value} />));
}

test("shows three original media kinds through controlled log URLs", async () => {
    await render();
    expect(host.textContent).toContain("生成内容");
    expect(host.textContent).toContain("共 3 件");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(adminApiLogReferenceMediaURL("log-1", "image-1"));
    for (const kind of ["video", "audio"]) {
        const media = host.querySelector(kind)!;
        expect(media.getAttribute("src")).toBe(adminApiLogReferenceMediaURL("log-1", `${kind}-1`));
        expect(media.hasAttribute("controls")).toBe(true);
        expect(media.getAttribute("preload")).toBe("none");
        expect(media.hasAttribute("autoplay")).toBe(false);
    }
    expect(host.innerHTML).not.toContain("untrusted.example");
    expect(host.querySelector("script")).toBeNull();
    expect(host.textContent).toContain("<script>原文</script>");
});

test("prompt chips keep numbering and focus their matching card", async () => {
    await render();
    const chips = host.querySelectorAll<HTMLButtonElement>(".api-log-generation-mention");
    expect(chips).toHaveLength(3);
    const card = host.querySelectorAll<HTMLElement>("article")[1];
    const scroll = mock(() => {});
    card.scrollIntoView = scroll;
    await act(async () => chips[1].click());
    expect(document.activeElement).toBe(card);
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(host.querySelector(".api-log-generation-prompt")?.textContent).toBe(content.prompt);
});

test("image preview opens the original and closes without changing the log", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="查看图片1原图"]')!.click());
    const preview = document.querySelector<HTMLImageElement>(".api-log-generation-original-image");
    expect(preview?.getAttribute("src")).toBe(adminApiLogReferenceMediaURL("log-1", "image-1"));
    expect(preview?.alt).toBe("商品原图.png");
    await act(async () => document.querySelector<HTMLButtonElement>(".ant-modal-close")!.click());
    expect(document.querySelector(".api-log-generation-original-image")).toBeNull();
});

test("missing originals show an explanation and never request an arbitrary URL", async () => {
    await render({ ...content, incomplete: true, note: "该历史请求未保存原始素材", references: [{ ...content.references[0], available: false, unavailableReason: "原始资源已删除" }] });
    expect(host.textContent).toContain("该历史请求未保存原始素材");
    expect(host.textContent).toContain("原始资源已删除");
    expect(host.querySelector("img,video,audio")).toBeNull();
    expect(host.querySelectorAll(".api-log-generation-mention")).toHaveLength(1);
});

test("media read failure preserves prompt and the resource name", async () => {
    await render();
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("原始素材读取失败");
    expect(host.textContent).toContain("商品原图.png");
    expect(host.querySelector(".api-log-generation-prompt")?.textContent).toBe(content.prompt);
});

test("switching logs clears failed previews and rebinds media URLs", async () => {
    await render();
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    await render({ ...content, prompt: "另一个请求@图片1" }, "log-2");
    expect(host.textContent).not.toContain("原始素材读取失败");
    expect(host.textContent).not.toContain("未知@图片9");
    expect(host.querySelector("img")?.getAttribute("src")).toBe(adminApiLogReferenceMediaURL("log-2", "image-1"));
});

test("text-only requests and unavailable history have distinct empty states", async () => {
    await render({ prompt: "文生视频", references: [], source: "snapshot", incomplete: false });
    expect(host.textContent).toContain("本次请求未使用参考素材");
    await act(async () => root.render(<ApiLogGenerationContent key="missing" logId="missing" />));
    expect(host.textContent).toContain("该历史请求未保存可还原的提示词");
    expect(host.textContent).toContain("没有保存可还原的原始参考素材");
});
