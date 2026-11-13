import { afterAll, afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { Window } from "happy-dom";
import type { ReactNode } from "react";
import type { MCPConnection, MCPConnectionInput, MCPServerTemplate } from "../../src/services/api/agent-mcp";

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
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { App, ConfigProvider } = await import("antd");
const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
const { default: MCPManager } = await import("../../src/components/mcp/mcp-manager");
const { MCPConnectionEditor } = await import("../../src/components/mcp/mcp-connection-editor");
const { AgentConnectorsBar } = await import("../../src/components/canvas/canvas-cloud-agent-connectors");
const { http } = await import("../../src/services/api/request");
const { useUserStore } = await import("../../src/stores/use-user-store");
const template: MCPServerTemplate = {
    id: "example",
    name: "工单服务",
    description: "读取工单",
    homepage: "",
    transport: "streamable_http",
    serverUrl: "https://example.com/mcp",
    headers: { Authorization: "Bearer {{token}}" },
    parameters: [{ name: "token", label: "访问令牌", description: "", type: "secret", required: true }],
    published: true,
    createdAt: "",
    updatedAt: "",
};
const verified: MCPConnection = {
    id: "connection-1",
    revision: 1,
    scope: "user",
    templateId: template.id,
    name: template.name,
    transport: template.transport,
    serverUrl: template.serverUrl,
    parameters: {},
    configuredSecrets: ["token"],
    tools: [{ name: "list_issues", description: "查看工单", inputSchema: {}, readOnly: true }],
    allowedTools: [],
    enabled: false,
    lastTestAt: "2026-11-11T01:00:00Z",
    createdAt: "",
    updatedAt: "",
};
let root: ReturnType<typeof createRoot>;
let host: HTMLDivElement;
let client: InstanceType<typeof QueryClient>;
let get: ReturnType<typeof spyOn>;
let post: ReturnType<typeof spyOn>;
let put: ReturnType<typeof spyOn>;
let remove: ReturnType<typeof spyOn>;

function account(id: string) {
    useUserStore.getState().setUser({ id, username: id, displayName: id, role: "admin", status: "active" });
}
beforeEach(() => {
    account("user-a");
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    get = spyOn(http, "get").mockImplementation(async (path) => {
        if (String(path).endsWith("/catalog")) return { items: [template] };
        if (String(path).endsWith("/connections")) return { items: [] };
        throw new Error(`Unexpected GET ${path}`);
    });
    post = spyOn(http, "post").mockImplementation(async (path, input) => {
        if (String(path).endsWith("/test")) return verified;
        return { ...verified, ...(input as MCPConnectionInput), parameters: {}, configuredSecrets: ["token"], tools: [], lastTestAt: undefined };
    });
    put = spyOn(http, "put").mockImplementation(async (_path, input) => ({ ...verified, ...(input as MCPConnectionInput), parameters: {}, configuredSecrets: ["token"] }));
    remove = spyOn(http, "delete").mockResolvedValue({ deleted: true });
});
afterEach(async () => {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    get.mockRestore();
    post.mockRestore();
    put.mockRestore();
    remove.mockRestore();
});
afterAll(() => {
    dom.happyDOM.abort();
    for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
    }
});

async function render(node: ReactNode = <MCPManager />) {
    await act(async () =>
        root.render(
            <ConfigProvider theme={{ token: { motion: false } }}>
                <App>
                    <QueryClientProvider client={client}>{node}</QueryClientProvider>
                </App>
            </ConfigProvider>,
        ),
    );
    await settle();
}
async function settle() {
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 30));
    });
}
function button(text: string) {
    const result = [...document.querySelectorAll("button")].find((item) => item.textContent?.replace(/\s/g, "") === text.replace(/\s/g, ""));
    expect(result).toBeTruthy();
    return result as HTMLButtonElement;
}
async function click(text: string) {
    await act(async () => button(text).click());
    await settle();
}
function field(label: string) {
    const target = [...document.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label));
    expect(target?.htmlFor).toBeTruthy();
    return document.getElementById(target!.htmlFor) as HTMLInputElement;
}
async function input(label: string, value: string) {
    const target = field(label);
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(target, value);
        target.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

async function textarea(label: string, value: string) {
    const target = field(label);
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLTextAreaElement.prototype, "value")!.set!.call(target, value);
        target.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
}

