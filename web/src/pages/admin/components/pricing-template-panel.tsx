import { useEffect, useState } from "react";
import { Alert, App, Button, Form, Input, Segmented, Switch, type FormInstance } from "antd";
import { Select } from "@/components/ui/base/select";
import { useUserStore } from "@/stores/use-user-store";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { priceCurrencyOptions, priceCurrencyUnit } from "@/services/api/user-groups";
import { AdminModal } from "../ui/overlays";
import { validateChannelModelPrices, type ChannelModelFormValues } from "./channel-model-editor-form";
import { defaultPriceTier } from "./channel-model-price-tier-form";
import { PriceTierFields } from "./channel-model-price-tier-fields";
import { TokenPriceRulesSection } from "./channel-model-token-rules";
import { priceSelectorIssues } from "./channel-model-templates";
import { assertPricingTemplateScope, PRICING_TEMPLATES_CHANGED, pricingTemplatesKey, readPricingTemplates, savePricingTemplate, templatePricingForModel, type PricingSnapshot, type SavedPricingTemplate } from "./saved-pricing-templates";

type Props = { form: FormInstance<ChannelModelFormValues>; protocols?: ModelProtocolDefinition[]; disabled?: boolean; onApplied: (action: "apply" | "undo") => void };
type Draft = { name: string; values: ChannelModelFormValues; template?: SavedPricingTemplate };

function load(scope: string) {
    try {
        return { templates: readPricingTemplates(scope), error: "" };
    } catch (error) {
        return { templates: [] as SavedPricingTemplate[], error: error instanceof Error ? error.message : "无法读取积分模板" };
    }
}

export function PricingTemplatePanel(props: Props) {
    const scope = useUserStore((state) => state.user?.id || "guest");
    const capability = Form.useWatch("capability", { form: props.form, preserve: true });
    return <ScopedPricingTemplates key={`${scope}:${capability}`} {...props} scope={scope} />;
}

function ScopedPricingTemplates({ form, protocols, disabled, onApplied, scope }: Props & { scope: string }) {
    const { message } = App.useApp();
    Form.useWatch([], { form, preserve: true });
    const values: ChannelModelFormValues = form.getFieldsValue(true);
    const [library, setLibrary] = useState(() => load(scope));
    const [selected, setSelected] = useState<string>();
    const [previous, setPrevious] = useState<PricingSnapshot>();
    const [draft, setDraft] = useState<Draft>();
    const templates = library.templates.filter((item) => item.capability === values.capability);
    const template = templates.find((item) => item.id === selected);
    useEffect(() => {
        const refresh = () => setLibrary(load(scope));
        const changed = (event: Event) => {
            if ((event as CustomEvent).detail === scope) refresh();
        };
        const storage = (event: StorageEvent) => {
            if (event.key === null || event.key === pricingTemplatesKey(scope)) refresh();
        };
        window.addEventListener(PRICING_TEMPLATES_CHANGED, changed);
        window.addEventListener("storage", storage);
        return () => {
            window.removeEventListener(PRICING_TEMPLATES_CHANGED, changed);
            window.removeEventListener("storage", storage);
        };
    }, [scope]);
    const perform = (action: () => void) => {
        try {
            assertPricingTemplateScope(scope);
            action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "积分模板操作失败");
        }
    };
    const begin = (mode: "new" | "current" | "edit") =>
        perform(() => {
            const current = structuredClone(form.getFieldsValue(true));
            if (mode === "current") validateChannelModelPrices({ ...current, protocols });
            const editing = mode === "edit" ? readPricingTemplates(scope).find((item) => item.id === selected) : undefined;
            if (mode === "edit" && !editing) throw new Error("模板已不存在，请重新选择");
            setDraft({
                name: editing?.name || "",
                template: editing,
                values: editing ? { ...current, ...templatePricingForModel(editing, current) } : mode === "new" ? { ...current, priceTiers: [{ ...defaultPriceTier(), unitPrice: null, priceConfigured: false, enabled: false }] } : current,
            });
        });
    return (
        <section className="admin-model-editor-section" aria-label="定价模板">
            <header className="admin-model-editor-section-heading">
                <h2>积分模板</h2>
                <p>保存在本机，应用后保存模型生效。</p>
            </header>
            <div className="admin-model-editor-section-content space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        ariaLabel="选择定价模板"
                        placeholder="选择模板"
                        className="min-w-48 flex-1"
                        value={template?.id}
                        disabled={disabled || Boolean(library.error)}
                        options={templates.map((item) => ({ value: item.id, label: item.name }))}
                        onChange={(value) => setSelected(String(value))}
                    />
                    <Button
                        aria-label="应用定价模板"
                        disabled={disabled || !template || Boolean(library.error)}
                        onClick={() =>
                            perform(() => {
                                const latest = readPricingTemplates(scope).find((item) => item.id === template?.id);
                                if (!latest || latest.revision !== template?.revision) throw new Error("模板已变更，请重新选择并核对");
                                const current = form.getFieldsValue(true);
                                const pricing = templatePricingForModel(latest, current);
                                setPrevious(structuredClone({ priceTiers: current.priceTiers, priceCurrency: current.priceCurrency, referenceVideoBilling: current.referenceVideoBilling }));
                                Object.entries(pricing).forEach(([name, value]) => form.setFieldValue(name as keyof PricingSnapshot, value));
                                onApplied("apply");
                            })
                        }
                    >
                        应用
                    </Button>
                    <Button aria-label="新增积分模板" disabled={disabled || Boolean(library.error)} onClick={() => begin("new")}>
                        新增
                    </Button>
                    <Button aria-label="编辑积分模板" disabled={disabled || !template || Boolean(library.error)} onClick={() => begin("edit")}>
                        编辑
                    </Button>
                    <Button aria-label="将当前积分配置保存为模板" disabled={disabled || Boolean(library.error)} onClick={() => begin("current")}>
                        存为模板
                    </Button>
                    {previous ? (
                        <Button
                            aria-label="撤销定价模板"
                            disabled={disabled}
                            onClick={() =>
                                perform(() => {
                                    Object.entries(previous).forEach(([name, value]) => form.setFieldValue(name as keyof PricingSnapshot, structuredClone(value)));
                                    setPrevious(undefined);
                                    onApplied("undo");
                                })
                            }
                        >
                            撤销
                        </Button>
                    ) : null}
                </div>
                {library.error ? <Alert type="error" title={library.error} /> : null}
                {template ? (
                    <p className="text-xs text-foreground/60">
                        {template.name} · {template.pricing.priceTiers.length} 个价格档 · {priceCurrencyUnit(template.pricing.priceCurrency)}。包含售价、成本及分时规则；上游型号跟随当前模型。
                    </p>
                ) : null}
            </div>
            {draft ? (
                <PricingTemplateEditor
                    scope={scope}
                    draft={draft}
                    protocols={protocols}
                    disabled={disabled}
                    currentValues={values}
                    onClose={() => setDraft(undefined)}
                    onSaved={(item) => {
                        setSelected(item.id);
                        setDraft(undefined);
                        message.success("积分模板已保存");
                    }}
                />
            ) : null}
        </section>
    );
}

