import { App, Button, Form, Input, InputNumber, Radio, Select, Space, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, RefreshCw, Search, Trash2, Upload, Wrench } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SUB_TAB_TAGS, toAbsoluteUrl } from "@/lib/canvas/canvas-tool-presentation";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { AppModal } from "@/components/ui/product/app-modal";
import {
    createAdminTool,
    deleteAdminTool,
    editAdminTool,
    getAdminTool,
    listAdminTools,
    updateAdminTool,
    type AdminToolMutationInput,
    type AdminToolUpdateInput,
    type ToolItem,
    type ToolSource,
    type ToolSummary,
    type ToolType,
    type ToolVisibility,
} from "@/services/api/tools";
import { Switch } from "@/pages/admin/ui/controls";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminDataTable, AdminStatusBadge, AdminTableEmpty, PaginationBar } from "../components/admin-ui";

// 与画布工具面板保持一致的类型/来源/可见性文案。
const TOOL_TYPE_LABELS: Record<string, string> = {
    style: "风格",
    motion: "运镜",
    nine_grid: "九宫格",
    effect: "特效",
};

const SOURCE_LABELS: Record<string, string> = {
    builtin: "内置",
    user: "用户",
};

// 悬停播放预览视频的工具类型：运镜、特效，与画布工具面板保持一致。
const HOVER_VIDEO_TYPES = new Set(["motion", "effect"]);

type ToolEditorMode = "create" | "edit";

type ToolFormValues = {
    type: ToolType | string;
    source?: ToolSource | string;
    label: string;
    tag?: string;
    visibility: ToolVisibility;
    desc?: string;
    prompt: string;
    cover?: string;
    mediaUrl?: string;
    ratio?: string;
    enabled: boolean;
    sortWeight: number;
};

type ToolTypeFilter = "all" | ToolType;
type SourceFilter = "all" | "builtin" | "user";
type EnabledFilter = "all" | "enabled" | "disabled";

function typeLabel(type: string) {
    return TOOL_TYPE_LABELS[type] || type || "未知";
}

