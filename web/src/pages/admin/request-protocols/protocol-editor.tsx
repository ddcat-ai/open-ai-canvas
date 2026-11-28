import { useRef, useState, type ReactNode } from "react";
import { Alert, App, Button, Form, Input, Select, Switch, Tabs } from "antd";
import { Check, Code2, Plus, Trash2 } from "lucide-react";
import { AdminDrawer, AdminModal } from "../ui/overlays";
import {
    checkRequestProtocol,
    publishRequestProtocol,
    type RequestProtocol,
    type RequestProtocolCheck,
    type RequestProtocolCheckResult,
    type RequestProtocolManifest,
    type RequestProtocolOperation,
    type RequestProtocolProvider,
    type RequestProtocolRelease,
} from "@/services/api/request-protocols";
import { getActiveUserScope } from "@/lib/user-scope";
import { useUserStore } from "@/stores/use-user-store";
import {
    isProtocolObject,
    newRequestProtocol,
    nextProtocolVersion,
    parseProtocolManifest,
    protocolCapabilities,
    protocolExampleRequest,
    protocolExampleResponse,
    requestExpressionSource,
    requestSourceExpression,
    requestSources,
    responseExpressionPaths,
    responsePathExpression,
    shortReleaseDigest,
    updateProtocolProvider,
} from "./protocol-form";

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const tabLabel = (step: number, label: string) => (
    <span className="protocol-tab-label">
        <span className="protocol-tab-step">{step}</span>
        <span>{label}</span>
    </span>
);

