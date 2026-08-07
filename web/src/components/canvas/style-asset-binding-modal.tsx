import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, InputNumber, Modal, Select, Switch } from "antd";
import { AlertTriangle, Box, Check, FileImage, Link2, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import {
    createStyleProfileSnapshot,
    MAX_STYLE_ASSETS,
    styleAssetValidationMessage,
    type StyleAssetBinding,
    type StyleAssetKind,
    type StyleAssetStatus,
    type StyleProfileSnapshot,
} from "@/lib/canvas/style-profile";

const kindOptions: Array<{ value: StyleAssetKind; label: string }> = [
    { value: "lora", label: "LoRA" },
    { value: "template", label: "图片模板" },
    { value: "reference", label: "参考图组" },
    { value: "prompt", label: "提示词模块" },
];

const statusOptions: Array<{ value: StyleAssetStatus; label: string }> = [
    { value: "draft", label: "待验证" },
    { value: "validated", label: "已验证" },
    { value: "unavailable", label: "不可用" },
];

const policyOptions: Array<{ value: NonNullable<StyleProfileSnapshot["executionPolicy"]>; label: string }> = [
    { value: "compatible-fallback", label: "兼容降级" },
    { value: "strict-assets", label: "严格阻止" },
];

const emptyAsset = (): StyleAssetBinding => ({
    id: nanoid(),
    kind: "lora",
    provider: "liblib",
    title: "",
    enabled: false,
    weight: 0.8,
    status: "draft",
});

type StyleAssetBindingModalProps = {
    open: boolean;
    profile: StyleProfileSnapshot | null;
    onClose: () => void;
    onApply: (profile: StyleProfileSnapshot) => void;
};

export function StyleAssetBindingModal({ open, profile, onClose, onApply }: StyleAssetBindingModalProps) {
    const [draft, setDraft] = useState<StyleProfileSnapshot | null>(profile);
    const [editingId, setEditingId] = useState("");

    useEffect(() => {
        if (!open) return;
        setDraft(profile ? createStyleProfileSnapshot(profile) : null);
        setEditingId(profile?.assets[0]?.id || "");
    }, [open, profile]);

    const editing = useMemo(() => draft?.assets.find((asset) => asset.id === editingId), [draft, editingId]);
    const issues = useMemo(() => draft?.assets.map((asset) => ({ id: asset.id, message: styleAssetValidationMessage(asset) })).filter((issue) => issue.message) || [], [draft]);
    if (!draft) return null;

    const updateAsset = (patch: Partial<StyleAssetBinding>) => {
        setDraft((current) => current ? { ...current, assets: current.assets.map((asset) => asset.id === editingId ? { ...asset, ...patch } : asset) } : current);
    };
    const addAsset = () => {
        const asset = emptyAsset();
        setDraft((current) => current ? { ...current, assets: [...current.assets, asset] } : current);
        setEditingId(asset.id);
    };
    const deleteAsset = (id: string) => {
        setDraft((current) => current ? { ...current, assets: current.assets.filter((asset) => asset.id !== id) } : current);
        setEditingId((current) => current === id ? draft.assets.find((asset) => asset.id !== id)?.id || "" : current);
    };

    return (
        <Modal
            rootClassName="style-asset-binding-modal"
            open={open}
            title={null}
            footer={null}
            centered
            width="min(980px, calc(100vw - 24px))"
            onCancel={onClose}
            styles={{ container: { padding: 0 }, body: { padding: 0 } }}
        >
            <div className="flex max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
                <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 pr-12 sm:items-center sm:px-5">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold">风格执行资产</h2>
                        <p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">绑定模型资产、兼容范围、执行参数和许可快照</p>
                    </div>
                    <Button className="shrink-0" icon={<Plus className="size-3.5" />} disabled={draft.assets.length >= MAX_STYLE_ASSETS} title={draft.assets.length >= MAX_STYLE_ASSETS ? `最多绑定 ${MAX_STYLE_ASSETS} 个资产` : undefined} onClick={addAsset}>添加资产</Button>
                </header>

                <div className="grid min-h-0 flex-1 md:grid-cols-3">
                    <aside className="thin-scrollbar max-h-52 min-h-0 overflow-y-auto border-b border-border md:col-span-1 md:max-h-none md:border-b-0 md:border-r">
                        <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
                            <label className="flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0">
                                    <span className="block font-medium">执行策略</span>
                                    <span className="mt-0.5 block text-[var(--fs-tiny)] text-foreground/42">不兼容、未验证资产如何处理</span>
                                </span>
                                <Select<NonNullable<StyleProfileSnapshot["executionPolicy"]>>
                                    className="shrink-0"
                                    size="small"
                                    value={draft.executionPolicy || "compatible-fallback"}
                                    options={policyOptions}
                                    onChange={(executionPolicy) => setDraft({ ...draft, executionPolicy })}
                                />
                            </label>
                        </div>

                        {draft.assets.length ? (
                            <div className="divide-y divide-border">
                                {draft.assets.map((asset) => {
                                    const issue = styleAssetValidationMessage(asset);
                                    return (
                                        <button
                                            key={asset.id}
                                            type="button"
                                            className={`flex w-full items-start gap-3 px-4 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset ${editingId === asset.id ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
                                            onClick={() => setEditingId(asset.id)}
                                        >
                                            <AssetKindIcon kind={asset.kind} />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-xs font-medium">{asset.title || "未命名资产"}</span>
                                                <span className="mt-1 block truncate text-[var(--fs-tiny)] text-foreground/42">{assetKindLabel(asset.kind)} · {assetStatusLabel(asset.status)}</span>
                                            </span>
                                            <span className={`mt-1 size-1.5 shrink-0 rounded-full ${issue ? "bg-red-500" : asset.enabled ? asset.status === "validated" ? "bg-emerald-500" : "bg-amber-500" : "bg-foreground/20"}`} />
                                        </button>
                                    );
                                })}
                            </div>
                        ) : (
                            <EmptyAssetList />
                        )}
                    </aside>

                    <main className="thin-scrollbar min-h-0 overflow-y-auto p-4 sm:p-5 md:col-span-2">
                        {editing ? (
                            <AssetEditor asset={editing} onChange={updateAsset} onDelete={() => deleteAsset(editing.id)} />
                        ) : (
                            <div className="grid min-h-72 place-items-center text-center">
                                <div><Plus className="mx-auto size-5 text-foreground/25" /><p className="mt-2 text-xs text-foreground/50">添加或选择一个执行资产</p></div>
                            </div>
                        )}
                    </main>
                </div>

                <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-2 text-[var(--fs-tiny)] text-foreground/45">
                        {issues.length ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
                        <span className="min-w-0 leading-5">{issues.length ? `${issues.length} 个资产需要处理：${issues[0].message}` : `${draft.assets.length} 个资产，${draft.assets.filter((asset) => asset.enabled).length} 个已启用`}</span>
                    </div>
                    <div className="flex shrink-0 justify-end gap-2">
                        <Button onClick={onClose}>取消</Button>
                        <Button
                            type="primary"
                            icon={<Save className="size-3.5" />}
                            disabled={issues.length > 0}
                            onClick={() => onApply(createStyleProfileSnapshot({ ...draft, source: "user", revision: draft.revision + 1 }))}
                        >
                            应用配置
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function AssetEditor({ asset, onChange, onDelete }: { asset: StyleAssetBinding; onChange: (patch: Partial<StyleAssetBinding>) => void; onDelete: () => void }) {
    const validationMessage = styleAssetValidationMessage(asset);
    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                    <h3 className="text-sm font-semibold">资产配置</h3>
                    <p className="mt-1 text-[var(--fs-label)] text-foreground/45">已验证且启用的资产才会进入执行计划</p>
                </div>
                <Button danger type="text" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>删除</Button>
            </div>

            {validationMessage ? (
                <div className="flex gap-2 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-foreground/65">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                    <span>{validationMessage}</span>
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="资产类型">
                    <Select<StyleAssetKind> value={asset.kind} options={kindOptions} onChange={(kind) => onChange({ kind })} />
                </Field>
                <Field label="启用状态">
                    <div className="flex h-8 items-center justify-between border-b border-border">
                        <span className="text-xs text-foreground/55">参与生成执行计划</span>
                        <Switch size="small" checked={asset.enabled !== false} onChange={(enabled) => onChange({ enabled })} />
                    </div>
                </Field>
                <Field label="资产名称">
                    <Input value={asset.title} placeholder="例如：东方玄幻武侠修仙" onChange={(event) => onChange({ title: event.target.value })} />
                </Field>
                <Field label="验证状态">
                    <Select<StyleAssetStatus> value={asset.status} options={statusOptions} onChange={(status) => onChange({ status })} />
                </Field>
                <Field label="来源平台 / 适配器">
                    <Input value={asset.provider} placeholder="liblib、comfyui 或自定义适配器" onChange={(event) => onChange({ provider: event.target.value })} />
                </Field>
                <Field label="来源资产 ID">
                    <Input value={asset.sourceId} placeholder="模型 UUID 或模板 ID" onChange={(event) => onChange({ sourceId: event.target.value })} />
                </Field>
                <Field label="来源页面 URL" className="sm:col-span-2">
                    <Input value={asset.sourceUrl} placeholder="记录资产出处，不会自动向该地址发送生成请求" onChange={(event) => onChange({ sourceUrl: event.target.value })} />
                </Field>
                <Field label="资产模型标识">
                    <Input value={asset.model} placeholder="例如 Liblib 模型名称" onChange={(event) => onChange({ model: event.target.value })} />
                </Field>
                <Field label="模型版本">
                    <Input value={asset.version} placeholder="版本 UUID 或版本号" onChange={(event) => onChange({ version: event.target.value })} />
                </Field>
                <Field label="兼容基础模型" className="sm:col-span-2">
                    <Select<string[]> mode="tags" value={asset.baseModels || []} tokenSeparators={[","]} placeholder="填写实际生成模型名，输入后回车" onChange={(baseModels) => onChange({ baseModels })} />
                </Field>
            </div>

            {asset.kind === "lora" ? <LoraFields asset={asset} onChange={onChange} /> : null}
            {asset.kind === "reference" ? <ReferenceFields asset={asset} onChange={onChange} /> : null}
            {asset.kind === "prompt" || asset.kind === "template" ? <PromptFields asset={asset} onChange={onChange} /> : null}

            <GenerationParameterFields asset={asset} onChange={onChange} />
            <LicenseFields asset={asset} onChange={onChange} />

            {asset.enabled !== false && (asset.kind === "lora" || asset.kind === "reference") ? (
                <div className="flex gap-2 border-l-2 border-amber-500 bg-amber-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-foreground/60">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
                    <span>当前通用生成协议尚未启用{asset.kind === "lora" ? " LoRA" : "参考图组自动注入"}适配器。兼容降级会继续执行项目 Prompt；严格策略会在生成前阻止任务。</span>
                </div>
            ) : null}
        </div>
    );
}

function LoraFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <Field label="LoRA 权重">
                <InputNumber className="w-full" min={0} max={2} step={0.05} value={asset.weight} onChange={(weight) => onChange({ weight: weight ?? undefined })} />
            </Field>
            <Field label="触发词">
                <Select<string[]> mode="tags" value={asset.triggerWords || []} tokenSeparators={[","]} placeholder="输入后回车" onChange={(triggerWords) => onChange({ triggerWords })} />
            </Field>
        </section>
    );
}

function ReferenceFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4">
            <Field label="参考图 URL">
                <Select<string[]> mode="tags" value={asset.referenceUrls || []} tokenSeparators={[","]} placeholder="输入可访问的参考图地址后回车" onChange={(referenceUrls) => onChange({ referenceUrls })} />
            </Field>
            <Field label="项目资源 ID">
                <Select<string[]> mode="tags" value={asset.referenceResourceIds || []} tokenSeparators={[","]} placeholder="输入已上传的 resource ID 后回车" onChange={(referenceResourceIds) => onChange({ referenceResourceIds })} />
            </Field>
        </section>
    );
}

function PromptFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <Field label="提示词模块">
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={asset.promptFragment} placeholder="只填写该资产需要追加的稳定视觉要求" onChange={(event) => onChange({ promptFragment: event.target.value })} />
            </Field>
        </section>
    );
}

function GenerationParameterFields({ asset, onChange }: AssetFieldProps) {
    const parameters = asset.parameters || {};
    const updateParameters = (patch: NonNullable<StyleAssetBinding["parameters"]>) => onChange({ parameters: { ...parameters, ...patch } });
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">建议生成参数</h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Sampler"><Input value={parameters.sampler} placeholder="可选" onChange={(event) => updateParameters({ sampler: event.target.value })} /></Field>
                <Field label="Steps"><InputNumber className="w-full" min={1} max={200} value={parameters.steps} onChange={(steps) => updateParameters({ steps: steps ?? undefined })} /></Field>
                <Field label="CFG"><InputNumber className="w-full" min={0} max={50} step={0.5} value={parameters.cfg} onChange={(cfg) => updateParameters({ cfg: cfg ?? undefined })} /></Field>
                <Field label="推荐尺寸"><Input value={parameters.size} placeholder="例如 1024x1536" onChange={(event) => updateParameters({ size: event.target.value })} /></Field>
            </div>
        </section>
    );
}

function LicenseFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">许可快照</h4>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label="商业使用">
                    <Select
                        value={asset.license?.commercial === true ? "yes" : asset.license?.commercial === false ? "no" : "unknown"}
                        options={[{ value: "unknown", label: "尚未确认" }, { value: "yes", label: "允许商用" }, { value: "no", label: "不可商用" }]}
                        onChange={(value: "unknown" | "yes" | "no") => onChange({ license: { ...asset.license, commercial: value === "unknown" ? undefined : value === "yes" } })}
                    />
                </Field>
                <Field label="许可来源"><Input value={asset.license?.source} placeholder="许可页面或协议版本" onChange={(event) => onChange({ license: { ...asset.license, source: event.target.value } })} /></Field>
                <Field label="许可说明" className="sm:col-span-2"><Input value={asset.license?.note} placeholder="记录会员限制、署名或转售限制" onChange={(event) => onChange({ license: { ...asset.license, note: event.target.value } })} /></Field>
            </div>
        </section>
    );
}

type AssetFieldProps = {
    asset: StyleAssetBinding;
    onChange: (patch: Partial<StyleAssetBinding>) => void;
};

function AssetKindIcon({ kind }: { kind: StyleAssetKind }) {
    return (
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded bg-foreground/5 text-foreground/55">
            {kind === "lora" ? <SlidersHorizontal className="size-3.5" /> : kind === "reference" ? <FileImage className="size-3.5" /> : kind === "template" ? <Box className="size-3.5" /> : <Link2 className="size-3.5" />}
        </span>
    );
}

function EmptyAssetList() {
    return (
        <div className="grid min-h-52 place-items-center px-6 text-center">
            <div><Box className="mx-auto size-5 text-foreground/25" /><p className="mt-2 text-xs font-medium">尚未绑定执行资产</p><p className="mt-1 text-[var(--fs-tiny)] leading-5 text-foreground/42">当前画风只通过项目 Prompt 执行</p></div>
        </div>
    );
}

function assetKindLabel(kind: StyleAssetKind) {
    return kindOptions.find((item) => item.value === kind)?.label || kind;
}

function assetStatusLabel(status: StyleAssetStatus) {
    return statusOptions.find((item) => item.value === status)?.label || status;
}

function Field({ label, className = "", children }: { label: string; className?: string; children: ReactNode }) {
    return <label className={`grid gap-1.5 text-xs ${className}`}><span className="font-medium text-foreground/60">{label}</span>{children}</label>;
}
