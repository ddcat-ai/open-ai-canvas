import { afterAll, expect, mock, test } from "bun:test";
import { Window } from "happy-dom";
import type { AgentEvent, AgentRun } from "@/services/api/agent";
import type { CloudAgentConversation, CloudAgentPendingSubmission } from "@/services/cloud-agent-conversations";

const dom = new Window({ url: "http://localhost/" });
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    HTMLElement: dom.HTMLElement,
    SVGElement: dom.SVGElement,
    Element: dom.Element,
    Node: dom.Node,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    ShadowRoot: dom.ShadowRoot,
    MutationObserver: dom.MutationObserver,
    ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
}))
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const agent = await import("@/services/api/agent");
const history = await import("@/services/cloud-agent-conversations");
const awaitImportHistory = await import("@/services/cloud-agent-history");
const skillsApi = await import("@/services/api/skills");
type Skill = import("@/services/api/skills").Skill;
const { setActiveUserScope } = await import("@/lib/user-scope");
const { useUserStore } = await import("@/stores/use-user-store");
const { useGlobalAgentStore } = await import("@/stores/use-global-agent-store");
const { createModelChannel, defaultConfig, normalizeConfigSnapshot, useConfigStore } = await import("@/stores/use-config-store");
const { ApiError } = await import("@/services/api/request");

