import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import localforage from "localforage";
import type { EcommerceDraft, EcommercePlan, EcommerceProject } from "../src/services/api/ecommerce";
import type { GenerationTask } from "../src/services/api/task-center";
import type { RemoteResource } from "../src/services/api/resources";

const dom = new Window({ url: "http://localhost:3000/ecommerce" });
const globals = new Map<string, PropertyDescriptor | undefined>();
for (const [key, value] of Object.entries({
    window: dom,
    document: dom.document,
    navigator: dom.navigator,
    localStorage: dom.localStorage,
    sessionStorage: dom.sessionStorage,
    HTMLElement: dom.HTMLElement,
    HTMLBodyElement: dom.HTMLBodyElement,
    HTMLHtmlElement: dom.HTMLHtmlElement,
    HTMLAnchorElement: dom.HTMLAnchorElement,
    Element: dom.Element,
    Node: dom.Node,
    SVGElement: dom.SVGElement,
    ShadowRoot: dom.ShadowRoot,
    Event: dom.Event,
    CustomEvent: dom.CustomEvent,
    MouseEvent: dom.MouseEvent,
    PointerEvent: dom.PointerEvent,
    ResizeObserver: dom.ResizeObserver,
    MutationObserver: dom.MutationObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom),
    IS_REACT_ACT_ENVIRONMENT: true,
})) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}

const React = await import("react");
const { act } = React;
const localForageValues = new Map<string, unknown>();
const originalLocalForageMethods = { getItem: localforage.getItem, setItem: localforage.setItem, removeItem: localforage.removeItem };
localforage.getItem = (async (key: string) => localForageValues.get(key) ?? null) as typeof localforage.getItem;
localforage.setItem = (async (key: string, value: unknown) => {
    localForageValues.set(key, value);
    return value;
}) as typeof localforage.setItem;
localforage.removeItem = async (key: string) => {
    localForageValues.delete(key);
};
mock.module("../src/components/canvas/canvas-viewport", () => ({
    CanvasViewport: ({ children, onCanvasMouseDown }: { children: React.ReactNode; onCanvasMouseDown?: React.PointerEventHandler<HTMLDivElement> }) => React.createElement("div", { "data-canvas-viewport": "", onPointerDown: onCanvasMouseDown }, children),
}));
const { createRoot } = await import("react-dom/client");
const { MemoryRouter, Routes, Route, useNavigate, useLocation } = await import("react-router");
const { message } = await import("antd");
const { emptyEcommerceDraft } = await import("../src/services/api/ecommerce");
const { http } = await import("../src/services/api/request");
const taskApi = await import("../src/services/api/task-center");
const generationApi = await import("../src/services/api/generation-task");
const pricing = await import("../src/lib/model-pricing");
const quotes = await import("../src/services/api/logical-models");
const capabilities = await import("../src/lib/model-capabilities");
const configStore = await import("../src/stores/use-config-store");
const { useUserStore } = await import("../src/stores/use-user-store");
const { setActiveUserScope } = await import("../src/lib/user-scope");
const sessions = await import("../src/services/ecommerce-session");
const modelPicker = await import("../src/components/model-picker");
const skillPicker = await import("../src/pages/ecommerce/skill-picker");
const ecommerceModelPicker = await import("../src/pages/ecommerce/model-picker");
const rollingCredits = await import("../src/components/rolling-credit-text");
const referenceMedia = await import("../src/pages/ecommerce/long-reference-media");
const resourceApi = await import("../src/services/api/resources");
const workbenchApi = await import("../src/services/api/workbench");
const exportApi = await import("../src/pages/ecommerce/export");
const { commerceInputSignature } = await import("../src/pages/ecommerce/planner");
const { default: EcommercePage } = await import("../src/pages/ecommerce/index");

let root: ReturnType<typeof createRoot> | undefined;
let host: HTMLDivElement;
let scope: string;
let route = "";
let navigate: ReturnType<typeof useNavigate>;
let config = configStore.defaultConfig;
let draft: EcommerceDraft;
const projects = new Map<string, EcommerceProject>();
const tasks = new Map<string, GenerationTask>();
const fetched: string[] = [];
const errors: string[] = [];
const paidSubmissions: unknown[] = [];
const additionalScopes: string[] = [];
const observers = new Map<string, Set<(task: GenerationTask) => void>>();
let completeCreateTask: ((value: GenerationTask) => void) | undefined;
let delayTaskCreation = false;
let failedSaves = 0;
const originalUser = useUserStore.getState();

function project(value: EcommerceDraft): EcommerceProject {
    return { id: crypto.randomUUID(), name: value.productName, status: value.planningTaskId ? "planning" : "draft", revision: 1, draftJson: JSON.stringify(value), planJson: "{}", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function runningTask(id: string): GenerationTask {
    return { id, projectId: "", type: "canvas_text", status: "running", prompt: "", attempts: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
}
function Harness() {
    navigate = useNavigate();
    const location = useLocation();
    route = `${location.pathname}${location.search}`;
    return (
        <Routes>
            <Route path="/ecommerce" element={<EcommercePage />} />
            <Route path="/other" element={<div>其他页面</div>} />
        </Routes>
    );
}
async function render(path = "/ecommerce?mode=quick") {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
        root!.render(
            <MemoryRouter initialEntries={[path]}>
                <Harness />
            </MemoryRouter>,
        );
    });
}
async function refresh() {
    await act(async () => {
        root!.render(
            <MemoryRouter>
                <Harness />
            </MemoryRouter>,
        );
    });
}
async function press(text: string) {
    const button = Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === text);
    expect(button).toBeDefined();
    await act(async () => {
        button!.click();
    });
    const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.textContent?.trim() === "确认并生成");
    if (confirm)
        await act(async () => {
            confirm.click();
        });
}
const productInput = () => host.querySelector<HTMLInputElement>('input[placeholder="例如：便携式香薰机"]');
const planningProgress = () => host.querySelector<HTMLElement>(".commerce-assistant-progress[role=status]");
async function selectOption(label: string, text: string) {
    const input = host.querySelector<HTMLElement>(`[aria-label="${label}"]`);
    expect(input).not.toBeNull();
    await act(async () => {
        input!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>(".ant-select-item-option")).find((entry) => entry.textContent?.trim() === text);
    expect(option).toBeDefined();
    await act(async () => {
        option!.click();
    });
}
function uploadedImage(id: string, userId = scope): RemoteResource {
    return {
        id,
        userId,
        kind: "image",
        status: "ready",
        provider: "local",
        endpoint: "",
        bucket: "",
        objectKey: `${id}.png`,
        publicUrl: "",
        mimeType: "image/png",
        size: 128,
        width: 800,
        height: 800,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
}
async function uploadModeFile(name = "新参考图.png") {
    const input = host.querySelector<HTMLInputElement>('[aria-label="参考方式设置"] input[type="file"]');
    expect(input).not.toBeNull();
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["image-test-data"], name, { type: "image/png" })] });
    await act(async () => {
        input!.dispatchEvent(new Event("change", { bubbles: true }));
    });
}

