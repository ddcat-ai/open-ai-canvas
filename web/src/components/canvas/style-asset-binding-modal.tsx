import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Button, Input, InputNumber, Modal, Select, Switch } from "antd";
import { AlertTriangle, Box, Check, FileImage, Link2, Plus, Save, SlidersHorizontal, Trash2 } from "lucide-react";
import { nanoid } from "nanoid";

import { createStyleProfileSnapshot, MAX_STYLE_ASSETS, styleAssetValidationMessage, type StyleAssetBinding, type StyleAssetKind, type StyleAssetStatus, type StyleProfileSnapshot } from "@/lib/canvas/style-profile";
import { useTranslation } from "react-i18next";
import { t } from "@/i18n";

const kindOptions: Array<{ value: StyleAssetKind; label: string }> = [
    { value: "lora", label: "LoRA" },
    { value: "template", label: t("canvas:image-template") },
    { value: "reference", label: t("canvas:reference-image-set") },
    { value: "prompt", label: t("canvas:prompt-modules") },
];

const statusOptions: Array<{ value: StyleAssetStatus; label: string }> = [
    { value: "draft", label: t("canvas:pending-validation") },
    { value: "validated", label: t("canvas:validated") },
    { value: "unavailable", label: t("canvas:unavailable") },
];

const policyOptions: Array<{ value: NonNullable<StyleProfileSnapshot["executionPolicy"]>; label: string }> = [
    { value: "compatible-fallback", label: t("canvas:graceful-fallback") },
    { value: "strict-assets", label: t("canvas:strictly-block") },
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
    const { t } = useTranslation("canvas");
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
        setDraft((current) => (current ? { ...current, assets: current.assets.map((asset) => (asset.id === editingId ? { ...asset, ...patch } : asset)) } : current));
    };
    const addAsset = () => {
        const asset = emptyAsset();
        setDraft((current) => (current ? { ...current, assets: [...current.assets, asset] } : current));
        setEditingId(asset.id);
    };
    const deleteAsset = (id: string) => {
        setDraft((current) => (current ? { ...current, assets: current.assets.filter((asset) => asset.id !== id) } : current));
        setEditingId((current) => (current === id ? draft.assets.find((asset) => asset.id !== id)?.id || "" : current));
    };

    return (
        <Modal rootClassName="style-asset-binding-modal" open={open} title={null} footer={null} centered width="min(980px, calc(100vw - 24px))" onCancel={onClose} styles={{ container: { padding: 0 }, body: { padding: 0 } }}>
            <div className="flex max-h-dvh min-h-0 flex-col overflow-hidden bg-background text-foreground">
                <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 pr-12 sm:items-center sm:px-5">
                    <div className="min-w-0">
                        <h2 className="text-sm font-semibold">{t("canvas:style-execution-assets-3")}</h2>
                        <p className="mt-0.5 text-[var(--fs-label)] text-foreground/45">{t("canvas:bind-model-assets-compatibility-scope-execution-params-and-license-snaps-3")}</p>
                    </div>
                    <Button
                        className="shrink-0"
                        icon={<Plus className="size-3.5" />}
                        disabled={draft.assets.length >= MAX_STYLE_ASSETS}
                        title={draft.assets.length >= MAX_STYLE_ASSETS ? t("canvas:bind-at-most-param-assets", { MAX_STYLE_ASSETS: MAX_STYLE_ASSETS }) : undefined}
                        onClick={addAsset}
                    >
                        {t("canvas:add-asset-3")}
                    </Button>
                </header>

                <div className="grid min-h-0 flex-1 md:grid-cols-3">
                    <aside className="thin-scrollbar max-h-52 min-h-0 overflow-y-auto border-b border-border md:col-span-1 md:max-h-none md:border-b-0 md:border-r">
                        <div className="sticky top-0 z-10 border-b border-border bg-background px-4 py-3">
                            <label className="flex items-center justify-between gap-3 text-xs">
                                <span className="min-w-0">
                                    <span className="block font-medium">{t("canvas:execution-policy-2")}</span>
                                    <span className="mt-0.5 block text-[var(--fs-tiny)] text-foreground/42">{t("canvas:how-to-handle-incompatible-or-unvalidated-assets-3")}</span>
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
                                                <span className="block truncate text-xs font-medium">{asset.title || t("canvas:unnamed-asset")}</span>
                                                <span className="mt-1 block truncate text-[var(--fs-tiny)] text-foreground/42">
                                                    {assetKindLabel(asset.kind)} · {assetStatusLabel(asset.status)}
                                                </span>
                                            </span>
                                            <span className={`mt-1 size-1.5 shrink-0 rounded-full ${issue ? "bg-red-500" : asset.enabled ? (asset.status === "validated" ? "bg-emerald-500" : "bg-amber-500") : "bg-foreground/20"}`} />
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
                                <div>
                                    <Plus className="mx-auto size-5 text-foreground/25" />
                                    <p className="mt-2 text-xs text-foreground/50">{t("canvas:add-or-choose-an-execution-asset-3")}</p>
                                </div>
                            </div>
                        )}
                    </main>
                </div>

                <footer className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                    <div className="flex min-w-0 items-start gap-2 text-[var(--fs-tiny)] text-foreground/45">
                        {issues.length ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" /> : <Check className="mt-0.5 size-3.5 shrink-0" />}
                        <span className="min-w-0 leading-5">
                            {issues.length
                                ? t("canvas:param-assets-need-attention-param", { length: issues.length, message: issues[0].message })
                                : t("canvas:param-assets-param-enabled", { length: draft.assets.length, length_1: draft.assets.filter((asset) => asset.enabled).length })}
                        </span>
                    </div>
                    <div className="flex shrink-0 justify-end gap-2">
                        <Button onClick={onClose}>{t("canvas:cancel-11")}</Button>
                        <Button type="primary" icon={<Save className="size-3.5" />} disabled={issues.length > 0} onClick={() => onApply(createStyleProfileSnapshot({ ...draft, source: "user", revision: draft.revision + 1 }))}>
                            {t("canvas:apply-config-3")}
                        </Button>
                    </div>
                </footer>
            </div>
        </Modal>
    );
}

