import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Input, Popconfirm, Tag, Tooltip } from "antd";
import { ArrowDownToLine, Clapperboard, Download, Image as ImageIcon, LayoutTemplate, Search, ShoppingBag, Sparkles, Trash2, Upload, Video, Workflow } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { AppModal } from "@/components/ui/product/app-modal";
import { canvasTemplateCategoryLabel, canvasTemplateDocumentForExport, canvasTemplateFromDocument, CANVAS_BUILTIN_TEMPLATES, type CanvasTemplate, type CanvasTemplateCategory } from "@/lib/canvas/canvas-templates";
import { canvasThemes } from "@/lib/canvas-theme";
import { createCanvasTemplate, deleteCanvasTemplate, listCanvasTemplates, type SaveCanvasTemplateInput } from "@/services/api/canvas-templates";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType } from "@/types/canvas";

type CanvasTemplateLibraryModalProps = {
    open: boolean;
    mode: "insert" | "create";
    onClose: () => void;
    onApply: (template: CanvasTemplate) => void | Promise<void>;
};

const CATEGORY_OPTIONS: Array<{ key: "all" | CanvasTemplateCategory; label: string }> = [
    { key: "all", label: "全部" },
    { key: "image", label: "图片" },
    { key: "video", label: "视频" },
    { key: "storyboard", label: "分镜" },
    { key: "commerce", label: "电商" },
];

function categoryIcon(category: CanvasTemplateCategory) {
    return category === "image" ? <ImageIcon className="size-4" /> : category === "video" ? <Video className="size-4" /> : category === "storyboard" ? <Clapperboard className="size-4" /> : <ShoppingBag className="size-4" />;
}

function nodeLabel(type: string) {
    return type === CanvasNodeType.Image ? "图片" : type === CanvasNodeType.Video ? "视频" : type === CanvasNodeType.Text ? "文字" : type;
}