test("平台连接必须明确授权用户并填写每个工具的参数限制", async () => {
    const platform = { ...verified, scope: "platform" as const, allowedUserIds: [], toolPolicies: {} };
    await render(<MCPConnectionEditor scope="platform" connection={platform} template={template} onClose={() => {}} onSaved={() => {}} />);
    await click("全选全部 1 项");
    expect(field("list_issues 参数限制").value).toBe("");
    await click("保存并启用");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("明确填写参数限制");
    expect(put.mock.calls).toHaveLength(0);

    const policy = { type: "object", properties: { owner: { const: "approved-org" }, repo: { enum: ["approved-repo"] } }, required: ["owner", "repo"] };
    await textarea("list_issues 参数限制", JSON.stringify(policy));
    await click("保存并启用");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("用户 ID");
    await textarea("授权用户 ID", "user-a\nuser-b\nuser-a");
    await click("保存并启用");
    expect(put.mock.calls[0][0]).toBe("/admin/mcp/connections/connection-1");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: true, allowedUserIds: ["user-a", "user-b"], toolPolicies: { list_issues: policy } });
});

test("平台连接重新检测保留授权用户但清空工具和参数授权", async () => {
    const platform = { ...verified, scope: "platform" as const, enabled: true, allowedTools: ["list_issues"], allowedUserIds: ["user-a"], toolPolicies: { list_issues: { type: "object" } } };
    post.mockResolvedValue({ ...platform, enabled: false, allowedTools: [], toolPolicies: {} });
    await render(<MCPConnectionEditor scope="platform" connection={platform} template={template} onClose={() => {}} onSaved={() => {}} />);
    await input("访问令牌", "rotated-platform-token");
    expect(document.querySelector('[aria-label="list_issues 参数限制"]')).toBeNull();
    await click("保存并检测");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: false, allowedTools: [], allowedUserIds: ["user-a"], toolPolicies: {} });
    expect(field("授权用户 ID").value).toBe("user-a");
    await click("全选全部 1 项");
    expect(field("list_issues 参数限制").value).toBe("");
});

test("旧平台连接可以立即关闭而不需要先添加授权策略", async () => {
    const platform = { ...verified, scope: "platform" as const, enabled: true, allowedTools: ["list_issues"] };
    await render(<MCPConnectionEditor scope="platform" connection={platform} template={template} onClose={() => {}} onSaved={() => {}} />);
    await act(async () => field("向授权用户开放").click());
    await click("保存");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: false, allowedTools: ["list_issues"], allowedUserIds: [], toolPolicies: {} });
});

test("连接器保留标题、真实图标列表和常驻市场跳转", async () => {
    get.mockResolvedValue({ items: [verified] });
    const destinations: string[] = [];
    await render(<AgentConnectorsBar onOpenMCP={(destination) => destinations.push(destination)} />);
    expect(host.textContent).toContain("连接器");
    const connector = host.querySelector(".agent-connector-item") as HTMLButtonElement;
    expect(connector.getAttribute("aria-label")).toContain(verified.name);
    expect(connector.textContent).toBe("");
    await click("连接器");
    await act(async () => connector.click());
    await click("浏览插件市场");
    expect(destinations).toEqual(["connections", "connections", "market"]);
});

test("市场安装在同一个弹窗内保存检测、选择工具并启用", async () => {
    await render();
    await click("MCP 市场");
    await click("安装");
    await input("访问令牌", "entered-token");
    await click("保存并检测");
    expect(post.mock.calls[0][0]).toBe("/agent/mcp/connections");
    expect(post.mock.calls[0][1]).toMatchObject({ enabled: false, allowedTools: [], parameters: { token: "entered-token" } });
    expect(post.mock.calls[1][0]).toBe("/agent/mcp/connections/connection-1/test");
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
    expect(button("保存并启用").disabled).toBe(true);
    expect(field("访问令牌").value).toBe("");
    const tool = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => tool.click());
    await click("保存并启用");
    expect(put.mock.calls[0][0]).toBe("/agent/mcp/connections/connection-1");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: true, allowedTools: ["list_issues"], parameters: { token: "" } });
});