export default function AdminToolsPage() {
    const { message, modal } = App.useApp();
    const queryClient = useQueryClient();
    const [search, setSearch] = useState("");
    const [typeFilter, setTypeFilter] = useState<ToolTypeFilter>("all");
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
    const [enabledFilter, setEnabledFilter] = useState<EnabledFilter>("all");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorMode, setEditorMode] = useState<ToolEditorMode>("create");
    const [editingId, setEditingId] = useState<number | null>(null);

    const enabledParam = enabledFilter === "all" ? undefined : enabledFilter === "enabled";

    const listQuery = useQuery({
        queryKey: ["admin-tools", page, pageSize, typeFilter, sourceFilter, enabledParam, search.trim()],
        queryFn: ({ signal }) =>
            listAdminTools(
                {
                    page,
                    pageSize,
                    type: typeFilter === "all" ? undefined : typeFilter,
                    source: sourceFilter === "all" ? undefined : sourceFilter,
                    enabled: enabledParam,
                    search: search.trim() || undefined,
                },
                { signal },
            ),
    });

    const tools = listQuery.data?.tools ?? [];
    const totalCount = listQuery.data?.totalCount ?? 0;

    const updateMutation = useMutation({
        mutationFn: ({ id, input }: { id: number; input: AdminToolUpdateInput }) => updateAdminTool(id, input),
        onSuccess: () => {
            message.success("已更新");
            void queryClient.invalidateQueries({ queryKey: ["admin-tools"] });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "更新工具失败"),
    });

    const deleteMutation = useMutation({
        mutationFn: deleteAdminTool,
        onSuccess: () => {
            message.success("工具已删除");
            void queryClient.invalidateQueries({ queryKey: ["admin-tools"] });
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "删除工具失败"),
    });

    const save = (id: number, input: AdminToolUpdateInput) => updateMutation.mutate({ id, input });

    const confirmDelete = (tool: ToolSummary) => {
        modal.confirm({
            title: `删除“${tool.label}”？`,
            content: "删除后不可恢复，该工具的收藏记录也会一同移除。",
            okText: "删除",
            cancelText: "取消",
            okButtonProps: { danger: true },
            onOk: () => deleteMutation.mutateAsync(tool.id),
        });
    };

    const openCreate = () => {
        setEditorMode("create");
        setEditingId(null);
        setEditorOpen(true);
    };

    const openEdit = (tool: ToolSummary) => {
        setEditorMode("edit");
        setEditingId(tool.id);
        setEditorOpen(true);
    };

    const hasFilters = Boolean(search.trim() || typeFilter !== "all" || sourceFilter !== "all" || enabledFilter !== "all");

    const columns: ColumnsType<ToolSummary> = [
        {
            title: "工具",
            key: "tool",
            width: 380,
            render: (_, tool) => <ToolNameCell tool={tool} />,
        },
        {
            title: "类型",
            key: "type",
            width: 100,
            align: "center",
            render: (_, tool) => <AdminStatusBadge label={typeLabel(tool.type)} tone="info" />,
        },
        {
            title: "来源",
            key: "source",
            width: 100,
            align: "center",
            render: (_, tool) => <AdminStatusBadge label={SOURCE_LABELS[tool.source] || tool.source || "未知"} tone={tool.source === "builtin" ? "neutral" : "warning"} />,
        },
        {
            title: "可见性",
            key: "visibility",
            width: 130,
            align: "center",
            render: (_, tool) => (
                <Select
                    size="small"
                    value={tool.visibility}
                    className="w-24"
                    aria-label={`${tool.label} 可见性`}
                    onChange={(value) => save(tool.id, { visibility: value as ToolVisibility })}
                    options={[
                        { value: "public", label: "公开" },
                        { value: "private", label: "私有" },
                    ]}
                />
            ),
        },
        {
            title: "排序权重",
            key: "sortWeight",
            width: 120,
            align: "center",
            render: (_, tool) => <SortWeightInput tool={tool} saving={updateMutation.isPending} onSave={save} />,
        },
        {
            title: "启用",
            key: "enabled",
            width: 120,
            align: "center",
            render: (_, tool) => (
                <div className="flex items-center justify-center gap-2">
                    <AdminStatusBadge label={tool.enabled ? "已启用" : "已禁用"} tone={tool.enabled ? "success" : "neutral"} />
                    <Switch checked={tool.enabled} loading={updateMutation.isPending} aria-label={`${tool.label}，当前${tool.enabled ? "已启用，点击禁用" : "已禁用，点击启用"}`} onChange={(checked) => save(tool.id, { enabled: checked })} />
                </div>
            ),
        },
        {
            title: "操作",
            key: "actions",
            width: 96,
            align: "center",
            render: (_, tool) => (
                <Space size={0}>
                    <Button type="text" size="small" aria-label={`编辑 ${tool.label}`} icon={<Pencil className="size-3.5" aria-hidden="true" />} onClick={() => openEdit(tool)} />
                    {tool.source === "builtin" ? (
                        <Tooltip title="内置工具不可删除">
                            <Button danger type="text" size="small" disabled aria-label={`删除 ${tool.label}`} icon={<Trash2 className="size-3.5" aria-hidden="true" />} />
                        </Tooltip>
                    ) : (
                        <Button danger type="text" size="small" aria-label={`删除 ${tool.label}`} icon={<Trash2 className="size-3.5" aria-hidden="true" />} onClick={() => confirmDelete(tool)} />
                    )}
                </Space>
            ),
        },
    ];

    return (
        <AdminPageFrame
            title="工具管理"
            description="画布工具的启用、可见性与排序权重"
            actions={
                <Space>
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        新建工具
                    </Button>
                    <Button icon={<RefreshCw className="size-4" />} loading={listQuery.isFetching} onClick={() => void listQuery.refetch()}>
                        刷新
                    </Button>
                </Space>
            }
        >
            <AdminDataTable
                toolbar={
                    <Input
                        className="app-list-search"
                        allowClear
                        prefix={<Search className="size-4 text-foreground/40" />}
                        value={search}
                        aria-label="搜索工具"
                        placeholder="搜索名称、英文名或描述"
                        onChange={(event) => {
                            setSearch(event.target.value);
                            setPage(1);
                        }}
                    />
                }
                toolbarFilters={
                    <>
                        <Select
                            aria-label="筛选工具类型"
                            className="w-32"
                            value={typeFilter}
                            onChange={(value) => {
                                setTypeFilter(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "全部类型" },
                                { value: "style", label: "风格" },
                                { value: "motion", label: "运镜" },
                                { value: "nine_grid", label: "九宫格" },
                                { value: "effect", label: "特效" },
                            ]}
                        />
                        <Select
                            aria-label="筛选来源"
                            className="w-28"
                            value={sourceFilter}
                            onChange={(value) => {
                                setSourceFilter(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "全部来源" },
                                { value: "builtin", label: "内置" },
                                { value: "user", label: "用户" },
                            ]}
                        />
                        <Select
                            aria-label="筛选启用状态"
                            className="w-32"
                            value={enabledFilter}
                            onChange={(value) => {
                                setEnabledFilter(value);
                                setPage(1);
                            }}
                            options={[
                                { value: "all", label: "全部状态" },
                                { value: "enabled", label: "已启用" },
                                { value: "disabled", label: "已禁用" },
                            ]}
                        />
                    </>
                }
                toolbarActive={hasFilters}
                onReset={() => {
                    setSearch("");
                    setTypeFilter("all");
                    setSourceFilter("all");
                    setEnabledFilter("all");
                    setPage(1);
                }}
                skeletonColumns={7}
                table={{ className: "app-data-table", size: "small", sticky: true, rowKey: (item) => item.id, loading: listQuery.isLoading, columns, dataSource: tools, pagination: false, scroll: { x: 1120 } }}
                empty={<AdminTableEmpty filtered={hasFilters} title={hasFilters ? undefined : "还没有可管理的工具"} />}
                footer={
                    <PaginationBar
                        alwaysShow
                        current={page}
                        pageSize={pageSize}
                        total={totalCount}
                        onChange={(nextPage, nextPageSize) => {
                            setPage(nextPageSize !== pageSize ? 1 : nextPage);
                            setPageSize(nextPageSize);
                        }}
                    />
                }
            />
            <ToolEditorModal open={editorOpen} mode={editorMode} toolId={editingId ?? undefined} onClose={() => setEditorOpen(false)} onSaved={() => void queryClient.invalidateQueries({ queryKey: ["admin-tools"] })} />
        </AdminPageFrame>
    );
}

