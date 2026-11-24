import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { CreationConversation } from "@/pages/create/creation-types";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    MouseEvent: dom.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
mock.module("@/stores/use-user-store", () => ({ useUserStore: (selector: (state: { hydrated: boolean }) => unknown) => selector({ hydrated: true }) }));
let load: () => Promise<CreationConversation[] | null> = async () => [];
mock.module("@/services/creation-conversation-store", () => ({ loadCreationConversations: () => load() }));
const { act, useState } = await import("react");
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, useLocation, useNavigate } = await import("react-router");
const { setActiveUserScope } = await import("@/lib/user-scope");
const { clearCreationConversationSnapshot, writeCreationConversationSnapshot, readCreationConversationSnapshot, readCreationConversationNavigation } = await import("@/services/creation-conversation-snapshot");
const { useCreationSidebarHistory } = await import("@/hooks/use-creation-sidebar-history");
const { useCreationConversationRoute } = await import("@/pages/create/use-creation-conversation-route");
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let history: ReturnType<typeof useCreationSidebarHistory>;
let newCount = 0;
let selected: string[] = [];
const video: CreationConversation = { id: "video", title: "视频对话", updatedAt: "2026-11-10T01:00:00Z", messages: [{ id: "m1", role: "user", mode: "video", content: "镜头", createdAt: "2026-11-10T00:00:00Z" }] };
const text: CreationConversation = { ...video, id: "text", title: "文本对话", updatedAt: "2026-11-10T00:00:00Z", messages: [{ ...video.messages[0], mode: "text" }] };
function History({ userId }: { userId: string }) {
    history = useCreationSidebarHistory(userId);
    return <p>{history.items.map((item) => item.title).join("|")}</p>;
}
function Page({ ready, busy }: { ready: boolean; busy: boolean }) {
    const [activeId, setActiveId] = useState("text");
    const location = useLocation();
    const navigate = useNavigate();
    const selectRoute = useCreationConversationRoute({
        scope: "user-a",
        ready,
        activeId,
        canSelect: !busy,
        ids: ["text", "video", "new-id"],
        onSelect: (id) => {
            selected.push(id);
            setActiveId(id);
        },
        onNew: () => {
            newCount++;
            setActiveId("new-id");
            return "new-id";
        },
    });
    return (
        <>
            <output>
                {activeId}|{location.search}
            </output>
            <button onClick={() => navigate("/?conversation=video")}>video</button>
            <button
                onClick={() => {
                    setActiveId("text");
                    selectRoute("text");
                }}
            >
                drawer
            </button>
        </>
    );
}
async function renderPage(initial: string, ready = true, busy = false) {
    await act(async () =>
        root.render(
            <MemoryRouter initialEntries={[initial]}>
                <Page ready={ready} busy={busy} />
            </MemoryRouter>,
        ),
    );
}
async function renderHistory(userId = "user-a") {
    await act(async () =>
        root.render(
            <MemoryRouter>
                <History userId={userId} />
            </MemoryRouter>,
        ),
    );
}
async function eventually(check: () => void) {
    const deadline = Date.now() + 1500;
    let failure: unknown;
    do {
        try {
            check();
            return;
        } catch (error) {
            failure = error;
        }
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
        });
    } while (Date.now() < deadline);
    throw failure;
}
beforeEach(() => {
    setActiveUserScope("user-a");
    clearCreationConversationSnapshot();
    newCount = 0;
    selected = [];
    load = async () => [text, video];
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    clearCreationConversationSnapshot();
});
afterAll(() => dom.happyDOM.abort());

test("真实历史 hook 读取创作记录，过滤空对话，按时间与最近模式展示", async () => {
    await renderHistory();
    await eventually(() =>
        expect(history.items.map((item) => [item.id, item.mode])).toEqual([
            ["video", "video"],
            ["text", "text"],
        ]),
    );
    await act(async () => writeCreationConversationSnapshot("user-a", [text, { ...video, messages: [...video.messages, { ...video.messages[0], mode: "image" }] }, { ...text, id: "empty", messages: [] }]));
    expect(history.items.map((item) => [item.id, item.mode])).toEqual([
        ["video", "image"],
        ["text", "text"],
    ]);
});

test("磁盘迟到结果不能覆盖首页新快照；切换账号立即隐藏旧记录", async () => {
    let resolveLoad!: (value: CreationConversation[]) => void;
    load = () =>
        new Promise((resolve) => {
            resolveLoad = resolve;
        });
    await renderHistory();
    await act(async () => writeCreationConversationSnapshot("user-a", [video]));
    await act(async () => resolveLoad([text]));
    expect(history.items.map((item) => item.id)).toEqual(["video"]);
    setActiveUserScope("user-b");
    load = async () => [];
    await renderHistory("user-b");
    await eventually(() => expect(history.loading).toBe(false));
    expect(history.items).toEqual([]);
    expect(readCreationConversationSnapshot("user-a")).toBeNull();
});

test("历史加载失败显示错误，重试后恢复", async () => {
    load = async () => {
        throw new Error("storage unavailable");
    };
    await renderHistory();
    await eventually(() => expect(history.error).toBe("storage unavailable"));
    expect(history.loading).toBe(false);
    load = async () => [video];
    await act(async () => history.refetch());
    await eventually(() => expect(history.items[0]?.id).toBe("video"));
    expect(history.error).toBe("");
});

test("深链接等待首页恢复后选择正确对话，内部抽屉同步 URL", async () => {
    await renderPage("/?conversation=video", false);
    expect(selected).toEqual([]);
    await renderPage("/?conversation=video", true);
    expect(selected).toEqual(["video"]);
    expect(host.querySelector("output")?.textContent).toBe("video|?conversation=video");
    expect(readCreationConversationNavigation("user-a")?.activeId).toBe("video");
    await act(async () => host.querySelectorAll<HTMLButtonElement>("button")[1].click());
    expect(host.querySelector("output")?.textContent).toBe("text|?conversation=text");
});

test("新建只执行一次，URL 替换为真实身份", async () => {
    await renderPage("/?conversation=new");
    await renderPage("/?conversation=new");
    expect(newCount).toBe(1);
    expect(host.querySelector("output")?.textContent).toBe("new-id|?conversation=new-id");
});

test("忙碌时拒绝切换，任务结束不自动执行旧请求", async () => {
    await renderPage("/?conversation=video", true, true);
    expect(selected).toEqual([]);
    expect(host.querySelector("output")?.textContent).toBe("text|?conversation=text");
    await renderPage("/?conversation=video", true, false);
    expect(selected).toEqual([]);
    expect(readCreationConversationNavigation("user-a")?.canSelect).toBe(true);
});
