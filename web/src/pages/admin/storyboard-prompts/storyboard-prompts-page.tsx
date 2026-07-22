import { App, Button, Drawer, Form, Input, Select, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Copy, Info, Pencil, Plus, Power, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";

import { ListToolbar, TableSurface } from "@/components/layout/workspace-page";
import { createAdminStoryboardPromptTemplate, deleteAdminStoryboardPromptTemplate, listAdminStoryboardPromptTemplates, updateAdminStoryboardPromptTemplate, type StoryboardPromptTemplate, type StoryboardPromptVariable } from "@/services/api/auth";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminRowActions, AdminTableEmpty, AdminTableSkeleton } from "../components/admin-ui";

type PromptFormValues = { name: string; content: string; enabled?: boolean };

export default function StoryboardPromptsPage() {
    const { message, modal } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const status = searchParams.get("status") === "enabled" || searchParams.get("status") === "disabled" ? searchParams.get("status") as "enabled" | "disabled" : "all";
    const [templates, setTemplates] = useState<StoryboardPromptTemplate[]>([]);
    const [variables, setVariables] = useState<StoryboardPromptVariable[]>([]);
    const [loading, setLoading] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [editing, setEditing] = useState<StoryboardPromptTemplate | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<PromptFormValues>();
    const hasFilters = Boolean(keyword || status !== "all");

    const updateUrl = (patch: { filter?: string; status?: string }) => {
        const next = new URLSearchParams(searchParams);
        if (patch.filter !== undefined) patch.filter ? next.set("filter", patch.filter) : next.delete("filter");
        if (patch.status !== undefined) patch.status !== "all" ? next.set("status", patch.status) : next.delete("status");
        setSearchParams(next);
    };

    const reload = async () => {
        setLoading(true);
        try {
            const result = await listAdminStoryboardPromptTemplates();
            setTemplates(result.templates);
            setVariables(result.variables);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "读取分镜提示词失败");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { void reload(); }, []);

    const filtered = useMemo(() => templates.filter((template) => {
        const normalizedKeyword = keyword.trim().toLowerCase();
        if (normalizedKeyword && !`${template.name} ${template.content}`.toLowerCase().includes(normalizedKeyword)) return false;
        if (status === "enabled" && !template.enabled) return false;
        if (status === "disabled" && template.enabled) return false;
        return true;
    }), [keyword, status, templates]);

    const openDrawer = (template?: StoryboardPromptTemplate) => {
        setEditing(template || null);
        form.resetFields();
        form.setFieldsValue(template ? { name: template.name, content: template.content, enabled: template.enabled } : { name: "", content: "", enabled: false });
        setDrawerOpen(true);
    };

    const closeDrawer = () => {
        if (saving) return;
        if (!form.isFieldsTouched()) return setDrawerOpen(false);
        modal.confirm({ title: "放弃提示词修改？", content: "尚未保存的版本内容将丢失。", okText: "放弃修改", cancelText: "继续编辑", okButtonProps: { danger: true }, onOk: () => setDrawerOpen(false) });
    };

    const save = async () => {
        const values = await form.validateFields();
        setSaving(true);
        try {
            const payload = { name: values.name.trim(), content: values.content, enabled: values.enabled === true };
            await (editing ? updateAdminStoryboardPromptTemplate(editing.id, payload) : createAdminStoryboardPromptTemplate(payload));
            setDrawerOpen(false);
            form.resetFields();
            await reload();
            message.success(editing ? "分镜提示词已更新" : "分镜提示词已创建");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存分镜提示词失败");
        } finally {
            setSaving(false);
        }
    };

    const activate = async (template: StoryboardPromptTemplate) => {
        try {
            await updateAdminStoryboardPromptTemplate(template.id, { name: template.name, content: template.content, enabled: true });
            await reload();
            message.success("分镜提示词已启用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "启用分镜提示词失败");
        }
    };

    const remove = async (template: StoryboardPromptTemplate) => {
        try {
            await deleteAdminStoryboardPromptTemplate(template.id);
            await reload();
            message.success("分镜提示词已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除分镜提示词失败");
        }
    };

    const columns: ColumnsType<StoryboardPromptTemplate> = [
        { title: "模板", dataIndex: "name", render: (_, template) => <div><div className="font-medium">{template.name}</div><div className="text-xs text-foreground/45">{template.content.length} 字符</div></div> },
        { title: "内容摘要", dataIndex: "content", width: 420, render: (content: string) => <div className="line-clamp-2 whitespace-pre-wrap text-xs leading-5 text-foreground/65">{content}</div> },
        { title: "状态", dataIndex: "enabled", width: 110, render: (enabled) => <Tag bordered={false} color={enabled ? "success" : "default"}>{enabled ? "启用中" : "未启用"}</Tag> },
        { title: "更新时间", dataIndex: "updatedAt", width: 180, render: formatTime },
        { title: "操作", width: 140, fixed: "right", align: "right", render: (_, template) => <AdminRowActions primary={{ label: "编辑", icon: <Pencil className="size-3.5" />, onClick: () => openDrawer(template) }} actions={[{ key: "activate", label: "启用版本", icon: <Power className="size-3.5" />, disabled: template.enabled, confirm: { title: "启用这个提示词版本？", description: "启用后会立即替换当前 Agent 分镜生成所使用的版本。", okText: "确认启用" }, onClick: () => activate(template) }, { key: "delete", label: "删除版本", icon: <Trash2 className="size-3.5" />, danger: true, disabled: template.enabled, confirm: { title: "删除这个提示词版本？", description: "删除后不可恢复；启用中的版本不能删除。", okText: "确认删除" }, onClick: () => remove(template) }]} /> },
    ];

    const insertVariable = (placeholder: string) => {
        const current = form.getFieldValue("content") || "";
        form.setFieldValue("content", `${current}${current && !current.endsWith("\n") ? "\n" : ""}${placeholder}`);
    };

    return (
        <AdminPageFrame title="分镜提示词" description="Agent 提示词版本" actions={<Button type="primary" icon={<Plus className="size-4" />} onClick={() => openDrawer()}>新增版本</Button>}>
            <div className="border-b border-border pb-4 text-xs leading-5 text-foreground/60"><div className="flex items-center gap-1.5 font-medium text-foreground/80"><Info className="size-3.5" />真实用于 Agent 分镜生成</div><p>当前启用版本会与镜头时长、数量和电影化质量约束一起发送给文本模型。展开行可查看完整提示词。</p></div>
            <ListToolbar active={hasFilters} onReset={() => updateUrl({ filter: "", status: "all" })}>
                <Input allowClear className="w-full sm:w-72" prefix={<Search className="size-4 text-foreground/40" />} value={keyword} placeholder="搜索版本名称或提示词" onChange={(event) => updateUrl({ filter: event.target.value })} />
                <Select className="w-32" value={status} onChange={(value) => updateUrl({ status: value })} options={[{ label: "全部状态", value: "all" }, { label: "启用中", value: "enabled" }, { label: "未启用", value: "disabled" }]} />
            </ListToolbar>
            <TableSurface>{loading && templates.length === 0 ? <AdminTableSkeleton rows={8} columns={5} /> : <Table className="app-data-table" size="middle" rowKey="id" loading={loading} columns={columns} dataSource={filtered} locale={{ emptyText: <AdminTableEmpty filtered={hasFilters} /> }} pagination={{ pageSize: 20, showSizeChanger: true, pageSizeOptions: [20, 50, 100] }} scroll={{ x: 1080 }} expandable={{ expandedRowRender: (template) => <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-5 text-foreground/75">{template.content}</pre> }} />}</TableSurface>
            <Drawer title={editing ? "编辑分镜提示词" : "新增分镜提示词"} open={drawerOpen} width="min(760px, 100vw)" onClose={closeDrawer} maskClosable={!saving} destroyOnHidden extra={<Button type="primary" loading={saving} onClick={() => void save()}>保存</Button>}>
                <Form form={form} layout="vertical" requiredMark={false}>
                    <Form.Item name="name" label="版本名称" rules={[{ required: true, message: "请填写版本名称" }]}><Input placeholder="例如：写实电影分镜 v2" /></Form.Item>
                    <Form.Item label="变量"><div className="flex flex-wrap gap-2">{variables.map((variable) => <Button key={variable.placeholder} size="small" icon={<Copy className="size-3.5" />} onClick={() => insertVariable(variable.placeholder)}>{variable.label}</Button>)}</div></Form.Item>
                    <Form.Item name="content" label="提示词模板" rules={[{ required: true, message: "请填写提示词模板" }]}><Input.TextArea rows={22} placeholder="使用变量占位符，例如 {{剧情}}、{{用户要求}}、{{画布资产}}" /></Form.Item>
                    <Form.Item name="enabled" label="保存后状态"><Select disabled={editing?.enabled} options={[{ label: "保留为未启用版本", value: false }, { label: "保存并设为当前启用版本", value: true }]} /></Form.Item>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function formatTime(value?: string) { return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--"; }
