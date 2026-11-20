import { useId, useState } from "react";
import { App, Button, Checkbox, Input, Select } from "antd";
import { ChevronDown, Search } from "lucide-react";

import { Switch } from "@/components/ui/base/switch";
import { AppModal } from "@/components/ui/product/app-modal";
import { saveMCPConnection, testMCPConnection, type MCPConnection, type MCPConnectionInput, type MCPManagementScope, type MCPServerTemplate, type MCPTransport } from "@/services/api/agent-mcp";
import { createMCPConnectionDraft, mcpConnectionChanged, mcpConnectionWrite, mcpParameters, parseMCPToolPolicies, validateMCPConnection } from "./mcp-form";
import "./mcp-connection-editor.css";

export function MCPConnectionEditor({
    scope,
    connection: initialConnection,
    template,
    onClose,
    onSaved,
}: {
    scope: MCPManagementScope;
    connection?: MCPConnection;
    template?: MCPServerTemplate;
    onClose: () => void;
    onSaved: (connection: MCPConnection) => void;
}) {
    const { message } = App.useApp();
    const fieldId = useId();
    const [connection, setConnection] = useState(initialConnection);
    const [draft, setDraft] = useState(() => createMCPConnectionDraft(template, connection));
    const [allowedUsersText, setAllowedUsersText] = useState(() => (connection?.allowedUserIds ?? []).join("\n"));
    const [policyTexts, setPolicyTexts] = useState<Record<string, string>>(() => Object.fromEntries(Object.entries(connection?.toolPolicies ?? {}).map(([name, policy]) => [name, JSON.stringify(policy, null, 2)])));
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [needsActivation, setNeedsActivation] = useState(!initialConnection?.enabled);
    const [requiresTest, setRequiresTest] = useState(!initialConnection?.lastTestAt);
    const [error, setError] = useState("");
    const [toolSearch, setToolSearch] = useState("");
    const parameters = mcpParameters(template, connection);
    const changed = mcpConnectionChanged(draft, connection);
    const verified = Boolean(connection?.lastTestAt) && !changed && !requiresTest;
    const busy = saving || testing;
    const tools = connection?.tools ?? [];
    const keyword = toolSearch.trim().toLocaleLowerCase();
    const visibleTools = tools.filter((tool) => !keyword || `${tool.name} ${tool.description}`.toLocaleLowerCase().includes(keyword));
    const canSelectTools = verified && !busy && tools.length > 0;

    const selectAllTools = (selected: boolean) => {
        if (!canSelectTools) return;
        setDraft((current) => ({ ...current, allowedTools: selected ? tools.map((tool) => tool.name) : [], enabled: selected && current.enabled }));
    };

    const acceptConnection = (next: MCPConnection) => {
        setConnection(next);
        setDraft(createMCPConnectionDraft(template, next));
        setAllowedUsersText((next.allowedUserIds ?? []).join("\n"));
        setPolicyTexts(Object.fromEntries(Object.entries(next.toolPolicies ?? {}).map(([name, policy]) => [name, JSON.stringify(policy, null, 2)])));
        setToolSearch("");
        onSaved(next);
    };

    const updateConfiguration = (patch: Partial<MCPConnectionInput>) => {
        setDraft((current) => ({ ...current, ...patch, enabled: false, allowedTools: [], toolPolicies: {} }));
        setPolicyTexts({});
        setNeedsActivation(true);
        setError("");
    };

    const saveAndTest = async () => {
        const input = { ...draft, enabled: false, allowedTools: [], toolPolicies: {} };
        const validation = validateMCPConnection(input, parameters, connection, scope);
        if (validation) {
            setError(validation);
            return;
        }
        setSaving(true);
        setError("");
        let saved = false;
        try {
            const next = await saveMCPConnection(scope, connection?.id, mcpConnectionWrite(input));
            saved = true;
            // 保存后立即清空密钥草稿并记住 ID；检测失败重试时更新同一连接。
            acceptConnection(next);
            setRequiresTest(true);
            setNeedsActivation(true);
            setSaving(false);
            setTesting(true);
            const tested = await testMCPConnection(scope, next.id);
            acceptConnection(tested);
            setRequiresTest(false);
            message.success(tested.tools.length ? `连接成功，已发现 ${tested.tools.length} 个工具，请选择后启用` : "连接成功，服务暂未提供工具");
        } catch (cause) {
            const reason = cause instanceof Error ? cause.message : "连接检测失败";
            setError(saved ? `配置已保存，检测失败：${reason}。可在此修改配置或重试检测。` : reason);
        } finally {
            setSaving(false);
            setTesting(false);
        }
    };

    const save = async () => {
        const enabled = needsActivation ? true : draft.enabled;
        let toolPolicies: MCPConnectionInput["toolPolicies"];
        try {
            toolPolicies = scope === "platform" ? parseMCPToolPolicies(policyTexts, draft.allowedTools, enabled) : {};
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请检查工具参数限制");
            return;
        }
        const input = { ...draft, enabled, toolPolicies };
        const validation = validateMCPConnection(input, parameters, connection, scope);
        if (validation) {
            setError(validation);
            return;
        }
        setSaving(true);
        setError("");
        try {
            const next = await saveMCPConnection(scope, connection?.id, mcpConnectionWrite(input));
            onSaved(next);
            message.success(next.enabled ? "MCP 已启用，将在下一次 Agent 运行时生效" : "连接已保存");
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存 MCP 连接失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal
            open
            title={connection ? "配置 MCP 连接" : template ? `安装 ${template.name}` : "添加 MCP 连接"}
            width={1120}
            centered
            className="mcp-connection-modal"
            okText={testing ? "正在检测…" : !verified ? "保存并检测" : needsActivation ? "保存并启用" : "保存"}
            cancelText="关闭"
            confirmLoading={busy}
            okButtonProps={{ disabled: busy || (verified && needsActivation && !draft.allowedTools.length) }}
            onOk={() => void (verified ? save() : saveAndTest())}
            onCancel={onClose}
            cancelButtonProps={{ disabled: busy }}
            closable={!busy}
            maskClosable={!busy}
            keyboard={!busy}
        >
            <div className="mcp-connection-editor">
                {error ? (
                    <p className="rounded-lg bg-surface-secondary p-3 text-caption text-status-error" role="alert">
                        {error}
                    </p>
                ) : null}
                <div className="mcp-connection-layout">
                    <section className="mcp-connection-fields thin-scrollbar" aria-label="连接配置">
                        <h3 className="mcp-connection-section-title">连接配置</h3>
                        <div className="space-y-1.5">
                            <label htmlFor={`${fieldId}-name`} className="text-caption font-medium">
                                连接名称
                            </label>
                            <Input id={`${fieldId}-name`} value={draft.name} maxLength={100} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoFocus disabled={busy} />
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor={`${fieldId}-transport`} className="text-caption font-medium">
                                连接方式
                            </label>
                            <Select
                                id={`${fieldId}-transport`}
                                className="w-full"
                                value={draft.transport}
                                disabled={busy}
                                options={[
                                    { value: "streamable_http", label: "Streamable HTTP" },
                                    { value: "sse", label: "SSE" },
                                ]}
                                onChange={(transport: MCPTransport) => updateConfiguration({ transport })}
                            />
                        </div>
                        <div className="space-y-1.5">
                            <label htmlFor={`${fieldId}-url`} className="text-caption font-medium">
                                MCP 服务地址
                            </label>
                            <Input
                                id={`${fieldId}-url`}
                                value={draft.serverUrl}
                                maxLength={2048}
                                placeholder="https://mcp.example.com/mcp"
                                autoComplete="off"
                                spellCheck={false}
                                disabled={busy}
                                onChange={(event) => updateConfiguration({ serverUrl: event.target.value })}
                            />
                            <p className="text-[var(--fs-label)] text-muted-foreground">填写远端服务的 HTTP 或 SSE 地址；访问令牌填写在下方参数中。</p>
                        </div>
                        {parameters.map((parameter) => {
                            const id = `${fieldId}-parameter-${parameter.name}`;
                            const configured = connection?.configuredSecrets.includes(parameter.name) && draft.serverUrl.trim() === connection.serverUrl && draft.templateId === connection.templateId;
                            const props = {
                                id,
                                value: draft.parameters[parameter.name] ?? "",
                                disabled: busy,
                                autoComplete: "off",
                                placeholder: configured ? "已配置，留空保留原值" : parameter.required ? "必填" : "选填",
                                onChange: (event: React.ChangeEvent<HTMLInputElement>) => updateConfiguration({ parameters: { ...draft.parameters, [parameter.name]: event.target.value } }),
                            };
                            return (
                                <div key={parameter.name} className="space-y-1.5">
                                    <label htmlFor={id} className="text-caption font-medium">
                                        {parameter.label || parameter.name}
                                        {parameter.required ? <span className="ml-1 text-muted-foreground">（必填）</span> : null}
                                    </label>
                                    {parameter.type === "secret" ? <Input.Password {...props} /> : <Input {...props} />}
                                    {parameter.description ? <p className="text-[var(--fs-label)] text-muted-foreground">{parameter.description}</p> : null}
                                </div>
                            );
                        })}
                        {scope === "platform" ? (
                            <div className="space-y-1.5">
                                <label htmlFor={`${fieldId}-users`} className="text-caption font-medium">
                                    授权用户 ID
                                </label>
                                <Input.TextArea
                                    id={`${fieldId}-users`}
                                    value={allowedUsersText}
                                    rows={3}
                                    placeholder="每行一个用户 ID，也可用逗号分隔"
                                    autoComplete="off"
                                    spellCheck={false}
                                    disabled={busy}
                                    onChange={(event) => {
                                        setAllowedUsersText(event.target.value);
                                        setDraft((current) => ({ ...current, allowedUserIds: [...new Set(event.target.value.split(/[\s,，]+/).filter(Boolean))] }));
                                        setError("");
                                    }}
                                />
                                <p className="text-[var(--fs-label)] text-muted-foreground">从用户管理复制有效用户 ID。只有名单内的账号可以调用，管理员也需要加入名单。</p>
                            </div>
                        ) : null}
                    </section>
                    <section className="mcp-connection-tools" aria-label="工具权限">
                        <div className="mcp-tools-heading">
                            <div>
                                <h3 className="mcp-connection-section-title">允许 Agent 使用的工具</h3>
                                <p className="mcp-tools-count" role="status">
                                    已选择 {draft.allowedTools.length} / {tools.length} 个工具
                                </p>
                            </div>
                            {verified ? (
                                <Button size="small" disabled={busy} onClick={() => void saveAndTest()}>
                                    重新检测
                                </Button>
                            ) : null}
                        </div>
                        {scope === "platform" ? (
                            <div className="space-y-1 text-[var(--fs-label)] text-muted-foreground">
                                <p>平台连接使用同一份凭证。请为每个已选工具填写参数限制，明确允许访问的仓库、路径或其他资源。</p>
                                <details>
                                    <summary>查看仓库工具参数限制示例</summary>
                                    <pre className="whitespace-pre-wrap break-all font-mono">{'{"type":"object","properties":{"owner":{"const":"your-org"},"repo":{"enum":["approved-repo"]}},"required":["owner","repo"]}'}</pre>
                                    <p>{'仅填写 {"type":"object"} 表示明确允许该工具接受任意对象参数。不会自动添加此授权。'}</p>
                                </details>
                            </div>
                        ) : null}
                        {!verified ? (
                            <p className="text-caption text-muted-foreground" role="status">
                                {testing ? "正在连接服务并获取工具列表…" : "填写配置后点击「保存并检测」，在这里选择工具并启用连接。"}
                            </p>
                        ) : null}
                        {verified && !connection?.tools.length ? <p className="text-caption text-muted-foreground">连接成功，但服务没有提供工具。检查服务配置后重新检测。</p> : null}
                        {tools.length ? (
                            <>
                                <Input
                                    prefix={<Search className="size-3.5" aria-hidden="true" />}
                                    value={toolSearch}
                                    onChange={(event) => setToolSearch(event.target.value)}
                                    placeholder="搜索工具名称或说明"
                                    aria-label="搜索工具"
                                    disabled={busy}
                                    allowClear
                                />
                                <div className="mcp-tools-selection">
                                    <Button size="small" type="text" disabled={!canSelectTools || tools.every((tool) => draft.allowedTools.includes(tool.name))} onClick={() => selectAllTools(true)}>
                                        全选全部 {tools.length} 项
                                    </Button>
                                    <Button size="small" type="text" disabled={!canSelectTools || !draft.allowedTools.length} onClick={() => selectAllTools(false)}>
                                        取消全选
                                    </Button>
                                    {keyword ? <span>找到 {visibleTools.length} 项</span> : null}
                                </div>
                                <div className="mcp-tools-options thin-scrollbar" role="group" aria-label="可授权工具">
                                    {!visibleTools.length ? (
                                        <p className="mcp-tools-no-results" role="status">
                                            没有匹配的工具，试试其他关键词。
                                        </p>
                                    ) : null}
                                    {visibleTools.map((tool) => (
                                        <div key={tool.name} className={`mcp-tool-option${draft.allowedTools.includes(tool.name) ? " is-selected" : ""}`}>
                                            <Checkbox
                                                checked={draft.allowedTools.includes(tool.name)}
                                                disabled={busy || !verified}
                                                onChange={(event) =>
                                                    setDraft((current) => {
                                                        const allowedTools = event.target.checked ? [...current.allowedTools, tool.name] : current.allowedTools.filter((name) => name !== tool.name);
                                                        return { ...current, allowedTools, enabled: allowedTools.length > 0 && current.enabled };
                                                    })
                                                }
                                            >
                                                <span className="mcp-tool-option-name">{tool.name}</span>
                                            </Checkbox>
                                            {tool.description ? (
                                                <details className="mcp-tool-description">
                                                    <summary aria-label={`展开或收起 ${tool.name} 的说明`}>
                                                        <span className="mcp-tool-description-preview">{tool.description}</span>
                                                        <span className="mcp-tool-description-collapse">收起说明</span>
                                                        <ChevronDown className="size-3" aria-hidden="true" />
                                                    </summary>
                                                    <p>{tool.description}</p>
                                                </details>
                                            ) : null}
                                            {scope === "platform" && draft.allowedTools.includes(tool.name) ? (
                                                <div className="mt-2 space-y-1.5">
                                                    <label htmlFor={`${fieldId}-policy-${tool.name}`} className="text-caption font-medium">
                                                        {tool.name} 参数限制
                                                    </label>
                                                    <Input.TextArea
                                                        id={`${fieldId}-policy-${tool.name}`}
                                                        aria-label={`${tool.name} 参数限制`}
                                                        value={policyTexts[tool.name] ?? ""}
                                                        rows={5}
                                                        placeholder="填写 JSON Schema，顶层 type 必须为 object"
                                                        spellCheck={false}
                                                        disabled={busy || !verified}
                                                        onChange={(event) => {
                                                            setPolicyTexts((current) => ({ ...current, [tool.name]: event.target.value }));
                                                            setError("");
                                                        }}
                                                    />
                                                    <p className="text-[var(--fs-label)] text-muted-foreground">单个工具最多 8 KiB，全部策略最多 64 KiB；不支持外部 Schema 引用。</p>
                                                </div>
                                            ) : null}
                                        </div>
                                    ))}
                                </div>
                            </>
                        ) : null}
                        <div className="mcp-tools-footer">
                            {verified && needsActivation ? <p className="text-caption text-muted-foreground">已选择 {draft.allowedTools.length} 个工具，点击「保存并启用」完成连接。</p> : null}
                            {verified && !needsActivation ? (
                                <div className="flex items-center justify-between gap-3 pt-2">
                                    <label htmlFor={`${fieldId}-enabled`} className="text-caption font-medium">
                                        {scope === "platform" ? "向授权用户开放" : "启用此连接"}
                                    </label>
                                    <Switch id={`${fieldId}-enabled`} checked={draft.enabled} disabled={busy || !verified || !draft.allowedTools.length} onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))} />
                                </div>
                            ) : null}
                            <p className="text-[var(--fs-label)] text-muted-foreground">每次执行 MCP 工具前，Agent 都会请求确认。</p>
                        </div>
                    </section>
                </div>
            </div>
        </AppModal>
    );
}