let local: CloudAgentConversation[] = [];
let remote: CloudAgentConversation[] = [];
let activeId = "";
let pending: CloudAgentPendingSubmission | null = null;
let refreshOverride: (() => Promise<CloudAgentConversation[]>) | undefined;
const subscriptions: Array<{ id: string; after: number; event: (event: AgentEvent) => void; connection: (status: string) => void; closed: boolean }> = [];
const sent: string[] = [];
const sendInputs: Array<Record<string, any>> = [];
let sendFailure: Error | undefined;
let capabilitiesOverride: (() => Promise<unknown>) | undefined;
let sendOverride: (() => Promise<{ run: AgentRun }>) | undefined;
let pendingSaveOverride: (() => Promise<void>) | undefined;
const refreshRequests: Array<{ observedConversationIds?: string[]; canvasId?: string }> = [];
let generated = 0;
let composer: Record<string, any>;
let header: Record<string, any>;
let conversationUI: Record<string, any>;
let historyUI: Record<string, any>;
let controls: Record<string, any>;
let skillLibrary: Record<string, any>;
let availableSkills: Skill[] = [];
let skillsFailure: Error | undefined;
const skillReads: Array<{ fresh?: boolean } | undefined> = [];
const silent = () => {};
mock.module("file-saver", () => ({ saveAs: silent }));
const MotionBox = ({ children, className, style }: any) => (
    <div className={className} style={style}>
        {children}
    </div>
);
mock.module("motion/react", () => ({ AnimatePresence: ({ children }: any) => children, motion: { aside: MotionBox, div: MotionBox }, useReducedMotion: () => true }));
mock.module("antd", () => ({
    App: { useApp: () => ({ message: { info: silent, error: silent } }) },
    Button: ({ children, loading: _loading, icon, size: _size, ...props }: any) => (
        <button {...props}>
            {icon}
            {children}
        </button>
    ),
}));
mock.module("@/services/api/agent", () => ({
    ...agent,
    getAgentProfile: async () => ({ revision: "profile", hash: "hash", layers: [] }),
    getAgentCapabilities: async () => (capabilitiesOverride ? capabilitiesOverride() : { permissionModes: ["request_approval"], skills: true }),
    subscribeAgentEvents: (id: string, event: (event: AgentEvent) => void, options: any) => {
        const subscription = { id, after: options.after, event, connection: options.onConnectionChange, closed: false };
        subscriptions.push(subscription);
        options.onConnectionChange("connected");
        return () => {
            subscription.closed = true;
        };
    },
    sendAgentMessage: async (id: string, input: any) => {
        sent.push(id);
        sendInputs.push(input);
        if (sendFailure) throw sendFailure;
        if (sendOverride) return sendOverride();
        return { run: { ...makeRun("submitted-child"), parentId: id, userPrompt: input.prompt, idempotencyKey: input.idempotencyKey } };
    },
    createAgentRun: async () => {
        generated++;
        throw new Error("不应新建独立轮次");
    },
    decideAgentApproval: async () => {
        generated++;
        throw new Error("测试禁止审批");
    },
}));
mock.module("@/services/cloud-agent-conversations", () => ({
    ...history,
    loadCloudAgentConversations: async (scope: string) => (scope === "sync-user" ? { version: 1, activeId, conversations: local } : { version: 1, activeId: null, conversations: [] }),
    saveCloudAgentConversations: async (id: string, conversations: CloudAgentConversation[], scope: string) => {
        if (scope !== "sync-user") return;
        activeId = id;
        local = conversations;
    },
    loadCloudAgentPendingSubmission: async (_id: string, scope: string) => (scope === "sync-user" ? pending : null),
    saveCloudAgentPendingSubmission: async (_id: string, value: CloudAgentPendingSubmission, scope: string) => {
        if (scope !== "sync-user") throw new Error("不能向其他账号保存原请求");
        pending = value;
        await pendingSaveOverride?.();
    },
    clearCloudAgentPendingSubmission: async (_id: string, scope: string) => {
        if (scope !== "sync-user") throw new Error("不能清除其他账号原请求");
        pending = null;
    },
}));
mock.module("@/services/cloud-agent-history", () => ({
    ...awaitImportHistory,
    refreshCloudAgentConversations: async (options: any) => {
        refreshRequests.push(options);
        if (options.scope !== "sync-user") return [];
        return refreshOverride ? refreshOverride() : remote;
    },
    loadCloudAgentConversation: async (id: string) => remote.find((item) => item.serverConversationId === id)!,
}));
mock.module("@/services/api/skills", () => ({
    ...skillsApi,
    listSkillPresets: async () => ({ presets: [] }),
    listSkills: async () => ({ skills: [] }),
    listAddedSkills: async (options?: { fresh?: boolean }) => {
        skillReads.push(options);
        if (skillsFailure) throw skillsFailure;
        return { skills: availableSkills };
    },
    listSkillLibraryCategories: async () => ({ categories: [] }),
    addSkill: async () => {
        throw new Error("不应安装技能");
    },
}));
mock.module("@/services/user-data-sync", () => ({ prepareCanvasForCloudAction: async () => {}, applyAgentCanvasPatches: async () => {}, refreshCanvasAfterAgent: async () => {} }));
mock.module("@/components/skills/skill-curation-browser", () => ({ useSkillCuration: () => ({ curation: null }), curationQuery: () => ({}) }));
mock.module("@/components/canvas/canvas-cloud-agent-chat-ui", () => ({
    AGENT_SCENE_DEFS: [],
    parseCloudAgentFormAnswer: () => undefined,
    AgentChatComposer: (props: any) => {
        composer = props;
        return (
            <>
                {props.left}
                <textarea aria-label="草稿" value={props.prompt} readOnly />
            </>
        );
    },
    AgentPlanBar: () => null,
    AgentQuestionBar: () => null,
    AgentSceneCapsules: () => null,
}));
mock.module("@/components/canvas/canvas-cloud-agent-panel-parts", () => ({
    AgentLauncher: () => null,
    AgentContextRing: () => null,
    ComposerControls: (props: any) => {
        controls = props;
        return null;
    },
    AgentHeader: (props: any) => {
        header = props;
        return <div>{props.statusLabel}</div>;
    },
    AgentConversation: (props: any) => {
        conversationUI = props;
        return (
            <div data-testid="conversation">
                {props.messages.map((item: any) => (
                    <div key={item.id}>{item.text}</div>
                ))}
            </div>
        );
    },
    AgentHistory: (props: any) => {
        historyUI = props;
        return <div>历史</div>;
    },
}));
mock.module("@/components/canvas/canvas-agent-skill-library-modal", () => ({
    CanvasAgentSkillLibraryModal: (props: any) => {
        skillLibrary = props;
        return null;
    },
}));
mock.module("@/components/canvas/canvas-cloud-agent-settings", () => ({ CanvasCloudAgentSettings: () => null }));
mock.module("@/components/canvas/canvas-cloud-agent-connectors", () => ({ AgentConnectorsBar: () => null }));
mock.module("@/components/canvas/use-agent-panel-layout", () => ({ useAgentPanelLayout: () => ({ style: {}, pointerHandlers: {}, reset: silent, onResizeKeyDown: silent }) }));

