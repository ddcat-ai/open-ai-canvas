import { useId, useState } from "react";
import { App, Button, Checkbox, Input, Select } from "antd";
import { Plus, Trash2 } from "lucide-react";

import { AppModal } from "@/components/ui/product/app-modal";
import { Switch } from "@/components/ui/base/switch";
import { saveMCPTemplate, type MCPParameter, type MCPServerTemplate, type MCPServerTemplateInput, type MCPTransport } from "@/services/api/agent-mcp";

export function MCPTemplateEditor({ template, onClose, onSaved }: { template?: MCPServerTemplate; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const fieldId = useId();
    const [draft, setDraft] = useState<MCPServerTemplateInput>(() => ({
        name: template?.name ?? "",
        description: template?.description ?? "",
        homepage: template?.homepage ?? "",
        transport: template?.transport ?? "streamable_http",
        serverUrl: template?.serverUrl ?? "",
        headers: template?.headers ?? {},
        parameters: template?.parameters.map((parameter) => ({ ...parameter })) ?? [],
        published: template?.published ?? false,
    }));
    const [headersText, setHeadersText] = useState(() => JSON.stringify(template?.headers ?? {}, null, 2));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState("");
    const updateParameter = (index: number, patch: Partial<MCPParameter>) => setDraft((current) => ({ ...current, parameters: current.parameters.map((parameter, position) => (position === index ? { ...parameter, ...patch } : parameter)) }));

    const save = async () => {
        let headers: Record<string, string>;
        try {
            const parsed: unknown = JSON.parse(headersText);
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.values(parsed).some((value) => typeof value !== "string")) throw new Error();
            headers = parsed as Record<string, string>;
        } catch {
            setError("请求头模板需要是字符串键值组成的 JSON 对象");
            return;
        }
        if (!draft.name.trim()) {
            setError("请输入市场条目名称");
            return;
        }
        const names = draft.parameters.map((parameter) => parameter.name.trim());
        if (names.some((name) => !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) || new Set(names).size !== names.length) {
            setError("参数名须以字母开头，仅含字母、数字、下划线，最多 64 个字符且不可重复");
            return;
        }
        setSaving(true);
        setError("");
        try {
            await saveMCPTemplate(template?.id, {
                ...draft,
                name: draft.name.trim(),
                serverUrl: draft.serverUrl.trim(),
                homepage: draft.homepage.trim(),
                headers,
                parameters: draft.parameters.map((parameter) => ({ ...parameter, name: parameter.name.trim(), defaultValue: parameter.type === "secret" ? undefined : parameter.defaultValue })),
            });
            onSaved();
            message.success("MCP 市场条目已保存");
            onClose();
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "保存市场条目失败");
        } finally {
            setSaving(false);
        }
    };

    return (
        <AppModal
            open
            title={template ? "编辑 MCP 市场条目" : "添加 MCP 市场条目"}
            width={720}
            okText="保存"
            cancelText="取消"
            confirmLoading={saving}
            onOk={() => void save()}
            onCancel={onClose}
            cancelButtonProps={{ disabled: saving }}
            closable={!saving}
            maskClosable={!saving}
        >
            <div className="space-y-4 pt-2">
                {error ? (
                    <p role="alert" className="text-caption text-status-error">
                        {error}
                    </p>
                ) : null}
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-name`} className="text-caption font-medium">
                        名称
                    </label>
                    <Input id={`${fieldId}-name`} value={draft.name} maxLength={100} disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} autoFocus />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-description`} className="text-caption font-medium">
                        介绍
                    </label>
                    <Input.TextArea
                        id={`${fieldId}-description`}
                        value={draft.description}
                        maxLength={2000}
                        autoSize={{ minRows: 2, maxRows: 4 }}
                        disabled={saving}
                        onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                    />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-homepage`} className="text-caption font-medium">
                        使用文档地址
                    </label>
                    <Input id={`${fieldId}-homepage`} value={draft.homepage} placeholder="https://..." disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, homepage: event.target.value }))} />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-transport`} className="text-caption font-medium">
                        连接方式
                    </label>
                    <Select
                        id={`${fieldId}-transport`}
                        className="w-full"
                        value={draft.transport}
                        disabled={saving}
                        options={[
                            { value: "streamable_http", label: "Streamable HTTP" },
                            { value: "sse", label: "SSE" },
                        ]}
                        onChange={(transport: MCPTransport) => setDraft((current) => ({ ...current, transport }))}
                    />
                </div>
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-url`} className="text-caption font-medium">
                        默认服务地址
                    </label>
                    <Input id={`${fieldId}-url`} value={draft.serverUrl} placeholder="用户需要自部署时可留空" disabled={saving} onChange={(event) => setDraft((current) => ({ ...current, serverUrl: event.target.value }))} />
                </div>
                <section className="space-y-3" aria-label="用户配置参数">
                    <div className="flex items-center justify-between gap-3">
                        <h3 className="text-sm font-medium">用户配置参数</h3>
                        <Button
                            size="small"
                            disabled={saving}
                            icon={<Plus className="size-3.5" />}
                            onClick={() => setDraft((current) => ({ ...current, parameters: [...current.parameters, { name: "", label: "", description: "", type: "string", required: false }] }))}
                        >
                            添加参数
                        </Button>
                    </div>
                    {draft.parameters.map((parameter, index) => (
                        <div key={index} className="space-y-2 rounded-xl bg-surface-secondary p-3">
                            <div className="grid grid-cols-2 gap-2">
                                <Input value={parameter.name} aria-label={`参数 ${index + 1} 名称`} placeholder="参数名，如 token" disabled={saving} onChange={(event) => updateParameter(index, { name: event.target.value })} />
                                <Input value={parameter.label} aria-label={`参数 ${index + 1} 显示名称`} placeholder="显示名称" disabled={saving} onChange={(event) => updateParameter(index, { label: event.target.value })} />
                            </div>
                            <Input value={parameter.description} aria-label={`参数 ${index + 1} 说明`} placeholder="填写说明" disabled={saving} onChange={(event) => updateParameter(index, { description: event.target.value })} />
                            <div className="flex flex-wrap items-center gap-3">
                                <Select
                                    value={parameter.type}
                                    aria-label={`参数 ${index + 1} 类型`}
                                    className="w-28"
                                    disabled={saving}
                                    options={[
                                        { value: "string", label: "普通文本" },
                                        { value: "secret", label: "密钥" },
                                    ]}
                                    onChange={(type: MCPParameter["type"]) => updateParameter(index, { type, defaultValue: type === "secret" ? undefined : parameter.defaultValue })}
                                />
                                <Checkbox checked={parameter.required} disabled={saving} onChange={(event) => updateParameter(index, { required: event.target.checked })}>
                                    必填
                                </Checkbox>
                                <Button
                                    type="text"
                                    danger
                                    size="small"
                                    className="ml-auto"
                                    icon={<Trash2 className="size-3.5" />}
                                    aria-label={`删除参数 ${index + 1}`}
                                    disabled={saving}
                                    onClick={() => setDraft((current) => ({ ...current, parameters: current.parameters.filter((_, position) => position !== index) }))}
                                />
                            </div>
                            {parameter.type === "string" ? (
                                <Input value={parameter.defaultValue ?? ""} aria-label={`参数 ${index + 1} 默认值`} placeholder="默认值（选填）" disabled={saving} onChange={(event) => updateParameter(index, { defaultValue: event.target.value })} />
                            ) : null}
                        </div>
                    ))}
                </section>
                <div className="space-y-1.5">
                    <label htmlFor={`${fieldId}-headers`} className="text-caption font-medium">
                        请求头模板
                    </label>
                    <Input.TextArea id={`${fieldId}-headers`} value={headersText} autoSize={{ minRows: 3, maxRows: 6 }} spellCheck={false} disabled={saving} onChange={(event) => setHeadersText(event.target.value)} />
                    <p className="text-[var(--fs-label)] text-muted-foreground">例如 {`{"Authorization": "Bearer {{token}}"}`}。密钥使用参数占位，不填写真实凭证。</p>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <label htmlFor={`${fieldId}-published`} className="text-caption font-medium">
                        发布到 MCP 市场
                    </label>
                    <Switch id={`${fieldId}-published`} checked={draft.published} disabled={saving} onChange={(published) => setDraft((current) => ({ ...current, published }))} />
                </div>
                {template ? <p className="text-caption text-status-warning">保存会清空已安装连接的参数和密钥并停用连接，用户需要重新填写参数、检测并授权工具。</p> : null}
            </div>
        </AppModal>
    );
}