function ToolNameCell({ tool }: { tool: ToolSummary }) {
    const [failed, setFailed] = useState(false);
    const coverUrl = toAbsoluteUrl(tool.cover);

    useEffect(() => {
        setFailed(false);
    }, [tool.cover]);

    return (
        <div className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center overflow-hidden rounded-lg border border-border/40 bg-muted">
                {coverUrl && !failed ? (
                    <img src={coverUrl} alt="" loading="lazy" decoding="async" className="size-full object-cover" onError={() => setFailed(true)} />
                ) : (
                    <Wrench className="size-4 text-foreground/40" aria-hidden="true" />
                )}
            </span>
            <div className="min-w-0">
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="truncate font-medium text-foreground">{tool.label || "未命名"}</span>
                    {tool.labelEn && tool.labelEn !== tool.label ? <span className="shrink-0 font-mono text-[11px] text-foreground/42">{tool.labelEn}</span> : null}
                </div>
                <div className="mt-0.5 truncate text-xs text-foreground/52" title={tool.desc || undefined}>
                    {tool.desc || "-"}
                </div>
            </div>
        </div>
    );
}

function SortWeightInput({ tool, saving, onSave }: { tool: ToolSummary; saving: boolean; onSave: (id: number, input: AdminToolUpdateInput) => void }) {
    const [value, setValue] = useState<number | null>(tool.sortWeight);

    useEffect(() => {
        setValue(tool.sortWeight);
    }, [tool.sortWeight]);

    const commit = () => {
        if (value !== null && value !== tool.sortWeight) {
            onSave(tool.id, { sortWeight: value });
        }
    };

    return (
        <InputNumber
            size="small"
            min={0}
            disabled={saving}
            value={value}
            className="w-20"
            aria-label={`${tool.label} 排序权重`}
            onChange={(next) => setValue(next)}
            onBlur={commit}
            onPressEnter={commit}
        />
    );
}

function mapToolItemToFormValues(item: ToolItem): ToolFormValues {
    return {
        type: item.type,
        source: item.source,
        label: item.label,
        tag: item.tag || undefined,
        visibility: (item.visibility as ToolVisibility) || "private",
        desc: item.desc || undefined,
        prompt: item.prompt,
        cover: item.cover || undefined,
        mediaUrl: item.mediaUrl || undefined,
        ratio: item.ratio || undefined,
        enabled: item.enabled,
        sortWeight: item.sortWeight,
    };
}

