import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { ComponentProps, ReactNode } from "react";
import type { CloudAgentChatMessage } from "@/components/canvas/canvas-cloud-agent-chat-ui";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import type { SkillPreset } from "@/services/api/skills";

// 子进程隔离 DOM 全局与真实 Zustand store，不替换组件、布局 hook、AntD 或动画库。
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
const { MotionConfig } = await import("motion/react");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { MemoryRouter } = await import("react-router");
const { AgentConversation, AgentHeader, ComposerControls } = await import("@/components/canvas/canvas-cloud-agent-panel-parts");
const { AgentChatComposer, AgentQuestionBar, AgentSceneCapsules } = await import("@/components/canvas/canvas-cloud-agent-chat-ui");
const { CanvasAgentSkillLibraryModal } = await import("@/components/canvas/canvas-agent-skill-library-modal");
const { useAgentPanelDock } = await import("@/components/canvas/use-agent-panel-dock");
const { useGlobalAgentStore } = await import("@/stores/use-global-agent-store");
const { restoreAgentPanelDock } = await import("@/lib/canvas/agent-panel-dock");
const { defaultConfig } = await import("@/stores/use-config-store");
const { canvasThemes } = await import("@/lib/canvas-theme");

const theme = canvasThemes.light;
const initialDock = { ...useGlobalAgentStore.getState().dock };
const noop = () => {};
const canvas = { canvasId: "sidebar-canvas", nodeCount: 1, selectedNodeIds: [], references: [] };
const preset: SkillPreset = { presetId: "story", name: "短片起步组合", scene: "film", skillIds: ["story-skill"], rationale: "先梳理短片结构", source: "test", evidence: "fixture", upgrade: "" };
const presetBuckets = [{ key: "film", label: "影视创作", presets: [preset], skills: [] }];
const curationState = { curation: null, error: "", retry: noop };
const installedIds = new Set<string>();
const reference: CanvasResourceReference = { id: "video-123", nodeId: "video-123", kind: "video", label: "片头镜头", title: "片头镜头", sourceType: "video", active: true };
const mutation: CloudAgentChatMessage = {
    id: "mutation-1",
    role: "tool",
    title: "canvas_apply_ops",
    text: "已调整镜头标题",
    detail: { eventType: "tool_completed", toolName: "canvas_apply_ops", runId: "run-1", canvasId: "sidebar-canvas", callId: "call-1", result: { snapshotHash: "a".repeat(64), committed: true } },
};
const pendingApproval = {
    approvalId: "approval-1",
    reason: "",
    detail: {
        toolName: "generate_media",
        preview: {
            kind: "media_generation",
            title: "确认生成视频",
            description: "预计 12 积分；批准后才会提交收费任务。",
            items: [{ operation: "generate_media", nodeId: "video-123", nodeTitle: "片头镜头", summary: "生成视频《片头镜头》", details: ["模型：视频模型", "时长：5 秒"] }],
        },
    },
};

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: InstanceType<typeof QueryClient>;
let errors: unknown[];
let historyClicks: number;
let newClicks: number;
let sent: string[];
let chosenPresets: string[];

