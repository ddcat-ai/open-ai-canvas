import { afterAll, afterEach, beforeEach, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { JianyingDraftPreview } from "../../src/services/api/drama-export";

const dom = new Window({ url: "http://localhost/projects/project" });
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
})) {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App } = await import("antd");
const { JianyingDraftModal } = await import("../../src/pages/projects/studio/asset-transfer");
const { http } = await import("../../src/services/api/request");
const exports = await import("../../src/services/drama-export");

const preview: JianyingDraftPreview = {
    draftRoot: "/Users/editor/Drafts",
    revision: "review-1",
    totalSegments: 3,
    availableSegments: 2,
    missingSegments: 1,
    staleSegments: 1,
    durationMs: 9500,
    mediaBytes: 8192,
    captionCount: 2,
    warnings: ["1 个剧情段将被跳过", "1 个剧情段使用旧版本"],
    segments: [
        { index: 0, title: "开场", included: true, stale: false, durationMs: 2500, durationEstimated: false },
        { index: 1, title: "中场", included: false, stale: false, reason: "视频不可用", durationMs: 0, durationEstimated: false },
        { index: 2, title: "结尾", included: true, stale: true, durationMs: 7000, durationEstimated: false },
    ],
};
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let posts: Array<{ url: string; body: any; config: any }>;
let forms: Array<{ action: string; method: string; target: string; fields: Record<string, string> }>;
let preflight: () => Promise<JianyingDraftPreview>;
let closes: number;

beforeEach(() => {
    posts = [];
    forms = [];
    closes = 0;
    preflight = () => Promise.resolve(preview);
    exports.saveJianyingDraftRoot(preview.draftRoot);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    spyOn(http, "post").mockImplementation((url, body, config) => {
        posts.push({ url, body, config });
        return preflight() as never;
    });
    spyOn(dom.HTMLFormElement.prototype, "submit").mockImplementation(function (this: HTMLFormElement) {
        forms.push({ action: this.action, method: this.method, target: this.target, fields: Object.fromEntries([...this.querySelectorAll<HTMLInputElement>("input")].map((input) => [input.name, input.value])) });
    });
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
    mock.restore();
});
afterAll(() => dom.happyDOM.abort());

async function mount() {
    await act(async () =>
        root.render(
            <App>
                <JianyingDraftModal
                    open
                    projectId="project"
                    episodeId="episode"
                    episodeLabel="第 1 集"
                    onClose={() => {
                        closes++;
                    }}
                />
            </App>,
        ),
    );
}
function button(label: string) {
    const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent?.replace(/\s/g, "") === label.replace(/\s/g, ""));
    if (!found) throw new Error(`Missing button: ${label}`);
    return found;
}
async function click(label: string) {
    await act(async () => button(label).click());
}
async function toggle(text: string) {
    const label = [...document.querySelectorAll("label")].find((item) => item.textContent?.includes(text));
    const input = label?.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (!input) throw new Error(`Missing checkbox: ${text}`);
    await act(async () => input.click());
}
async function accept() {
    await click("检查导出内容");
    await toggle("确认跳过");
    await toggle("确认使用");
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((yes) => {
        resolve = yes;
    });
    return { promise, resolve };
}

test("path validation matches desktop path rules and examples remain placeholders", () => {
    for (const path of ["/Users/作者/Movies/Drafts", "C:\\Users\\Editor\\Drafts", "D:/中文 草稿", "\\\\server\\share\\Drafts"]) expect(exports.jianyingDraftRootProblem(path)).toBe("");
    for (const path of [
        "",
        "/",
        "C:\\",
        "relative",
        "~/Movies",
        "/Users/editor/../Drafts",
        "C:\\A\\CON",
        "C:\\A\\bad.",
        "C:\\A\\x:y",
        "\\\\server\\share",
        "/Users/x\u0001/Drafts",
        exports.defaultJianyingDraftRoot("windows"),
        exports.defaultJianyingDraftRoot("macos"),
    ])
        expect(exports.jianyingDraftRootProblem(path)).not.toBe("");
});