function AssetEditor({ asset, onChange, onDelete }: { asset: StyleAssetBinding; onChange: (patch: Partial<StyleAssetBinding>) => void; onDelete: () => void }) {
    const { t } = useTranslation("canvas");
    const validationMessage = styleAssetValidationMessage(asset);
    return (
        <div className="space-y-5">
            <div className="flex items-start justify-between gap-3 border-b border-border pb-4">
                <div>
                    <h3 className="text-sm font-semibold">{t("canvas:asset-configuration-3")}</h3>
                    <p className="mt-1 text-[var(--fs-label)] text-foreground/45">{t("canvas:only-validated-and-enabled-assets-join-the-execution-plan-3")}</p>
                </div>
                <Button danger type="text" icon={<Trash2 className="size-3.5" />} onClick={onDelete}>
                    {t("canvas:delete-5")}
                </Button>
            </div>

            {validationMessage ? (
                <div className="flex gap-2 border-l-2 border-red-500 bg-red-500/5 px-3 py-2 text-[var(--fs-label)] leading-5 text-foreground/65">
                    <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red-500" />
                    <span>{validationMessage}</span>
                </div>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("canvas:asset-type")}>
                    <Select<StyleAssetKind> value={asset.kind} options={kindOptions} onChange={(kind) => onChange({ kind })} />
                </Field>
                <Field label={t("canvas:enabled-status")}>
                    <div className="flex h-8 items-center justify-between border-b border-border">
                        <span className="text-xs text-foreground/55">{t("canvas:participates-in-the-execution-plan-3")}</span>
                        <Switch size="small" checked={asset.enabled !== false} onChange={(enabled) => onChange({ enabled })} />
                    </div>
                </Field>
                <Field label={t("canvas:asset-name")}>
                    <Input value={asset.title} placeholder={t("canvas:e-g-eastern-fantasy-wuxia-cultivation")} onChange={(event) => onChange({ title: event.target.value })} />
                </Field>
                <Field label={t("canvas:validation-status")}>
                    <Select<StyleAssetStatus> value={asset.status} options={statusOptions} onChange={(status) => onChange({ status })} />
                </Field>
                <Field label={t("canvas:source-platform-adapter")}>
                    <Input value={asset.provider} placeholder={t("canvas:liblib-comfyui-or-custom-adapter")} onChange={(event) => onChange({ provider: event.target.value })} />
                </Field>
                <Field label={t("canvas:source-asset-id")}>
                    <Input value={asset.sourceId} placeholder={t("canvas:model-uuid-or-template-id")} onChange={(event) => onChange({ sourceId: event.target.value })} />
                </Field>
                <Field label={t("canvas:source-page-url")} className="sm:col-span-2">
                    <Input value={asset.sourceUrl} placeholder={t("canvas:records-asset-provenance-no-generation-requests-are-sent-to-this-url-aut")} onChange={(event) => onChange({ sourceUrl: event.target.value })} />
                </Field>
                <Field label={t("canvas:asset-model-identifier")}>
                    <Input value={asset.model} placeholder={t("canvas:e-g-liblib-model-name")} onChange={(event) => onChange({ model: event.target.value })} />
                </Field>
                <Field label={t("canvas:model-version")}>
                    <Input value={asset.version} placeholder={t("canvas:version-uuid-or-version-number")} onChange={(event) => onChange({ version: event.target.value })} />
                </Field>
                <Field label={t("canvas:compatible-base-models")} className="sm:col-span-2">
                    <Select<string[]> mode="tags" value={asset.baseModels || []} tokenSeparators={[","]} placeholder={t("canvas:enter-the-actual-model-name-and-press-enter")} onChange={(baseModels) => onChange({ baseModels })} />
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
                    <span>
                        {t("canvas:the-generic-generation-protocol-is-not-enabled-yet-3")}
                        {asset.kind === "lora" ? " LoRA" : t("canvas:reference-image-set-auto-injected")}
                        {t("canvas:adapter-graceful-fallback-keeps-executing-the-project-prompt-strict-poli-3")}
                    </span>
                </div>
            ) : null}
        </div>
    );
}

function LoraFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
            <Field label={t("canvas:lora-weight")}>
                <InputNumber className="w-full" min={0} max={2} step={0.05} value={asset.weight} onChange={(weight) => onChange({ weight: weight ?? undefined })} />
            </Field>
            <Field label={t("canvas:trigger-words")}>
                <Select<string[]> mode="tags" value={asset.triggerWords || []} tokenSeparators={[","]} placeholder={t("canvas:type-and-press-enter")} onChange={(triggerWords) => onChange({ triggerWords })} />
            </Field>
        </section>
    );
}

function ReferenceFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="grid gap-4 border-t border-border pt-4">
            <Field label={t("canvas:reference-image-url")}>
                <Select<string[]> mode="tags" value={asset.referenceUrls || []} tokenSeparators={[","]} placeholder={t("canvas:paste-an-accessible-reference-image-url-and-press-enter")} onChange={(referenceUrls) => onChange({ referenceUrls })} />
            </Field>
            <Field label={t("canvas:project-resource-id")}>
                <Select<string[]>
                    mode="tags"
                    value={asset.referenceResourceIds || []}
                    tokenSeparators={[","]}
                    placeholder={t("canvas:paste-an-uploaded-resource-id-and-press-enter")}
                    onChange={(referenceResourceIds) => onChange({ referenceResourceIds })}
                />
            </Field>
        </section>
    );
}

function PromptFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <Field label={t("canvas:prompt-modules")}>
                <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} value={asset.promptFragment} placeholder={t("canvas:fill-in-only-stable-visual-requirements-this-asset-adds")} onChange={(event) => onChange({ promptFragment: event.target.value })} />
            </Field>
        </section>
    );
}

function GenerationParameterFields({ asset, onChange }: AssetFieldProps) {
    const parameters = asset.parameters || {};
    const updateParameters = (patch: NonNullable<StyleAssetBinding["parameters"]>) => onChange({ parameters: { ...parameters, ...patch } });
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">{t("canvas:recommended-parameters-3")}</h4>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Sampler">
                    <Input value={parameters.sampler} placeholder={t("canvas:optional")} onChange={(event) => updateParameters({ sampler: event.target.value })} />
                </Field>
                <Field label="Steps">
                    <InputNumber className="w-full" min={1} max={200} value={parameters.steps} onChange={(steps) => updateParameters({ steps: steps ?? undefined })} />
                </Field>
                <Field label="CFG">
                    <InputNumber className="w-full" min={0} max={50} step={0.5} value={parameters.cfg} onChange={(cfg) => updateParameters({ cfg: cfg ?? undefined })} />
                </Field>
                <Field label={t("canvas:recommended-size")}>
                    <Input value={parameters.size} placeholder={t("canvas:e-g-1024x1536")} onChange={(event) => updateParameters({ size: event.target.value })} />
                </Field>
            </div>
        </section>
    );
}

function LicenseFields({ asset, onChange }: AssetFieldProps) {
    return (
        <section className="border-t border-border pt-4">
            <h4 className="mb-3 text-xs font-semibold">{t("canvas:license-snapshot-3")}</h4>
            <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("canvas:commercial-use")}>
                    <Select
                        value={asset.license?.commercial === true ? "yes" : asset.license?.commercial === false ? "no" : "unknown"}
                        options={[
                            { value: "unknown", label: t("canvas:not-confirmed-yet") },
                            { value: "yes", label: t("canvas:commercial-use-allowed") },
                            { value: "no", label: t("canvas:not-for-commercial-use") },
                        ]}
                        onChange={(value: "unknown" | "yes" | "no") => onChange({ license: { ...asset.license, commercial: value === "unknown" ? undefined : value === "yes" } })}
                    />
                </Field>
                <Field label={t("canvas:license-source")}>
                    <Input value={asset.license?.source} placeholder={t("canvas:license-page-or-agreement-version")} onChange={(event) => onChange({ license: { ...asset.license, source: event.target.value } })} />
                </Field>
                <Field label={t("canvas:license-notes")} className="sm:col-span-2">
                    <Input value={asset.license?.note} placeholder={t("canvas:note-membership-limits-attribution-or-resale-restrictions")} onChange={(event) => onChange({ license: { ...asset.license, note: event.target.value } })} />
                </Field>
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
            <div>
                <Box className="mx-auto size-5 text-foreground/25" />
                <p className="mt-2 text-xs font-medium">{t("canvas:no-execution-assets-bound-yet-3")}</p>
                <p className="mt-1 text-[var(--fs-tiny)] leading-5 text-foreground/42">{t("canvas:the-current-style-executes-through-project-prompt-only-3")}</p>
            </div>
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
    return (
        <label className={`grid gap-1.5 text-xs ${className}`}>
            <span className="font-medium text-foreground/60">{label}</span>
            {children}
        </label>
    );
}