export function CanvasTemplateLibraryModal({ open, mode, onClose, onApply }: CanvasTemplateLibraryModalProps) {
    const theme = canvasThemes[useActiveTheme()];
    const { message } = App.useApp();
    const userId = useUserStore((state) => state.user?.id);
    const sessionHydrated = useUserStore((state) => state.hydrated);
    const [query, setQuery] = useState("");
    const [category, setCategory] = useState<"all" | CanvasTemplateCategory>("all");
    const [selectedId, setSelectedId] = useState(CANVAS_BUILTIN_TEMPLATES[0]?.id || "");
    const [applying, setApplying] = useState(false);
    const importInputRef = useRef<HTMLInputElement>(null);
    const remoteQuery = useQuery({
        queryKey: ["canvas-templates", userId],
        queryFn: () => listCanvasTemplates({ page: 1, pageSize: 100 }),
        enabled: open && Boolean(userId) && sessionHydrated,
        staleTime: 60_000,
    });

    useEffect(() => {
        if (!open) return;
        setQuery("");
        setCategory("all");
        setSelectedId(CANVAS_BUILTIN_TEMPLATES[0]?.id || "");
        setApplying(false);
    }, [open]);

    useEffect(() => {
        if (!open || !userId || !sessionHydrated) return;
        void remoteQuery.refetch();
    }, [open, sessionHydrated, userId]);

    const allTemplates = useMemo(() => {
        const remote = (remoteQuery.data?.templates || []).flatMap((item) =>
            item.document ? [canvasTemplateFromDocument({ id: item.id, title: item.title, description: item.description, category: item.category, tags: item.tags, source: item.source, version: item.currentVersion, document: item.document })] : [],
        );
        return [...CANVAS_BUILTIN_TEMPLATES, ...remote];
    }, [remoteQuery.data?.templates]);
    const templates = useMemo(() => {
        const normalized = query.trim().toLowerCase();
        return allTemplates.filter((template) => {
            const matchesCategory = category === "all" || template.category === category;
            const haystack = `${template.title} ${template.description} ${template.tags.join(" ")}`.toLowerCase();
            return matchesCategory && (!normalized || haystack.includes(normalized));
        });
    }, [allTemplates, category, query]);
    const selectedTemplate = templates.find((template) => template.id === selectedId) || templates[0] || allTemplates[0];
    const preview = useMemo(() => selectedTemplate?.createGraph({ x: 0, y: 0 }), [selectedTemplate]);

    const apply = async () => {
        if (!selectedTemplate) return;
        setApplying(true);
        try {
            await onApply(selectedTemplate);
            onClose();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板应用失败");
        } finally {
            setApplying(false);
        }
    };

    const importJson = async (file?: File) => {
        if (!file) return;
        try {
            const parsed = JSON.parse(await file.text()) as Partial<SaveCanvasTemplateInput> & { document?: SaveCanvasTemplateInput["document"] };
            const document = parsed.document || (parsed as unknown as SaveCanvasTemplateInput["document"]);
            if (document?.schema !== "yingce.canvas-template" || document.schemaVersion !== 1 || !Array.isArray(document.nodes) || !Array.isArray(document.connections)) throw new Error("不是有效的影策模板 JSON");
            await createCanvasTemplate({
                title: String(parsed.title || file.name.replace(/\.json$/i, "") || "导入模板").slice(0, 160),
                description: String(parsed.description || "从 JSON 导入的画布工作流").slice(0, 500),
                category: String(parsed.category || "image").slice(0, 40),
                tags: Array.isArray(parsed.tags) ? parsed.tags.map(String).slice(0, 12) : ["导入"],
                document,
            });
            await remoteQuery.refetch();
            message.success("模板已导入到我的模板");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模板 JSON 导入失败");
        } finally {
            if (importInputRef.current) importInputRef.current.value = "";
        }
    };

    const exportJson = () => {
        if (!selectedTemplate) return;
        const templateDocument = canvasTemplateDocumentForExport(selectedTemplate);
        const payload = { title: selectedTemplate.title, description: selectedTemplate.description, category: selectedTemplate.category, tags: selectedTemplate.tags, document: templateDocument };
        const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${selectedTemplate.title.replace(/[\\/:*?"<>|]/g, "_")}.yingce-template.json`;
        anchor.click();
        URL.revokeObjectURL(url);
    };

    const removeUserTemplate = async (template: CanvasTemplate) => {
        if (!template.remoteId) return;
        try {
            await deleteCanvasTemplate(template.remoteId);
            await remoteQuery.refetch();
            if (selectedId === template.id) setSelectedId(CANVAS_BUILTIN_TEMPLATES[0]?.id || "");
            message.success("个人模板已删除");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除模板失败");
        }
    };

    return (
        <AppModal open={open} centered title={null} footer={null} width="min(1120px, calc(100vw - 24px))" destroyOnHidden flush onCancel={onClose} className="canvas-template-library-modal">
            <div className="flex min-h-[min(680px,calc(100vh-80px))] flex-col" style={{ background: theme.canvas.background, color: theme.node.text }}>
                <header className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: theme.toolbar.border }}>
                    <div className="flex min-w-0 items-center gap-3">
                        <span className="grid size-9 shrink-0 place-items-center rounded-xl" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                            <LayoutTemplate className="size-4" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="truncate text-base font-semibold">模板库</h2>
                            <p className="mt-0.5 text-xs" style={{ color: theme.node.muted }}>
                                {mode === "insert" ? "选择一个工作流插入当前画布" : "选择一个工作流创建自由画布"}
                            </p>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                        <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => void importJson(event.target.files?.[0])} />
                        <Button type="text" size="small" icon={<Upload className="size-3.5" />} onClick={() => importInputRef.current?.click()}>
                            导入 JSON
                        </Button>
                        <Button type="text" size="small" icon={<Download className="size-3.5" />} onClick={exportJson}>
                            导出 JSON
                        </Button>
                        <span className="hidden text-xs sm:inline" style={{ color: remoteQuery.isError ? theme.accent.danger : theme.node.muted }}>
                            {remoteQuery.isFetching ? "正在读取模板" : remoteQuery.isError ? "服务端模板读取失败" : `${allTemplates.length} 个模板`}
                        </span>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(360px,0.92fr)_minmax(440px,1.08fr)]">
                    <section className="min-h-0 border-b p-4 lg:border-b-0 lg:border-r" style={{ borderColor: theme.toolbar.border }}>
                        <div className="flex flex-col gap-2 sm:flex-row">
                            <Input value={query} allowClear prefix={<Search className="size-3.5" />} placeholder="搜索模板" aria-label="搜索模板" onChange={(event) => setQuery(event.target.value)} />
                            <div className="flex shrink-0 items-center gap-1 overflow-x-auto">
                                {CATEGORY_OPTIONS.map((option) => (
                                    <button
                                        key={option.key}
                                        type="button"
                                        aria-pressed={category === option.key}
                                        className="h-8 shrink-0 rounded-lg px-2.5 text-xs font-medium transition"
                                        style={{ background: category === option.key ? theme.accent.primarySoft : "transparent", color: category === option.key ? theme.accent.primary : theme.node.muted }}
                                        onClick={() => setCategory(option.key)}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="thin-scrollbar mt-4 max-h-[min(510px,calc(100vh-260px))] space-y-2 overflow-y-auto pr-1">
                            {templates.length ? (
                                templates.map((template) => {
                                    const active = template.id === selectedTemplate?.id;
                                    return (
                                        <div
                                            key={template.id}
                                            className="group flex w-full items-start gap-3 rounded-xl border p-3 text-left transition"
                                            style={{ borderColor: active ? theme.accent.primary : theme.toolbar.border, background: active ? theme.accent.primarySoft : "transparent" }}
                                        >
                                            <button type="button" aria-pressed={active} className="flex min-w-0 flex-1 items-start gap-3 text-left" onClick={() => setSelectedId(template.id)}>
                                                <span className="grid size-9 shrink-0 place-items-center rounded-lg" style={{ background: active ? theme.accent.primary : theme.node.panel, color: active ? "white" : theme.accent.primary }}>
                                                    {categoryIcon(template.category)}
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    <span className="flex items-center gap-2">
                                                        <span className="truncate text-sm font-semibold">{template.title}</span>
                                                        <span className="shrink-0 text-[var(--fs-micro)]" style={{ color: theme.node.muted }}>
                                                            {canvasTemplateCategoryLabel(template.category)}
                                                        </span>
                                                    </span>
                                                    <span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>
                                                        {template.description}
                                                    </span>
                                                    <span className="mt-2 flex flex-wrap gap-1">
                                                        {template.tags.map((tag) => (
                                                            <Tag key={tag} bordered={false} className="!m-0 !px-1.5 !py-0 !text-[10px]" style={{ background: theme.node.panel, color: theme.node.muted }}>
                                                                {tag}
                                                            </Tag>
                                                        ))}
                                                    </span>
                                                </span>
                                            </button>
                                            {template.source === "user" && template.remoteId ? (
                                                <Popconfirm title="删除这个个人模板？" description="删除后不能恢复。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={() => void removeUserTemplate(template)}>
                                                    <Tooltip title="删除个人模板">
                                                        <Button type="text" size="small" aria-label="删除个人模板" icon={<Trash2 className="size-3.5" />} />
                                                    </Tooltip>
                                                </Popconfirm>
                                            ) : null}
                                        </div>
                                    );
                                })
                            ) : (
                                <div className="py-16 text-center text-sm" style={{ color: theme.node.muted }}>
                                    没有匹配的模板
                                </div>
                            )}
                        </div>
                    </section>

                    <section className="flex min-h-0 flex-col p-5">
                        {selectedTemplate && preview ? (
                            <>
                                <div className="flex items-start justify-between gap-3">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <h3 className="text-lg font-semibold">{selectedTemplate.title}</h3>
                                            <Tag color={selectedTemplate.source === "published" ? "green" : selectedTemplate.source === "user" ? "gold" : "blue"}>
                                                {selectedTemplate.source === "published" ? "已发布" : selectedTemplate.source === "user" ? "我的模板" : "系统模板"}
                                            </Tag>
                                        </div>
                                        <p className="mt-1 text-sm" style={{ color: theme.node.muted }}>
                                            {selectedTemplate.description}
                                        </p>
                                    </div>
                                    <Sparkles className="mt-1 size-4 shrink-0" style={{ color: theme.accent.primary }} />
                                </div>

                                <div className="mt-5 min-h-[250px] flex-1 overflow-hidden rounded-2xl border p-5" style={{ borderColor: theme.toolbar.border, background: theme.node.panel }}>
                                    <div className="mb-4 flex items-center justify-between gap-2 text-xs" style={{ color: theme.node.muted }}>
                                        <span className="inline-flex items-center gap-1.5">
                                            <Workflow className="size-3.5" />
                                            工作流预览
                                        </span>
                                        <span>
                                            {preview.nodes.length} 个节点 · {preview.connections.length} 条连线
                                        </span>
                                    </div>
                                    <div className="flex min-h-[190px] flex-wrap items-center justify-center gap-3">
                                        {preview.nodes.map((node, index) => (
                                            <div key={node.id} className="flex items-center gap-3">
                                                <div className="flex min-w-[110px] flex-col items-center gap-2 rounded-xl border px-3 py-3 text-center" style={{ borderColor: theme.toolbar.border, background: theme.canvas.background }}>
                                                    <span className="grid size-8 place-items-center rounded-lg" style={{ background: theme.accent.primarySoft, color: theme.accent.primary }}>
                                                        {node.type === CanvasNodeType.Image ? <ImageIcon className="size-4" /> : node.type === CanvasNodeType.Video ? <Video className="size-4" /> : <Clapperboard className="size-4" />}
                                                    </span>
                                                    <span className="max-w-[120px] truncate text-xs font-medium">{node.title}</span>
                                                    <span className="text-[10px]" style={{ color: theme.node.muted }}>
                                                        {nodeLabel(node.type)}
                                                    </span>
                                                </div>
                                                {index < preview.nodes.length - 1 ? (
                                                    <span className="text-lg" style={{ color: theme.node.muted }} aria-hidden>
                                                        →
                                                    </span>
                                                ) : null}
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                                    <div className="text-xs" style={{ color: theme.node.muted }}>
                                        输出：{selectedTemplate.output} · 导入后可继续编辑
                                    </div>
                                    <Button type="primary" icon={<ArrowDownToLine className="size-4" />} loading={applying} onClick={() => void apply()}>
                                        {mode === "insert" ? "导入到当前画布" : "用此模板新建画布"}
                                    </Button>
                                </div>
                            </>
                        ) : (
                            <div className="grid flex-1 place-items-center text-sm" style={{ color: theme.node.muted }}>
                                选择一个模板查看预览
                            </div>
                        )}
                    </section>
                </div>
            </div>
        </AppModal>
    );
}