export function ProtocolEditor({ item, baseRelease, copy, onClose, onSaved }: { item?: RequestProtocol; baseRelease?: RequestProtocolRelease; copy?: boolean; onClose: () => void; onSaved: (item: RequestProtocol) => Promise<void> }) {
    const { message, modal } = App.useApp();
    const [scope] = useState(getActiveUserScope);
    const sourceManifest = baseRelease?.manifest || item?.manifest;
    const [manifest, setManifest] = useState<RequestProtocolManifest>(() => {
        if (!sourceManifest) return newRequestProtocol();
        const cloned = structuredClone(sourceManifest);
        return copy ? { ...cloned, name: cloned.name + "（副本）" } : cloned;
    });
    const [id, setId] = useState(() => (copy ? "custom-" + (item?.providerId || item?.id || "protocol").replace(/^custom-/, "").slice(0, 30) : item?.id || "custom-video"));
    const readOnly = Boolean(item?.readOnly && !copy);
    const editing = Boolean(item && !item.readOnly && !copy);
    const nextVersion = editing ? nextProtocolVersion(item?.releases) : "1.0.0";
    const sourceVersion = baseRelease?.version || item?.version || "";
    const provider = manifest.contributes.providers[0];
    const capability = provider.capabilities[0];
    const [tab, setTab] = useState("identity");
    const [advanced, setAdvanced] = useState<string>();
    const [requestText, setRequestText] = useState(() => pretty(protocolExampleRequest()));
    const [responseText, setResponseText] = useState(() => pretty(protocolExampleResponse(capability)));
    const [phase, setPhase] = useState<"create" | "poll">(provider.poll ? "poll" : "create");
    const [taskId, setTaskId] = useState("example-task");
    const [result, setResult] = useState<RequestProtocolCheckResult>();
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [checkedInput, setCheckedInput] = useState("");
    const dirty = useRef(false);
    const lock = useRef(false);
    const assertScope = () => {
        if (scope === "guest" || getActiveUserScope() !== scope || useUserStore.getState().user?.id !== scope) throw new Error("账号已切换，请重新打开请求协议");
    };
    const change = (next: RequestProtocolManifest) => {
        dirty.current = true;
        setManifest(next);
        setCheckedInput("");
        setResult(undefined);
    };
    const patch = (value: Partial<RequestProtocolProvider>) => change(updateProtocolProvider(manifest, value));
    const input = (): RequestProtocolCheck => {
        assertScope();
        if (!manifest.name.trim()) throw new Error("请填写协议名称");
        if (!/^[a-z][a-z0-9-]{0,39}$/.test(id)) throw new Error("协议标识需以小写字母开头，使用小写字母、数字和连字符，最多 40 位");
        return { manifest, request: JSON.parse(requestText), response: JSON.parse(responseText), phase, taskId };
    };
    const check = async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        try {
            const request = input();
            const next = await checkRequestProtocol(request);
            assertScope();
            setResult(next);
            setCheckedInput(pretty(request));
            message.success("请求与响应映射校验通过");
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "协议校验失败");
            setCheckedInput("");
            setResult(undefined);
        } finally {
            lock.current = false;
            setBusy(false);
        }
    };
    const publish = async () => {
        if (lock.current) return;
        lock.current = true;
        setBusy(true);
        setError("");
        let saved: RequestProtocol | undefined;
        try {
            const request = input();
            if (!checkedInput || checkedInput !== pretty(request)) throw new Error("配置或示例已变化，请重新校验后发布");
            saved = await publishRequestProtocol(id, editing ? item?.sha256 || "" : "", request);
            assertScope();
            dirty.current = false;
            await onSaved(saved);
            message.success(`已发布 v${saved.version}，可在渠道模型中绑定此发行版本`);
            onClose();
        } catch (cause) {
            setError(saved ? "协议已保存，列表刷新失败，请关闭后刷新确认" : cause instanceof Error ? cause.message : "协议发布失败");
        } finally {
            lock.current = Boolean(saved);
            setBusy(false);
        }
    };
    const close = () => {
        if (busy) return;
        if (!dirty.current) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃未发布的修改？", content: "当前修改尚未保存到服务端。", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
    };
    const operation = (key: "create" | "poll" | "result", title: string, description: string, optional: boolean, children?: ReactNode) => {
        const value = provider[key];
        return (
            <section className={"protocol-panel protocol-operation-panel" + (value ? "" : " is-disabled")} key={key}>
                <div className="protocol-panel-heading">
                    <div>
                        <h3>{title}</h3>
                        <p>{description}</p>
                    </div>
                    {optional && (
                        <label className="protocol-switch-label">
                            <span>{value ? "已启用" : "未启用"}</span>
                            <Switch
                                aria-label={"启用" + title}
                                checked={Boolean(value)}
                                onChange={(enabled) => {
                                    patch({ [key]: enabled ? { method: "GET", path: "/v1/tasks/{{taskId}}" + (key === "result" ? "/content" : "") } : undefined });
                                    if (key === "poll" && !enabled) setPhase("create");
                                }}
                                disabled={readOnly || busy}
                            />
                        </label>
                    )}
                </div>
                {value && (
                    <div className="protocol-operation-block">
                        <div className="protocol-operation">
                            <Form.Item label="请求方法">
                                <Select
                                    aria-label={title + "请求方法"}
                                    value={value.method}
                                    options={["GET", "POST", "PUT", "PATCH", "DELETE"].map((method) => ({ value: method, label: method }))}
                                    onChange={(method) => patch({ [key]: { ...value, method } })}
                                />
                            </Form.Item>
                            <Form.Item label="接口路径">
                                <Input aria-label={title + "接口路径"} value={value.path} onChange={(event) => patch({ [key]: { ...value, path: event.target.value } })} placeholder="/v1/tasks/{{taskId}}" />
                            </Form.Item>
                        </div>
                        <p className="protocol-hint">路径拼接在渠道 Base URL 后；查询和下载可使用 {"{{taskId}}"}，鉴权沿用协议配置。</p>
                    </div>
                )}
                {children}
            </section>
        );
    };
    const pathField = (key: string, label: string, placeholder: string) => {
        const paths = responseExpressionPaths(provider.response[key]);
        return (
            <Form.Item key={key} label={label} extra={paths === null ? "当前为高级表达式，请在高级 JSON 中编辑。" : "多个候选路径用逗号分隔，按顺序取第一个有效值。"}>
                <Input
                    aria-label={label}
                    value={paths ?? "高级表达式"}
                    disabled={paths === null || readOnly || busy}
                    placeholder={placeholder}
                    onChange={(event) => patch({ response: { ...provider.response, [key]: responsePathExpression(event.target.value) } })}
                />
            </Form.Item>
        );
    };

    return (
        <AdminDrawer
            open
            title={readOnly ? `查看请求协议 · v${sourceVersion}` : editing ? `编辑协议 · 发布 v${nextVersion}` : "新建请求协议"}
            onClose={close}
            width="min(1080px, 100vw)"
            rootClassName="request-protocol-drawer"
            footer={
                <div className="protocol-editor-footer">
                    <span>{readOnly ? "当前版本为只读；复制后可发布为自定义声明式插件。" : `发布为标准 .yingce-plugin 发行包 v${nextVersion}；旧版本自动归档，不会自动替换已锁版模型。`}</span>
                    <Button onClick={close}>关闭</Button>
                    {!readOnly && (
                        <Button type="primary" disabled={busy || !checkedInput} loading={busy} onClick={() => void publish()}>
                            发布 v{nextVersion}
                        </Button>
                    )}
                </div>
            }
        >
            <div className="protocol-editor">
                <div className="protocol-editor-toolbar">
                    <div>
                        <strong>接口配置</strong>
                        <p>这里只描述请求与结果映射；渠道地址和密钥继续由渠道管理。示例校验不会访问供应商。</p>
                    </div>
                    <Button icon={<Code2 size={15} />} onClick={() => setAdvanced(pretty(manifest))}>
                        高级 JSON
                    </Button>
                </div>
                {editing && (
                    <div className="protocol-version-context">
                        <span className="protocol-version-badge">v{sourceVersion}</span>
                        <div>
                            <strong>
                                基于 v{sourceVersion} 创建发行版 v{nextVersion}
                            </strong>
                            <span>
                                保持稳定协议标识 {item?.providerId}；当前归档摘要 {shortReleaseDigest(item?.sha256)}，发布后需在模型绑定中选择新发行版。
                            </span>
                        </div>
                    </div>
                )}
                {error && <Alert type="error" showIcon title={error} />}
                <Form layout="vertical" disabled={readOnly || busy}>
                    <Tabs
                        className="protocol-tabs"
                        activeKey={tab}
                        onChange={setTab}
                        items={[
                            {
                                key: "identity",
                                label: tabLabel(1, "基本信息"),
                                children: (
                                    <div className="protocol-tab-content">
                                        <section className="protocol-panel">
                                            <div className="protocol-panel-heading">
                                                <div>
                                                    <h3>基础信息</h3>
                                                    <p>发布后会注册为统一插件体系中的声明式协议插件，与插件管理共享版本归档。</p>
                                                </div>
                                            </div>
                                            <div className="protocol-editor-fields">
                                                <Form.Item label="协议名称" required>
                                                    <Input aria-label="协议名称" value={manifest.name} onChange={(event) => change({ ...updateProtocolProvider(manifest, { label: event.target.value }), name: event.target.value })} />
                                                </Form.Item>
                                                <Form.Item label="协议标识" required extra="同时作为插件 ID 与 Provider ID；发布后不可修改，升级仅递增版本号。">
                                                    <Input
                                                        aria-label="协议标识"
                                                        value={id}
                                                        disabled={editing || readOnly || busy}
                                                        onChange={(event) => {
                                                            setId(event.target.value);
                                                            setCheckedInput("");
                                                        }}
                                                    />
                                                </Form.Item>
                                                <Form.Item label="能力类型">
                                                    <Select
                                                        aria-label="能力类型"
                                                        value={capability}
                                                        options={protocolCapabilities}
                                                        onChange={(value) => {
                                                            const resultKey = value === "text" ? "text" : value + "s";
                                                            patch({ capabilities: [value], response: { ...provider.response, [resultKey]: responsePathExpression(value === "text" ? "text" : value + "_url") } });
                                                            setResponseText(pretty(protocolExampleResponse(value)));
                                                        }}
                                                    />
                                                </Form.Item>
                                                <Form.Item label="说明">
                                                    <Input.TextArea aria-label="协议说明" rows={3} value={manifest.description} onChange={(event) => change({ ...manifest, description: event.target.value })} />
                                                </Form.Item>
                                            </div>
                                        </section>
                                        <section className="protocol-panel">
                                            <div className="protocol-panel-heading">
                                                <div>
                                                    <h3>鉴权方式</h3>
                                                    <p>密钥由渠道在运行时注入，协议中不保存真实凭据。</p>
                                                </div>
                                            </div>
                                            <div className="protocol-editor-fields">
                                                <Form.Item label="鉴权类型">
                                                    <Select
                                                        aria-label="鉴权类型"
                                                        value={provider.auth?.type || "bearer"}
                                                        options={[
                                                            { value: "bearer", label: "Bearer Token" },
                                                            { value: "header", label: "自定义请求头" },
                                                            { value: "query", label: "查询参数" },
                                                            { value: "none", label: "无需鉴权" },
                                                        ]}
                                                        onChange={(type) => patch({ auth: { ...provider.auth, type, field: "apiKey" } })}
                                                    />
                                                </Form.Item>
                                                {provider.auth?.type === "header" && (
                                                    <Form.Item label="鉴权请求头名称">
                                                        <Input aria-label="鉴权请求头名称" value={provider.auth.header} placeholder="X-API-Key" onChange={(event) => patch({ auth: { ...provider.auth, header: event.target.value } })} />
                                                    </Form.Item>
                                                )}
                                                {provider.auth?.type === "query" && (
                                                    <Form.Item label="鉴权参数名称">
                                                        <Input aria-label="鉴权参数名称" value={provider.auth.query} placeholder="key" onChange={(event) => patch({ auth: { ...provider.auth, query: event.target.value } })} />
                                                    </Form.Item>
                                                )}
                                            </div>
                                            <p className="protocol-hint">复杂签名、动态请求头或刷新令牌等规则，在高级 JSON 中配置。</p>
                                        </section>
                                    </div>
                                ),
                            },
                            {
                                key: "request",
                                label: tabLabel(2, "接口与参数"),
                                children: (
                                    <div className="protocol-tab-content">
                                        {operation(
                                            "create",
                                            "创建接口",
                                            "提交生成任务，并接收任务 ID 或同步作品结果。",
                                            false,
                                            <>
                                                <div className="protocol-request-format">
                                                    <Form.Item label="请求格式">
                                                        <Select
                                                            aria-label="请求格式"
                                                            value={provider.create.contentType || "application/json"}
                                                            options={["application/json", "application/x-www-form-urlencoded", "multipart/form-data"].map((value) => ({ value, label: value }))}
                                                            onChange={(contentType) => patch({ create: { ...provider.create, contentType } })}
                                                        />
                                                    </Form.Item>
                                                </div>
                                                <RequestMappings operation={provider.create} disabled={readOnly || busy} onChange={(create) => patch({ create })} onAdvanced={() => setAdvanced(pretty(manifest))} />
                                            </>,
                                        )}
                                        {operation("poll", "查询接口", "按上游任务 ID 查询排队、处理中或成功状态。", true)}
                                        {operation("result", "独立下载接口", "仅当供应商把状态和文件下载拆成两个接口时启用。", true)}
                                        {provider.result && <Alert type="warning" showIcon title="仅在供应商明确提供独立下载接口时启用；直接返回成片地址的接口不需要此项。" />}
                                    </div>
                                ),
                            },
                            {
                                key: "response",
                                label: tabLabel(3, "响应解析"),
                                children: (
                                    <div className="protocol-tab-content">
                                        <section className="protocol-panel">
                                            <div className="protocol-panel-heading">
                                                <div>
                                                    <h3>结果字段</h3>
                                                    <p>填写供应商响应中的字段路径。多个候选路径按顺序取第一个有效值。</p>
                                                </div>
                                            </div>
                                            <div className="protocol-editor-fields">
                                                {pathField("taskId", "任务 ID 路径", "id, data.task_id")}
                                                {pathField("status", "任务状态路径", "status, data.status")}
                                                {pathField("message", "错误消息路径", "error.message, message")}
                                                {pathField(capability === "text" ? "text" : capability + "s", capability === "text" ? "文本内容路径" : "作品地址路径", capability === "text" ? "choices.0.message.content" : "data.data.video_url")}
                                            </div>
                                            <div className="protocol-note">状态会统一识别为排队、处理中、成功、失败或取消。保存前请用供应商的真实示例响应核对。</div>
                                        </section>
                                    </div>
                                ),
                            },
                            {
                                key: "check",
                                label: tabLabel(4, "校验与发布"),
                                children: (
                                    <div className="protocol-tab-content">
                                        <section className="protocol-panel">
                                            <div className="protocol-panel-heading">
                                                <div>
                                                    <h3>校验上下文</h3>
                                                    <p>选择要核对的响应阶段，并提供一个示例任务 ID。</p>
                                                </div>
                                            </div>
                                            <div className="protocol-editor-fields">
                                                <Form.Item label="响应阶段">
                                                    <Select
                                                        aria-label="响应阶段"
                                                        value={phase}
                                                        options={[{ value: "create", label: "创建响应" }, ...(provider.poll ? [{ value: "poll", label: "查询响应" }] : [])]}
                                                        onChange={(value) => {
                                                            setPhase(value);
                                                            setCheckedInput("");
                                                        }}
                                                        disabled={busy}
                                                    />
                                                </Form.Item>
                                                <Form.Item label="示例任务 ID">
                                                    <Input
                                                        aria-label="示例任务 ID"
                                                        value={taskId}
                                                        onChange={(event) => {
                                                            setTaskId(event.target.value);
                                                            setCheckedInput("");
                                                        }}
                                                        disabled={busy}
                                                    />
                                                </Form.Item>
                                            </div>
                                        </section>
                                        <div className="protocol-check-grid">
                                            <section className="protocol-panel protocol-sample-panel">
                                                <div className="protocol-panel-heading">
                                                    <div>
                                                        <h3>统一请求示例</h3>
                                                        <p>填写业务字段，校验时会构造成供应商请求。</p>
                                                    </div>
                                                </div>
                                                <Form.Item>
                                                    <Input.TextArea
                                                        aria-label="示例请求"
                                                        className="protocol-json"
                                                        rows={12}
                                                        value={requestText}
                                                        onChange={(event) => {
                                                            setRequestText(event.target.value);
                                                            setCheckedInput("");
                                                        }}
                                                        disabled={busy}
                                                    />
                                                </Form.Item>
                                            </section>
                                            <section className="protocol-panel protocol-sample-panel">
                                                <div className="protocol-panel-heading">
                                                    <div>
                                                        <h3>供应商响应示例</h3>
                                                        <p>粘贴真实响应结构，用来说明任务状态和作品地址。</p>
                                                    </div>
                                                </div>
                                                <Form.Item>
                                                    <Input.TextArea
                                                        aria-label="供应商示例响应"
                                                        className="protocol-json"
                                                        rows={12}
                                                        value={responseText}
                                                        onChange={(event) => {
                                                            setResponseText(event.target.value);
                                                            setCheckedInput("");
                                                        }}
                                                        disabled={busy}
                                                    />
                                                </Form.Item>
                                            </section>
                                        </div>
                                        <div className="protocol-check-actions">
                                            <span>校验只验证映射，不发送请求，也不创建生成任务。</span>
                                            <Button type="primary" ghost icon={<Check size={15} />} loading={busy} onClick={() => void check()} disabled={busy}>
                                                校验请求与响应
                                            </Button>
                                        </div>
                                        {result && (
                                            <section className="protocol-panel protocol-check-result">
                                                <Alert type="success" showIcon title="映射校验通过；未调用供应商、未创建生成任务。" />
                                                {result.warnings.map((warning) => (
                                                    <Alert key={warning} type="warning" showIcon title={warning} />
                                                ))}
                                                <div className="protocol-panel-heading">
                                                    <div>
                                                        <h3>构造与解析结果</h3>
                                                        <p>确认请求字段和作品地址都落在预期位置后，再发布新版本。</p>
                                                    </div>
                                                </div>
                                                <pre>{pretty(result)}</pre>
                                            </section>
                                        )}
                                    </div>
                                ),
                            },
                        ]}
                    />
                </Form>
            </div>
            <AdminModal
                open={advanced !== undefined}
                title="高级 JSON · 完整协议定义"
                width={900}
                onCancel={() => setAdvanced(undefined)}
                okText={readOnly ? "关闭" : "应用到表单"}
                cancelText="取消"
                onOk={() => {
                    if (readOnly) {
                        setAdvanced(undefined);
                        return;
                    }
                    try {
                        change(parseProtocolManifest(advanced || ""));
                        setAdvanced(undefined);
                    } catch (cause) {
                        message.error(cause instanceof Error ? cause.message : "JSON 无效");
                    }
                }}
            >
                <p className="protocol-hint">高级修改保留完整映射；应用后需重新校验，再发布新版本。</p>
                <Input.TextArea aria-label="完整协议 JSON" className="protocol-json" rows={22} readOnly={readOnly} value={advanced} onChange={(event) => setAdvanced(event.target.value)} />
            </AdminModal>
        </AdminDrawer>
    );
}