beforeEach(async () => {
    scope = crypto.randomUUID();
    setActiveUserScope(scope);
    useUserStore.setState({ user: { id: scope, username: "test", displayName: "测试", role: "user", status: "active" } });
    projects.clear();
    tasks.clear();
    fetched.length = 0;
    errors.length = 0;
    paidSubmissions.length = 0;
    observers.clear();
    additionalScopes.length = 0;
    completeCreateTask = undefined;
    delayTaskCreation = false;
    failedSaves = 0;
    route = "";
    draft = { ...emptyEcommerceDraft(), productName: "蓝色测试商品", count: 1, agentModel: "test::vision", imageModel: "test::image", ratio: "1:1", resolution: "1k", references: [{ resourceId: "owned-product", role: "primary" }] };
    config = { ...configStore.defaultConfig };
    spyOn(configStore, "useEffectiveConfig").mockImplementation(() => config);
    spyOn(configStore, "selectableModelsByCapability").mockImplementation((_, capability) => (capability === "text" ? ["test::vision"] : capability === "image" ? ["test::image"] : []));
    const profile = capabilities.defaultModelCapabilityConfig();
    profile.text!.references.maxImages = 24;
    profile.image!.references.maxImages = 24;
    profile.image!.size.values = ["1:1"];
    profile.image!.size.default = "1:1";
    profile.image!.resolution.supported = true;
    profile.image!.resolution.values = ["1k"];
    profile.image!.resolution.default = "1k";
    spyOn(capabilities, "modelCapabilityConfigFor").mockReturnValue(profile);
    spyOn(pricing, "modelQuoteRequest").mockReturnValue({ channelId: "test", modelKey: "vision" } as ReturnType<typeof pricing.modelQuoteRequest>);
    spyOn(quotes, "quoteModel").mockResolvedValue({ quote: { amountMicrocredits: 1_000_000 } } as Awaited<ReturnType<typeof quotes.quoteModel>>);
    // Keep the real page and router lifecycle; avoid unrelated model/skill catalog network and animation effects.
    spyOn(modelPicker, "ModelPicker").mockImplementation(() => <span>模型选择</span>);
    spyOn(skillPicker, "EcommerceSkillPicker").mockImplementation(() => <span>技能选择</span>);
    spyOn(ecommerceModelPicker, "EcommerceModelPicker").mockImplementation(() => <span>模特选择</span>);
    spyOn(rollingCredits, "RollingCreditAmount").mockImplementation(({ value }) => <span>{value}</span>);
    for (const method of ["error", "warning", "success", "info"] as const)
        spyOn(message, method).mockImplementation(((value: unknown) => {
            errors.push(String(value));
            return () => {};
        }) as (typeof message)[typeof method]);
    spyOn(http, "get").mockImplementation((async (path: string) => {
        if (path === "/ecommerce/agent-setting") return { logicalModelId: "" };
        if (path === "/tasks") return [...tasks.values()];
        if (path === "/workbench/tasks") return [...tasks.values()];
        if (path === "/ecommerce/projects") return { projects: [...projects.values()].reverse() };
        if (path.startsWith("/ecommerce/projects?")) {
            const query = new URLSearchParams(path.split("?")[1]);
            const page = Number(query.get("page"));
            const pageSize = Number(query.get("pageSize"));
            const all = [...projects.values()].reverse();
            return { projects: all.slice((page - 1) * pageSize, page * pageSize), total: all.length, page, pageSize };
        }
        if (path.startsWith("/ecommerce/projects/")) {
            const id = path.split("/").at(-1)!;
            fetched.push(id);
            const value = projects.get(id);
            if (!value) throw new Error("project missing");
            return structuredClone(value);
        }
        throw new Error(`unexpected GET ${path}`);
    }) as typeof http.get);
    spyOn(http, "post").mockImplementation((async (path: string) => {
        if (path === "/ecommerce/projects") {
            const value = project(emptyEcommerceDraft());
            projects.set(value.id, value);
            return structuredClone(value);
        }
        throw new Error(`unexpected POST ${path}`);
    }) as typeof http.post);
    spyOn(http, "put").mockImplementation((async (path: string, body: { revision: number; draft: EcommerceDraft; plan?: unknown; name: string }) => {
        if (failedSaves > 0) {
            failedSaves--;
            throw new Error("保存连接暂时中断");
        }
        const id = path.split("/").at(-1)!;
        const current = projects.get(id)!;
        if (current.revision !== body.revision) throw new Error("stale revision");
        const saved = { ...current, revision: current.revision + 1, name: body.name, draftJson: JSON.stringify(body.draft), planJson: JSON.stringify(body.plan || {}) };
        projects.set(id, saved);
        return structuredClone(saved);
    }) as typeof http.put);
    spyOn(http, "deleteWithBody").mockImplementation((async (path: string, body: { ids?: string[]; all?: boolean; expectedTotal: number }) => {
        if (path !== "/ecommerce/projects") throw new Error(`unexpected DELETE ${path}`);
        const ids = body.all ? [...projects.keys()] : body.ids || [];
        if (ids.length !== body.expectedTotal || ids.some((id) => !projects.has(id))) throw new Error("项目列表已变化，请刷新后重新确认删除");
        ids.forEach((id) => projects.delete(id));
        return { deleted: ids.length };
    }) as typeof http.deleteWithBody);
    spyOn(generationApi, "prepareBackendGenerationTask").mockImplementation(async (value) => value as unknown as Awaited<ReturnType<typeof generationApi.prepareBackendGenerationTask>>);
    spyOn(taskApi, "createGenerationTask").mockImplementation(async (value) => {
        paidSubmissions.push(value);
        if (delayTaskCreation)
            return new Promise((resolve) => {
                completeCreateTask = resolve;
            });
        const task = runningTask(crypto.randomUUID());
        tasks.set(task.id, task);
        return task;
    });
    spyOn(taskApi, "queryGenerationTask").mockImplementation(async (id) => {
        const task = tasks.get(id);
        if (!task) throw new Error("task missing");
        return structuredClone(task);
    });
    spyOn(taskApi, "subscribeGenerationTasks").mockImplementation((ids, listener) => {
        for (const id of ids) {
            const subscribers = observers.get(id) || new Set();
            subscribers.add(listener);
            observers.set(id, subscribers);
        }
        return () => {
            for (const id of ids) observers.get(id)?.delete(listener);
        };
    });
});
afterEach(async () => {
    await act(async () => {
        root?.unmount();
    });
    root = undefined;
    host?.remove();
    await sessions.clearEcommerceWorkspace(scope);
    for (const account of additionalScopes) await sessions.clearEcommerceWorkspace(account);
    localForageValues.clear();
    mock.restore();
});
afterAll(() => {
    useUserStore.setState(originalUser);
    dom.happyDOM.abort();
    localforage.getItem = originalLocalForageMethods.getItem;
    localforage.setItem = originalLocalForageMethods.setItem;
    localforage.removeItem = originalLocalForageMethods.removeItem;
    for (const [key, descriptor] of globals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

describe("真实电商页面生命周期", () => {
    test("风格分析提交后立刻切页，返回恢复同一任务与四个方向，不重复付费", async () => {
        draft.instruction = "按真实商品推荐详情页风格";
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        delayTaskCreation = true;
        await render();
        const send = host.querySelector<HTMLButtonElement>(".flylep-submit")!;
        expect(send.disabled).toBe(false);
        await act(async () => {
            send.click();
        });
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "确认并生成");
        expect(confirm).toBeDefined();
        await act(async () => {
            confirm!.click();
        });
        expect(paidSubmissions).toHaveLength(1);
        // 发送后立即清空输入框，不等服务端回执；提交失败时才恢复（见“提交失败时保留输入内容供用户重试”）。
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')?.value).toBe("");
        const submission = paidSubmissions[0] as { projectId: string; metadata: { stage: string; ecommerceProjectId: string; ecommerceDraft: EcommerceDraft } };
        expect(submission.metadata.stage).toBe("creative-directions");
        expect(submission.projectId).toBe(submission.metadata.ecommerceProjectId);
        await act(async () => {
            navigate("/other");
        });
        const task = { ...runningTask("durable-directions"), inputJson: JSON.stringify({ metadata: submission.metadata }) };
        tasks.set(task.id, task);
        await act(async () => {
            completeCreateTask!(task);
        });
        expect(route).toBe("/other");
        await act(async () => {
            navigate("/ecommerce");
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.directionsTaskId).toBe(task.id);
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')?.value).toBe("");
        expect(host.querySelector(".flylep-submit")?.getAttribute("aria-busy")).toBe("false");
        expect(host.querySelector(".flylep-submit .commerce-planning-spin")).toBeNull();
        await act(async () => {
            navigate("/other");
        });
        const response = {
            recommendationId: "ecr-durable",
            directions: Array.from({ length: 4 }, (_, i) => ({ id: `direction-${i}`, name: `恢复风格${i}`, summary: "真实商品的完整美术风格", tags: [] })),
            evidence: [],
            retrievalStatus: "ready",
            productCategory: "商品",
        };
        tasks.set(task.id, { ...task, status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify(response) }) });
        await act(async () => {
            navigate("/ecommerce");
        });
        expect(host.textContent).toContain("恢复风格0");
        expect(host.textContent).toContain("恢复风格3");
        expect(paidSubmissions).toHaveLength(1);
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate("/ecommerce");
        });
        expect(host.textContent).toContain("恢复风格0");
        expect(paidSubmissions).toHaveLength(1);
    });

    test("首张图片完成后恢复发送箭头，修改商品需求可开启新一轮创作", async () => {
        const first = {
            id: "first-image",
            taskId: "first-task",
            imageType: "single",
            platform: draft.platform,
            language: draft.language,
            goal: "主视觉",
            theme: "商品",
            composition: "居中",
            mainVisual: "耳机",
            verifiedClaims: "",
            copy: "日常聆听",
            lighting: "柔光",
            fidelity: "保持真实外观",
            prompt: "保持商品外观",
            negativePrompt: "黑边",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
        };
        const second = { ...first, id: "second-image", taskId: "second-task", goal: "细节" };
        const saved = project(draft);
        saved.planJson = JSON.stringify({ inputSignature: commerceInputSignature(draft), productSummary: "耳机", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "街头画报", images: [first, second] });
        projects.set(saved.id, saved);
        tasks.set("first-task", { ...runningTask("first-task"), status: "succeeded", outputs: [{ outputIndex: 0, materializedAssetId: "first-asset" }], resultJson: JSON.stringify({ images: [{ dataUrl: "/first.png" }] }) });
        tasks.set("second-task", runningTask("second-task"));
        await render(`/ecommerce?project=${saved.id}`);
        await act(async () => {
            for (const id of ["first-task", "second-task"]) observers.get(id)?.forEach((listener) => listener(tasks.get(id)!));
        });
        const send = () => host.querySelector<HTMLButtonElement>(".flylep-submit")!;
        expect(send().disabled).toBe(true);
        expect(send().getAttribute("aria-busy")).toBe("false");
        expect(send().querySelector(".commerce-planning-spin")).toBeNull();
        expect(host.querySelector<HTMLInputElement>('[aria-label="添加商品参考图"]')?.disabled).toBe(false);
        const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')!;
        const setter = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!;
        await act(async () => {
            setter.call(editor, "换一款商品继续生成");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(send().disabled).toBe(false);
        await act(async () => {
            send().click();
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(errors).toEqual([]);
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "确认并生成");
        expect(confirm).toBeDefined();
        await act(async () => {
            confirm!.click();
        });
        const nextSubmission = paidSubmissions.at(-1) as { projectId: string; metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(nextSubmission.metadata.stage).toBe("creative-directions");
        expect(nextSubmission.projectId).not.toBe(saved.id);
        expect(nextSubmission.metadata.ecommerceDraft.instruction).toBe("换一款商品继续生成");
        expect(projects.get(saved.id)?.planJson).toBe(saved.planJson);
    });

    test("已完成图片的后台风格推荐不占用发送状态，新商品与旧作品隔离", async () => {
        draft.instruction = "生成详情页";
        const image = {
            id: "completed-image",
            taskId: "completed-task",
            imageType: "single",
            platform: draft.platform,
            language: draft.language,
            goal: "主视觉",
            theme: "商品",
            composition: "居中",
            mainVisual: "耳机",
            verifiedClaims: "",
            copy: "日常聆听",
            lighting: "柔光",
            fidelity: "保持真实外观",
            prompt: "保持商品外观",
            negativePrompt: "黑边",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
        };
        const saved = project({ ...draft, directionsTaskId: "followup-task" });
        saved.planJson = JSON.stringify({ inputSignature: commerceInputSignature(draft), productSummary: "耳机", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "街头画报", images: [image] });
        projects.set(saved.id, saved);
        tasks.set(image.taskId, { ...runningTask(image.taskId), status: "succeeded", outputs: [{ outputIndex: 0, materializedAssetId: "completed-asset" }], resultJson: JSON.stringify({ images: [{ dataUrl: "/completed.png" }] }) });
        tasks.set("followup-task", runningTask("followup-task"));
        await render(`/ecommerce?project=${saved.id}`);
        await act(async () => {
            observers.get(image.taskId)?.forEach((listener) => listener(tasks.get(image.taskId)!));
        });
        const send = () => host.querySelector<HTMLButtonElement>(".flylep-submit")!;
        expect(send().getAttribute("aria-busy")).toBe("false");
        expect(send().querySelector(".commerce-planning-spin")).toBeNull();
        expect(host.querySelector<HTMLInputElement>('[aria-label="添加商品参考图"]')?.disabled).toBe(false);
        const exporting = spyOn(exportApi, "exportEcommerceZip")
            .mockResolvedValue({ blob: new Blob(["zip-test"], { type: "application/zip" }), fileName: "耳机-电商图片.zip" })
            .mockRejectedValueOnce(new Error("下载连接暂时中断"));
        await press("导出图片");
        expect(host.querySelector('[role="alert"]')?.textContent).toContain("下载连接暂时中断");
        await press("导出图片");
        const download = host.querySelector<HTMLAnchorElement>('a[download="耳机-电商图片.zip"]');
        expect(download?.href.startsWith("blob:")).toBe(true);
        expect(download?.textContent).toContain("下载已打包文件");
        expect(host.querySelector('[role="alert"]')).toBeNull();
        expect(exporting).toHaveBeenCalledTimes(2);
        const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "换一款商品继续生成");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(send().disabled).toBe(false);
        await act(async () => {
            send().click();
        });
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "确认并生成");
        expect(confirm).toBeDefined();
        await act(async () => {
            confirm!.click();
        });
        expect(paidSubmissions).toHaveLength(1);
        const submission = paidSubmissions[0] as { projectId: string; metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(submission.projectId).not.toBe(saved.id);
        expect(submission.metadata.stage).toBe("creative-directions");
        expect(submission.metadata.ecommerceDraft.directionsTaskId).toBeUndefined();
        expect(projects.get(saved.id)?.planJson).toBe(saved.planJson);
        expect(tasks.get("followup-task")?.status).toBe("running");
    });

    test("打开和刷新已完成项目只恢复结果，不提交付费任务也不新建项目", async () => {
        draft = { ...draft, instruction: "生成详情页", creativeDirectionId: "chosen", creativeRecommendationId: "rec-done" };
        const images = Array.from({ length: 9 }, (_, index) => ({
            id: `done-${index}`,
            taskId: `done-task-${index}`,
            imageType: "detail",
            platform: draft.platform,
            language: draft.language,
            goal: "详情",
            theme: `第 ${index + 1} 屏`,
            composition: "构图",
            mainVisual: "商品",
            verifiedClaims: "",
            copy: "",
            lighting: "柔光",
            fidelity: "保持真实外观",
            prompt: `第 ${index + 1} 屏提示词`,
            negativePrompt: "",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
        }));
        const saved = project(draft);
        saved.planJson = JSON.stringify({ inputSignature: commerceInputSignature(draft), productSummary: "商品", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "方向", images });
        projects.set(saved.id, saved);
        for (const image of images)
            tasks.set(image.taskId, { ...runningTask(image.taskId), status: "succeeded", outputs: [{ outputIndex: 0, materializedAssetId: `asset-${image.id}` }], resultJson: JSON.stringify({ images: [{ dataUrl: `/${image.id}.png` }] }) });
        const post = spyOn(http, "post").mockImplementation((async (path: string) => {
            throw new Error(`unexpected POST ${path}`);
        }) as typeof http.post);
        const imageTasks = spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async () => {
            throw new Error("unexpected image task");
        });
        await render(`/ecommerce?project=${saved.id}`);
        await act(async () => {
            for (const image of images) observers.get(image.taskId)?.forEach((listener) => listener(tasks.get(image.taskId)!));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        await refresh();
        await act(async () => {
            for (const image of images) observers.get(image.taskId)?.forEach((listener) => listener(tasks.get(image.taskId)!));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(paidSubmissions).toHaveLength(0);
        expect(imageTasks).not.toHaveBeenCalled();
        expect(post.mock.calls.map(([path]) => path)).toEqual([]);
        expect(projects.size).toBe(1);
        expect(route).toContain(saved.id);
        expect(projects.get(saved.id)?.planJson).toBe(saved.planJson);
        expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("为你推荐下一组创意方向"))).toBe(true);
    });

    test("刷新部分提交的项目不自动续交剩余图片，需用户点击继续", async () => {
        draft = { ...draft, instruction: "生成详情页", creativeDirectionId: "chosen", creativeRecommendationId: "rec-partial" };
        const images = Array.from({ length: 9 }, (_, index) => ({
            id: `part-${index}`,
            ...(index < 4 ? { taskId: `part-task-${index}` } : {}),
            imageType: "detail",
            platform: draft.platform,
            language: draft.language,
            goal: "详情",
            theme: `第 ${index + 1} 屏`,
            composition: "构图",
            mainVisual: "商品",
            verifiedClaims: "",
            copy: "",
            lighting: "柔光",
            fidelity: "保持真实外观",
            prompt: `第 ${index + 1} 屏提示词`,
            negativePrompt: "",
            imageModel: draft.imageModel,
            ratio: draft.ratio,
            resolution: draft.resolution,
        }));
        const saved = project(draft);
        saved.planJson = JSON.stringify({ inputSignature: commerceInputSignature(draft), productSummary: "商品", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "方向", images });
        projects.set(saved.id, saved);
        for (const image of images)
            if (image.taskId)
                tasks.set(image.taskId, { ...runningTask(image.taskId), status: "succeeded", outputs: [{ outputIndex: 0, materializedAssetId: `asset-${image.id}` }], resultJson: JSON.stringify({ images: [{ dataUrl: `/${image.id}.png` }] }) });
        const imageTasks = spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async () => {
            throw new Error("unexpected image task");
        });
        await render(`/ecommerce?project=${saved.id}`);
        await act(async () => {
            for (const image of images) if (image.taskId) observers.get(image.taskId)?.forEach((listener) => listener(tasks.get(image.taskId!)!));
        });
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        await refresh();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(paidSubmissions).toHaveLength(0);
        expect(imageTasks).not.toHaveBeenCalled();
        expect(projects.size).toBe(1);
        expect(Array.from(host.querySelectorAll("button")).some((button) => button.textContent?.includes("继续生成剩余 5 张图片"))).toBe(true);
    });
    test("已选方向策划失败后输入框保持清空仍能确认重试", async () => {
        draft = { ...draft, references: [], instruction: "为蓝色耳机生成详情页", creativeDirectionId: "dark-style", creativeRecommendationId: "dark-rec" };
        const saved = project(draft);
        projects.set(saved.id, saved);
        spyOn(http, "post").mockImplementation((async (path: string) => {
            if (path === "/ecommerce/creative-directions/dark-rec/select") return { recommendationId: "dark-rec", directionId: "dark-style", status: "selected", planningContext: { knowledgeContext: [] } };
            throw new Error(`unexpected POST ${path}`);
        }) as typeof http.post);
        await render(`/ecommerce?project=${saved.id}`);
        await press("按已选方向重新策划");
        expect(paidSubmissions).toHaveLength(1);
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')?.value).toBe("");
        const taskId = sessions.peekEcommerceWorkspace(scope)!.draft.planningTaskId!;
        await act(async () => {
            const failed = { ...tasks.get(taskId)!, status: "failed" as const, error: "上游暂时不可用" };
            tasks.set(taskId, failed);
            observers.get(taskId)?.forEach((listener) => listener(failed));
        });
        expect(host.textContent).toContain("上游暂时不可用");
        await press("按已选方向重新策划");
        expect(paidSubmissions).toHaveLength(2);
        const retry = paidSubmissions[1] as { metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(retry.metadata.stage).toBe("planning");
        expect(retry.metadata.ecommerceDraft.creativeDirectionId).toBe("dark-style");
        expect(retry.metadata.ecommerceDraft.instruction).toBe(draft.instruction);
    });

    test("空白提示词禁用发送，有输入启用，清空后再次禁用", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        expect(host.querySelector<HTMLButtonElement>(".flylep-submit")!.disabled).toBe(true);
        await press("示例");
        expect(host.querySelector<HTMLButtonElement>(".flylep-submit")!.disabled).toBe(false);
        const editor = host.querySelector<HTMLTextAreaElement>(".flylep-composer textarea") || host.querySelector<HTMLTextAreaElement>("textarea");
        expect(editor).not.toBeNull();
        const setValue = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!;
        await act(async () => {
            setValue.call(editor, "   ");
            editor!.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(host.querySelector<HTMLButtonElement>(".flylep-submit")!.disabled).toBe(true);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("返回项目时分析失败会恢复真实错误，旧参数结果不会覆盖新需求", async () => {
        const source = { ...draft, instruction: "原始需求" };
        const saved = project({ ...source, directionsTaskId: "failed-directions" });
        projects.set(saved.id, saved);
        tasks.set("failed-directions", { ...runningTask("failed-directions"), status: "failed", error: "模型服务响应超时，请稍后重试" });
        await render(`/ecommerce?project=${saved.id}`);
        expect(host.textContent).toContain("模型服务响应超时");
        expect(host.querySelector(".flylep-submit")?.getAttribute("aria-busy")).toBe("false");
        await act(async () => {
            navigate("/other");
        });
        const changed = { ...source, instruction: "新需求", directionsTaskId: "stale-directions" };
        const next = { ...saved, revision: 2, draftJson: JSON.stringify(changed) };
        projects.set(next.id, next);
        tasks.set("stale-directions", {
            ...runningTask("stale-directions"),
            status: "succeeded",
            inputJson: JSON.stringify({ metadata: { ecommerceDraft: source } }),
            resultJson: JSON.stringify({ text: JSON.stringify({ recommendationId: "old", directions: Array.from({ length: 4 }, () => ({ id: "old", name: "不该显示的旧风格", summary: "旧结果", tags: [] })) }) }),
        });
        await act(async () => {
            navigate(`/ecommerce?project=${saved.id}`);
        });
        expect(host.textContent).toContain("参数已修改");
        expect(host.textContent).not.toContain("不该显示的旧风格");
        expect(paidSubmissions).toHaveLength(0);
    });

    test("生成图片可按缩放自由移动、撤销重做，重入项目恢复位置且不触发生图", async () => {
        const saved = project(draft);
        const image = {
            id: "move-image",
            taskId: "move-task",
            imageType: "main",
            platform: draft.platform,
            language: draft.language,
            goal: "展示商品",
            theme: "商品主视觉",
            composition: "居中",
            mainVisual: "商品",
            verifiedClaims: "",
            copy: "",
            lighting: "柔光",
            fidelity: "保持结构",
            prompt: "真实商品",
            negativePrompt: "",
            imageModel: draft.imageModel,
            ratio: "1:1",
            resolution: draft.resolution,
        };
        saved.planJson = JSON.stringify({ productSummary: "商品", confirmedFacts: [], uncertainFacts: [], qualityChecks: [], visualStrategy: "真实商品", images: [image, { ...image, id: "move-image-2", taskId: "move-task-2" }] });
        projects.set(saved.id, saved);
        for (const id of ["move-task", "move-task-2"])
            tasks.set(id, { ...runningTask(id), status: "succeeded", previewUrl: "/test-product.png", outputs: [{ outputIndex: 0, materializedAssetId: `${id}-asset` }], resultJson: JSON.stringify({ images: [{ dataUrl: "/test-product.png" }] }) });
        await render(`/ecommerce?project=${saved.id}`);
        await act(async () => {
            for (const id of ["move-task", "move-task-2"]) observers.get(id)?.forEach((listener) => listener(tasks.get(id)!));
        });
        const world = host.querySelector<HTMLElement>(".commerce-canvas-results")!;
        Object.defineProperty(world, "offsetWidth", { configurable: true, value: 548 });
        spyOn(world, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 274, bottom: 130, width: 274, height: 130, toJSON() {} });
        const capture = new Set<number>();
        const control = () => host.querySelector<HTMLButtonElement>(".ecommerce-result-open")!;
        for (const element of host.querySelectorAll<HTMLElement>(".ecommerce-result-open")) {
            element.setPointerCapture = (id) => {
                capture.add(id);
            };
            element.hasPointerCapture = (id) => capture.has(id);
            element.releasePointerCapture = (id) => {
                capture.delete(id);
            };
        }
        const pointer = async (type: string, x: number, y: number) =>
            act(async () => {
                control().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerId: 42, pointerType: "mouse", clientX: x, clientY: y }));
            });
        const node = () => host.querySelector<HTMLElement>('[data-ecommerce-image-id="move-image"]')!;
        await pointer("pointerdown", 100, 100);
        await pointer("pointermove", 160, 140);
        await pointer("pointerup", 180, 150);
        expect(node().style.translate).toBe("160px 100px");
        await act(async () => {
            control().click();
        }); // A drag must not toggle off its selection.
        expect(node().classList.contains("is-focused")).toBe(true);
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="撤回画布操作"]')!.click();
        });
        expect(node().style.translate).toBe("");
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="前进画布操作"]')!.click();
        });
        expect(node().style.translate).toBe("160px 100px");
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".commerce-canvas-layers header button")!.click();
        });
        expect(host.querySelector(".commerce-selected-tools")).toBeNull();
        await pointer("pointerdown", 100, 100);
        await pointer("pointermove", 130, 90);
        await pointer("pointerup", 130, 90);
        expect(node().style.translate).toBe("220px 80px");
        expect(host.querySelector<HTMLElement>('[data-ecommerce-image-id="move-image-2"]')!.style.translate).toBe("60px -20px");
        await pointer("pointerdown", 100, 100);
        await pointer("pointermove", -900, -500);
        await pointer("pointercancel", -900, -500);
        expect(node().style.translate).toBe("220px 80px");
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate(`/ecommerce?project=${saved.id}`);
        });
        expect(node().style.translate).toBe("220px 80px");
        expect(host.querySelectorAll(".commerce-canvas-layer-list > button")).toHaveLength(2);
        expect(paidSubmissions).toHaveLength(0);
    });
    test("生成前展示服务端报价确认，取消不会创建付费任务", async () => {
        draft = { ...draft, references: [], instruction: "为测试商品设计白底图" };
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".flylep-submit")!.click();
        });
        expect(document.body.textContent).toContain("确认生成配置");
        expect(document.body.textContent).toContain("预估消耗");
        expect(paidSubmissions).toHaveLength(0);
        const cancel = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.replace(/\s/g, "") === "取消");
        expect(cancel).toBeDefined();
        await act(async () => {
            cancel!.click();
        });
        expect(paidSubmissions).toHaveLength(0);
    });
    test("提交失败时保留输入内容供用户重试", async () => {
        draft = { ...draft, instruction: "保留这次商品需求" };
        spyOn(taskApi, "createGenerationTask").mockRejectedValueOnce(new Error("提交失败"));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".flylep-submit")!.click();
        });
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "确认并生成");
        await act(async () => {
            confirm!.click();
        });
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')?.value).toBe("保留这次商品需求");
    });
    test("点击知识推荐方向只提交一次隐藏策划，并在任务结束后直接提交图片", async () => {
        draft = { ...draft, references: [], noText: true, instruction: "为蓝色耳机创作" };
        const post = spyOn(http, "post").mockImplementation((async (path: string) => {
            if (path === "/ecommerce/projects") {
                const value = project(emptyEcommerceDraft());
                projects.set(value.id, value);
                return structuredClone(value);
            }
            if (path === "/ecommerce/creative-directions/rec-test/select") return { recommendationId: "rec-test", directionId: "direction-1", status: "selected", planningContext: { knowledgeContext: [{ content: "不可虚构性能数据" }] } };
            throw new Error(`unexpected POST ${path}`);
        }) as typeof http.post);
        spyOn(configStore, "resolveModelChannel").mockReturnValue({ id: "test" } as ReturnType<typeof configStore.resolveModelChannel>);
        const images = spyOn(workbenchApi, "createWorkbenchTask").mockImplementation(async () => runningTask("generated-image"));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".flylep-submit")!.click();
        });
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.textContent?.trim() === "确认并生成");
        expect(confirm).toBeDefined();
        await act(async () => {
            confirm!.click();
        });
        expect(host.querySelector<HTMLTextAreaElement>('[aria-label="电商创作输入"]')?.value).toBe("");
        expect(paidSubmissions).toHaveLength(1);
        const directionTaskId = sessions.peekEcommerceWorkspace(scope)!.draft.directionsTaskId!;
        const directionTask = { ...tasks.get(directionTaskId)!, inputJson: JSON.stringify({ metadata: (paidSubmissions[0] as { metadata: unknown }).metadata }) };
        const directionResult = {
            recommendationId: "rec-test",
            directions: Array.from({ length: 4 }, (_, index) => ({ id: `direction-${index}`, name: `方向 ${index}`, summary: "检索到的视觉策略", tags: ["商品保真"] })),
            evidence: [],
            retrievalStatus: "ready",
            productCategory: "耳机",
        };
        await act(async () => {
            const completed = { ...directionTask, status: "succeeded" as const, resultJson: JSON.stringify({ text: JSON.stringify(directionResult) }) };
            tasks.set(directionTaskId, completed);
            observers.get(directionTaskId)?.forEach((listener) => listener(completed));
        });
        expect(host.querySelectorAll(".flylep-workspace .flylep-direction-card")).toHaveLength(4);
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="编辑第 2 个风格"]')!.click();
        });
        const nameEditor = host.querySelector<HTMLInputElement>('[aria-label="第 2 个风格名称"]')!;
        const editor = host.querySelector<HTMLTextAreaElement>('[aria-label="第 2 个风格描述"]')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(nameEditor, "极简方向");
            nameEditor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "保留蓝色耳机真实外观");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            Array.from(host.querySelectorAll<HTMLButtonElement>(".commerce-direction-edit-actions button"))
                .find((button) => button.textContent?.includes("保存"))!
                .click();
        });
        const cards = host.querySelectorAll<HTMLButtonElement>(".flylep-workspace .flylep-direction-card");
        expect(cards).toHaveLength(4);
        expect(cards[1].textContent).toContain("极简方向");
        await act(async () => {
            cards[1].click();
        });
        const chooseDirection = host.querySelector<HTMLButtonElement>(".commerce-direction-confirm")!;
        expect(chooseDirection.disabled).toBe(false);
        await act(async () => {
            chooseDirection.click();
        });
        expect(post.mock.calls.filter(([path]) => path.endsWith("/select"))).toHaveLength(1);
        expect(host.querySelector(".commerce-direction-choice")?.textContent).toContain("极简方向");
        expect(errors).toEqual([]);
        expect(paidSubmissions).toHaveLength(2);
        const submission = paidSubmissions[1] as { prompt: string; metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(submission.metadata.stage).toBe("planning");
        expect(submission.prompt).toContain("不可虚构性能数据");
        expect(submission.prompt).toContain("保留蓝色耳机真实外观");
        expect(submission.metadata.ecommerceDraft.instruction).toBe(draft.instruction);
        expect(submission.metadata.ecommerceDraft.creativeDirectionId).toBe("direction-1");
        const plan = {
            productSummary: "蓝色耳机",
            confirmedFacts: [],
            uncertainFacts: [],
            qualityChecks: [],
            visualStrategy: "按已选方向展示商品",
            images: [
                {
                    id: "planned-image",
                    imageType: "main",
                    platform: draft.platform,
                    language: draft.language,
                    goal: "展示商品",
                    theme: "商品主视觉",
                    composition: "商品居中",
                    mainVisual: "蓝色耳机",
                    verifiedClaims: "",
                    copy: "",
                    lighting: "柔光",
                    fidelity: "保持结构",
                    prompt: "真实蓝色耳机居中展示，保持商品真实外观",
                    negativePrompt: "虚构功能",
                    imageModel: draft.imageModel,
                    ratio: draft.ratio,
                    resolution: draft.resolution,
                },
            ],
        };
        const id = sessions.peekEcommerceWorkspace(scope)!.draft.planningTaskId!;
        await act(async () => {
            const done = { ...tasks.get(id)!, status: "succeeded" as const, resultJson: JSON.stringify({ text: JSON.stringify(plan) }), inputJson: JSON.stringify({ metadata: submission.metadata }) };
            tasks.set(id, done);
            observers.get(id)?.forEach((listener) => listener(done));
        });
        expect(errors).toEqual([]);
        if (!images.mock.calls.length) throw new Error(host.querySelector(".commerce-assistant-status")?.textContent || JSON.stringify([...observers.keys()]));
        expect(images).toHaveBeenCalledTimes(1);
        expect(host.querySelector(".commerce-generation-message")?.textContent).toContain("AI 生成中");
        expect(host.querySelector(".commerce-result-canvas .ecommerce-result")).not.toBeNull();
        const finishedImage = { ...runningTask("generated-image"), status: "succeeded" as const, resultJson: JSON.stringify({ images: [{ dataUrl: "/finished-image.png" }] }), outputs: [{ outputIndex: 0, materializedAssetId: "finished-asset" }] };
        await act(async () => {
            tasks.set(finishedImage.id, finishedImage);
            observers.get(finishedImage.id)?.forEach((listener) => listener(finishedImage));
        });
        expect(host.querySelector(".commerce-generated-card img")).not.toBeNull();
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".commerce-generated-preview")!.click();
        });
        expect(host.querySelectorAll(".commerce-canvas-layer-list > button")).toHaveLength(1);
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".commerce-canvas-layers header button")!.click();
        });
        expect(host.querySelector(".commerce-canvas-layer-list > button.is-selected")).not.toBeNull();
        // Finishing a set in this session starts exactly one follow-up recommendation.
        expect(paidSubmissions).toHaveLength(3);
        expect((paidSubmissions[2] as { metadata: { stage: string } }).metadata.stage).toBe("creative-directions");
        expect(host.querySelector(".commerce-direction-message.is-followup")).toBeNull();
        expect(planningProgress()?.textContent).toContain("小夜正在分析商品并推荐视觉风格");
        expect(host.querySelector(".commerce-result-canvas .ecommerce-result")).not.toBeNull();
        expect(paidSubmissions).toHaveLength(3);
        expect(images).toHaveBeenCalledTimes(1);
        expect(sessions.peekEcommerceWorkspace(scope)?.plan?.images[0]?.taskId).toBe("generated-image");
    });
    test("平台图标与语言旗帜可选中并保留用户张数，不触发生图", async () => {
        draft = { ...draft, count: 4 };
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await press("淘宝 · 简体中文");
        const dialog = document.querySelector<HTMLElement>('[aria-label="电商平台与语言"]')!;
        const amazon = Array.from(dialog.querySelectorAll<HTMLButtonElement>(".commerce-market-grid button")).find((entry) => entry.textContent === "Amazon")!;
        expect(amazon.querySelector("img")?.getAttribute("src")).toBe("/commerce/platforms/amazon.svg");
        await act(async () => amazon.click());
        expect(amazon.getAttribute("aria-pressed")).toBe("true");
        await act(async () => dialog.querySelector<HTMLButtonElement>(".commerce-language-trigger")!.click());
        const russian = Array.from(dialog.querySelectorAll<HTMLButtonElement>("[role=option]")).find((entry) => entry.textContent === "俄语")!;
        expect(russian.querySelector("img")?.getAttribute("src")).toBe("/commerce/flags/ru.svg");
        await act(async () => russian.click());
        expect(dialog.querySelector(".commerce-language-trigger")?.textContent).toContain("俄语");
        expect(dialog.querySelector("[role=listbox]")).toBeNull();
        await act(async () => dialog.querySelector<HTMLButtonElement>('[aria-label="关闭参数"]')!.click());
        expect(document.querySelector('[aria-label="电商平台与语言"]')).toBeNull();
        expect(sessions.peekEcommerceWorkspace(scope)?.draft).toMatchObject({ platform: "amazon", language: "ru", count: 4 });
        expect(paidSubmissions).toHaveLength(0);
    });
    test("创作类型菜单区分视频灰度项，主副图和张数滑块更新真实草稿", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        const toolbar = host.querySelector<HTMLElement>(".flylep-composer-toolbar")!;
        await act(async () => {
            toolbar.querySelectorAll<HTMLButtonElement>("button")[0].click();
        });
        expect(document.querySelector<HTMLButtonElement>(".flylep-type-menu button:disabled")?.textContent).toContain("电商视频");
        await act(async () => {
            toolbar.querySelectorAll<HTMLButtonElement>("button")[1].click();
        });
        const mainSecondary = Array.from(document.querySelectorAll<HTMLButtonElement>(".flylep-type-menu button")).find((button) => button.textContent === "主副图")!;
        await act(async () => {
            mainSecondary.click();
        });
        expect(document.querySelector(".flylep-type-extra")).toBeNull();
        expect(toolbar.querySelectorAll<HTMLButtonElement>("button")[1].textContent).toContain("主副图");
        expect(sessions.peekEcommerceWorkspace(scope)?.draft).toMatchObject({ imageType: "set", count: 2, typeOptions: { distribution: "主图 1 张、副图 1 张" } });
        await act(async () => {
            toolbar.querySelectorAll<HTMLButtonElement>("button")[3].click();
        });
        const slider = document.querySelector<HTMLInputElement>('.flylep-count-control input[type="range"]')!;
        expect(slider.max).toBe("20");
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(slider, "20");
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.count).toBe(20);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.typeOptions?.distribution).toBe("");
        expect(paidSubmissions).toHaveLength(0);
    });
    test("电商 Agent 分析模型由后台固定：页面不展示选择，提交使用后台识图与策划模型", async () => {
        const choices = ["test::vision", "test::admin-vision", "test::admin-planner"];
        spyOn(configStore, "selectableModelsByCapability").mockImplementation((_, capability) => (capability === "text" ? choices : ["test::image"]));
        spyOn(pricing, "modelQuoteRequest").mockImplementation((_, value) => ({ channelId: "test", modelKey: value.split("::")[1], intent: { capability: "text" } }) as ReturnType<typeof pricing.modelQuoteRequest>);
        spyOn(http, "get").mockImplementation((async (path: string) => {
            if (path === "/ecommerce/agent-setting") return { logicalModelId: "", channelModelId: "planner", channelId: "test", modelKey: "admin-planner", vision: { channelModelId: "vision", channelId: "test", modelKey: "admin-vision" } };
            if (path.startsWith("/ecommerce/projects")) return { projects: [] };
            throw new Error(`unexpected GET ${path}`);
        }) as typeof http.get);
        // A draft saved while users could still pick a model keeps that value
        // until the next submission, which is stamped with the administrator's model.
        draft = { ...draft, agentModel: "test::vision", references: [], instruction: "生成商品风格" };
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        expect(host.querySelector('[aria-label="选择电商 Agent 大模型"]')).toBeNull();
        expect(host.querySelector(".flylep-composer-toolbar")!.textContent).not.toContain("电商 Agent");
        localStorage.removeItem(`ecommerce-confirm-skip:${scope}`);
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".flylep-submit")!.click();
        });
        expect(errors).toEqual([]);
        const grid = document.querySelector(".commerce-confirm-grid")!.textContent;
        for (const hidden of ["电商 Agent", "商品识图", "视觉策划"]) expect(grid).not.toContain(hidden);
        const confirm = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.trim() === "确认并生成");
        expect(confirm).toBeDefined();
        await act(async () => {
            confirm!.click();
        });
        expect(errors).toEqual([]);
        expect(paidSubmissions).toHaveLength(1);
        const submitted = paidSubmissions[0] as { config: { model: string }; metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(submitted.metadata.stage).toBe("creative-directions");
        expect(submitted.config.model).toBe("test::admin-vision");
        expect(submitted.metadata.ecommerceDraft.agentModel).toBe("test::admin-planner");
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.agentModel).toBe("test::admin-planner");
    });
    test("按已选方向重新策划时，收费策划任务使用后台策划模型而不是草稿里的旧模型", async () => {
        const choices = ["test::vision", "test::admin-vision", "test::admin-planner"];
        spyOn(configStore, "selectableModelsByCapability").mockImplementation((_, capability) => (capability === "text" ? choices : ["test::image"]));
        spyOn(pricing, "modelQuoteRequest").mockImplementation((_, value) => ({ channelId: "test", modelKey: value.split("::")[1], intent: { capability: "text" } }) as ReturnType<typeof pricing.modelQuoteRequest>);
        spyOn(http, "get").mockImplementation((async (path: string) => {
            if (path === "/ecommerce/agent-setting") return { logicalModelId: "", channelModelId: "planner", channelId: "test", modelKey: "admin-planner", vision: { channelModelId: "vision", channelId: "test", modelKey: "admin-vision" } };
            if (path.startsWith("/ecommerce/projects")) return { projects: [] };
            throw new Error(`unexpected GET ${path}`);
        }) as typeof http.get);
        spyOn(http, "post").mockImplementation((async (path: string) => {
            if (path === "/ecommerce/projects") {
                const value = project(emptyEcommerceDraft());
                projects.set(value.id, value);
                return structuredClone(value);
            }
            if (path === "/ecommerce/creative-directions/rec-1/select") return { recommendationId: "rec-1", directionId: "direction-1", planningContext: { imageCount: 1 } };
            throw new Error(`unexpected POST ${path}`);
        }) as typeof http.post);
        draft = { ...draft, agentModel: "test::vision", creativeRecommendationId: "rec-1", creativeDirectionId: "direction-1", instruction: "按已选方向策划" };
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        localStorage.removeItem(`ecommerce-confirm-skip:${scope}`);
        await press("按已选方向重新策划");
        expect(errors).toEqual([]);
        expect(paidSubmissions).toHaveLength(1);
        const submitted = paidSubmissions[0] as { config: { model: string }; metadata: { stage: string; ecommerceDraft: EcommerceDraft } };
        expect(submitted.metadata.stage).toBe("planning");
        expect(submitted.config.model).toBe("test::admin-planner");
        expect(submitted.metadata.ecommerceDraft.agentModel).toBe("test::admin-planner");
    });
    test("详情图默认九张，手动张数在保存与页面恢复后保留", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        const toolbar = () => host.querySelector<HTMLElement>(".flylep-composer-toolbar")!;
        await act(async () => {
            toolbar().querySelectorAll<HTMLButtonElement>("button")[1].click();
        });
        const detail = Array.from(document.querySelectorAll<HTMLButtonElement>(".flylep-type-menu button")).find((button) => button.textContent === "详情图")!;
        await act(async () => {
            detail.click();
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft).toMatchObject({ imageType: "detail", count: 9 });
        await act(async () => {
            toolbar().querySelectorAll<HTMLButtonElement>("button")[3].click();
        });
        const slider = document.querySelector<HTMLInputElement>('[aria-label="图片张数"]')!;
        expect(slider.value).toBe("9");
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(slider, "6");
            slider.dispatchEvent(new Event("input", { bubbles: true }));
            slider.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.count).toBe(6);
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft).toMatchObject({ imageType: "detail", count: 6 });
        expect(paidSubmissions).toHaveLength(0);
    });
    test("整块输入区可点击编辑，示例有预览，多张商品图横向列出", async () => {
        draft = {
            ...draft,
            references: [
                { resourceId: "product-a", role: "primary", name: "主图" },
                { resourceId: "product-b", role: "detail", name: "细节" },
            ],
        };
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        const promptBox = host.querySelector<HTMLElement>(".flylep-prompt-box")!;
        await act(async () => {
            promptBox.click();
        });
        expect(document.activeElement).toBe(host.querySelector('textarea[aria-label="电商创作输入"]'));
        expect(host.querySelector(".commerce-example-preview img")?.getAttribute("src")).toBe("/commerce/examples/diffuser-white-v1.png");
        const row = host.querySelector(".flylep-product-slot .commerce-reference-list")!;
        expect(row.firstElementChild?.classList.contains("commerce-reference-add")).toBe(true);
        expect(row.querySelectorAll(".commerce-reference-item")).toHaveLength(2);
        expect(paidSubmissions).toHaveLength(0);
    });
    test("画布可放置默认文字、双击编辑并撤回前进", async () => {
        await render();
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="输入文字"]')!.click();
        });
        const viewport = host.querySelector<HTMLElement>("[data-canvas-viewport]")!;
        await act(async () => {
            viewport.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 800, clientY: 300, pointerType: "mouse", pointerId: 1 }));
        });
        const layer = host.querySelector<HTMLElement>(".commerce-canvas-layer")!;
        expect(layer.textContent).toContain("电商 Agent");
        await act(async () => {
            layer.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
        });
        const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="编辑画布文字"]')!;
        expect(editor).not.toBeNull();
        await act(async () => {
            Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(editor, "我的商品");
            editor.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            editor.blur();
        });
        expect(host.querySelector(".commerce-canvas-layer")?.textContent).toContain("我的商品");
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="撤回画布操作"]')!.click();
        });
        expect(host.querySelector(".commerce-canvas-layer")?.textContent).toContain("电商 Agent");
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="前进画布操作"]')!.click();
        });
        expect(host.querySelector(".commerce-canvas-layer")?.textContent).toContain("我的商品");
        expect(paidSubmissions).toHaveLength(0);
    });
    test("画布上传图片形成可撤回的资源图层", async () => {
        spyOn(resourceApi, "uploadResourceFile").mockResolvedValue(uploadedImage("canvas-uploaded"));
        await render();
        const input = host.querySelector<HTMLInputElement>('input[aria-label="上传图片到画布"]')!;
        Object.defineProperty(input, "files", { configurable: true, value: [new File(["image"], "商品.png", { type: "image/png" })] });
        await act(async () => {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(host.querySelector(".commerce-canvas-layer img")?.getAttribute("src")).toContain("canvas-uploaded");
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="撤回画布操作"]')!.click();
        });
        expect(host.querySelector(".commerce-canvas-layer img")).toBeNull();
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="前进画布操作"]')!.click();
        });
        expect(host.querySelector(".commerce-canvas-layer img")?.getAttribute("src")).toContain("canvas-uploaded");
        expect(paidSubmissions).toHaveLength(0);
    });
    test.each(["product", "style"] as const)("%s 模式单次生图需要 21 张参考时，在收费策划之前阻止提交", async (mode) => {
        draft =
            mode === "product"
                ? { ...draft, references: [...draft.references, ...Array.from({ length: 20 }, (_, index) => ({ resourceId: `product-detail-${index}`, role: "detail" as const }))] }
                : { ...draft, referenceMode: "style", layoutReferences: Array.from({ length: 20 }, (_, index) => ({ resourceId: `style-${index}`, role: "style" as const })) };
        const mediaPreparation = spyOn(referenceMedia, "prepareCommerceReferenceViews").mockImplementation(async (source) => ({ draft: source, views: [] }));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await press("AI 一键策划");
        expect(errors.some((message) => message.includes("平台单次生图最多接收 20 张") && message.includes("21 张"))).toBe(true);
        expect(mediaPreparation).not.toHaveBeenCalled();
        expect(paidSubmissions).toHaveLength(0);
        expect(projects.size).toBe(0);
    });

    test("逐屏模式可保存 24 张素材，并按商品图加单屏裁片的实际需求提交策划", async () => {
        draft = { ...draft, referenceMode: "detail", imageType: "detail", layoutReferences: Array.from({ length: 23 }, (_, index) => ({ resourceId: `long-${index}`, role: "style" as const })) };
        spyOn(referenceMedia, "prepareCommerceReferenceViews").mockImplementation(async (source) => ({ draft: source, views: [] }));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await press("AI 一键策划");
        expect(paidSubmissions).toHaveLength(1);
        const input = paidSubmissions[0] as { referenceImages: unknown[]; metadata: { ecommerceDraft: EcommerceDraft } };
        expect(input.referenceImages).toHaveLength(24);
        expect(input.metadata.ecommerceDraft.layoutReferences).toHaveLength(23);
        expect(input.metadata.ecommerceDraft.references).toHaveLength(1);
    });

    test.each([
        ["style", "参考风格与排版", "style"],
        ["detail", "长图详情页逐屏参考", "style"],
    ] as const)("%s 上传卡的图片角色和来源进入保存及后端策划快照", async (mode, label, role) => {
        const upload = spyOn(resourceApi, "uploadResourceFile").mockResolvedValue(uploadedImage(`uploaded-${mode}`));
        spyOn(referenceMedia, "prepareCommerceReferenceViews").mockImplementation(async (source, _maximum, assertCurrent) => {
            assertCurrent?.();
            return { draft: source, views: [] };
        });
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await selectOption("参考方式", label);
        await uploadModeFile(`${mode}.png`);
        expect(upload).toHaveBeenCalledTimes(1);
        expect(paidSubmissions).toHaveLength(0);
        expect(projects.size).toBe(0);
        await press("保存草稿");
        const stored = JSON.parse([...projects.values()][0].draftJson) as EcommerceDraft;
        expect(stored.references).toEqual(draft.references);
        expect(stored.layoutReferences).toEqual([{ resourceId: `uploaded-${mode}`, role, name: `${mode}.png`, width: 800, height: 800 }]);
        expect(stored.referenceMode || "product").toBe(mode);
        if (mode === "detail") expect(stored.imageType).toBe("detail");
        await press("AI 一键策划");
        expect(paidSubmissions).toHaveLength(1);
        const submission = paidSubmissions[0] as { prompt: string; referenceImages: Array<{ id: string }>; metadata: { ecommerceDraft: EcommerceDraft } };
        expect(submission.metadata.ecommerceDraft.references).toEqual(stored.references);
        expect(submission.metadata.ecommerceDraft.layoutReferences).toEqual(stored.layoutReferences);
        expect(submission.referenceImages.map((reference) => reference.id)).toEqual(["owned-product", `uploaded-${mode}`]);
        expect(submission.prompt).toContain(`"referenceMode":"${mode}"`);
    });

    test("追加借鉴图保留已有来源、商品与Logo且不删除服务器资源", async () => {
        draft = { ...draft, referenceMode: "style", layoutReferences: [{ resourceId: "old-style", role: "style", name: "旧参考.png" }], references: [...draft.references, { resourceId: "brand-logo", role: "logo", name: "品牌.png" }] };
        spyOn(resourceApi, "uploadResourceFile").mockResolvedValue(uploadedImage("new-style"));
        const deletion = spyOn(http, "delete").mockResolvedValue(undefined);
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await uploadModeFile();
        await press("保存草稿");
        const stored = JSON.parse([...projects.values()][0].draftJson) as EcommerceDraft;
        expect(stored.layoutReferences?.map((ref) => ref.resourceId)).toEqual(["old-style", "new-style"]);
        expect(stored.references.map((reference) => [reference.resourceId, reference.role])).toEqual([
            ["owned-product", "primary"],
            ["brand-logo", "logo"],
        ]);
        expect(deletion).not.toHaveBeenCalled();
        expect(paidSubmissions).toHaveLength(0);
    });

    test("上传失败保留原参考图和绑定，不保存半成品或触发分析", async () => {
        draft = { ...draft, referenceMode: "detail", imageType: "detail", layoutReferences: [{ resourceId: "original-long", role: "style", name: "原详情长图.png" }] };
        spyOn(resourceApi, "uploadResourceFile").mockRejectedValue(new Error("图片上传失败"));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await uploadModeFile();
        expect(host.querySelector('[aria-label="参考方式设置"] [role="alert"]')?.textContent).toContain("图片上传失败");
        expect(projects.size).toBe(0);
        await press("保存草稿");
        const stored = JSON.parse([...projects.values()][0].draftJson) as EcommerceDraft;
        expect(stored.references).toEqual(draft.references);
        expect(stored.layoutReferences).toEqual(draft.layoutReferences);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("一次选择两张借鉴图按顺序追加，独立移除后保存并跨页恢复", async () => {
        draft = { ...draft, referenceMode: "style" };
        let uploads = 0;
        spyOn(resourceApi, "uploadResourceFile").mockImplementation(async () => uploadedImage(`batch-${++uploads}`));
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        const input = host.querySelector<HTMLInputElement>('[aria-label="参考方式设置"] input[type="file"]')!;
        expect(input.multiple).toBe(true);
        Object.defineProperty(input, "files", { configurable: true, value: ["一.png", "二.png"].map((name) => new File(["test-image"], name, { type: "image/png" })) });
        await act(async () => {
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(uploads).toBe(2);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.references).toEqual(draft.references);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.layoutReferences?.map((ref) => ref.resourceId)).toEqual(["batch-1", "batch-2"]);
        expect(host.querySelector('[aria-label="参考方式设置"]')?.textContent).not.toContain("也可从已上传图片中选择");
        await act(async () => {
            host.querySelector<HTMLButtonElement>('[aria-label="移除一.png"]')!.click();
        });
        await press("保存草稿");
        const id = [...projects.keys()][0];
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate(`/ecommerce?project=${id}`);
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.references).toEqual(draft.references);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.layoutReferences?.map((ref) => ref.resourceId)).toEqual(["batch-2"]);
        expect(host.querySelector('[aria-label="已上传借鉴图片"]')?.textContent).toContain("二.png");
        expect(paidSubmissions).toHaveLength(0);
    });

    test.each(["追加", "移除"] as const)("逐屏方案%s借鉴来源后保存新草稿，旧方案与任务仍留在历史", async (change) => {
        draft = {
            ...draft,
            referenceMode: "detail",
            imageType: "detail",
            count: 2,
            layoutReferences: [
                { resourceId: "first-layout", role: "style", name: "参考一.png" },
                { resourceId: "second-layout", role: "style", name: "参考二.png" },
            ],
        };
        const originalPlan: EcommercePlan = {
            productSummary: "自己的蓝色商品",
            confirmedFacts: [],
            uncertainFacts: [],
            qualityChecks: [],
            visualStrategy: "按参考图逐屏展示真实商品",
            referenceSummary: "两张借鉴图各包含一屏",
            inputSignature: commerceInputSignature(draft),
            images: draft.layoutReferences!.map((source, index) => ({
                id: `screen-${index + 1}`,
                imageType: "detail",
                platform: draft.platform,
                language: draft.language,
                goal: "展示商品",
                theme: "蓝色日常",
                composition: "上文下图",
                mainVisual: "真实商品",
                verifiedClaims: "",
                copy: "看见日常里的蓝色",
                lighting: "自然光",
                fidelity: "保留真实商品",
                prompt: "按该屏图文位置展示自己的商品",
                negativePrompt: "不替换商品",
                imageModel: draft.imageModel,
                ratio: draft.ratio,
                resolution: draft.resolution,
                taskId: `existing-image-${index + 1}`,
                referenceScreen: { sourceResourceId: source.resourceId, screenIndex: index + 1, top: 0, bottom: 1, content: "商品展示", layout: "上文下图", visual: "浅蓝背景", resourceId: `existing-crop-${index + 1}` },
            })),
        };
        const original = { ...project(draft), planJson: JSON.stringify(originalPlan), status: "completed" };
        const snapshot = structuredClone(original);
        projects.set(original.id, original);
        spyOn(resourceApi, "uploadResourceFile").mockResolvedValue(uploadedImage("third-layout"));
        await render(`/ecommerce?project=${original.id}`);
        if (change === "追加") await uploadModeFile("参考三.png");
        else
            await act(async () => {
                host.querySelector<HTMLButtonElement>('[aria-label="移除参考一.png"]')!.click();
            });
        expect(host.textContent).toContain("配置已更新");
        const expectedIds = change === "追加" ? ["first-layout", "second-layout", "third-layout"] : ["second-layout"];
        await press("保存草稿");
        expect(projects.get(original.id)).toEqual(snapshot);
        expect(projects.size).toBe(2);
        const fresh = [...projects.values()].find((entry) => entry.id !== original.id)!;
        const savedDraft = JSON.parse(fresh.draftJson) as EcommerceDraft;
        expect(savedDraft.layoutReferences!.map((source) => source.resourceId)).toEqual(expectedIds);
        expect(savedDraft.references).toEqual(draft.references);
        expect(savedDraft.planningTaskId).toBeUndefined();
        expect(JSON.parse(fresh.planJson)).toEqual({});
        expect(route).toBe(`/ecommerce?project=${fresh.id}`);
        expect(sessions.peekEcommerceWorkspace(scope)?.plan).toBeNull();
        expect(host.textContent).toContain("原方案和成品保留在历史项目");
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate(`/ecommerce?project=${fresh.id}`);
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.layoutReferences!.map((source) => source.resourceId)).toEqual(expectedIds);
        expect(sessions.peekEcommerceWorkspace(scope)?.plan).toBeNull();
        await act(async () => {
            navigate(`/ecommerce?project=${original.id}`);
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.plan).toEqual(originalPlan);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.layoutReferences).toEqual(draft.layoutReferences);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("上传期间保存草稿被禁用，完成后保存包含本次新增图片", async () => {
        draft = { ...draft, referenceMode: "style" };
        let finishUpload!: (resource: RemoteResource) => void;
        spyOn(resourceApi, "uploadResourceFile").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishUpload = resolve;
                }),
        );
        const original = project(draft);
        projects.set(original.id, original);
        await render(`/ecommerce?project=${original.id}`);
        await uploadModeFile();
        const save = Array.from(host.querySelectorAll("button")).find((entry) => entry.textContent?.trim() === "保存草稿")!;
        expect(save.disabled).toBe(true);
        await act(async () => {
            save.click();
        });
        expect(projects.get(original.id)?.revision).toBe(1);
        await act(async () => {
            finishUpload(uploadedImage("new-layout"));
        });
        await press("保存草稿");
        expect(JSON.parse(projects.get(original.id)!.draftJson).layoutReferences.map((reference: { resourceId: string }) => reference.resourceId)).toEqual(["new-layout"]);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("上传尚未结束时切换项目，旧上传结果不写入任何项目", async () => {
        draft = { ...draft, referenceMode: "style" };
        let finishUpload!: (resource: RemoteResource) => void;
        spyOn(resourceApi, "uploadResourceFile").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishUpload = resolve;
                }),
        );
        const original = project(draft);
        const otherDraft = { ...draft, productName: "另一个项目", references: [{ resourceId: "other-product", role: "primary" as const }] };
        const other = project(otherDraft);
        projects.set(original.id, original);
        projects.set(other.id, other);
        await render(`/ecommerce?project=${original.id}`);
        await uploadModeFile();
        expect(finishUpload).toBeDefined();
        await act(async () => {
            navigate(`/ecommerce?project=${other.id}`);
        });
        expect(productInput()?.value).toBe(otherDraft.productName);
        await act(async () => {
            finishUpload(uploadedImage("late-original-upload"));
        });
        await press("保存草稿");
        expect(JSON.parse(projects.get(original.id)!.draftJson).references).toEqual(draft.references);
        expect(JSON.parse(projects.get(other.id)!.draftJson).references).toEqual(otherDraft.references);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.references).toEqual(otherDraft.references);
        expect(route).toBe(`/ecommerce?project=${other.id}`);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("上传尚未结束时切换账号，旧账号资源不进入新账号草稿或保存请求", async () => {
        draft = { ...draft, referenceMode: "style" };
        let finishUpload!: (resource: RemoteResource) => void;
        spyOn(resourceApi, "uploadResourceFile").mockImplementation(
            () =>
                new Promise((resolve) => {
                    finishUpload = resolve;
                }),
        );
        const original = project(draft);
        projects.set(original.id, original);
        await render(`/ecommerce?project=${original.id}`);
        await uploadModeFile();
        expect(finishUpload).toBeDefined();
        const nextScope = crypto.randomUUID();
        additionalScopes.push(nextScope);
        const otherDraft = { ...draft, productName: "新账号商品", references: [{ resourceId: "new-account-product", role: "primary" as const }] };
        const other = project(otherDraft);
        projects.set(other.id, other);
        await act(async () => {
            setActiveUserScope(nextScope);
            useUserStore.setState({ user: { id: nextScope, username: "other", displayName: "另一账号", role: "user", status: "active" } });
            navigate(`/ecommerce?project=${other.id}`);
        });
        expect(productInput()?.value).toBe(otherDraft.productName);
        await act(async () => {
            finishUpload(uploadedImage("old-account-upload", scope));
        });
        await press("保存草稿");
        expect(JSON.parse(projects.get(original.id)!.draftJson).references).toEqual(draft.references);
        expect(JSON.parse(projects.get(other.id)!.draftJson).references).toEqual(otherDraft.references);
        expect(sessions.peekEcommerceWorkspace(nextScope)?.draft.references).toEqual(otherDraft.references);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("左侧逐屏模式保存并传图，跨页恢复实际屏数和参考摘要，文案与提示词可编辑保存", async () => {
        draft = { ...draft, count: 9, layoutReferences: [{ resourceId: "owned-layout", role: "style", name: "耳机详情长图.png" }] };
        const preparedInputs: EcommerceDraft[] = [];
        // Pixel cropping and resource ownership are covered by the media tests; keep the real page and payload assembly.
        spyOn(referenceMedia, "prepareCommerceReferenceViews").mockImplementation(async (source, maximum, assertCurrent) => {
            assertCurrent?.();
            preparedInputs.push(source);
            expect(maximum).toBe(24);
            return {
                draft: { ...source, layoutReferences: source.layoutReferences?.map((reference) => ({ ...reference, width: 790, height: 5100 })) },
                views: Array.from({ length: 3 }, (_, index) => ({ resourceId: `reading-window-${index + 1}`, sourceResourceId: "owned-layout", role: "style" as const, name: `长图阅读窗 ${index + 1}`, top: index / 3, bottom: (index + 1) / 3 })),
            };
        });
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await selectOption("参考方式", "长图详情页逐屏参考");
        await press("保存草稿");
        const savedId = [...projects.values()][0].id;
        const selectedDraft = JSON.parse(projects.get(savedId)!.draftJson) as EcommerceDraft;
        expect(selectedDraft.referenceMode).toBe("detail");
        expect(selectedDraft.layoutReferences?.[0].resourceId).toBe("owned-layout");
        expect(selectedDraft.imageType).toBe("detail");
        await press("AI 一键策划");
        expect(preparedInputs).toHaveLength(1);
        expect(preparedInputs[0].layoutReferences?.[0].resourceId).toBe("owned-layout");
        const submission = paidSubmissions[0] as { prompt: string; referenceImages: Array<{ id: string; storageKey: string }>; metadata: { ecommerceDraft: EcommerceDraft } };
        expect(submission.metadata.ecommerceDraft.referenceMode).toBe("detail");
        expect(submission.metadata.ecommerceDraft.layoutReferences?.[0].resourceId).toBe("owned-layout");
        expect(submission.referenceImages.map((image) => image.id)).toEqual(["owned-product", "owned-layout", "reading-window-1", "reading-window-2", "reading-window-3"]);
        expect(submission.referenceImages.every((image) => image.storageKey.startsWith("resource:"))).toBe(true);
        expect(submission.prompt).toContain("长图局部阅读映射");
        expect(submission.prompt).toContain('"sourceResourceId":"owned-layout"');
        expect(submission.prompt).not.toContain("images 必须恰好 9 项");

        const plan: EcommercePlan = {
            productSummary: "参考图中的蓝色头戴式耳机",
            confirmedFacts: [],
            uncertainFacts: [],
            qualityChecks: ["逐屏核对主题与版式"],
            visualStrategy: "保留浅蓝背景与深色标题的清晰层级",
            referenceSummary: "识别为两屏：第一屏产品主视觉，第二屏桌边听歌情境。",
            images: Array.from({ length: 2 }, (_, index) => ({
                id: `screen-${index + 1}`,
                imageType: "detail",
                platform: draft.platform,
                language: draft.language,
                goal: index ? "桌边听歌情境" : "产品主视觉",
                theme: `日常音乐时刻 ${index + 1}`,
                composition: "上方标题，产品居中",
                mainVisual: "蓝色头戴式耳机",
                verifiedClaims: "",
                copy: "把喜欢的旋律带进日常\n留一段桌边听歌时光",
                lighting: "窗边柔光",
                fidelity: "保留耳机外观",
                prompt: "浅蓝背景，按这一屏图文比例展示真实耳机",
                negativePrompt: "不虚构产品功能",
                imageModel: draft.imageModel,
                ratio: draft.ratio,
                resolution: draft.resolution,
                referenceScreen: {
                    sourceResourceId: "owned-layout",
                    screenIndex: index + 1,
                    top: index / 2,
                    bottom: (index + 1) / 2,
                    content: index ? "桌边场景" : "产品展示",
                    layout: "上方标题与居中产品",
                    visual: "浅蓝背景，柔和光线",
                    sourceCopy: "参考原文仅用于理解布局",
                },
            })),
        };
        const taskId = sessions.peekEcommerceWorkspace(scope)!.draft.planningTaskId!;
        await act(async () => {
            navigate("/other");
        });
        tasks.set(taskId, { ...tasks.get(taskId)!, status: "succeeded", resultJson: JSON.stringify({ text: JSON.stringify(plan) }), inputJson: JSON.stringify({ metadata: submission.metadata }) });
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        const restoredDraft = JSON.parse(projects.get(savedId)!.draftJson) as EcommerceDraft;
        const restoredPlan = JSON.parse(projects.get(savedId)!.planJson) as EcommercePlan;
        expect(restoredDraft.count).toBe(2);
        expect(restoredDraft.referenceMode).toBe("detail");
        expect(restoredDraft.layoutReferences?.[0].resourceId).toBe("owned-layout");
        expect(restoredPlan.images).toHaveLength(2);
        expect(restoredPlan.inputSignature).toBe(commerceInputSignature(restoredDraft));
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.count).toBe(2);
        expect(host.textContent).toContain("参考图分析");
        expect(host.textContent).toContain(plan.referenceSummary!);
        expect(host.querySelector('[aria-label="原长图第 2 屏识别"]')).not.toBeNull();
        expect(paidSubmissions).toHaveLength(1);

        const firstCard = host.querySelector(".ecommerce-plan-list section")!;
        const editors = firstCard.querySelectorAll<HTMLTextAreaElement>("textarea");
        expect(editors).toHaveLength(2);
        expect(editors[0].readOnly).toBe(false);
        expect(editors[1].readOnly).toBe(false);
        const setValue = Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!;
        await act(async () => {
            setValue.call(editors[0], "用户修改：耳机放在左侧，右侧保留标题");
            editors[0].dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            setValue.call(editors[1], "用户新标题\n属于自己的音乐时刻");
            editors[1].dispatchEvent(new Event("input", { bubbles: true }));
        });
        await press("保存草稿");
        const edited = JSON.parse(projects.get(savedId)!.planJson) as EcommercePlan;
        expect(edited.images[0].prompt).toBe("用户修改：耳机放在左侧，右侧保留标题");
        expect(edited.images[0].copy).toBe("用户新标题\n属于自己的音乐时刻");
        expect(edited.images[0].referenceScreen).toEqual(restoredPlan.images[0].referenceScreen);
        expect(edited.inputSignature).toBe(commerceInputSignature(restoredDraft));
        expect(paidSubmissions).toHaveLength(1);
    });

    test("六项文案视觉参数可选择、保存恢复，并进入后端分析提交", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await selectOption("图中文字", "丰富图文");
        await selectOption("文案风格", "生活场景");
        await selectOption("字体风格", "现代黑体");
        await selectOption("色彩节奏", "深浅交替");
        await selectOption("信息密度", "详解丰富");
        await selectOption("排版方向", "卖点模块");
        const expected = { textMode: "rich", copyTone: "lifestyle", fontStyle: "modern-sans", colorRhythm: "alternating", informationDensity: "detailed", layoutStyle: "feature-cards" };
        await press("保存草稿");
        expect(JSON.parse([...projects.values()][0].draftJson).creativeOptions).toEqual(expected);
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.creativeOptions).toEqual(expected);
        expect(host.querySelector('[aria-label="文案与视觉参数"]')?.textContent).toContain("深浅交替");
        await press("AI 一键策划");
        const submission = paidSubmissions[0] as { prompt: string; metadata: { ecommerceDraft: EcommerceDraft } };
        expect(submission.metadata.ecommerceDraft.creativeOptions).toEqual(expected);
        expect(submission.prompt).toContain('"colorRhythm":"alternating"');
        expect(submission.prompt).toContain("字体风格 · 现代黑体");
    });

    test("纯图模式同步开关并保留其他创作参数，切回图文后恢复", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render();
        await selectOption("字体风格", "现代黑体");
        await selectOption("图中文字", "纯图无字");
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.noText).toBe(true);
        expect(host.querySelector('[aria-label="字体风格"]')?.closest(".ant-select")?.classList.contains("ant-select-disabled")).toBe(true);
        await selectOption("图中文字", "丰富图文");
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.noText).toBe(false);
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.creativeOptions?.fontStyle).toBe("modern-sans");
    });

    test("裸入口恢复进行中的项目；配置刷新和重入均不重复提交付费分析", async () => {
        const task = runningTask("existing-planning-task");
        tasks.set(task.id, task);
        const saved = project({ ...draft, planningTaskId: task.id });
        projects.set(saved.id, saved);
        sessions.setEcommerceActiveProject(scope, saved.id);
        await render();
        expect(productInput()?.value).toBe(draft.productName);
        expect(planningProgress()).not.toBeNull();
        expect(fetched).toEqual([saved.id]);
        expect(paidSubmissions).toHaveLength(0);
        config = { ...config };
        await refresh();
        expect(fetched).toEqual([saved.id]);
        await act(async () => {
            navigate("/other");
        });
        expect(host.textContent).toBe("其他页面");
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        expect(productInput()?.value).toBe(draft.productName);
        expect(planningProgress()).not.toBeNull();
        expect(paidSubmissions).toHaveLength(0);
    });

    test("分析提交中切走后不会被异步保存拉回，重入接续同一任务", async () => {
        const checkpoint = { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai" as const, autoGenerate: false };
        await sessions.writeEcommerceWorkspace(scope, checkpoint);
        delayTaskCreation = true;
        await render();
        await press("AI 一键策划");
        expect(paidSubmissions).toHaveLength(1);
        expect(completeCreateTask).toBeDefined();
        await act(async () => {
            navigate("/other");
        });
        const task = runningTask("submitted-after-leaving");
        tasks.set(task.id, task);
        await act(async () => {
            completeCreateTask!(task);
        });
        expect(route).toBe("/other");
        expect(host.textContent).toBe("其他页面");
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        expect(productInput()?.value).toBe(draft.productName);
        expect(planningProgress()).not.toBeNull();
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.planningTaskId).toBe(task.id);
        expect(paidSubmissions).toHaveLength(1);
        expect(projects.size).toBe(1);
    });

    test("用户主动新建后保持空白项目，离开再回来不会恢复旧分析", async () => {
        const task = runningTask("old-planning-task");
        tasks.set(task.id, task);
        const saved = project({ ...draft, planningTaskId: task.id });
        projects.set(saved.id, saved);
        sessions.setEcommerceActiveProject(scope, saved.id);
        await render();
        await press("新建项目");
        expect(productInput()?.value).toBe("");
        expect(planningProgress()).toBeNull();
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        expect(productInput()?.value).toBe("");
        expect(planningProgress()).toBeNull();
        expect(paidSubmissions).toHaveLength(0);
        expect(fetched).toEqual([saved.id]);
    });

    test("提交请求尚未返回时重入，不能重复提交同一轮付费分析", async () => {
        await sessions.writeEcommerceWorkspace(scope, { sessionId: crypto.randomUUID(), draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        delayTaskCreation = true;
        await render();
        await press("AI 一键策划");
        const finishOriginal = completeCreateTask!;
        await act(async () => {
            navigate("/other");
        });
        await act(async () => {
            navigate("/ecommerce?mode=quick");
        });
        await act(async () => {
            host.querySelector<HTMLButtonElement>(".ecommerce-plan-button")!.click();
        });
        const submissions = paidSubmissions.length;
        const task = runningTask("pending-response-task");
        tasks.set(task.id, task);
        await act(async () => {
            finishOriginal(task);
        });
        expect(submissions).toBe(1);
        expect(planningProgress()).not.toBeNull();
    });

    test("刷新新建项目的同一 URL 时恢复该草稿，不清空已填写商品资料", async () => {
        const sessionId = crypto.randomUUID();
        const oldProject = project({ ...draft, productName: "旧项目" });
        projects.set(oldProject.id, oldProject);
        sessions.setEcommerceActiveProject(scope, oldProject.id);
        await sessions.writeEcommerceWorkspace(scope, { sessionId, draft, plan: null, project: null, creationMode: "ai", autoGenerate: false });
        await render(`/ecommerce?new=${sessionId}`);
        expect(productInput()?.value).toBe(draft.productName);
        expect(fetched).toEqual([]);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("历史列表停留期间项目更新，打开时读取最新服务端资料和分析任务", async () => {
        const saved = project(draft);
        projects.set(saved.id, saved);
        await render(`/ecommerce?new=${crypto.randomUUID()}`);
        const task = runningTask("newer-server-task");
        tasks.set(task.id, task);
        projects.set(saved.id, { ...saved, revision: 2, draftJson: JSON.stringify({ ...draft, productName: "服务器上的最新商品", planningTaskId: task.id }) });
        await press("历史项目");
        expect(document.querySelector(".ecommerce-project-card img")?.getAttribute("src")).toContain("/resources/owned-product/file");
        expect(document.querySelector(".ecommerce-project-card")?.textContent).toContain("草稿");
        await act(async () => {
            document.querySelector(".ecommerce-project-card img")!.dispatchEvent(new Event("error"));
        });
        expect(document.querySelector(".ecommerce-project-card")?.textContent).toContain("封面暂不可用");
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-project-card")!.click();
        });
        expect(fetched).toEqual([saved.id]);
        expect(productInput()?.value).toBe("服务器上的最新商品");
        expect(planningProgress()).not.toBeNull();
        expect(sessions.peekEcommerceWorkspace(scope)?.draft.planningTaskId).toBe(task.id);
        expect(paidSubmissions).toHaveLength(0);
    });

    test("历史项目弹窗按 20、50、100 项分页并可选择后续页项目", async () => {
        for (let index = 0; index < 52; index++) {
            const value = project({ ...draft, productName: `商品 ${index + 1}` });
            projects.set(value.id, value);
        }
        await render(`/ecommerce?new=${crypto.randomUUID()}`);
        await press("历史项目");
        expect(document.querySelectorAll(".ecommerce-project-card")).toHaveLength(20);
        expect(document.querySelector(".ecommerce-history-count")?.textContent).toContain("52");
        await act(async () => {
            document.querySelector<HTMLButtonElement>('[aria-label="第 2 页"]')!.click();
        });
        expect(document.querySelectorAll(".ecommerce-project-card")).toHaveLength(20);
        expect(document.querySelector(".ecommerce-history-footer")?.textContent).toContain("21–40 / 52");
        const select = document.querySelector<HTMLSelectElement>('[aria-label="每页项目数"]')!;
        await act(async () => {
            select.value = "50";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(document.querySelectorAll(".ecommerce-project-card")).toHaveLength(50);
        await act(async () => {
            select.value = "100";
            select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        expect(document.querySelectorAll(".ecommerce-project-card")).toHaveLength(52);
        await act(async () => {
            document.querySelector<HTMLButtonElement>('[aria-label="关闭历史项目"]')!.click();
        });
        expect(host.querySelector('[aria-expanded="false"]')).not.toBeNull();
        await press("历史项目");
        const reopenedSelect = document.querySelector<HTMLSelectElement>('[aria-label="每页项目数"]')!;
        await act(async () => {
            reopenedSelect.value = "20";
            reopenedSelect.dispatchEvent(new Event("change", { bubbles: true }));
        });
        await act(async () => {
            document.querySelector<HTMLButtonElement>('[aria-label="第 3 页"]')!.click();
        });
        const selected = document.querySelector<HTMLButtonElement>(".ecommerce-project-card")!;
        const selectedId = [...projects.values()].reverse()[40].id;
        await act(async () => {
            selected.click();
        });
        expect(fetched).toContain(selectedId);
    });

    test("多选跨页删除与全部删除均需确认，取消不会删除", async () => {
        for (let index = 0; index < 24; index++) {
            const value = project({ ...draft, productName: `待整理商品 ${index + 1}` });
            projects.set(value.id, value);
        }
        await render(`/ecommerce?new=${crypto.randomUUID()}`);
        await press("历史项目");
        const button = (label: string) => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((entry) => entry.textContent?.trim() === label)!;
        const chosenFirst = [...projects.values()].reverse()[0].id;
        const chosenSecond = [...projects.values()].reverse()[20].id;
        await act(async () => {
            button("多选管理").click();
        });
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-project-card")!.click();
        });
        await act(async () => {
            document.querySelector<HTMLButtonElement>('[aria-label="第 2 页"]')!.click();
        });
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-project-card")!.click();
        });
        expect(document.querySelector(".ecommerce-history-selected")?.textContent).toContain("2");
        await act(async () => {
            button("删除所选").click();
        });
        expect(document.querySelector(".ecommerce-delete-confirm")?.textContent).toContain("跨页选中的 2 个");
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-delete-confirm .ant-modal-footer .ant-btn-default")!.click();
        });
        expect(projects.size).toBe(24);
        await act(async () => {
            button("删除所选").click();
        });
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-delete-confirm .ant-modal-footer .ant-btn-primary")!.click();
        });
        expect(projects.has(chosenFirst)).toBe(false);
        expect(projects.has(chosenSecond)).toBe(false);
        expect(projects.size).toBe(22);
        await act(async () => {
            button("删除全部").click();
        });
        expect(document.querySelector(".ecommerce-delete-confirm")?.textContent).toContain("全部 22 个");
        await act(async () => {
            document.querySelector<HTMLButtonElement>(".ecommerce-delete-confirm .ant-modal-footer .ant-btn-primary")!.click();
        });
        expect(projects.size).toBe(0);
        expect(document.querySelector(".ecommerce-history-count")?.textContent).toContain("0");
    });

    test("删除当前项目后清除当前工作区与本地恢复指针", async () => {
        const saved = project(draft);
        projects.set(saved.id, saved);
        sessions.setEcommerceActiveProject(scope, saved.id);
        await render(`/ecommerce?project=${saved.id}`);
        await press("历史项目");
        await act(async () => {
            document.querySelector<HTMLButtonElement>(`[aria-label="删除项目：${saved.name}"]`)!.click();
        });
        const confirm = document.querySelector<HTMLButtonElement>(".ecommerce-delete-confirm .ant-modal-footer .ant-btn-primary")!;
        await act(async () => {
            confirm.click();
        });
        expect(projects.has(saved.id)).toBe(false);
        expect(route).toContain("/ecommerce?new=");
        expect(sessions.getEcommerceActiveProject(scope)).toBeNull();
        expect(sessions.peekEcommerceWorkspace(scope)?.project).toBeNull();
    });
    test("恢复已完成分析时保存失败，可重试保存结果且不再提交收费任务", async () => {
        const plan = {
            productSummary: "产品图中的蓝色商品",
            confirmedFacts: [],
            uncertainFacts: [],
            qualityChecks: ["核对产品结构"],
            visualStrategy: "浅蓝色背景与深色标题统一",
            images: [
                {
                    id: "planned-image",
                    imageType: "main",
                    platform: draft.platform,
                    language: draft.language,
                    goal: "展示产品外观",
                    theme: "商品主视觉",
                    composition: "上方标题，完整商品居中",
                    mainVisual: "参考图中的完整商品",
                    verifiedClaims: "",
                    copy: "看见产品细节",
                    lighting: "柔和侧光",
                    fidelity: "保留产品结构",
                    prompt: "浅蓝色背景，产品正面居中，完整保留真实结构",
                    negativePrompt: "虚构产品功能",
                    imageModel: draft.imageModel,
                    ratio: draft.ratio,
                    resolution: draft.resolution,
                },
            ],
        };
        const task = { ...runningTask("completed-planning-task"), status: "succeeded" as const, resultJson: JSON.stringify({ text: JSON.stringify(plan) }), inputJson: JSON.stringify({ metadata: { ecommerceDraft: draft } }) };
        tasks.set(task.id, task);
        const saved = project({ ...draft, planningTaskId: task.id });
        projects.set(saved.id, saved);
        sessions.setEcommerceActiveProject(scope, saved.id);
        sessions.setEcommercePlanningReceipt(scope, saved.id, task.id);
        failedSaves = 1;
        await render();
        expect(host.textContent).toContain("重试保存分析结果");
        expect(sessions.getEcommercePlanningReceipt(scope, saved.id)).toBe(task.id);
        expect(paidSubmissions).toHaveLength(0);
        await press("重试保存分析结果");
        expect(host.textContent).toContain("商品分析摘要");
        expect(host.textContent).toContain(plan.productSummary);
        expect(planningProgress()).toBeNull();
        expect(sessions.getEcommercePlanningReceipt(scope, saved.id)).toBeNull();
        expect(JSON.parse(projects.get(saved.id)!.planJson).images).toHaveLength(1);
        expect(paidSubmissions).toHaveLength(0);
    });
});