test("preflight lists missing and stale clips before enabling download", async () => {
    await mount();
    await click("检查导出内容");
    expect(posts).toHaveLength(1);
    expect(posts[0].url).toBe("/dramas/project/episodes/episode/jianying-draft/preview");
    expect(posts[0].body).toEqual({ draftRoot: preview.draftRoot, captions: true });
    expect(document.body.textContent).toContain("可导出 2 / 3 段");
    expect(document.body.textContent).toContain("第 2 段 · 中场：视频不可用");
    expect(button("确认并请求下载").disabled).toBe(true);
    await toggle("确认跳过");
    expect(button("确认并请求下载").disabled).toBe(true);
    await toggle("确认使用");
    expect(button("确认并请求下载").disabled).toBe(false);
    expect(forms).toHaveLength(0);
});

test("rapid clicks send one preflight and one form, without claiming completed download", async () => {
    const gate = deferred<JianyingDraftPreview>();
    preflight = () => gate.promise;
    await mount();
    await act(async () => {
        button("检查导出内容").click();
        button("检查导出内容").click();
    });
    expect(posts).toHaveLength(1);
    await act(async () => gate.resolve(preview));
    await toggle("确认跳过");
    await toggle("确认使用");
    await act(async () => {
        button("确认并请求下载").click();
        button("确认并请求下载").click();
    });
    expect(forms).toHaveLength(1);
    expect(forms[0].method).toBe("post");
    expect(forms[0].fields).toEqual({ draftRoot: preview.draftRoot, captions: "1", revision: "review-1", allowIncomplete: "1", allowStale: "1" });
    expect(forms[0].action).toEndWith("/api/dramas/project/episodes/episode/jianying-draft");
    expect(forms[0].action).not.toContain("editor");
    expect(document.body.textContent).toContain("已提交下载请求");
    expect(document.body.textContent).toContain("页面无法确认文件已下载完成");
    expect(closes).toBe(0);
    expect(document.querySelector("form")).toBeNull();
    expect(document.querySelector("iframe")).not.toBeNull();
});

test("form validation error keeps settings and offers a new check", async () => {
    await mount();
    await accept();
    await click("确认并请求下载");
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
    frame.contentDocument!.body.textContent = JSON.stringify({ code: 409, msg: "导出清单已变化" });
    await act(async () => frame.dispatchEvent(new Event("load")));
    expect(document.body.textContent).toContain("导出清单已变化");
    expect((document.querySelector('[aria-label="本机剪映草稿目录"]') as HTMLInputElement).value).toBe(preview.draftRoot);
    expect(button("检查导出内容").disabled).toBe(false);
    expect(document.querySelector("iframe")).toBeNull();
    await click("检查导出内容");
    expect(posts).toHaveLength(2);
    expect(button("确认并请求下载").disabled).toBe(true);
});

test("network check failure is recoverable and never submits an archive", async () => {
    preflight = () => Promise.reject(new Error("存储暂不可读取"));
    await mount();
    await click("检查导出内容");
    expect(document.body.textContent).toContain("存储暂不可读取");
    expect(forms).toHaveLength(0);
    preflight = () => Promise.resolve(preview);
    await click("检查导出内容");
    expect(document.body.textContent).toContain("可导出 2 / 3 段");
});

test("changing options invalidates the reviewed manifest", async () => {
    await mount();
    await accept();
    await toggle("附带台词字幕轨");
    expect(button("检查导出内容")).toBeDefined();
    expect(document.body.textContent).not.toContain("确认并请求下载");
    await click("检查导出内容");
    expect(posts[1].body.captions).toBe(false);
});

test("closing stops observation without aborting the browser's archive request", async () => {
    await mount();
    await accept();
    await click("确认并请求下载");
    const frame = document.querySelector<HTMLIFrameElement>("iframe")!;
    await act(async () => root.render(<App />));
    expect(frame.isConnected).toBe(true);
    expect(frame.onload).toBeNull();
});

test("no usable media prevents submission even after acknowledgements", async () => {
    preflight = () => Promise.resolve({ ...preview, availableSegments: 0, missingSegments: 3 });
    await mount();
    await accept();
    expect(button("确认并请求下载").disabled).toBe(true);
    expect(forms).toHaveLength(0);
});

test("asset package continues using the original streaming form contract", () => {
    exports.exportDramaAssetPackage("project", { episodeIds: ["a", "b"], media: true, prompts: false }, () => {});
    expect(forms).toHaveLength(1);
    expect(forms[0].action).toEndWith("/api/dramas/project/asset-package");
    expect(forms[0].fields.media).toBe("1");
    expect(forms[0].fields.prompts).toBe("0");
});
