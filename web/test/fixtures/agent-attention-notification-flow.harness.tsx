import { afterAll, beforeEach, expect, test } from "bun:test";
import { Window } from "happy-dom";
import type { AgentAttention, AgentNotificationHandle } from "../../src/services/agent-browser-notifications";

const dom = new Window({ url: "https://localhost/" });
const originals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

let permission: NotificationPermission = "granted";
let visibilityState: DocumentVisibilityState = "visible";
let requestPermissionImpl: () => Promise<NotificationPermission> = async () => permission;
let requests = 0;
let focused = 0;
const created: FakeNotification[] = [];

class FakeNotification implements AgentNotificationHandle {
    static get permission() {
        return permission;
    }

    static async requestPermission() {
        requests += 1;
        const next = await requestPermissionImpl();
        permission = next;
        return next;
    }

    onclick: ((event: Event) => void) | null = null;
    closed = 0;

    constructor(
        readonly title: string,
        readonly options: NotificationOptions,
    ) {
        created.push(this);
    }

    close() {
        this.closed += 1;
    }
}

Object.defineProperty(globalThis, "Notification", { configurable: true, writable: true, value: FakeNotification });
Object.defineProperty(dom, "isSecureContext", { configurable: true, get: () => true });
Object.defineProperty(dom.document, "visibilityState", { configurable: true, get: () => visibilityState });
Object.defineProperty(dom, "focus", {
    configurable: true,
    value: () => {
        focused += 1;
    },
});

const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { agentAttentionFromPending, useAgentAttentionNotifications } = await import("../../src/components/canvas/use-agent-attention-notifications");

afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, value] of originals) {
        if (value) Object.defineProperty(globalThis, key, value);
        else Reflect.deleteProperty(globalThis, key);
    }
});

beforeEach(() => {
    permission = "granted";
    visibilityState = "visible";
    requestPermissionImpl = async () => permission;
    requests = 0;
    focused = 0;
    created.length = 0;
});

test("审批优先于提问并直接使用 approvalId 作为提醒键", () => {
    expect(
        agentAttentionFromPending({
            approval: { approvalId: "approval-7" },
            question: { questionId: "question-7", question: "如何继续？" },
            conversationId: "conversation-7",
        }),
    ).toEqual({ key: "approval:approval-7", kind: "approval" });
});

test("提问优先使用 questionId，旧提问使用对话、轮次和文本组成稳定键", () => {
    expect(agentAttentionFromPending({ approval: null, question: { questionId: "question-8", question: "选择风格" }, conversationId: "conversation-8" })).toEqual({ key: "question:question-8", kind: "question" });
    expect(agentAttentionFromPending({ approval: null, question: { round: 2, question: "选择风格" }, conversationId: "conversation-8" })).toEqual({ key: "question:conversation-8:2:选择风格", kind: "question" });
    expect(agentAttentionFromPending({ approval: null, question: null, conversationId: "conversation-8" })).toBeNull();
});

type HookProps = {
    attention: AgentAttention | null;
    enabled: boolean;
    panelOpen: boolean;
};

type HookView = {
    permission: string;
    requesting: boolean;
    showGuide: boolean;
    requestPermission: () => Promise<void>;
};

async function settle() {
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
}

async function mount(initial: HookProps) {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    let current = initial;
    let latest: HookView | null = null;
    let opened = 0;

    function Harness(props: HookProps) {
        latest = useAgentAttentionNotifications({ ...props, onOpen: () => (opened += 1) });
        return null;
    }

    const render = async (next: HookProps = current) => {
        current = next;
        await act(async () => {
            root.render(<Harness {...next} />);
            await settle();
        });
    };
    await render();
    return {
        render,
        latest: () => latest!,
        opened: () => opened,
        close: async () => {
            await act(async () => {
                root.unmount();
                await settle();
            });
            host.remove();
        },
    };
}

test("同一待处理键在重渲染和快照回放后只通知一次，解决时关闭通知", async () => {
    visibilityState = "hidden";
    const attention: AgentAttention = { key: "approval:a1", kind: "approval" };
    const mounted = await mount({ attention, enabled: true, panelOpen: true });
    try {
        expect(created).toHaveLength(1);
        await mounted.render({ attention: { ...attention }, enabled: true, panelOpen: true });
        expect(created).toHaveLength(1);
        await mounted.render({ attention: null, enabled: true, panelOpen: true });
        expect(created[0]?.closed).toBe(1);
    } finally {
        await mounted.close();
    }
});