beforeEach(() => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    useGlobalAgentStore.setState({ open: true, canvas, dock: { ...initialDock } });
    host = document.createElement("div");
    document.body.append(host);
    errors = [];
    root = createRoot(host, { onUncaughtError: (error) => errors.push(error) });
    client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    historyClicks = 0;
    newClicks = 0;
    sent = [];
    chosenPresets = [];
});
afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
    expect(errors).toEqual([]);
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(children: ReactNode) {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>
                        <MemoryRouter>
                            <MotionConfig reducedMotion="always">{children}</MotionConfig>
                        </MemoryRouter>
                    </QueryClientProvider>
                </App>
            </ConfigProvider>,
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
function button(label: string, scope: ParentNode = host) {
    const found = Array.from(scope.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label || item.querySelector("strong")?.textContent?.trim() === label);
    expect(found, `找不到按钮：${label}`).toBeDefined();
    return found!;
}
async function click(label: string, scope: ParentNode = host) {
    await act(async () => button(label, scope).click());
}
async function menu(label: string) {
    await click("更多");
    let item: Element | undefined;
    await eventually(() => {
        item = Array.from(document.querySelectorAll('[role="menuitem"]')).find((element) => element.textContent?.includes(label));
        expect(item).toBeDefined();
    });
    await act(async () => (item as HTMLElement).click());
}
function editor() {
    const field = host.querySelector<HTMLElement>('[aria-label="Agent 输入"]');
    expect(field).not.toBeNull();
    return field!;
}
async function type(text: string) {
    await act(async () => {
        const field = editor();
        field.focus();
        if (field instanceof HTMLTextAreaElement) {
            Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, text);
        } else field.textContent = text;
        field.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    });
}
function editorText() {
    const field = editor();
    return field instanceof HTMLTextAreaElement ? field.value : field.textContent;
}
async function viewport(width: number) {
    await act(async () => {
        Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
        window.dispatchEvent(new Event("resize"));
    });
}
function conversation(props: Partial<ComponentProps<typeof AgentConversation>> = {}) {
    return <AgentConversation theme={theme} messages={[]} references={[]} busy={false} approval={null} approvalSubmitting={false} onApprovalReasonChange={noop} onApprove={noop} onReject={noop} {...props} />;
}
function liveIndicators() {
    return host.querySelectorAll(".agent-working-indicator, .agent-activity.is-live, .ai-message-markdown-streaming");
}

// 这里只持有生产组件要求的受控值；开合与停靠使用真实全局 store/hook，输入区是真实编辑器。
function SidebarFixture() {
    const dock = useAgentPanelDock();
    const open = useGlobalAgentStore((state) => state.open);
    const [prompt, setPrompt] = useState("");
    const [messages, setMessages] = useState<CloudAgentChatMessage[]>([]);
    const nodeCount = useGlobalAgentStore((state) => state.canvas?.nodeCount ?? null);
    const [skillsOpen, setSkillsOpen] = useState(false);
    return (
        <>
            {!open ? (
                <button type="button" onClick={() => useGlobalAgentStore.getState().openAgent()}>
                    重新打开 Agent
                </button>
            ) : (
                <aside data-testid="sidebar" data-layout={dock.active ? "docked" : "floating"}>
                    <AgentHeader
                        theme={theme}
                        hasMessages
                        conversationTitle="短片创作"
                        statusLabel="待命"
                        statusColor={theme.node.muted}
                        onNew={() => newClicks++}
                        onHistory={() => historyClicks++}
                        onSettings={noop}
                        onResetLayout={noop}
                        docked={dock.active}
                        onToggleDock={dock.available ? () => useGlobalAgentStore.getState().setDocked(!dock.active) : undefined}
                        onCollapse={() => useGlobalAgentStore.getState().closeAgent()}
                        onExport={noop}
                        exporting={false}
                    />
                    {conversation({ messages, nodeCount, onChooseSkill: () => setSkillsOpen(true), onDraftPrompt: (draft) => setPrompt((current) => (current.trim() ? `${current}\n\n${draft}` : draft)) })}
                    <AgentChatComposer
                        prompt={prompt}
                        theme={theme}
                        placeholder="描述创作想法"
                        onPromptChange={setPrompt}
                        onSubmit={() => {
                            sent.push(prompt);
                            setMessages([{ id: "sent-user", role: "user", text: prompt }]);
                            setPrompt("");
                        }}
                        includeAssetLibrary={false}
                        left={
                            <ComposerControls
                                config={defaultConfig}
                                selectedModel=""
                                permissionMode="read_only"
                                theme={theme}
                                onModelChange={noop}
                                onPermissionChange={noop}
                                skillsOpen={skillsOpen}
                                onSkillsOpenChange={setSkillsOpen}
                                selectedSkillCount={0}
                                reasoningMode="off"
                                onReasoningModeChange={noop}
                            />
                        }
                    />
                </aside>
            )}
            <CanvasAgentSkillLibraryModal
                open={skillsOpen}
                curationState={curationState}
                platformCategory=""
                onPlatformCategoryChange={noop}
                theme={theme}
                installedSkills={[]}
                marketSkills={[]}
                selectedSkillIds={[]}
                categories={[]}
                libraryCategories={[]}
                category="all"
                search=""
                loading={false}
                hasMore={false}
                onClose={() => setSkillsOpen(false)}
                onCategoryChange={noop}
                onSearch={noop}
                onToggle={noop}
                onInstall={async () => {}}
                onLoadMore={async () => {}}
                presets={skillsOpen ? <AgentSceneCapsules buckets={presetBuckets} installedIds={installedIds} theme={theme} onPick={(value) => chosenPresets.push(value.presetId)} onPickSkill={noop} /> : undefined}
            />
        </>
    );
}