const { CanvasCloudAgentPanel } = await import("@/components/canvas/canvas-cloud-agent-panel");
function makeRun(id: string, status: AgentRun["status"] = "completed"): AgentRun {
    return { id, conversationId: "shared-session", canvasId: "shared-canvas", status, userPrompt: `用户-${id}`, permissionMode: "request_approval", createdAt: "2026-10-23T01:00:00Z", updatedAt: `2026-10-23T01:00:0${id.length}Z`, revision: 1 };
}
function chat(id: string, latest: AgentRun | null): CloudAgentConversation {
    return {
        id,
        serverConversationId: latest?.conversationId,
        run: latest,
        lastEventSeq: 4,
        runs: latest ? [latest] : [],
        title: id,
        messages: latest
            ? [
                  { id: `user-${latest.id}`, role: "user", text: latest.userPrompt! },
                  { id: `assistant-${latest.id}`, role: "assistant", text: `结果-${latest.id}` },
              ]
            : [],
        permissionMode: "request_approval",
        createdAt: "2026-10-23T01:00:00Z",
        updatedAt: "2026-10-23T01:00:00Z",
    };
}
const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 10));
};
const focus = async () => {
    await act(async () => {
        window.dispatchEvent(new Event("focus"));
        await settle();
    });
};
async function mount(initial: CloudAgentConversation, cloud: CloudAgentConversation[], initialPending: CloudAgentPendingSubmission | null = null, catalog: Skill[] = []) {
    availableSkills = catalog;
    skillsFailure = undefined;
    skillReads.length = 0;
    local = [initial];
    activeId = initial.id;
    remote = cloud;
    pending = initialPending;
    refreshOverride = undefined;
    sent.length = 0;
    sendInputs.length = 0;
    sendFailure = undefined;
    capabilitiesOverride = undefined;
    sendOverride = undefined;
    pendingSaveOverride = undefined;
    generated = 0;
    subscriptions.length = 0;
    refreshRequests.length = 0;
    setActiveUserScope("sync-user");
    useUserStore.setState({ hydrated: true, user: { id: "sync-user", username: "test", displayName: "test", role: "user", status: "active" } });
    configureModels(false);
    useGlobalAgentStore.setState({ open: true, canvas: { canvasId: "shared-canvas", nodeCount: 2, selectedNodeIds: [], references: [] } });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
        root.render(<CanvasCloudAgentPanel />);
        await settle();
    });
    return {
        host,
        root,
        close: async () => {
            await act(async () => root.unmount());
            host.remove();
        },
    };
}
afterAll(() => dom.happyDOM.abort());
const testSkill = (skillId: string) => ({ skillId, skillName: skillId, isAdded: true, status: 1 }) as Skill;

test("#888 恢复旧对话识别失效 ID，新建仅继承有效选择且不改写旧运行快照", async () => {
    const initial = { ...chat("stale", makeRun("first")), skillIds: ["valid", "deleted"], draft: "保留草稿" };
    initial.run!.skills = [{ id: "deleted", name: "历史技能快照", version: "mock-v1", hash: "mock-hash" }];
    const snapshot = JSON.stringify(initial.run);
    const mounted = await mount(initial, [], null, [testSkill("valid")]);
    try {
        expect(skillLibrary.selection).toEqual({ validIds: ["valid"], invalidIds: ["deleted"], unknownIds: [] });
        await act(async () => {
            header.onNew();
            await settle();
        });
        expect(local.find((item) => item.id === activeId)?.skillIds).toEqual(["valid"]);
        expect(local.find((item) => item.id === "stale")?.skillIds).toEqual(["valid", "deleted"]);
        expect(JSON.stringify(local.find((item) => item.id === "stale")?.run)).toBe(snapshot);
    } finally {
        await mounted.close();
    }
});

test("#888 提交前强制刷新目录，失效选择阻止 POST 并保留输入", async () => {
    const initial = { ...chat("stale-submit", makeRun("first")), skillIds: ["deleted"], draft: "不能丢失的输入" };
    const mounted = await mount(initial, [], null, [testSkill("deleted")]);
    try {
        availableSkills = [];
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toHaveLength(0);
        expect(generated).toBe(0);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("不能丢失的输入");
        expect(skillReads.some((options) => options?.fresh)).toBe(true);
        expect(skillLibrary.selection.invalidIds).toEqual(["deleted"]);
        expect(conversationUI.messages.some((item: any) => item.text.includes("失效"))).toBe(true);
    } finally {
        await mounted.close();
    }
});

