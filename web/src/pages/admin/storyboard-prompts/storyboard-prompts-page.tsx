import { Alert, App, Button, Drawer, Form, Input, Popconfirm, Select, Table, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Braces, Copy, FileJson, FileText, Info, Plus, Power, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { PromptCodeEditor, type PromptCodeEditorHandle } from "@/components/prompt/prompt-code-editor";
import {
    createAdminPromptTemplate,
    deleteAdminPromptTemplate,
    listAdminPromptTemplates,
    updateAdminPromptTemplate,
    type PromptOperationDefinition,
    type PromptTemplate,
} from "@/services/api/auth";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminTableEmpty, AdminTableSkeleton } from "../components/admin-ui";

type PromptFormValues = { name: string; enabled?: boolean };
type DraftBaseline = { operation: string; name: string; enabled: boolean; content: string };

export default function StoryboardPromptsPage() {
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const operationFilter = searchParams.get("operation") || "all";
    const status = searchParams.get("status") === "enabled" || searchParams.get("status") === "disabled" ? searchParams.get("status") as "enabled" | "disabled" : "all";
    const [templates, setTemplates] = useState<PromptTemplate[]>([]);
    const [definitions, setDefinitions] = useState<PromptOperationDefinition[]>([]);
    const [loading, setLoading] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [baseTemplate, setBaseTemplate] = useState<PromptTemplate | null>(null);
    const [draftOperation, setDraftOperation] = useState("");
    const [pendingOperation, setPendingOperation] = useState("");
    const [draftBaseline, setDraftBaseline] = useState<DraftBaseline | null>(null);
    const [editorContent, setEditorContent] = useState("");
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<PromptFormValues>();
    const editorRef = useRef<PromptCodeEditorHandle>(null);
    const draftName = Form.useWatch("name", form) || "";
    const draftEnabled = Form.useWatch("enabled", form) === true;
    const selectedDefinition = definitions.find((item) => item.operation === draftOperation);
    const hasFilters = Boolean(keyword || operationFilter !== "all" || status !== "all");
    const dirty = Boolean(draftBaseline) && (
        draftOperation !== draftBaseline?.operation
        || draftName !== draftBaseline?.name
        || draftEnabled !== draftBaseline?.enabled
        || editorContent !== draftBaseline?.content
    );

    const updateUrl = (patch: { filter?: string; operation?: string; status?: string }) => {
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => value && value !== "all" ? next.set(key, value) : next.delete(key));
        setSearchParams(next);
    };

    const reload = async () => {
        setLoading(true);
        try {
            const result = await listAdminPromptTemplates();
            setTemplates(result.templates);
            setDefinitions(result.definitions);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取提示词模板失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void reload(); }, []);

    const definitionByOperation = useMemo(() => new Map(definitions.map((item) => [item.operation, item])), [definitions]);
    const filtered = useMemo(() => templates.filter((template) => {
        const definition = definitionByOperation.get(template.operation);
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (normalizedKeyword && !`${template.name} ${template.content} ${definition?.label || ""}`.toLowerCase().includes(normalizedKeyword)) return false;
        if (operationFilter !== "all" && template.operation !== operationFilter) return false;
        if (status === "enabled" && !template.enabled) return false;
        if (status === "disabled" && template.enabled) return false;
        return true;
    }), [definitionByOperation, keyword, operationFilter, status, templates]);

    const activeTemplateFor = (operation: string) => templates.find((template) => template.operation === operation && template.enabled);

    const loadDraftBaseline = (operation: string, template?: PromptTemplate) => {
        const source = template || activeTemplateFor(operation);
        const baseline = {
            operation,
            name: source ? `${source.name} · 新版本` : "",
            enabled: false,
            content: source?.content || "",
        };
        setDraftOperation(operation);
        setPendingOperation("");
        setEditorContent(baseline.content);
        setDraftBaseline(baseline);
        form.setFieldsValue({ name: baseline.name, enabled: baseline.enabled });
    };

    const openDrawer = (template?: PromptTemplate) => {
        const operation = template?.operation || definitions[0]?.operation || "";
        setBaseTemplate(template || null);
        form.resetFields();
        loadDraftBaseline(operation, template);
        setDrawerOpen(true);
    };

    const switchOperation = (operation: string) => {
        if (!dirty) {
            loadDraftBaseline(operation);
            return;
        }
        setPendingOperation(operation);
    };

    const closeDrawer = () => {
        if (saving) return;
        setDrawerOpen(false);
        setPendingOperation("");
    };

    const save = async () => {
        const values = await form.validateFields();
        if (!editorContent.trim()) {
            message.warning("请填写提示词模板内容");
            return;
        }
        setSaving(true);
        try {
            await createAdminPromptTemplate({ operation: draftOperation, name: values.name.trim(), content: editorContent, enabled: values.enabled === true });
            setDraftBaseline(null);
            setDrawerOpen(false);
            await reload();
            message.success("提示词新版本已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存提示词模板失败");
        } finally {
            setSaving(false);
        }
    };

    const activate = async (template: PromptTemplate) => {
        try {
            await updateAdminPromptTemplate(template.id, { operation: template.operation, name: template.name, content: template.content, enabled: true });
            await reload();
            message.success("提示词版本已启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "启用提示词版本失败");
        }
    };

    const remove = async (template: PromptTemplate) => {
        try {
            await deleteAdminPromptTemplate(template.id);
            await reload();
            message.success("提示词版本已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除提示词版本失败");
        }
    };

    const columns: ColumnsType<PromptTemplate> = [
        { title: "模板类型", dataIndex: "operation", width: 180, render: (operation: string) => { const definition = definitionByOperation.get(operation); return <div><div className="font-medium">{definition?.label || operation}</div><div className="mt-1 text-xs text-foreground/45">{definition?.category || "--"}</div></div>; } },
        { title: "版本", dataIndex: "name", render: (_, template) => <div><div className="font-medium">{template.name}</div><div className="mt-1 text-xs text-foreground/45">v{template.version} · {template.content.length} 字符</div></div> },
        { title: "输出", dataIndex: "outputType", width: 120, render: (outputType: string, template) => <span className="inline-flex items-center gap-1.5 text-xs text-foreground/65">{outputType === "json" ? <FileJson className="size-3.5" /> : <FileText className="size-3.5" />}{outputType === "json" ? definitionByOperation.get(template.operation)?.schemaKey || "JSON" : "文本"}</span> },
        { title: "状态", dataIndex: "enabled", width: 100, render: (enabled) => <Tag variant="filled" color={enabled ? "success" : "default"}>{enabled ? "启用中" : "历史版"}</Tag> },
        { title: "更新时间", dataIndex: "updatedAt", width: 180, render: formatTime },
        { title: "操作", width: 170, fixed: "right", align: "right", render: (_, template) => <AdminRowActions primary={{ label: "基于此版本新建", icon: <Copy className="size-3.5" />, onClick: () => openDrawer(template) }} actions={[{ key: "activate", label: "启用版本", icon: <Power className="size-3.5" />, disabled: template.enabled, confirm: { title: "启用这个提示词版本？", description: "只会替换同类型的当前版本，其他模板类型不受影响。", okText: "确认启用" }, onClick: () => activate(template) }, { key: "delete", label: "删除版本", icon: <Trash2 className="size-3.5" />, danger: true, disabled: template.enabled, confirm: { title: "删除这个历史版本？", description: "删除后不可恢复，启用中的版本不能删除。", okText: "确认删除" }, onClick: () => remove(template) }]} /> },
    ];

    return (
        <AdminPageFrame title="提示词模板" description="平台创作策略与版本管理" actions={<Button type="primary" icon={<Plus className="size-4" />} disabled={!definitions.length} onClick={() => openDrawer()}>新建版本</Button>}>
            <div className="border-b border-border pb-4 text-xs leading-5 text-foreground/60"><div className="flex items-center gap-1.5 font-medium text-foreground/80"><ShieldCheck className="size-3.5" />创作策略与执行契约分离</div><p>可以调整导演方法、镜头语言和生成策略。JSON Schema、动态项目数据和服务端校验属于受保护契约，只读展示且不会被模板覆盖。</p></div>
            <ListToolbar active={hasFilters} onReset={() => updateUrl({ filter: "", operation: "all", status: "all" })}>
                <Input allowClear className="app-list-search" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索模板或内容" onChange={(event) => updateUrl({ filter: event.target.value })} />
                <Select className="w-40" value={operationFilter} onChange={(value) => updateUrl({ operation: value })} options={[{ label: "全部类型", value: "all" }, ...definitions.map((item) => ({ label: item.label, value: item.operation }))]} />
                <Select className="w-32" value={status} onChange={(value) => updateUrl({ status: value })} options={[{ label: "全部状态", value: "all" }, { label: "启用中", value: "enabled" }, { label: "历史版本", value: "disabled" }]} />
            </ListToolbar>
            <TableSurface>{loading && templates.length === 0 ? <AdminTableSkeleton rows={8} columns={6} /> : <Table className="app-data-table" size="middle" rowKey="id" loading={loading} columns={columns} dataSource={filtered} locale={{ emptyText: <AdminTableEmpty filtered={hasFilters} /> }} pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1120 }} expandable={{ expandedRowRender: (template) => <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-5 text-foreground/75">{template.content}</pre> }} />}</TableSurface>

            <Drawer
                title={baseTemplate ? `基于 v${baseTemplate.version} 新建版本` : "新建提示词版本"}
                open={drawerOpen}
                size="min(1180px, 100vw)"
                onClose={closeDrawer}
                closable={false}
                maskClosable={false}
                keyboard={false}
                destroyOnHidden
                styles={{ body: { padding: 0 } }}
                extra={<div className="flex gap-2"><Popconfirm disabled={!dirty} title="放弃模板修改？" description="尚未保存的新版本内容将丢失。" okText="放弃修改" cancelText="继续编辑" okButtonProps={{ danger: true }} onConfirm={closeDrawer}><Button disabled={saving} onClick={() => { if (!dirty) closeDrawer(); }}>关闭</Button></Popconfirm><Button type="primary" loading={saving} disabled={!draftOperation || !draftName.trim() || !editorContent.trim()} onClick={() => void save()}>保存版本</Button></div>}
            >
                <Form form={form} layout="vertical" requiredMark={false} className="flex min-h-full flex-col">
                    <div className="grid shrink-0 gap-4 border-b border-border p-4 md:grid-cols-3">
                        <Form.Item label="模板类型" className="mb-0">
                            <Select value={draftOperation} disabled={Boolean(baseTemplate)} options={definitions.map((item) => ({ label: `${item.category} · ${item.label}`, value: item.operation }))} onChange={switchOperation} />
                        </Form.Item>
                        <Form.Item name="name" label="版本名称" className="mb-0" rules={[{ required: true, whitespace: true, message: "请填写版本名称" }]}>
                            <Input placeholder="例如：轻喜剧分镜策略 v2" />
                        </Form.Item>
                        <Form.Item name="enabled" label="保存后状态" className="mb-0">
                            <Select options={[{ label: "保存为历史版本", value: false }, { label: "保存并设为当前启用版本", value: true }]} />
                        </Form.Item>
                    </div>

                    {pendingOperation ? (
                        <Alert
                            type="warning"
                            showIcon
                            title="当前版本有未保存修改"
                            description={`切换到“${definitionByOperation.get(pendingOperation)?.label || pendingOperation}”会丢弃当前草稿。`}
                            action={<div className="flex gap-2"><Button size="small" onClick={() => setPendingOperation("")}>继续编辑</Button><Button size="small" danger onClick={() => loadDraftBaseline(pendingOperation)}>放弃并切换</Button></div>}
                        />
                    ) : null}

                    <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-3">
                        <section className="flex min-h-0 flex-col border-b border-border p-4 lg:col-span-2 lg:border-b-0 lg:border-r">
                            <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-semibold">模板内容</h3>{dirty ? <Tag variant="filled" color="warning">未保存</Tag> : null}</div>
                                    <p className="mt-1 text-xs leading-5 text-foreground/50">这里只编辑创作策略。变量会插入到当前光标位置。</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {selectedDefinition?.variables.map((variable) => (
                                        <Button key={variable.placeholder} size="small" icon={<Braces className="size-3.5" />} onClick={() => editorRef.current?.insertText(variable.placeholder)}>
                                            插入{variable.label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div className="min-h-96 flex-1 overflow-hidden rounded-md border border-border">
                                <PromptCodeEditor ref={editorRef} value={editorContent} ariaLabel="提示词模板内容" onChange={setEditorContent} />
                            </div>
                        </section>

                        <aside className="min-h-0 p-4">
                            <Tabs
                                size="small"
                                items={[
                                    {
                                        key: "contract",
                                        label: "输出契约",
                                        children: <div><div className="mb-3 flex items-center gap-2 text-xs font-medium"><ShieldCheck className="size-4" />服务端只读</div><pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{selectedDefinition?.outputContract || "请选择模板类型"}</pre></div>,
                                    },
                                    {
                                        key: "preview",
                                        label: "最终结构",
                                        children: <div className="space-y-4 text-xs leading-6"><section><div className="mb-2 font-medium text-foreground/80">可编辑创作策略</div><pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap text-foreground/65">{editorContent || "尚未填写"}</pre></section><section className="border-t border-border pt-4"><div className="mb-2 font-medium text-foreground/80">运行时强制追加</div><p className="text-foreground/55">动态项目上下文、用户个性化要求和受保护输出契约。</p></section></div>,
                                    },
                                ]}
                            />
                            <div className="mt-4 flex items-start gap-2 border-t border-border pt-4 text-xs leading-5 text-foreground/55"><Info className="mt-0.5 size-3.5 shrink-0" />每次调整都会创建新版本，启用中的版本不会被原地覆盖。</div>
                        </aside>
                    </div>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