test("空会话恢复原光球、居中欢迎文案和三个入口，输入仍可操作", async () => {
    await render(<SidebarFixture />);
    expect(host.querySelector(".agent-welcome-orb")).not.toBeNull();
    expect(host.querySelector(".agent-welcome-intro h2")?.textContent).toContain("让灵感，慢慢成形");
    expect(host.querySelectorAll(".agent-welcome-actions button")).toHaveLength(3);
    expect(host.querySelector(".agent-welcome-footnote")?.textContent).toBe("先聊想法，再决定下一步");
    expect(host.querySelector(".agent-conversation-starter")).toBeNull();
    expect(document.querySelector(".agent-scene-capsules")).toBeNull();
    expect(button("发送").disabled).toBe(true);
    expect(button("打开 Skills 技能库").disabled).toBe(false);
    await type("保留我的短片草稿");
    expect(button("发送").disabled).toBe(false);
    await click("发送");
    expect(sent).toEqual(["保留我的短片草稿"]);
});

test("原欢迎页创作入口只填草稿、保留已有输入，发送后收起", async () => {
    await render(<SidebarFixture />);
    await type("我的短片是都市题材");
    await click("从灵感构思故事");
    expect(editorText()).toContain("我的短片是都市题材");
    expect(editorText()).toContain("先询问我的想法，不要直接生成");
    expect(sent).toEqual([]);
    expect(host.querySelector(".agent-welcome")).not.toBeNull();
    await click("发送");
    expect(sent).toHaveLength(1);
    expect(host.querySelector(".agent-welcome")).toBeNull();
});

test("欢迎页梳理入口仅在有画布节点时可用", async () => {
    await render(<SidebarFixture />);
    expect(button("一起梳理当前画布").disabled).toBe(false);
    await click("一起梳理当前画布");
    expect(editorText()).toContain("梳理素材与节点之间的关系");
    expect(sent).toEqual([]);
    await act(async () => useGlobalAgentStore.getState().setCanvas({ ...canvas, nodeCount: 0 }));
    expect(button("一起梳理当前画布").disabled).toBe(true);
    expect(host.textContent).toContain("添加节点后，一起梳理创作思路");
    expect(button("从灵感构思故事").disabled).toBe(false);
    await act(async () => useGlobalAgentStore.getState().setCanvas(null));
    expect(button("一起梳理当前画布").disabled).toBe(true);
});

test("历史恢复、执行与审批阶段不展示原欢迎页", async () => {
    await render(conversation());
    expect(host.querySelector(".agent-welcome")).toBeNull();
    await render(conversation({ onDraftPrompt: noop, onChooseSkill: noop, busy: true }));
    expect(host.querySelector(".agent-welcome")).toBeNull();
    await render(conversation({ onDraftPrompt: noop, onChooseSkill: noop, approval: pendingApproval }));
    expect(host.querySelector(".agent-welcome")).toBeNull();
});

test("真实停靠 hook 默认宽屏侧栏，窄屏和非画布自动使用浮窗", async () => {
    await render(<SidebarFixture />);
    const layout = () => host.querySelector('[data-testid="sidebar"]')?.getAttribute("data-layout");
    expect(layout()).toBe("docked");
    await viewport(700);
    expect(layout()).toBe("floating");
    await viewport(1280);
    expect(layout()).toBe("docked");
    await act(async () => useGlobalAgentStore.getState().setCanvas(null));
    expect(layout()).toBe("floating");
    await act(async () => useGlobalAgentStore.getState().setCanvas(canvas));
    expect(layout()).toBe("docked");
});