function ToolEditorModal({ open, mode, toolId, onClose, onSaved }: { open: boolean; mode: ToolEditorMode; toolId?: number; onClose: () => void; onSaved: () => void }) {
    const { message } = App.useApp();
    const [form] = Form.useForm<ToolFormValues>();
    const [coverUploading, setCoverUploading] = useState(false);
    const [mediaUploading, setMediaUploading] = useState(false);
    const coverInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const watchedType = Form.useWatch("type", form);
    const tagOptions =
        watchedType === "style"
            ? SUB_TAB_TAGS.style.map((tag) => ({ value: tag.id, label: tag.label }))
            : watchedType === "motion"
                ? SUB_TAB_TAGS.motion.map((tag) => ({ value: tag.id, label: tag.label }))
                : [];

    const detailQuery = useQuery({
        queryKey: ["admin-tool", toolId],
        queryFn: ({ signal }) => getAdminTool(toolId!, { signal }),
        enabled: mode === "edit" && toolId != null,
    });

    useEffect(() => {
        if (!open) return;
        form.resetFields();
        if (mode === "create") {
            form.setFieldsValue({ type: "style", source: "user", visibility: "private", enabled: true, sortWeight: 0 });
        } else if (detailQuery.data) {
            form.setFieldsValue(mapToolItemToFormValues(detailQuery.data));
        }
    }, [open, mode, detailQuery.data, form]);

    // 上传成功才回填表单；本地降级（pendingRemoteUpload）拿到的是页面级 objectURL，刷新即失效，不能写进工具数据。
    async function handleCoverUpload(file: File) {
        setCoverUploading(true);
        try {
            const image = await uploadImage(file);
            if (image.pendingRemoteUpload) throw new Error(image.remoteUploadError || "图片暂存本机，尚未上传到云端，请稍后重试");
            form.setFieldValue("cover", toAbsoluteUrl(image.url));
            message.success("封面已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "封面上传失败");
        } finally {
            setCoverUploading(false);
        }
    }

    async function handleMediaUpload(file: File) {
        setMediaUploading(true);
        try {
            const uploaded = await uploadMediaFile(file, "video");
            if (uploaded.pendingRemoteUpload) throw new Error(uploaded.remoteUploadError || "视频暂存本机，尚未上传到云端，请稍后重试");
            form.setFieldValue("mediaUrl", toAbsoluteUrl(uploaded.url));
            message.success("演示视频已上传");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "视频上传失败");
        } finally {
            setMediaUploading(false);
        }
    }

    const saveMutation = useMutation({
        mutationFn: async (values: ToolFormValues) => {
            const payload: AdminToolMutationInput = {
                type: values.type,
                label: values.label.trim(),
                desc: values.desc?.trim() || undefined,
                tag: values.tag?.trim() || undefined,
                cover: values.cover?.trim() || undefined,
                prompt: values.prompt.trim(),
                ratio: values.ratio?.trim() || undefined,
                mediaUrl: values.mediaUrl?.trim() || undefined,
                visibility: values.visibility,
                enabled: values.enabled,
                sortWeight: values.sortWeight,
            };
            if (mode === "edit" && toolId != null) {
                return editAdminTool(toolId, payload);
            }
            return createAdminTool({ ...payload, source: (values.source as ToolSource) || "user" });
        },
        onSuccess: () => {
            message.success(mode === "edit" ? "工具已保存" : "工具已创建");
            onSaved();
            onClose();
        },
        onError: (error) => message.error(error instanceof Error ? error.message : "保存工具失败"),
    });

    const isEdit = mode === "edit";
    const detailReady = !isEdit || Boolean(detailQuery.data);
    const showMediaUrl = HOVER_VIDEO_TYPES.has(watchedType as string);

    return (
        <AppModal
            open={open}
            title={isEdit ? "编辑工具" : "新建工具"}
            okText={isEdit ? "保存" : "创建"}
            cancelText="取消"
            confirmLoading={saveMutation.isPending}
            okButtonProps={{ disabled: !detailReady }}
            onCancel={onClose}
            onOk={() => form.submit()}
            afterClose={() => form.resetFields()}
        >
            <Form<ToolFormValues> form={form} layout="vertical" requiredMark={false} onFinish={(values) => saveMutation.mutate(values)} className="max-h-[72vh] overflow-y-auto p-6 px-8">
                {isEdit && detailQuery.isLoading ? (
                    <div className="grid place-items-center py-12 text-foreground/50">加载中…</div>
                ) : isEdit && detailQuery.isError ? (
                    <div className="grid place-items-center py-12 text-foreground/50">{detailQuery.error instanceof Error ? detailQuery.error.message : "加载工具详情失败"}</div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 gap-3">
                            <Form.Item name="type" label="类型" rules={[{ required: true, message: "请选择工具类型" }]}>
                                <Select
                                    options={[
                                        { value: "style", label: "风格" },
                                        { value: "motion", label: "运镜" },
                                        { value: "nine_grid", label: "九宫格" },
                                        { value: "effect", label: "特效" },
                                    ]}
                                    onChange={() => form.setFieldValue("tag", undefined)}
                                />
                            </Form.Item>
                            <Form.Item name="tag" label="标签">
                                {tagOptions.length ? <Select allowClear showSearch options={tagOptions} placeholder="选择标签" /> : <Input maxLength={64} placeholder="可选" />}
                            </Form.Item>

                        </div>
                        <Form.Item name="label" label="名称" rules={[{ required: true, whitespace: true, message: "请输入工具名称" }, { max: 120 }]}>
                            <Input maxLength={120} showCount placeholder="例如：电影感胶片" />
                        </Form.Item>

                        <Form.Item name="desc" label="描述" rules={[{ max: 500 }]}>
                            <Input maxLength={500} showCount />
                        </Form.Item>
                        <Form.Item name="prompt" label="提示词" rules={[{ required: true, whitespace: true, message: "请输入提示词" }, { max: 8000 }]}>
                            <Input.TextArea rows={5} maxLength={8000} showCount placeholder="该工具应用到生成节点时使用的提示词" />
                        </Form.Item>
                        <Form.Item label="封面图">
                            <Space.Compact block>
                                <Form.Item name="cover" noStyle className="flex-1 min-w-0" rules={[{ type: "url", message: "请输入合法 URL" }]}>
                                    <Input placeholder="上传图片或粘贴 URL" allowClear disabled={coverUploading} />
                                </Form.Item>
                                <Button icon={<Upload className="size-3.5" />} loading={coverUploading} onClick={() => coverInputRef.current?.click()}>
                                    上传
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        {showMediaUrl ? (
                            <Form.Item label="演示视频">
                                <Space.Compact block>
                                    <Form.Item name="mediaUrl" noStyle className="flex-1 min-w-0" rules={[{ type: "url", message: "请输入合法 URL" }]}>
                                        <Input placeholder="上传视频或粘贴 URL" allowClear disabled={mediaUploading} />
                                    </Form.Item>
                                    <Button icon={<Upload className="size-3.5" />} loading={mediaUploading} onClick={() => mediaInputRef.current?.click()}>
                                        上传
                                    </Button>
                                </Space.Compact>
                            </Form.Item>
                        ) : null}
                        <div className="grid grid-cols-4 gap-1">
                            <Form.Item name="enabled" label="启用" valuePropName="checked">
                                <Switch />
                            </Form.Item>
                            <Form.Item name="visibility" label="可见性">
                                <Radio.Group
                                    optionType="button"
                                    buttonStyle="solid"
                                    options={[
                                        { label: "私有", value: "private" },
                                        { label: "公开", value: "public" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="source" label="来源" rules={[{ required: true, message: "请选择工具来源" }]}>
                                <Radio.Group
                                    optionType="button"
                                    buttonStyle="solid"
                                    options={[
                                        { label: "用户", value: "user" },
                                        { label: "内置", value: "builtin" },
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item name="sortWeight" label="排序权重">
                                <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                        </div>
                        <input
                            ref={coverInputRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(event) => {
                                const file = event.target.files?.[0];
                                event.target.value = "";
                                if (file) void handleCoverUpload(file);
                            }}
                        />
                        {showMediaUrl ? (
                            <input
                                ref={mediaInputRef}
                                type="file"
                                accept="video/*"
                                style={{ display: "none" }}
                                onChange={(event) => {
                                    const file = event.target.files?.[0];
                                    event.target.value = "";
                                    if (file) void handleMediaUpload(file);
                                }}
                            />
                        ) : null}
                    </>
                )}
            </Form>
        </AppModal>
    );
}