test("#888 目录请求失败不误删选择、不发送且保留输入", async () => {
    const initial = { ...chat("failed-catalog", makeRun("first")), skillIds: ["valid"], draft: "重试时保留" };
    const mounted = await mount(initial, [], null, [testSkill("valid")]);
    try {
        skillsFailure = new Error("技能目录暂时不可用");
        await focus();
        expect(skillLibrary.selection).toEqual({ validIds: [], invalidIds: [], unknownIds: ["valid"] });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toHaveLength(0);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("重试时保留");
        expect(local.find((item) => item.id === activeId)?.skillIds).toEqual(["valid"]);
    } finally {
        await mounted.close();
    }
});

test("#888 逐项移除只更新当前对话选择，重新挂载不会由内存写回失效 ID", async () => {
    const initial = { ...chat("remove-stale", makeRun("first")), skillIds: ["valid", "deleted", "another-deleted"] };
    initial.run!.skills = [{ id: "deleted", name: "历史技能快照", version: "mock-v1", hash: "mock-hash" }];
    initial.messages[1].detail = { request: { skillIds: ["deleted"] }, skillSnapshot: initial.run!.skills };
    let mounted = await mount(initial, [], null, [testSkill("valid")]);
    try {
        await act(async () => {
            skillLibrary.onToggle("deleted");
            await settle();
        });
        const saved = local.find((item) => item.id === activeId)!;
        expect(saved.skillIds).toEqual(["valid", "another-deleted"]);
        expect(saved.run).toEqual(initial.run);
        expect(saved.messages).toEqual(initial.messages);
        await mounted.close();
        mounted = await mount(saved, [], null, [testSkill("valid")]);
        expect(skillLibrary.selectedSkillIds).toEqual(["valid", "another-deleted"]);
    } finally {
        await mounted.close();
    }
});

test("#888 所有选择有效时保持原有续发流程", async () => {
    const initial = { ...chat("valid-submit", makeRun("first")), skillIds: ["valid"], draft: "正常续发" };
    const mounted = await mount(initial, [], null, [testSkill("valid")]);
    try {
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["first"]);
        expect(sendInputs[0].skillIds).toEqual(["valid"]);
        expect(composer.prompt).toBe("");
        expect(pending).toBeNull();
    } finally {
        await mounted.close();
    }
});

test("#888 删除事件及时刷新当前对话，目录失败后新建也不继承已确认失效 ID", async () => {
    const initial = { ...chat("delete-event", makeRun("first")), skillIds: ["valid", "deleted"] };
    const mounted = await mount(initial, [], null, [testSkill("valid"), testSkill("deleted")]);
    try {
        availableSkills = [testSkill("valid")];
        await act(async () => {
            window.dispatchEvent(new Event("canvas-skills-changed"));
            await settle();
        });
        expect(skillLibrary.selection.invalidIds).toEqual(["deleted"]);
        skillsFailure = new Error("断网");
        await focus();
        await act(async () => {
            header.onNew();
            await settle();
        });
        expect(local.find((item) => item.id === activeId)?.skillIds).toEqual(["valid"]);
    } finally {
        await mounted.close();
    }
});

test("#888 预检后保存期间删除技能，POST 前再次核验并清理尚未发送的幂等记录", async () => {
    const initial = { ...chat("delete-during-save", makeRun("first")), skillIds: ["deleted"], draft: "保存期间也不能丢失" };
    const mounted = await mount(initial, [], null, [testSkill("deleted")]);
    try {
        pendingSaveOverride = async () => {
            availableSkills = [];
            window.dispatchEvent(new Event("canvas-skills-changed"));
            await settle();
        };
        await act(async () => {
            composer.onSubmit();
            await settle();
            await settle();
        });
        expect(sent).toHaveLength(0);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("保存期间也不能丢失");
        expect(skillLibrary.selection.invalidIds).toEqual(["deleted"]);
    } finally {
        await mounted.close();
    }
});