test("显式浮窗偏好保留，改视口或开关面板不会重置偏好", async () => {
    useGlobalAgentStore.setState({ dock: restoreAgentPanelDock(JSON.stringify({ docked: false, width: 468 })) });
    await render(<SidebarFixture />);
    const layout = () => host.querySelector('[data-testid="sidebar"]')?.getAttribute("data-layout");
    expect(layout()).toBe("floating");
    await viewport(700);
    await viewport(1440);
    expect(layout()).toBe("floating");
    await click("收起 Agent");
    await click("重新打开 Agent");
    expect(layout()).toBe("floating");
    expect(useGlobalAgentStore.getState().dock.width).toBe(468);
});

test("标题历史、新建、更多停靠与关闭均可点击，切换和开关保留输入", async () => {
    await render(<SidebarFixture />);
    expect(host.querySelector(".agent-panel-context")).toBeNull();
    await click("历史对话，当前：短片创作");
    await click("新建对话");
    expect(historyClicks).toBe(1);
    expect(newClicks).toBe(1);
    await type("第二行镜头还没发送");
    await menu("改为浮动窗口");
    expect(host.querySelector('[data-testid="sidebar"]')?.getAttribute("data-layout")).toBe("floating");
    expect(editorText()).toBe("第二行镜头还没发送");
    await menu("停靠到画布右侧");
    expect(host.querySelector('[data-testid="sidebar"]')?.getAttribute("data-layout")).toBe("docked");
    await click("收起 Agent");
    expect(host.querySelector('[aria-label="Agent 输入"]')).toBeNull();
    await click("重新打开 Agent");
    expect(editorText()).toBe("第二行镜头还没发送");
});

test("原欢迎页选择技能打开技能库，预设仅在主动打开后展示", async () => {
    await render(<SidebarFixture />);
    expect(document.querySelector(".agent-scene-capsules")).toBeNull();
    await click("选择技能，开始创作");
    await eventually(() => expect(document.querySelector('[role="dialog"] .agent-scene-capsules')).not.toBeNull());
    expect(chosenPresets).toEqual([]);
    const category = document.querySelector<HTMLButtonElement>('button[data-scene="film"]');
    expect(category).not.toBeNull();
    await act(async () => category!.click());
    const choose = Array.from(document.querySelectorAll<HTMLButtonElement>(".agent-scene-capsule")).find((item) => item.textContent?.includes(preset.name));
    expect(choose).toBeDefined();
    expect(document.querySelector(".agent-scene-capsules-note")?.textContent).toContain("缺失技能将加入技能库");
    await act(async () => choose!.click());
    expect(chosenPresets).toEqual([preset.presetId]);
    await act(async () => document.querySelector<HTMLButtonElement>(".canvas-agent-skill-library-close")!.click());
    await eventually(() => expect(document.querySelector(".agent-scene-capsules")).toBeNull());
});