function PricingTemplateEditor({
    scope,
    draft,
    protocols,
    disabled,
    currentValues,
    onClose,
    onSaved,
}: {
    scope: string;
    draft: Draft;
    protocols?: ModelProtocolDefinition[];
    disabled?: boolean;
    currentValues: ChannelModelFormValues;
    onClose: () => void;
    onSaved: (template: SavedPricingTemplate) => void;
}) {
    const [form] = Form.useForm<ChannelModelFormValues>();
    const [name, setName] = useState(draft.name);
    const [error, setError] = useState("");
    Form.useWatch([], { form, preserve: true });
    const values: ChannelModelFormValues = { ...draft.values, ...form.getFieldsValue(true), capability: currentValues.capability, protocol: currentValues.protocol, capabilityConfig: currentValues.capabilityConfig };
    const issues = priceSelectorIssues({ ...values, protocols });
    const save = async () => {
        try {
            assertPricingTemplateScope(scope);
            await form.validateFields();
            validateChannelModelPrices({ ...values, protocols });
            const saved = savePricingTemplate(scope, name, values, draft.template);
            onSaved(saved);
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请检查模板中标记的配置项");
        }
    };
    return (
        <AdminModal
            open
            title={draft.template ? "编辑积分模板" : "新增积分模板"}
            width={960}
            onCancel={onClose}
            footer={
                <>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={disabled || Boolean(issues.length)} onClick={() => void save()}>
                        保存模板
                    </Button>
                </>
            }
        >
            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-1">
                <label className="block space-y-2">
                    <span>模板名称</span>
                    <Input aria-label="积分模板名称" value={name} maxLength={48} disabled={disabled} onChange={(event) => setName(event.target.value)} />
                </label>
                <p className="text-xs text-foreground/60">编辑模板不会改动当前模型。上游型号不随模板保存，应用后跟随目标模型。</p>
                {error ? <Alert type="error" title={error} /> : null}
                {issues.length ? (
                    <Alert
                        type="warning"
                        title="定价条件与当前模型能力冲突，不能保存"
                        description={
                            <ul>
                                {issues.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : null}
                <Form form={form} name="pricing-template" initialValues={draft.values} layout="vertical" disabled={disabled}>
                    <Form.Item name="priceCurrency" label="计价货币">
                        <Segmented options={priceCurrencyOptions} />
                    </Form.Item>
                    {values.capability === "video" ? (
                        <Form.Item name="referenceVideoBilling" label="参考视频计费" valuePropName="checked">
                            <Switch />
                        </Form.Item>
                    ) : null}
                    <Form.List name="priceTiers">
                        {(fields, { add, remove }) => (
                            <div className="space-y-3">
                                {fields.map((field, index) => (
                                    <PriceTierFields
                                        key={field.key}
                                        index={field.name}
                                        ordinal={index + 1}
                                        form={form}
                                        capability={values.capability}
                                        protocol={values.protocol}
                                        capabilityConfig={values.capabilityConfig}
                                        modelUpstream={values.providerModelKey || values.modelKey}
                                        onDirty={() => setError("")}
                                        onRemove={() => remove(field.name)}
                                    />
                                ))}
                                <Button block type="dashed" onClick={() => add({ ...defaultPriceTier(values.priceTiers.some((tier) => tier.matchMode === "default") ? "advanced" : "default"), unitPrice: null, priceConfigured: false, enabled: false })}>
                                    新增价格档
                                </Button>
                            </div>
                        )}
                    </Form.List>
                    {values.capability === "text" ? <TokenPriceRulesSection form={form} onDirty={() => setError("")} /> : null}
                </Form>
            </div>
        </AdminModal>
    );
}