function RequestMappings({ operation, onChange, disabled, onAdvanced }: { operation: RequestProtocolOperation; onChange: (operation: RequestProtocolOperation) => void; disabled: boolean; onAdvanced: () => void }) {
    const { message } = App.useApp();
    const body = isProtocolObject(operation.body) ? operation.body : {};
    if (Object.keys(body).some((key) => key.startsWith("$")) || (operation.body !== undefined && !isProtocolObject(operation.body))) {
        return <Alert type="info" title="当前请求使用高级参数映射" description={<Button onClick={onAdvanced}>编辑完整 JSON，保留原有表达式</Button>} />;
    }
    const entries = Object.entries(body);
    const update = (index: number, field: string, expression: unknown) => {
        if (entries.some(([key], at) => at !== index && key === field)) {
            message.error("目标参数名不能重复");
            return;
        }
        onChange({ ...operation, body: Object.fromEntries(entries.map((entry, at) => (at === index ? [field, expression] : entry))) });
    };
    return (
        <div className="protocol-mapping-block">
            <div className="protocol-section-heading">
                <div>
                    <h4>请求参数映射</h4>
                    <p>左侧填写供应商字段名，右侧选择业务数据来源。</p>
                </div>
                <Button
                    size="small"
                    disabled={disabled}
                    icon={<Plus size={14} />}
                    onClick={() => {
                        let field = "field_" + (entries.length + 1);
                        while (Object.hasOwn(body, field)) field += "_";
                        onChange({ ...operation, body: { ...body, [field]: requestSourceExpression("model") } });
                    }}
                >
                    添加参数
                </Button>
            </div>
            <div className="protocol-mapping-head">
                <span>供应商参数名</span>
                <span>取值来源</span>
                <span />
            </div>
            {entries.map(([field, expression], index) => (
                <div className="protocol-mapping-row" key={index}>
                    <Input aria-label={"参数 " + (index + 1) + " 名称"} value={field} disabled={disabled} onChange={(event) => update(index, event.target.value, expression)} />
                    <Select
                        aria-label={"参数 " + (index + 1) + " 来源"}
                        value={requestExpressionSource(expression)}
                        disabled={disabled}
                        options={[...requestSources, { value: "advanced", label: "高级表达式（保留）", disabled: true }]}
                        onChange={(source) => update(index, field, requestSourceExpression(source))}
                    />
                    <Button type="text" aria-label={"删除参数 " + (index + 1)} disabled={disabled} icon={<Trash2 size={15} />} onClick={() => onChange({ ...operation, body: Object.fromEntries(entries.filter((_, at) => at !== index)) })} />
                </div>
            ))}
            <p className="protocol-hint">参考素材映射为地址列表；对象、条件、固定值和嵌套结构可在高级 JSON 中设置。</p>
        </div>
    );
}