test("执行工具时只保留过程行状态，展开可查看真实操作，结束后正文仍在", async () => {
    await render(conversation({ busy: true, messages: [mutation] }));
    expect(liveIndicators()).toHaveLength(1);
    expect(host.querySelector(".agent-working-indicator")).toBeNull();
    const toggle = host.querySelector<HTMLButtonElement>(".agent-operation-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await act(async () => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector(".agent-operation-list")).not.toBeNull();
    await render(conversation({ messages: [mutation, { id: "answer", role: "assistant", text: "镜头标题已调整。" }] }));
    expect(liveIndicators()).toHaveLength(0);
    expect(host.textContent).toContain("镜头标题已调整。");
});

test("流式思考与流式正文各自承担唯一工作状态", async () => {
    await render(conversation({ busy: true, messages: [{ id: "think", role: "assistant", text: "检查素材关系", reasoning: true, streaming: true }] }));
    expect(liveIndicators()).toHaveLength(1);
    expect(host.querySelector(".agent-working-indicator")).toBeNull();
    await render(conversation({ busy: true, messages: [{ id: "answer", role: "assistant", text: "正在整理镜头说明", streaming: true }] }));
    expect(liveIndicators()).toHaveLength(1);
    expect(host.querySelector(".agent-working-indicator")).toBeNull();
    await eventually(() => expect(host.textContent).toContain("正在整理镜头说明"));
});

for (const [activity, label] of [
    ["submitting", "正在发送…"],
    ["queued", "等待启动"],
    ["stopping", "正在停止…"],
] as const) {
    test(`${label}是明确且唯一的工作状态`, async () => {
        await render(conversation({ busy: true, activity, messages: [mutation] }));
        expect(liveIndicators()).toHaveLength(1);
        expect(host.querySelector('[role="status"]')?.textContent).toBe(label);
        expect(host.querySelector(".agent-operation-feed.is-live")).toBeNull();
    });
}

for (const [activity, label] of [
    ["stopping", "正在停止…"],
    ["queued", "等待启动"],
] as const) {
    for (const reasoning of [true, false]) {
        test(`${label}时旧流式${reasoning ? "思考" : "正文"}不再同时宣告运行`, async () => {
            const messages: CloudAgentChatMessage[] = [{ id: "stream", role: "assistant", text: "检查素材关系", reasoning, streaming: true }];
            await render(conversation({ busy: true, messages }));
            await render(conversation({ busy: true, activity, messages }));
            await eventually(() => expect(liveIndicators()).toHaveLength(1));
            expect(host.querySelector(".agent-working-indicator")?.textContent).toBe(label);
        });
    }
}

test("等待审批时显示目标、费用与真实决定按钮，不继续显示工具执行状态", async () => {
    let approved = 0;
    let rejected = 0;
    await render(conversation({ busy: true, messages: [mutation], approval: pendingApproval, onApprove: () => approved++, onReject: () => rejected++ }));
    expect(host.textContent).toContain("预计 12 积分");
    expect(host.textContent).toContain("片头镜头");
    expect(host.textContent).toContain("视频模型");
    expect(host.querySelector(".agent-working-indicator")).toBeNull();
    const activeIndicatorsDuringApproval = liveIndicators().length;
    await click("同意执行");
    await click("暂不执行");
    expect(approved).toBe(1);
    expect(rejected).toBe(1);
    await render(conversation({ busy: true, approval: pendingApproval, approvalBlockedReason: "连接未就绪" }));
    expect(button("同意执行").disabled).toBe(true);
    expect(button("暂不执行").disabled).toBe(true);
    expect(host.textContent).toContain("连接未就绪");
    expect(activeIndicatorsDuringApproval).toBe(0);
});

test("正文、节点引用、错误重试与展开后的撤销操作仍可访问", async () => {
    const focused: string[] = [];
    const undone: unknown[] = [];
    let retries = 0;
    await render(
        conversation({
            messages: [
                { id: "user", role: "user", text: "保留这段用户说明\n第二行要求" },
                { id: "answer", role: "assistant", text: "完成节点 video-123，请检查镜头。" },
                mutation,
                { id: "failure", role: "error", title: "生成失败", text: "积分不足，请充值后重试" },
            ],
            references: [reference],
            onFocusNode: (id) => focused.push(id),
            onUndo: (target) => undone.push(target),
            retryableErrorId: "failure",
            onRetryRun: () => retries++,
        }),
    );
    expect(host.textContent).toContain("第二行要求");
    expect(host.textContent).toContain("请检查镜头");
    expect(host.textContent).toContain("积分不足");
    await act(async () => host.querySelector<HTMLButtonElement>('[data-agent-node-id="video-123"]')!.click());
    expect(focused).toEqual(["video-123"]);
    await click("重试本轮");
    expect(retries).toBe(1);
    await act(async () => host.querySelector<HTMLButtonElement>(".agent-operation-toggle")!.click());
    await click("撤销本次画布写入");
    expect(undone).toEqual([{ runId: "run-1", canvasId: "sidebar-canvas", stepId: "call-1", expectedSnapshotHash: "a".repeat(64) }]);
});

test("结构化提问保留选择和回答动作，不被无正文载体处理吞掉", async () => {
    const answers: string[] = [];
    const question = { questionId: "question-1", question: "选择创作方向", options: [{ label: "制作短片" }, { label: "制作预告" }] };
    await render(
        <>
            {conversation({ messages: [{ id: "question-1", role: "tool", text: "", question }] })}
            <AgentQuestionBar question={question} theme={theme} onAnswer={(value) => answers.push(value)} />
        </>,
    );
    expect(host.textContent).toContain("选择创作方向");
    expect(host.querySelector(".agent-working-indicator")).toBeNull();
    const choice = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find((item) => item.textContent?.includes("制作短片"));
    expect(choice).toBeDefined();
    await act(async () => choice!.click());
    expect(answers).toEqual(["制作短片"]);
});