test("修改密钥撤销旧授权；保存失败保留编辑状态", async () => {
    const existing = { ...verified, enabled: true, allowedTools: ["list_issues"] };
    put.mockRejectedValue(new Error("暂时无法保存"));
    let closed = false;
    await render(
        <MCPConnectionEditor
            scope="user"
            connection={existing}
            template={template}
            onClose={() => {
                closed = true;
            }}
            onSaved={() => {}}
        />,
    );
    await input("访问令牌", "rotated-token");
    expect(button("保存并检测")).toBeTruthy();
    const tool = document.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(tool.checked).toBe(false);
    expect(tool.disabled).toBe(true);
    await click("保存并检测");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: false, allowedTools: [], parameters: { token: "rotated-token" } });
    expect(closed).toBe(false);
    expect(field("访问令牌").value).toBe("rotated-token");
    expect(document.querySelector('[role="alert"]')?.textContent).toBe("暂时无法保存");
});

test("检测失败留在弹窗，重试更新同一连接且不会重复创建", async () => {
    const normalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path, input) => {
        if (String(path).endsWith("/test")) throw new Error("服务暂不可用");
        return normalPost(path, input);
    });
    await render();
    await click("MCP 市场");
    await click("安装");
    await input("访问令牌", "retry-test-credential");
    await click("保存并检测");
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("配置已保存，检测失败");
    expect(field("访问令牌").value).toBe("");
    post.mockResolvedValue(verified);
    await click("保存并检测");
    expect(put.mock.calls[0][0]).toBe("/agent/mcp/connections/connection-1");
    expect(post.mock.calls.filter((call) => call[0] === "/agent/mcp/connections")).toHaveLength(1);
    expect(button("保存并启用").disabled).toBe(true);
});

test("工具搜索不丢选择，全选全部包含隐藏项，取消全选后不能启用", async () => {
    const manyTools = {
        ...verified,
        tools: [...verified.tools, { name: "update_issue", description: "修改工单正文", inputSchema: {}, readOnly: false }, { name: "list_repos", description: "查看仓库", inputSchema: {}, readOnly: true }],
    };
    await render(<MCPConnectionEditor scope="user" connection={manyTools} template={template} onClose={() => {}} onSaved={() => {}} />);
    const search = document.querySelector('input[aria-label="搜索工具"]') as HTMLInputElement;
    await act(async () => {
        Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, "value")!.set!.call(search, "修改工单");
        search.dispatchEvent(new dom.Event("input", { bubbles: true }));
    });
    expect(document.querySelectorAll(".mcp-tool-option")).toHaveLength(1);
    await click("全选全部 3 项");
    expect(document.querySelector(".mcp-tools-count")?.textContent).toBe("已选择 3 / 3 个工具");
    expect(button("保存并启用").disabled).toBe(false);
    await click("取消全选");
    expect(document.querySelector(".mcp-tools-count")?.textContent).toBe("已选择 0 / 3 个工具");
    expect(button("保存并启用").disabled).toBe(true);
    await click("全选全部 3 项");
    await click("保存并启用");
    expect(put.mock.calls[0][1]).toMatchObject({ enabled: true, allowedTools: ["list_issues", "update_issue", "list_repos"] });
});

test("修改配置撤销全选，重新检测前不能批量授权", async () => {
    await render(<MCPConnectionEditor scope="user" connection={verified} template={template} onClose={() => {}} onSaved={() => {}} />);
    await click("全选全部 1 项");
    await input("MCP 服务地址", "https://other.example.com/mcp");
    expect(button("全选全部 1 项").disabled).toBe(true);
    expect(button("取消全选").disabled).toBe(true);
    expect(document.querySelector(".mcp-tools-count")?.textContent).toBe("已选择 0 / 1 个工具");
    expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
});

