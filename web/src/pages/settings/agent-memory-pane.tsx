import { App, Button, Form, Input, Select, Space } from "antd";
import { Check, Download, Pencil, Plus, Sparkles, Trash2, Upload, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { WorkspaceState } from "@/components/layout/workspace-state";
import { ModelPicker } from "@/components/model-picker";
import { StatusBadge } from "@/components/ui/base/badges";
import { IconButton } from "@/components/ui/base/buttons";
import { SegmentedControl } from "@/components/ui/base/segmented-control";
import { AppModal } from "@/components/ui/product/app-modal";
import { Callout } from "@/components/ui/product/callout";
import {
    agentMemoryCategoryLabel,
    AGENT_MEMORY_CATEGORIES,
    compactAgentMemories,
    createAgentMemory,
    decideAgentMemory,
    deleteAgentMemory,
    exportAgentMemories,
    getAgentMemorySettings,
    importAgentMemories,
    listAgentMemories,
    updateAgentMemory,
    updateAgentMemorySettings,
    type AgentMemory,
    type AgentMemoryBundle,
    type AgentMemoryCompactInterval,
    type AgentMemoryCompactView,
    type AgentMemoryRequest,
    type AgentMemoryStep,
} from "@/services/api/agent-memories";
import { encodeChannelModel, logicalModelIDForConfig, modelOptionName, resolveModelRequestConfig, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";

const COMPACT_INTERVALS: Array<{ value: AgentMemoryCompactInterval; label: string }> = [
    { value: "off", label: "手动" },
    { value: "daily", label: "每天" },
    { value: "weekly", label: "每周" },
    { value: "monthly", label: "每月" },
];

const STATUS_FILTERS = [
    { value: "all", label: "全部" },
    { value: "pending", label: "待审" },
    { value: "approved", label: "已批" },
    { value: "rejected", label: "已拒" },
] as const;

function memoryStatusTone(status: string) {
    if (status === "approved") return "success" as const;
    if (status === "rejected") return "error" as const;
    if (status === "pending") return "warning" as const;
    return "neutral" as const;
}

function memoryStatusLabel(status: string) {
    if (status === "approved") return "已批准";
    if (status === "rejected") return "已拒绝";
    if (status === "pending") return "待审";
    return status;
}

function compactModelFields(config: AiConfig, selectedModel: string) {
    const model = selectedModel.trim();
    if (!model) return {};
    const agentConfig = { ...config, model };
    const requestConfig = resolveModelRequestConfig(agentConfig, model);
    return {
        logicalModelId: logicalModelIDForConfig(agentConfig) || undefined,
        channelId: requestConfig.channelId || undefined,
        channelModelKey: modelOptionName(model) || undefined,
        model,
    };
}

function restoreCompactModel(settings: AgentMemoryCompactView | null, fallback: string) {
    if (settings?.model?.trim()) return settings.model.trim();
    if (settings?.channelId && settings?.channelModelKey) return encodeChannelModel(settings.channelId, settings.channelModelKey);
    return fallback;
}

function compactStatusLabel(settings: AgentMemoryCompactView | null) {
    if (!settings) return "";
    if (settings.lastStatus === "queued") return "已排队，等待文本模型压缩";
    if (settings.lastStatus === "running") return "正在调用文本模型压缩记忆";
    if (settings.lastStatus === "failed") return settings.lastError || "上次压缩失败";
    if (settings.lastStatus === "succeeded") {
        const summary = settings.summary;
        const parts = [
            summary?.merged ? `合并 ${summary.merged}` : "",
            summary?.rewritten ? `改写 ${summary.rewritten}` : "",
            summary?.removed ? `删除 ${summary.removed}` : "",
        ].filter(Boolean);
        const when = settings.lastCompactAt ? new Date(settings.lastCompactAt).toLocaleString() : "";
        return [when && `上次 ${when}`, parts.join(" · ") || "模型认为没有需要改动的条目"].filter(Boolean).join(" · ");
    }
    return "压缩会按你的文本模型计费，把相近记忆合并、把含糊条目改清楚。";
}

type MemoryFormValues = {
    topic: string;
    category: string;
    situation: string;
    lesson?: string;
    source?: string;
    steps?: AgentMemoryStep[];
};

function toRequest(values: MemoryFormValues): AgentMemoryRequest {
    const steps = (values.steps || []).filter((step) => step.tool?.trim() && step.action?.trim());
    return {
        topic: values.topic.trim(),
        category: values.category,
        situation: values.situation.trim(),
        lesson: values.lesson?.trim() || undefined,
        source: values.source?.trim() || undefined,
        steps: steps.length ? steps : undefined,
    };
}

function AgentMemoryCompactCard({ compact = false, onApplied }: { compact?: boolean; onApplied: () => Promise<void> }) {
    const { message } = App.useApp();
    const config = useEffectiveConfig();
    const [settings, setSettings] = useState<AgentMemoryCompactView | null>(null);
    const [model, setModel] = useState("");
    const [saving, setSaving] = useState(false);
    const [compacting, setCompacting] = useState(false);
    const seqRef = useRef(0);
    const busy = settings?.lastStatus === "queued" || settings?.lastStatus === "running";

    const loadSettings = useCallback(async () => {
        const seq = ++seqRef.current;
        try {
            const next = await getAgentMemorySettings();
            if (seq !== seqRef.current) return null;
            setSettings(next);
            setModel((current) => restoreCompactModel(next, current || config.textModel || ""));
            return next;
        } catch (error) {
            if (seq === seqRef.current) message.error(error instanceof Error ? error.message : "读取压缩设置失败");
            return null;
        }
    }, [config.textModel, message]);

    useEffect(() => {
        void loadSettings();
    }, [loadSettings]);

    useEffect(() => {
        if (!busy) return;
        const timer = window.setInterval(() => {
            void loadSettings().then((next) => {
                if (next?.lastStatus === "succeeded") void onApplied();
            });
        }, 3000);
        return () => window.clearInterval(timer);
    }, [busy, loadSettings, onApplied]);

    const persist = async (interval: AgentMemoryCompactInterval, selectedModel: string) => {
        setSaving(true);
        try {
            const next = await updateAgentMemorySettings({
                compactInterval: interval,
                ...compactModelFields(config, selectedModel),
            });
            setSettings(next);
            setModel(restoreCompactModel(next, selectedModel));
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存压缩设置失败");
        } finally {
            setSaving(false);
        }
    };

    const runCompact = async () => {
        const selected = model.trim();
        if (!selected) {
            message.warning("请先选择用于压缩的文本模型");
            return;
        }
        setCompacting(true);
        try {
            const next = await compactAgentMemories(compactModelFields(config, selected));
            setSettings(next);
            message.success("已提交压缩任务，完成后会刷新记忆列表");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "提交压缩失败");
        } finally {
            setCompacting(false);
        }
    };

    const statusText = compactStatusLabel(settings);
    const failed = settings?.lastStatus === "failed";

    return (
        <section className={compact ? "space-y-2.5" : "space-y-3 rounded-2xl bg-surface-secondary/80 px-4 py-3.5"}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-sm font-medium text-foreground">压缩优化</h3>
                    {compact ? null : <p className="mt-0.5 text-caption leading-5 text-muted-foreground">按文本模型计费，合并相近条目、改写含糊内容。</p>}
                </div>
                <Button size="small" icon={<Sparkles className="size-3.5" />} loading={compacting || busy} disabled={!model.trim()} onClick={() => void runCompact()}>
                    {busy ? "压缩中" : "立即压缩"}
                </Button>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
                <SegmentedControl
                    size="sm"
                    ariaLabel="压缩周期"
                    value={settings?.compactInterval || "off"}
                    disabled={saving || busy}
                    options={COMPACT_INTERVALS}
                    onChange={(value) => void persist(value, model)}
                />
                <div className="min-w-0 overflow-hidden rounded-xl bg-surface-tertiary">
                    <ModelPicker
                        config={config}
                        value={model}
                        capability="text"
                        variant="creation"
                        fullWidth
                        showSelectedPrice
                        showOptionPrices
                        className="!h-9 !min-h-9 !border-0 !bg-transparent !shadow-none"
                        placeholder="选择压缩用的文本模型"
                        onChange={(value) => {
                            setModel(value);
                            void persist(settings?.compactInterval || "off", value);
                        }}
                    />
                </div>
            </div>
            {failed && settings?.lastError ? (
                <Callout tone="warning" title="上次压缩未完成">{settings.lastError}</Callout>
            ) : statusText ? (
                <p className="text-caption leading-5 text-muted-foreground">{statusText}</p>
            ) : null}
        </section>
    );
}

export default function AgentMemoryPane({ compact = false }: { compact?: boolean }) {
    const { message, modal } = App.useApp();
    const [items, setItems] = useState<AgentMemory[]>([]);
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState<string>("all");
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editing, setEditing] = useState<AgentMemory | null>(null);
    const [saving, setSaving] = useState(false);
    const [form] = Form.useForm<MemoryFormValues>();
    const fileRef = useRef<HTMLInputElement>(null);
    const seqRef = useRef(0);

    const load = useCallback(async () => {
        const seq = ++seqRef.current;
        setLoading(true);
        try {
            const data = await listAgentMemories(status === "all" ? undefined : status, 200);
            if (seq !== seqRef.current) return;
            setItems(data.memories || []);
        } catch (error) {
            if (seq === seqRef.current) message.error(error instanceof Error ? error.message : "读取记忆失败");
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    }, [message, status]);

    useEffect(() => {
        void load();
    }, [load]);

    const openCreate = () => {
        setEditing(null);
        form.resetFields();
        form.setFieldsValue({ category: "other", steps: [] });
        setEditorOpen(true);
    };

    const openEdit = (record: AgentMemory) => {
        setEditing(record);
        form.setFieldsValue({
            topic: record.topic,
            category: record.category || "other",
            situation: record.situation,
            lesson: record.lesson,
            source: record.source,
            steps: record.steps || [],
        });
        setEditorOpen(true);
    };

    const save = async () => {
        const values = await form.validateFields();
        const request = toRequest(values);
        if (!request.lesson && !(request.steps && request.steps.length)) {
            message.warning("请填写做法，或至少添加一步路线");
            return;
        }
        setSaving(true);
        try {
            if (editing) {
                await updateAgentMemory(editing.id, request);
                message.success("已保存");
            } else {
                await createAgentMemory(request);
                message.success("已添加，立刻对你的 Agent 生效");
            }
            setEditorOpen(false);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存失败");
        } finally {
            setSaving(false);
        }
    };

    const decide = async (record: AgentMemory, decision: "approve" | "reject") => {
        setBusyId(record.id);
        try {
            await decideAgentMemory(record.id, decision);
            message.success(decision === "approve" ? "已批准，之后的会话会用到这条记忆" : "已拒绝，不会再注入会话");
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "处理失败");
        } finally {
            setBusyId(null);
        }
    };

    const remove = (record: AgentMemory) => {
        modal.confirm({
            title: `删除记忆「${record.topic}」`,
            content: "删除后不会再出现在你的 Agent 上下文里。确认删除？",
            okText: "删除",
            okButtonProps: { danger: true },
            onOk: async () => {
                await deleteAgentMemory(record.id);
                message.success("已删除");
                await load();
            },
        });
    };

    const onExport = async () => {
        try {
            const bundle = await exportAgentMemories();
            const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = `agent-memories-${bundle.exportedAt.slice(0, 10)}.json`;
            link.click();
            URL.revokeObjectURL(url);
            message.success(`已导出 ${bundle.memories.length} 条`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导出失败");
        }
    };

    const onImportFile = async (file: File) => {
        try {
            const parsed = JSON.parse(await file.text()) as AgentMemoryBundle;
            const result = await importAgentMemories(parsed);
            message.success(`导入 ${result.imported} 条，合并 ${result.merged} 条，跳过 ${result.skipped} 条`);
            await load();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "导入失败，请确认是本产品导出的 JSON");
        }
    };

    const pendingCount = items.filter((item) => item.status === "pending").length;
    const statusFilters = STATUS_FILTERS.map((option) => ({
        ...option,
        label: option.value === "pending" && pendingCount ? `待审 ${pendingCount}` : option.label,
    }));

    return (
        <div className={compact ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" : "flex flex-col gap-5"}>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
                <SegmentedControl
                    size="sm"
                    ariaLabel="记忆状态"
                    value={status}
                    options={statusFilters}
                    onChange={setStatus}
                />
                <div className="ml-auto flex items-center gap-1">
                    <IconButton variant="ghost" size="sm" icon={Download} aria-label="导出记忆" onClick={() => void onExport()} />
                    <IconButton variant="ghost" size="sm" icon={Upload} aria-label="导入记忆" onClick={() => fileRef.current?.click()} />
                    <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>
                        添加记忆
                    </Button>
                </div>
                <input
                    ref={fileRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={(event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (file) void onImportFile(file);
                    }}
                />
            </div>

            {compact ? null : <AgentMemoryCompactCard onApplied={load} />}

            <div className={compact ? "thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto" : undefined}>
                {loading ? (
                    <div className="space-y-2" aria-busy="true" aria-live="polite">
                        {[0, 1, 2].map((index) => (
                            <div key={index} className="h-[72px] animate-pulse rounded-2xl bg-surface-secondary" />
                        ))}
                    </div>
                ) : null}
                {!loading && items.length === 0 ? (
                    <WorkspaceState
                        compact
                        icon="empty"
                        className={compact ? "min-h-0 flex-1 py-8" : "min-h-[220px] py-10"}
                        title={status === "pending" ? "没有待批准的记忆" : "还没有个人记忆"}
                        description={status === "pending" ? "Agent 跑通任务后会把可复用做法记到这里，等你点头。" : "手动添加立刻生效，也可以等 Agent 记下后再批准。"}
                        action={status === "pending" ? undefined : <Button type="primary" icon={<Plus className="size-4" />} onClick={openCreate}>添加记忆</Button>}
                    />
                ) : null}
                {!loading && items.length ? (
                    <div className="space-y-2">
                        {items.map((record) => (
                            <article key={record.id} className="group rounded-2xl bg-surface-secondary/80 px-3.5 py-3 transition-[background,transform] duration-[var(--motion-state)] hover:bg-surface-hover motion-reduce:transition-none">
                                <div className="flex items-start gap-3">
                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h3 className="text-sm font-medium text-foreground">{record.topic}</h3>
                                            <StatusBadge size="sm" tone={memoryStatusTone(record.status)} label={memoryStatusLabel(record.status)} />
                                            <span className="text-[11px] text-muted-foreground">{agentMemoryCategoryLabel(record.category)}</span>
                                        </div>
                                        <p className="mt-1 text-caption leading-5 text-muted-foreground">{record.situation}</p>
                                        {record.lesson ? <p className="mt-1 text-caption leading-5 text-foreground/80">{record.lesson}</p> : null}
                                        {record.steps?.length ? (
                                            <ol className="mt-1.5 ml-4 list-decimal space-y-0.5 text-[11px] leading-5 text-muted-foreground">
                                                {record.steps.map((step, index) => (
                                                    <li key={`${record.id}-${index}`}>
                                                        <span className="font-medium text-foreground/80">{step.tool}</span>
                                                        {" — "}
                                                        {step.action}
                                                        {step.note ? <span className="text-foreground/45">（{step.note}）</span> : null}
                                                    </li>
                                                ))}
                                            </ol>
                                        ) : null}
                                    </div>
                                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                                        {record.status === "pending" ? (
                                            <>
                                                <Button size="small" type="primary" icon={<Check className="size-3.5" />} loading={busyId === record.id} onClick={() => void decide(record, "approve")}>
                                                    批准
                                                </Button>
                                                <Button size="small" icon={<X className="size-3.5" />} loading={busyId === record.id} onClick={() => void decide(record, "reject")}>
                                                    拒绝
                                                </Button>
                                            </>
                                        ) : null}
                                        <IconButton variant="ghost" size="sm" icon={Pencil} aria-label={`编辑 ${record.topic}`} onClick={() => openEdit(record)} />
                                        <IconButton variant="danger" size="sm" icon={Trash2} aria-label={`删除 ${record.topic}`} onClick={() => remove(record)} />
                                    </div>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : null}
            </div>

            {compact ? (
                <div className="shrink-0 border-t border-border/40 pt-3">
                    <AgentMemoryCompactCard compact onApplied={load} />
                </div>
            ) : null}

            <AppModal
                open={editorOpen}
                title={editing ? "编辑记忆" : "添加记忆"}
                okText={editing ? "保存" : "添加"}
                confirmLoading={saving}
                onOk={() => void save()}
                onCancel={() => setEditorOpen(false)}
            >
                <Form form={form} layout="vertical" className="pt-2">
                    <Form.Item name="topic" label="主题" rules={[{ required: true, message: "请填写主题" }]}>
                        <Input maxLength={120} placeholder="例如 canvas.snapshot-hash" />
                    </Form.Item>
                    <Form.Item name="category" label="分类" rules={[{ required: true, message: "请选择分类" }]}>
                        <Select options={AGENT_MEMORY_CATEGORIES.map((entry) => ({ value: entry.key, label: entry.label }))} />
                    </Form.Item>
                    <Form.Item name="situation" label="适用场景" rules={[{ required: true, message: "请填写适用场景" }]}>
                        <Input maxLength={200} placeholder="什么情况下用这条记忆" />
                    </Form.Item>
                    <Form.Item name="lesson" label="做法">
                        <Input.TextArea rows={3} maxLength={400} placeholder="一句话说明该怎么做" />
                    </Form.Item>
                    <Form.Item name="source" label="来源（可选）">
                        <Input maxLength={200} />
                    </Form.Item>
                    <Form.List name="steps">
                        {(fields, { add, remove: removeStep }) => (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-sm">路线步骤（可选）</span>
                                    <Button size="small" onClick={() => add({ tool: "", action: "", note: "" })}>
                                        加一步
                                    </Button>
                                </div>
                                {fields.map((field) => (
                                    <Space key={field.key} className="flex w-full" align="start">
                                        <Form.Item {...field} name={[field.name, "tool"]} className="mb-0 flex-1">
                                            <Input placeholder="工具名" />
                                        </Form.Item>
                                        <Form.Item {...field} name={[field.name, "action"]} className="mb-0 flex-1">
                                            <Input placeholder="做什么" />
                                        </Form.Item>
                                        <Button type="text" danger onClick={() => removeStep(field.name)}>
                                            删
                                        </Button>
                                    </Space>
                                ))}
                            </div>
                        )}
                    </Form.List>
                </Form>
            </AppModal>
        </div>
    );
}