test("#888 服务端拒绝预检之后的并发删除，保留草稿并刷新失效提示", async () => {
    const initial = { ...chat("server-reject-delete", makeRun("first")), skillIds: ["deleted"], draft: "拒绝后可编辑" };
    const mounted = await mount(initial, [], null, [testSkill("deleted")]);
    try {
        sendOverride = async () => {
            availableSkills = [];
            throw new ApiError("技能不存在或已删除", { status: 400 });
        };
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["first"]);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("拒绝后可编辑");
        expect(skillLibrary.selection.invalidIds).toEqual(["deleted"]);
        expect(local.find((item) => item.id === activeId)?.run).toEqual(initial.run);
    } finally {
        await mounted.close();
    }
});
function configureModels(ambiguous: boolean) {
    const entry = (id: string, model: string, price: number) =>
        createModelChannel({ id, scope: "system", models: [model], modelCosts: [{ model, channelModelId: `${id}-${model}`, capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: price }] });
    const channels = [entry("paid-channel", "paid-model", 10_000_000), entry("local-test", "local-agent-test", 0), ...(ambiguous ? [entry("another-test", "local-agent-test", 0)] : [])];
    const config = normalizeConfigSnapshot({ config: { ...defaultConfig, channels, textModel: "paid-channel::paid-model", model: "paid-channel::paid-model" } }).config;
    useConfigStore.setState({ config });
}