test("页面可见但 Agent 收起时通知，点击后聚焦页面并打开 Agent", async () => {
    const mounted = await mount({ attention: { key: "question:q1", kind: "question" }, enabled: true, panelOpen: false });
    try {
        expect(created).toHaveLength(1);
        await act(async () => created[0]?.onclick?.(new Event("click")));
        expect(focused).toBe(1);
        expect(mounted.opened()).toBe(1);
        expect(created[0]?.closed).toBe(1);
    } finally {
        await mounted.close();
    }
});

test("页面可见且 Agent 展开时不通知，隐藏页面后才通知", async () => {
    const mounted = await mount({ attention: { key: "approval:a2", kind: "approval" }, enabled: true, panelOpen: true });
    try {
        expect(created).toHaveLength(0);
        visibilityState = "hidden";
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            await settle();
        });
        expect(created).toHaveLength(1);
    } finally {
        await mounted.close();
    }
});

test("待处理事项不再符合提醒条件时关闭现有系统通知", async () => {
    visibilityState = "hidden";
    const mounted = await mount({ attention: { key: "approval:a3", kind: "approval" }, enabled: true, panelOpen: false });
    try {
        expect(created).toHaveLength(1);
        visibilityState = "visible";
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            await settle();
        });
        await mounted.render({ attention: { key: "approval:a3", kind: "approval" }, enabled: true, panelOpen: true });
        expect(created[0]?.closed).toBe(1);
    } finally {
        await mounted.close();
    }
});

test("明确授权后仅在当前待处理事项仍需提醒时补发通知", async () => {
    permission = "default";
    let resolveRequest!: (value: NotificationPermission) => void;
    requestPermissionImpl = () => new Promise((resolve) => (resolveRequest = resolve));
    const mounted = await mount({ attention: { key: "question:q2", kind: "question" }, enabled: true, panelOpen: false });
    try {
        expect(mounted.latest()).toMatchObject({ permission: "default", requesting: false, showGuide: true });
        let request!: Promise<void>;
        await act(async () => {
            request = mounted.latest().requestPermission();
            await Promise.resolve();
        });
        expect(requests).toBe(1);
        expect(mounted.latest().requesting).toBe(true);
        await mounted.render({ attention: null, enabled: true, panelOpen: false });
        await act(async () => {
            resolveRequest("granted");
            await request;
            await settle();
        });
        expect(created).toHaveLength(0);
        expect(mounted.latest()).toMatchObject({ permission: "granted", requesting: false, showGuide: false });
    } finally {
        await mounted.close();
    }

    permission = "default";
    requestPermissionImpl = async () => "granted";
    const qualifying = await mount({ attention: { key: "question:q3", kind: "question" }, enabled: true, panelOpen: false });
    try {
        await act(async () => {
            await qualifying.latest().requestPermission();
            await settle();
        });
        expect(created).toHaveLength(1);
    } finally {
        await qualifying.close();
    }
});

test("通知授权等待期间组件卸载不会创建孤立通知", async () => {
    permission = "default";
    let resolveRequest!: (value: NotificationPermission) => void;
    requestPermissionImpl = () => new Promise((resolve) => (resolveRequest = resolve));
    const mounted = await mount({ attention: { key: "question:q4", kind: "question" }, enabled: true, panelOpen: false });
    let request!: Promise<void>;
    await act(async () => {
        request = mounted.latest().requestPermission();
        await Promise.resolve();
    });
    await mounted.close();
    await act(async () => {
        resolveRequest("granted");
        await request;
        await settle();
    });
    expect(created).toHaveLength(0);
});

test("禁用提醒时不展示授权指引也不创建通知", async () => {
    permission = "default";
    visibilityState = "hidden";
    const mounted = await mount({ attention: { key: "approval:disabled", kind: "approval" }, enabled: false, panelOpen: false });
    try {
        expect(created).toHaveLength(0);
        expect(mounted.latest().showGuide).toBe(false);
    } finally {
        await mounted.close();
    }
});
