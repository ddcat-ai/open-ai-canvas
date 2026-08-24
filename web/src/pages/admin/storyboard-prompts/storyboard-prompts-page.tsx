import { Alert, App, Button, Drawer, Form, Input, Popconfirm, Select, Tabs, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { Braces, Copy, FileJson, FileText, Plus, Power, Search, ShieldCheck, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { PaginationBar } from "@/components/layout/workspace-page";
import { PromptCodeEditor, type PromptCodeEditorHandle } from "@/components/prompt/prompt-code-editor";
import { createAdminPromptTemplate, deleteAdminPromptTemplate, listAdminPromptTemplates, updateAdminPromptTemplate, type PromptOperationDefinition, type PromptTemplate } from "@/services/api/auth";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminFilterChip, AdminRowActions, AdminStatusBadge, AdminTableEmpty } from "../components/admin-ui";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";

type PromptFormValues = { name: string; enabled?: boolean };
type DraftBaseline = { operation: string; name: string; enabled: boolean; content: string };

const promptDefinitionLocaleKeys: Record<string, { label: string; category: string }> = {
    art_setup: { label: "art-setup", category: "creation-category" },
    episode_script: { label: "episode-script", category: "creation-category" },
    outline_plan: { label: "outline-plan", category: "creation-category" },
    storyboard_plan: { label: "storyboard-plan", category: "storyboard-category" },
    storyboard_repair: { label: "storyboard-repair", category: "storyboard-category" },
    storyboard_first_frame: { label: "storyboard-first-frame", category: "generation-category" },
    storyboard_video: { label: "storyboard-video", category: "generation-category" },
    character_extract: { label: "character-extract", category: "character-category" },
    character_turnaround: { label: "character-turnaround", category: "character-category" },
};

const promptVariableLocaleKeys: Record<string, string> = {
    项目名称: "prompt-variable-project-name",
    项目画风: "prompt-variable-project-style",
    用户要求: "prompt-variable-user-requirements",
    校验错误: "prompt-variable-validation-errors",
    项目视觉: "prompt-variable-project-visual",
    首帧构图: "prompt-variable-first-frame-composition",
    表演起始状态: "prompt-variable-initial-performance-state",
    负面要求: "prompt-variable-negative-requirements",
    镜头意图: "prompt-variable-shot-intent",
    表演与调度: "prompt-variable-performance-blocking",
    摄影机: "prompt-variable-camera",
    时间节拍: "prompt-variable-timing",
    运动与结尾: "prompt-variable-motion-ending",
    声音: "prompt-variable-sound",
    执行优先级: "prompt-variable-execution-priority",
};

export default function StoryboardPromptsPage() {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [searchParams, setSearchParams] = useSearchParams();
    const keyword = searchParams.get("filter") || "";
    const operationFilter = searchParams.get("operation") || "all";
    const status = searchParams.get("status") === "enabled" || searchParams.get("status") === "disabled" ? (searchParams.get("status") as "enabled" | "disabled") : "all";
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
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [form] = Form.useForm<PromptFormValues>();
    const editorRef = useRef<PromptCodeEditorHandle>(null);
    const draftName = Form.useWatch("name", form) || "";
    const draftEnabled = Form.useWatch("enabled", form) === true;
    const hasFilters = Boolean(keyword || operationFilter !== "all" || status !== "all");
    const dirty = Boolean(draftBaseline) && (draftOperation !== draftBaseline?.operation || draftName !== draftBaseline?.name || draftEnabled !== draftBaseline?.enabled || editorContent !== draftBaseline?.content);

    const updateUrl = (patch: { filter?: string; operation?: string; status?: string }) => {
        setPage(1);
        const next = new URLSearchParams(searchParams);
        Object.entries(patch).forEach(([key, value]) => (value && value !== "all" ? next.set(key, value) : next.delete(key)));
        setSearchParams(next);
    };

    const reload = async () => {
        setLoading(true);
        try {
            const result = await listAdminPromptTemplates();
            setTemplates(result.templates);
            setDefinitions(result.definitions);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-read-prompt-templates"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        void reload();
    }, []);

    const localizedDefinitions = useMemo(
        () =>
            definitions.map((definition) => {
                const keys = promptDefinitionLocaleKeys[definition.operation];
                return {
                    ...definition,
                    ...(keys ? { label: t(`admin:${keys.label}`), category: t(`admin:${keys.category}`) } : {}),
                    variables: definition.variables.map((variable) => {
                        const localeKey = promptVariableLocaleKeys[variable.label];
                        return localeKey ? { ...variable, label: t(`admin:${localeKey}`) } : variable;
                    }),
                };
            }),
        [definitions, t],
    );
    const definitionByOperation = useMemo(() => new Map(localizedDefinitions.map((item) => [item.operation, item])), [localizedDefinitions]);
    const selectedDefinition = localizedDefinitions.find((item) => item.operation === draftOperation);
    const filtered = useMemo(
        () =>
            templates.filter((template) => {
                const definition = definitionByOperation.get(template.operation);
                const normalizedKeyword = keyword.trim().toLowerCase();
                if (normalizedKeyword && !`${template.name} ${template.content} ${definition?.label || ""}`.toLowerCase().includes(normalizedKeyword)) return false;
                if (operationFilter !== "all" && template.operation !== operationFilter) return false;
                if (status === "enabled" && !template.enabled) return false;
                if (status === "disabled" && template.enabled) return false;
                return true;
            }),
        [definitionByOperation, keyword, operationFilter, status, templates],
    );
    const paginatedTemplates = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);

    const activeTemplateFor = (operation: string) => templates.find((template) => template.operation === operation && template.enabled);

    const loadDraftBaseline = (operation: string, template?: PromptTemplate) => {
        const source = template || activeTemplateFor(operation);
        const baseline = {
            operation,
            name: source ? t("admin:param-new-version", { name: localizePromptTemplateName(source, definitionByOperation.get(operation)?.label, t) }) : "",
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
            message.warning(t("admin:enter-prompt-template-content"));
            return;
        }
        setSaving(true);
        try {
            await createAdminPromptTemplate({ operation: draftOperation, name: values.name.trim(), content: editorContent, enabled: values.enabled === true });
            setDraftBaseline(null);
            setDrawerOpen(false);
            await reload();
            message.success(t("admin:new-prompt-version-created"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-save-prompt-template"));
        } finally {
            setSaving(false);
        }
    };

    const activate = async (template: PromptTemplate) => {
        try {
            await updateAdminPromptTemplate(template.id, { operation: template.operation, name: template.name, content: template.content, enabled: true });
            await reload();
            message.success(t("admin:prompt-version-enabled"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-enable-prompt-version"));
        }
    };

    const remove = async (template: PromptTemplate) => {
        try {
            await deleteAdminPromptTemplate(template.id);
            await reload();
            message.success(t("admin:prompt-version-deleted"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("admin:failed-to-delete-prompt-version"));
        }
    };

    const columns: ColumnsType<PromptTemplate> = [
        {
            title: t("admin:template-type"),
            dataIndex: "operation",
            width: 180,
            render: (operation: string) => {
                const definition = definitionByOperation.get(operation);
                const fallback = promptDefinitionLocaleKeys[operation];
                return (
                    <div>
                        <div className="font-medium">{definition?.label || (fallback ? t(`admin:${fallback.label}`) : operation)}</div>
                        <div className="mt-1 text-xs text-foreground/45">{definition?.category || (fallback ? t(`admin:${fallback.category}`) : "--")}</div>
                    </div>
                );
            },
        },
        {
            title: t("admin:version"),
            dataIndex: "name",
            render: (_, template) => (
                <div>
                    <div className="font-medium">
                        {localizePromptTemplateName(template, definitionByOperation.get(template.operation)?.label || (promptDefinitionLocaleKeys[template.operation] ? t(`admin:${promptDefinitionLocaleKeys[template.operation].label}`) : undefined), t)}
                    </div>
                    <div className="mt-1 text-xs text-foreground/45">
                        v{template.version} · {template.content.length} {t("admin:characters")}
                    </div>
                </div>
            ),
        },
        {
            title: t("admin:output-2"),
            dataIndex: "outputType",
            width: 120,
            render: (outputType: string, template) => (
                <span className="inline-flex items-center gap-1.5 text-xs text-foreground/65">
                    {outputType === "json" ? <FileJson className="size-3.5" /> : <FileText className="size-3.5" />}
                    {outputType === "json" ? definitionByOperation.get(template.operation)?.schemaKey || "JSON" : t("admin:text")}
                </span>
            ),
        },
        { title: t("admin:status"), dataIndex: "enabled", width: 100, render: (enabled) => <AdminStatusBadge label={enabled ? t("admin:enabled-4") : t("admin:history")} tone={enabled ? "success" : "neutral"} /> },
        { title: t("admin:updated-at"), dataIndex: "updatedAt", width: 180, render: formatTime },
        {
            title: t("admin:actions"),
            width: 230,
            align: "right",
            render: (_, template) => (
                <AdminRowActions
                    primary={{ label: t("admin:new-from-this-version"), icon: <Copy className="size-3.5" />, onClick: () => openDrawer(template) }}
                    actions={[
                        {
                            key: "activate",
                            label: t("admin:enable-version"),
                            icon: <Power className="size-3.5" />,
                            disabled: template.enabled,
                            confirm: { title: t("admin:enable-this-prompt-version"), description: t("admin:only-replaces-the-current-version-of-the-same-type-other-template-types"), okText: t("admin:confirm-enable") },
                            onClick: () => activate(template),
                        },
                        {
                            key: "delete",
                            label: t("admin:delete-version"),
                            icon: <Trash2 className="size-3.5" />,
                            danger: true,
                            disabled: template.enabled,
                            confirm: { title: t("admin:delete-this-history-version"), description: t("admin:deletion-is-permanent-the-enabled-version-cannot-be-deleted"), okText: t("admin:confirm-delete") },
                            onClick: () => remove(template),
                        },
                    ]}
                />
            ),
        },
    ];

    return (
        <AdminPageFrame
            title={t("admin:prompt-templates")}
            description={t("admin:platform-creation-policies-and-versioning")}
            actions={
                <Button type="primary" icon={<Plus className="size-4" />} disabled={!definitions.length} onClick={() => openDrawer()}>
                    {t("admin:new-version")}
                </Button>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        allowClear
                        className="app-list-search"
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={keyword}
                        placeholder={t("admin:search-templates-or-content")}
                        onChange={(event) => updateUrl({ filter: event.target.value })}
                    />
                }
                toolbarActiveFilters={
                    <>
                        {keyword ? <AdminFilterChip label={t("admin:search-param", { keyword: keyword })} onRemove={() => updateUrl({ filter: "" })} /> : null}
                        {operationFilter !== "all" ? <AdminFilterChip label={`类型：${definitions.find((item) => item.operation === operationFilter)?.label || operationFilter}`} onRemove={() => updateUrl({ operation: "all" })} /> : null}
                        {status !== "all" ? <AdminFilterChip label={`状态：${status === "enabled" ? t("admin:enabled-4") : t("admin:history-versions")}`} onRemove={() => updateUrl({ status: "all" })} /> : null}
                    </>
                }
                toolbarActive={hasFilters}
                toolbarFilters={
                    <>
                        <Select
                            className="w-40"
                            value={operationFilter}
                            onChange={(value) => updateUrl({ operation: value })}
                            options={[{ label: t("admin:all-types"), value: "all" }, ...localizedDefinitions.map((item) => ({ label: item.label, value: item.operation }))]}
                        />
                        <Select
                            className="w-32"
                            value={status}
                            onChange={(value) => updateUrl({ status: value })}
                            options={[
                                { label: t("admin:all-statuses"), value: "all" },
                                { label: t("admin:enabled-4"), value: "enabled" },
                                { label: t("admin:history-versions"), value: "disabled" },
                            ]}
                        />
                    </>
                }
                onReset={() => updateUrl({ filter: "", operation: "all", status: "all" })}
                table={{
                    className: "app-data-table",
                    size: "small",
                    rowKey: "id",
                    loading,
                    pagination: false,
                    columns,
                    dataSource: paginatedTemplates,
                    scroll: { x: 1120 },
                    expandable: { expandedRowRender: (template) => <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-xs leading-5 text-foreground/75">{template.content}</pre> },
                }}
                empty={<AdminTableEmpty filtered={hasFilters} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={filtered.length}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />

            <Drawer
                title={baseTemplate ? t("admin:new-version-from-v-param", { version: baseTemplate.version }) : t("admin:new-prompt-version")}
                open={drawerOpen}
                size="min(1180px, 100vw)"
                onClose={closeDrawer}
                rootClassName="admin-drawer"
                closable={false}
                maskClosable={false}
                keyboard={false}
                destroyOnHidden
                styles={{ body: { padding: 0 } }}
                extra={
                    <div className="flex gap-2">
                        <Popconfirm
                            disabled={!dirty}
                            title={t("admin:discard-template-changes")}
                            description={t("admin:unsaved-new-version-content-will-be-lost")}
                            okText={t("admin:discard-changes")}
                            cancelText={t("admin:keep-editing-2")}
                            okButtonProps={{ danger: true }}
                            onConfirm={closeDrawer}
                        >
                            <Button
                                disabled={saving}
                                onClick={() => {
                                    if (!dirty) closeDrawer();
                                }}
                            >
                                {t("admin:close-4")}
                            </Button>
                        </Popconfirm>
                        <Button type="primary" loading={saving} disabled={!draftOperation || !draftName.trim() || !editorContent.trim()} onClick={() => void save()}>
                            {t("admin:save-version")}
                        </Button>
                    </div>
                }
            >
                <Form form={form} layout="vertical" requiredMark={false} className="flex min-h-full flex-col">
                    <div className="grid shrink-0 gap-4 border-b border-border p-4 md:grid-cols-3">
                        <Form.Item label={t("admin:template-type")} className="mb-0">
                            <Select value={draftOperation} disabled={Boolean(baseTemplate)} options={localizedDefinitions.map((item) => ({ label: `${item.category} · ${item.label}`, value: item.operation }))} onChange={switchOperation} />
                        </Form.Item>
                        <Form.Item name="name" label={t("admin:version-name")} className="mb-0" rules={[{ required: true, whitespace: true, message: t("admin:enter-a-version-name") }]}>
                            <Input placeholder={t("admin:e-g-light-comedy-storyboard-policy-v2")} />
                        </Form.Item>
                        <Form.Item name="enabled" label={t("admin:status-after-save")} className="mb-0">
                            <Select
                                options={[
                                    { label: t("admin:save-as-history-version"), value: false },
                                    { label: t("admin:save-and-set-as-enabled-version"), value: true },
                                ]}
                            />
                        </Form.Item>
                    </div>

                    {pendingOperation ? (
                        <Alert
                            type="warning"
                            showIcon
                            title={t("admin:current-version-has-unsaved-changes")}
                            description={`切换到“${definitionByOperation.get(pendingOperation)?.label || pendingOperation}”会丢弃当前草稿。`}
                            action={
                                <div className="flex gap-2">
                                    <Button size="small" onClick={() => setPendingOperation("")}>
                                        {t("admin:keep-editing-2")}
                                    </Button>
                                    <Button size="small" danger onClick={() => loadDraftBaseline(pendingOperation)}>
                                        {t("admin:discard-and-switch")}
                                    </Button>
                                </div>
                            }
                        />
                    ) : null}

                    <div className="grid min-h-0 flex-1 gap-0 lg:grid-cols-3">
                        <section className="flex min-h-0 flex-col border-b border-border p-4 lg:col-span-2 lg:border-b-0 lg:border-r">
                            <div className="mb-3 flex shrink-0 flex-wrap items-start justify-between gap-3">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="text-sm font-semibold">{t("admin:template-content")}</h3>
                                    {dirty ? (
                                        <Tag variant="filled" color="warning">
                                            {t("admin:unsaved")}
                                        </Tag>
                                    ) : null}
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {selectedDefinition?.variables.map((variable) => (
                                        <Button key={variable.placeholder} size="small" icon={<Braces className="size-3.5" />} onClick={() => editorRef.current?.insertText(variable.placeholder)}>
                                            {t("admin:insert")}
                                            {variable.label}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                            <div className="min-h-96 flex-1 overflow-hidden rounded-md border border-border">
                                <PromptCodeEditor ref={editorRef} value={editorContent} ariaLabel={t("admin:prompt-template-content")} onChange={setEditorContent} />
                            </div>
                        </section>

                        <aside className="min-h-0 p-4">
                            <Tabs
                                size="small"
                                items={[
                                    {
                                        key: "contract",
                                        label: t("admin:output-contract"),
                                        children: (
                                            <div>
                                                <div className="mb-3 flex items-center gap-2 text-xs font-medium">
                                                    <ShieldCheck className="size-4" />
                                                    {t("admin:server-read-only")}
                                                </div>
                                                <pre className="thin-scrollbar max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-6 text-foreground/65">{selectedDefinition?.outputContract || t("admin:select-a-template-type")}</pre>
                                            </div>
                                        ),
                                    },
                                    {
                                        key: "preview",
                                        label: t("admin:final-structure"),
                                        children: (
                                            <div className="space-y-4 text-xs leading-6">
                                                <section>
                                                    <div className="mb-2 font-medium text-foreground/80">{t("admin:editable-creation-policy")}</div>
                                                    <pre className="thin-scrollbar max-h-64 overflow-auto whitespace-pre-wrap text-foreground/65">{editorContent || t("admin:not-filled-in-yet")}</pre>
                                                </section>
                                                <section className="border-t border-border pt-4">
                                                    <div className="mb-2 font-medium text-foreground/80">{t("admin:force-appended-at-runtime")}</div>
                                                    <p className="text-foreground/55">{t("admin:dynamic-project-context-user-preferences-and-protected-output-contract")}</p>
                                                </section>
                                            </div>
                                        ),
                                    },
                                ]}
                            />
                        </aside>
                    </div>
                </Form>
            </Drawer>
        </AdminPageFrame>
    );
}

function formatTime(value?: string) {
    return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "--";
}

function localizePromptTemplateName(template: PromptTemplate, label: string | undefined, translate: TFunction) {
    const isBackendDefaultName = template.name === "内置默认" || template.name.startsWith("默认");
    if (isBackendDefaultName) {
        return translate("admin:default-template-name", { label: label || template.name.replace(/^默认/, "").replace(/模板$/, "") });
    }
    return template.name;
}