test("手机空缓存接续同画布桌面会话，审批被另一端处理后自动收敛且不重复提交", async () => {
    const waiting = makeRun("desktop", "waiting_approval");
    waiting.approval = { approvalId: "approval-one", call: { id: "call", function: { name: "generate_media", arguments: "{}" } } };
    const mounted = await mount(chat("new-phone", null), [chat("server", waiting)]);
    try {
        expect(conversationUI.messages.map((item: any) => item.text)).toContain("结果-desktop");
        expect(conversationUI.approval.approvalId).toBe("approval-one");
        expect(subscriptions.at(-1)).toMatchObject({ id: "desktop", after: 4 });
        await act(async () => {
            conversationUI.onApprovalReasonChange("手机保留的理由");
        });
        await focus();
        expect(conversationUI.approval.reason).toBe("手机保留的理由");
        const observation = subscriptions.at(-1)!;
        await act(async () => {
            observation.event({ eventId: "decision", runId: "desktop", seq: 5, type: "approval_decided", payload: { approvalId: "approval-one", decision: "approve" }, createdAt: waiting.updatedAt });
            observation.event({ eventId: "status", runId: "desktop", seq: 6, type: "run_status", payload: { status: "running", revision: 2 }, createdAt: waiting.updatedAt });
        });
        expect(conversationUI.approval).toBeNull();
        expect(local.find((item) => item.id === "server")?.lastEventSeq).toBe(6);
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("旧轮次结束后仍发现手机新轮次，电脑下一条消息使用最新 child 续接", async () => {
    const first = chat("desktop-local", makeRun("first"));
    const mounted = await mount(first, [chat("server", makeRun("first"))]);
    try {
        expect(refreshRequests.some((item) => item.canvasId === "shared-canvas" && item.observedConversationIds?.includes("shared-session"))).toBe(true);
        remote = [chat("server", { ...makeRun("second"), parentId: "first" })];
        await focus();
        expect(conversationUI.messages.map((item: any) => item.text)).toContain("结果-second");
        expect(subscriptions.find((item) => item.id === "first")?.closed).toBe(true);
        expect(subscriptions.at(-1)?.id).toBe("second");
        await act(async () => {
            subscriptions.find((item) => item.id === "first")!.event({ eventId: "late-old-event", runId: "first", seq: 5, type: "assistant_delta", payload: { messageId: "old-output", text: "不应出现在新轮次" }, createdAt: first.updatedAt });
        });
        expect(conversationUI.messages.map((item: any) => item.text)).not.toContain("不应出现在新轮次");
        await act(async () => {
            composer.onPromptChange("电脑接着这一轮继续");
        });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["second"]);
        expect(generated).toBe(0);
        expect(pending).toBeNull();
    } finally {
        await mounted.close();
    }
});

test("云端发现不能替换未提交草稿，明确新建后不会重新接回旧会话", async () => {
    const initial = { ...chat("phone-draft", null), draft: "尚未发送的草稿" };
    const mounted = await mount(initial, [chat("server", makeRun("desktop"))]);
    try {
        expect(composer.prompt).toBe("尚未发送的草稿");
        expect(conversationUI.messages).toHaveLength(0);
        await act(async () => {
            header.onNew();
            await settle();
        });
        expect(composer.prompt).toBe("");
        expect(local.some((item) => item.id === "phone-draft" && item.draft === "尚未发送的草稿")).toBe(true);
        await focus();
        expect(conversationUI.messages).toHaveLength(0);
        expect(local.find((item) => item.id === activeId)?.localNewCanvasId).toBe("shared-canvas");
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("旧账号云端请求迟到时不得写入已切换账号的面板", async () => {
    const mounted = await mount(chat("safe-local", null), []);
    try {
        let release: ((value: CloudAgentConversation[]) => void) | undefined;
        refreshOverride = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        await act(async () => {
            window.dispatchEvent(new Event("focus"));
            await settle();
        });
        expect(release).toBeDefined();
        await act(async () => {
            setActiveUserScope("other-user");
            useUserStore.setState({ user: { id: "other-user", username: "other", displayName: "other", role: "user", status: "active" } });
            release!([chat("old-account-secret", makeRun("secret"))]);
            await settle();
        });
        expect(conversationUI.messages.map((item: any) => item.text)).not.toContain("结果-secret");
        expect(local.some((item) => item.serverConversationId === "shared-session")).toBe(false);
    } finally {
        await mounted.close();
    }
});

test("手选同画布较早历史后不被其他会话抢走，但仍能跟随所选会话的新轮次", async () => {
    const earlier = chat("earlier", makeRun("earlier"));
    const newer = chat("newer", { ...makeRun("newer"), conversationId: "different-session" });
    const mounted = await mount(earlier, [earlier, newer]);
    try {
        await act(async () => {
            header.onHistory();
            await new Promise((resolve) => setTimeout(resolve, 350));
        });
        expect(historyUI).toBeDefined();
        await act(async () => {
            historyUI.onOpen(earlier);
            await new Promise((resolve) => setTimeout(resolve, 350));
        });
        await focus();
        expect(conversationUI.messages.map((item: any) => item.text)).toContain("结果-earlier");
        expect(local.find((item) => item.id === activeId)?.localSelectedCanvasId).toBe("shared-canvas");
        remote = [{ ...earlier, run: { ...makeRun("earlier-child"), parentId: "earlier" }, messages: [{ id: "new-result", role: "assistant", text: "所选会话的新轮次" }] }, newer];
        await focus();
        expect(conversationUI.messages.map((item: any) => item.text)).toContain("所选会话的新轮次");
    } finally {
        await mounted.close();
    }
});

test("未知提交的原请求与幂等身份保留，不能因发现云端同文本会话而被换掉", async () => {
    const original = { key: "original-key", fingerprint: "frozen-body", request: { canvasId: "shared-canvas", prompt: "生成森林", idempotencyKey: "original-key" } };
    const other = chat("other", { ...makeRun("other"), userPrompt: "生成森林", idempotencyKey: "another-key" });
    const mounted = await mount(chat("uncertain", null), [other], original);
    try {
        await focus();
        expect(pending).toEqual(original);
        expect(composer.prompt).toBe("生成森林");
        expect(conversationUI.messages).toHaveLength(0);
        expect(activeId).toBe("uncertain");
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("手机后台断线后在前台恢复同一事件订阅，focus与visibility不会发送或审批", async () => {
    const waiting = makeRun("background", "waiting_approval");
    waiting.approval = { approvalId: "remain-pending", call: { id: "call", function: { name: "generate_media", arguments: "{}" } } };
    const mounted = await mount(chat("mobile", waiting), [chat("server", waiting)]);
    try {
        const first = subscriptions.at(-1)!;
        await act(async () => {
            first.connection("disconnected");
        });
        const count = subscriptions.length;
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            window.dispatchEvent(new Event("focus"));
            await settle();
        });
        expect(subscriptions).toHaveLength(count);
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        await act(async () => {
            document.dispatchEvent(new Event("visibilitychange"));
            window.dispatchEvent(new Event("focus"));
            await settle();
        });
        expect(subscriptions).toHaveLength(count + 1);
        expect(first.closed).toBe(true);
        expect(subscriptions.at(-1)).toMatchObject({ id: "background", after: 4 });
        await act(async () => {
            subscriptions.at(-1)!.connection("disconnected");
        });
        await focus();
        expect(subscriptions).toHaveLength(count + 2);
        expect(conversationUI.approval.approvalId).toBe("remain-pending");
        expect(sent).toHaveLength(0);
        expect(generated).toBe(0);
    } finally {
        Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
        await mounted.close();
    }
});

test("第二端恢复裸模型key为唯一完整option，续发保持原零积分渠道", async () => {
    const cloud = { ...chat("server", { ...makeRun("mock-turn"), model: "local-agent-test" }), model: "local-agent-test" };
    const mounted = await mount(chat("new-device", null), [cloud]);
    try {
        expect(controls.selectedModel).toBe("local-test::local-agent-test");
        await act(async () => {
            composer.onPromptChange("接着免费测试模型继续");
        });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sendInputs).toHaveLength(1);
        expect(sendInputs[0]).toMatchObject({ model: "local-agent-test", channelId: "local-test", channelModelKey: "local-agent-test" });
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("同名多渠道不能自动换到默认收费模型，手动选择后才允许继续", async () => {
    const mounted = await mount(chat("new-device", null), []);
    try {
        await act(async () => {
            configureModels(true);
        });
        remote = [{ ...chat("server", { ...makeRun("ambiguous"), model: "local-agent-test" }), model: "local-agent-test" }];
        await focus();
        expect(controls.selectedModel).toBe("");
        expect(composer.submitDisabled).toBe(true);
        expect(local.find((item) => item.id === activeId)?.model).toBe("local-agent-test");
        await act(async () => {
            composer.onPromptChange("等待确认渠道的草稿");
            composer.onSubmit();
            await settle();
        });
        expect(sendInputs).toHaveLength(0);
        await act(async () => {
            controls.onModelChange("another-test::local-agent-test");
        });
        expect(controls.selectedModel).toBe("another-test::local-agent-test");
        expect(composer.submitDisabled).toBe(false);
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sendInputs[0]).toMatchObject({ channelId: "another-test", channelModelKey: "local-agent-test" });
    } finally {
        await mounted.close();
    }
});

test("另一端已推进parent的明确拒绝只同步上下文，保留草稿而不自动重发", async () => {
    const first = chat("local", makeRun("first"));
    const mounted = await mount(first, [first]);
    try {
        await act(async () => {
            composer.onPromptChange("确认新上下文后再发送这条");
        });
        remote = [chat("server", { ...makeRun("other-device-child"), parentId: "first" })];
        sendFailure = new ApiError("会话已在另一端推进", { status: 409, reason: "agent_conversation_stale_parent" });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["first"]);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("确认新上下文后再发送这条");
        expect(conversationUI.messages.some((item: any) => item.text === "结果-other-device-child")).toBe(true);
        expect(conversationUI.messages.some((item: any) => item.role === "user" && item.text === "确认新上下文后再发送这条")).toBe(false);
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("同轮历史已追赶到新水位后，延迟的旧 SSE delta 不会再次追加正文", async () => {
    const current = chat("local", makeRun("streaming", "running"));
    const mounted = await mount(current, [current]);
    try {
        const observation = subscriptions.at(-1)!;
        remote = [{ ...current, run: { ...current.run!, revision: 2 }, lastEventSeq: 6, messages: [{ id: "live-answer", role: "assistant", text: "完整回答" }] }];
        await focus();
        expect(conversationUI.messages.find((item: any) => item.id === "live-answer")?.text).toBe("完整回答");
        expect(subscriptions.at(-1)).toBe(observation);
        await act(async () => {
            observation.event({ eventId: "delayed-five", runId: "streaming", seq: 5, type: "assistant_delta", payload: { messageId: "live-answer", text: "重复片段" }, createdAt: current.updatedAt });
        });
        expect(conversationUI.messages.find((item: any) => item.id === "live-answer")?.text).toBe("完整回答");
        await act(async () => {
            observation.event({ eventId: "new-seven", runId: "streaming", seq: 7, type: "assistant_delta", payload: { messageId: "live-answer", text: "新内容" }, createdAt: current.updatedAt });
        });
        expect(conversationUI.messages.find((item: any) => item.id === "live-answer")?.text).toBe("完整回答新内容");
        expect(local.find((item) => item.id === activeId)?.lastEventSeq).toBe(7);
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("等待能力校验时切换账号，旧账号的请求不得以新账号身份提交", async () => {
    const initial = chat("original", makeRun("first"));
    const mounted = await mount(initial, [initial]);
    let release: ((value: unknown) => void) | undefined;
    try {
        capabilitiesOverride = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        await act(async () => {
            composer.onPromptChange("属于原账号的输入");
        });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(release).toBeDefined();
        await act(async () => {
            setActiveUserScope("other-user");
            useUserStore.setState({ user: { id: "other-user", username: "other", displayName: "other", role: "user", status: "active" } });
            release!({ permissionModes: ["request_approval"], skills: true });
            await settle();
        });
        expect(sent).toHaveLength(0);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("");
        expect(generated).toBe(0);
    } finally {
        release?.({ permissionModes: ["request_approval"], skills: true });
        await mounted.close();
    }
});

test("旧账号 POST 的迟到响应不覆盖新账号面板，清理也只使用原账号范围", async () => {
    const initial = chat("original", makeRun("first"));
    const mounted = await mount(initial, [initial]);
    let release: ((value: { run: AgentRun }) => void) | undefined;
    try {
        sendOverride = () =>
            new Promise((resolve) => {
                release = resolve;
            });
        await act(async () => {
            composer.onPromptChange("原账号已提交的输入");
        });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["first"]);
        expect(release).toBeDefined();
        await act(async () => {
            setActiveUserScope("other-user");
            useUserStore.setState({ user: { id: "other-user", username: "other", displayName: "other", role: "user", status: "active" } });
            await settle();
            release!({ run: { ...makeRun("original-late-child"), parentId: "first" } });
            await settle();
        });
        expect(subscriptions.some((item) => item.id === "original-late-child")).toBe(false);
        expect(conversationUI.messages).toHaveLength(0);
        expect(composer.prompt).toBe("");
        expect(pending).toBeNull();
        expect(generated).toBe(0);
    } finally {
        release?.({ run: makeRun("original-late-child") });
        await mounted.close();
    }
});

test("原样重试未知 POST 后得到明确 stale_parent 可解除旧身份，仍保留草稿且不自动重发", async () => {
    const initial = chat("original", makeRun("first"));
    const original: CloudAgentPendingSubmission = {
        key: "uncertain-original-key",
        fingerprint: "frozen",
        parentRunId: "first",
        messageId: "user-uncertain-original-key",
        request: { canvasId: "shared-canvas", prompt: "原请求内容", idempotencyKey: "uncertain-original-key" },
    };
    const mounted = await mount(initial, [initial], original);
    try {
        remote = [chat("server", { ...makeRun("other-device-child"), parentId: "first" })];
        sendFailure = new ApiError("已确认该 key 未受理，另一端已推进", { status: 409, reason: "agent_conversation_stale_parent" });
        await act(async () => {
            composer.onSubmit();
            await settle();
        });
        expect(sent).toEqual(["first"]);
        expect(sendInputs[0]).toEqual(original.request);
        expect(pending).toBeNull();
        expect(composer.prompt).toBe("原请求内容");
        expect(conversationUI.messages.some((item: any) => item.text === "结果-other-device-child")).toBe(true);
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});

test("手动重新打开当前云端历史时同步水位，旧 SSE 缓冲不会重复正文", async () => {
    const current = chat("local", makeRun("same-current"));
    const mounted = await mount(current, [current]);
    try {
        const observation = subscriptions.at(-1)!;
        await act(async () => {
            header.onHistory();
            await new Promise((resolve) => setTimeout(resolve, 350));
        });
        remote = [{ ...current, run: { ...current.run!, revision: 2 }, lastEventSeq: 6, messages: [{ id: "manual-history-answer", role: "assistant", text: "手动恢复的完整回复" }] }];
        await act(async () => {
            historyUI.onOpen(current);
            await new Promise((resolve) => setTimeout(resolve, 350));
        });
        expect(conversationUI.messages.find((item: any) => item.id === "manual-history-answer")?.text).toBe("手动恢复的完整回复");
        await act(async () => {
            observation.event({ eventId: "history-delayed-five", runId: "same-current", seq: 5, type: "assistant_delta", payload: { messageId: "manual-history-answer", text: "重复内容" }, createdAt: current.updatedAt });
        });
        expect(conversationUI.messages.find((item: any) => item.id === "manual-history-answer")?.text).toBe("手动恢复的完整回复");
        expect(local.find((item) => item.id === activeId)?.lastEventSeq).toBe(6);
        expect(generated).toBe(0);
    } finally {
        await mounted.close();
    }
});