test("检测期间禁止编辑与关闭；没有工具时不能启用", async () => {
    let finish!: (value: MCPConnection) => void;
    const normalPost = post.getMockImplementation()!;
    post.mockImplementation(async (path, input) => {
        if (String(path).endsWith("/test"))
            return new Promise<MCPConnection>((resolve) => {
                finish = resolve;
            });
        return normalPost(path, input);
    });
    await render();
    await click("MCP 市场");
    await click("安装");
    await input("访问令牌", "pending-test-credential");
    await click("保存并检测");
    expect(field("访问令牌").disabled).toBe(true);
    expect(button("关闭").disabled).toBe(true);
    await act(async () => finish({ ...verified, tools: [] }));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("服务没有提供工具");
    expect(button("保存并启用").disabled).toBe(true);
    expect(button("重新检测").disabled).toBe(false);
});

test("连接检测期间不能打开另一份配置，避免晚到结果覆盖草稿", async () => {
    get.mockImplementation(async (path) => ({ items: String(path).endsWith("/catalog") ? [template] : [verified] }));
    let finish!: (value: MCPConnection) => void;
    post.mockImplementation(
        () =>
            new Promise<MCPConnection>((resolve) => {
                finish = resolve;
            }),
    );
    await render();
    await click("检测连接");
    expect(button("自定义连接").disabled).toBe(true);
    expect(button("配置").disabled).toBe(true);
    await act(async () => finish(verified));
    await settle();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("配置 MCP 连接");
});

test("移除个人连接使用编码后的ID，成功后更新列表", async () => {
    get.mockImplementation(async (path) => ({ items: String(path).endsWith("/catalog") ? [template] : [{ ...verified, id: "connection/1" }] }));
    await render();
    await click("移除");
    const confirmation = document.querySelector(".ant-modal .ant-btn-dangerous") as HTMLButtonElement;
    expect(confirmation).toBeTruthy();
    await act(async () => confirmation.click());
    await settle();
    expect(remove.mock.calls[0][0]).toBe("/agent/mcp/connections/connection%2F1");
    expect(host.textContent).toContain("还没有 MCP 连接");
});

test("个人设置中的平台连接只展示工具，不提供修改或检测", async () => {
    get.mockImplementation(async (path) => ({ items: String(path).endsWith("/catalog") ? [template] : [{ ...verified, scope: "platform", enabled: true, allowedTools: ["list_issues"] }] }));
    await render();
    expect(host.textContent).toContain("平台连接");
    expect(host.textContent).toContain("list_issues");
    const labels = [...host.querySelectorAll("button")].map((item) => item.textContent?.trim());
    expect(labels).not.toContain("配置");
    expect(labels).not.toContain("检测连接");
    expect(labels).not.toContain("移除");
});

test("管理员入口使用平台接口并能维护市场", async () => {
    await render(<MCPManager scope="platform" />);
    expect(get.mock.calls.map((call) => call[0])).toContain("/admin/mcp/catalog");
    expect(get.mock.calls.map((call) => call[0])).toContain("/admin/mcp/connections");
    await click("市场管理");
    await click("添加条目");
    expect(document.querySelector('[role="dialog"]')?.textContent).not.toContain("清空已安装连接");
    await click("取消");
    await click("编辑");
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("保存会清空已安装连接的参数和密钥并停用连接，用户需要重新填写参数、检测并授权工具。");
    await input("名称", "新版工单服务");
    await click("保存");
    expect(put.mock.calls[0][0]).toBe("/admin/mcp/catalog/example");
    expect(put.mock.calls[0][1]).toMatchObject({ name: "新版工单服务", headers: { Authorization: "Bearer {{token}}" } });
});

test("切换账号不会展示上一账号晚到的连接列表", async () => {
    let resolveOld!: (value: { items: MCPConnection[] }) => void;
    const delayed = new Promise<{ items: MCPConnection[] }>((resolve) => {
        resolveOld = resolve;
    });
    get.mockImplementation(async (path) => {
        if (String(path).endsWith("/catalog")) return { items: [template] };
        return useUserStore.getState().user?.id === "user-a" ? delayed : { items: [{ ...verified, id: "new-user-connection", name: "新账号连接" }] };
    });
    await render();
    await act(async () => account("user-b"));
    await settle();
    await act(async () => resolveOld({ items: [{ ...verified, name: "旧账号连接" }] }));
    await settle();
    expect(host.textContent).toContain("新账号连接");
    expect(host.textContent).not.toContain("旧账号连接");
});
