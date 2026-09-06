import { useRef, useState } from "react";
import { Alert, App, Button, Form, Input, Modal, Segmented, Switch, Tabs } from "antd";
import { FlaskConical, Plus } from "lucide-react";
import { ModelIconPicker } from "@/components/model-logo";
import { ModelIcon } from "@/components/model-picker";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { defaultModelCapabilityConfig, normalizeModelCapabilityConfig, type ModelCapabilityConfig } from "@/lib/model-capabilities";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import { createAdminChannelModel, testAdminChannelModel, updateAdminChannelModel, type ChannelModel } from "@/services/api/wallet";
import type { ModelChannel } from "@/stores/use-config-store";
import { defaultPriceTier, priceTierResolutionFromForm, priceTierVideoSecondsFromForm, skuSelectorFromForm } from "./channel-model-price-tier-form";
import { PriceTierFields } from "./channel-model-price-tier-fields";
import { changeChannelModelCapability, editorSectionForField, initialChannelModelValues, validateChannelModelPrices, validateChannelModelProtocol, type ChannelModelFormValues as FormValues, type EditorSection } from "./channel-model-editor-form";

export function ChannelModelEditor({
    channel,
    editing,
    protocols,
    protocolLoading,
    protocolError,
    onRetryProtocols,
    onClose,
    onSaved,
}: {
    channel: ModelChannel;
    editing: ChannelModel | null;
    protocols: ModelProtocolDefinition[];
    protocolLoading: boolean;
    protocolError: string;
    onRetryProtocols: () => void;
    onClose: () => void;
    onSaved: () => Promise<void>;
}) {
    const { message, modal } = App.useApp();
    const [form] = Form.useForm<FormValues>();
    const [initialValues] = useState(() => initialChannelModelValues(editing, protocols));
    const [activeSection, setActiveSection] = useState<EditorSection>("identity");
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [configurationChanged, setConfigurationChanged] = useState(false);
    const busyRef = useRef(false);
    const dirtyRef = useRef(false);
    const modelCapability = Form.useWatch("capability", form);
    const modelProtocol = Form.useWatch("protocol", form);
    const modelKey = Form.useWatch("modelKey", form) || "";
    const providerModelKey = Form.useWatch("providerModelKey", form) || "";
    const capabilityConfig = Form.useWatch("capabilityConfig", form);
    const modelEnabled = Form.useWatch("enabled", form) !== false;
    const priceTiers = Form.useWatch("priceTiers", form) || [];
    const hasDefaultPriceTier = priceTiers.some((tier) => tier.matchMode === "default");
    const busy = saving || testing;

    const requestClose = () => {
        if (busyRef.current) return;
        if (!dirtyRef.current) {
            onClose();
            return;
        }
        modal.confirm({ title: "放弃未保存的修改？", content: "当前修改尚未保存，关闭后将丢弃。", okText: "放弃修改", cancelText: "继续编辑", onOk: onClose });
    };

    const handleFormValuesChange = (changed: Partial<FormValues>) => {
        dirtyRef.current = true;
        if (changed.capability) {
            form.setFieldsValue(changeChannelModelCapability(form.getFieldsValue(true), protocols));
            setConfigurationChanged(true);
        } else if (changed.protocol) {
            form.setFieldValue("capabilityConfig", modelCapability === "audio" ? undefined : defaultModelCapabilityConfig(changed.protocol, providerModelKey.trim() || modelKey.trim()));
            setConfigurationChanged(true);
        }
    };

    const validateEditor = async (names?: string[]): Promise<FormValues | undefined> => {
        busyRef.current = true;
        try {
            await form.validateFields(names);
            return form.getFieldsValue(true);
        } catch (error) {
            const fields = (error as { errorFields?: { name: (string | number)[] }[] }).errorFields;
            if (fields?.length) {
                setActiveSection(editorSectionForField(fields[0].name));
                requestAnimationFrame(() => form.scrollToField(fields[0].name, { block: "center", focus: true }));
                message.warning("请检查标记的配置项后重试");
            } else message.error(error instanceof Error ? error.message : "表单校验失败");
            return undefined;
        } finally {
            busyRef.current = false;
        }
    };

    const save = async () => {
        if (busyRef.current) return;
        const values = await validateEditor();
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setSaving(true);
        try {
            const payload = {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                displayName: values.displayName?.trim() || values.modelKey.trim(),
                icon: values.icon?.trim() || "",
                capability: values.capability,
                protocol: values.protocol,
                priceTiers: values.priceTiers.map((tier) => ({
                    selector: skuSelectorFromForm(values.capability, tier),
                    resolution: priceTierResolutionFromForm(values.capability, tier),
                    videoSeconds: priceTierVideoSecondsFromForm(values.capability, tier),
                    providerModelKey: tier.providerModelKey?.trim() || upstreamModel,
                    billingMode: tier.billingMode,
                    unitPriceMicrocredits: Math.round((tier.unitPrice || 0) * 1_000_000),
                    inputTokenPriceMicrocredits: Math.round((tier.inputTokenPrice || 0) * 1_000_000),
                    outputTokenPriceMicrocredits: Math.round((tier.outputTokenPrice || 0) * 1_000_000),
                    cachedTokenPriceMicrocredits: Math.round((tier.cachedTokenPrice || 0) * 1_000_000),
                    priceConfigured: tier.priceConfigured !== false,
                    enabled: tier.enabled !== false,
                })),
                enabled: values.enabled !== false,
                capabilityConfig,
            };
            if (editing) await updateAdminChannelModel(channel.id, editing.id, payload);
            else await createAdminChannelModel(channel.id, payload);
            try {
                await onSaved();
            } catch {
                message.warning("模型已保存，但列表刷新失败，请手动刷新");
            }
            onClose();
            message.success(editing ? "模型配置已更新" : "模型已添加");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存模型失败");
        } finally {
            busyRef.current = false;
            setSaving(false);
        }
    };

    const testModel = async () => {
        if (busyRef.current) return;
        const values = await validateEditor(["modelKey", "providerModelKey", "capability", "protocol", "capabilityConfig"]);
        if (!values) return;
        const upstreamModel = values.providerModelKey?.trim() || values.modelKey.trim();
        const capabilityConfig =
            values.capability === "text" || values.capability === "image" || values.capability === "video" ? normalizeModelCapabilityConfig(values.capabilityConfig || defaultModelCapabilityConfig(values.protocol, upstreamModel)) : undefined;
        busyRef.current = true;
        setTesting(true);
        try {
            const result = await testAdminChannelModel(channel.id, {
                modelKey: values.modelKey.trim(),
                providerModelKey: upstreamModel,
                capability: values.capability,
                protocol: values.protocol,
                capabilityConfig,
            });
            message.success(`模型测试通过，耗时 ${(result.durationMs / 1000).toFixed(2)} 秒`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型测试失败");
        } finally {
            busyRef.current = false;
            setTesting(false);
        }
    };

    return (
        <Modal
            open
            title={
                <div className="admin-model-editor-title">
                    <span>{editing ? "编辑模型" : "新增模型"}</span>
                    <p>
                        {channel.name} · {editing?.displayName || editing?.modelKey || "配置调用方式与用户积分价格"}
                    </p>
                </div>
            }
            width={1120}
            centered
            rootClassName="admin-modal-root admin-model-editor-modal"
            mask={{ closable: false }}
            keyboard={!busy}
            closable={!busy}
            onCancel={requestClose}
            styles={{ container: { padding: 0, overflow: "hidden" }, body: { padding: 0, minHeight: 0, flex: 1 }, header: { margin: 0 }, footer: { margin: 0 } }}
            footer={
                <div className="admin-model-editor-footer-actions">
                    <div className="admin-model-editor-footer-status">
                        <Switch
                            aria-label="启用模型"
                            checked={modelEnabled}
                            disabled={busy}
                            onChange={(checked) => {
                                dirtyRef.current = true;
                                form.setFieldValue("enabled", checked);
                            }}
                        />
                        <div>
                            <strong>{modelEnabled ? "模型启用" : "模型停用"}</strong>
                            <small>保存后生效</small>
                        </div>
                    </div>
                    <div className="admin-model-editor-footer-primary">
                        <Button
                            icon={<FlaskConical className="size-4" />}
                            loading={testing}
                            disabled={saving || protocolLoading || Boolean(protocolError)}
                            onClick={() => modal.confirm({ title: "测试模型连接？", content: "测试会向上游发送真实请求，可能产生供应商费用；不会保存当前修改。", okText: "开始测试", cancelText: "取消", onOk: testModel })}
                        >
                            测试模型
                        </Button>
                        <Button disabled={busy} onClick={requestClose}>
                            取消
                        </Button>
                        <Button type="primary" loading={saving} disabled={testing || protocolLoading || Boolean(protocolError)} onClick={() => void save()}>
                            {editing ? "保存修改" : "添加模型"}
                        </Button>
                    </div>
                </div>
            }
        >
            <Form className="admin-model-editor-form" form={form} initialValues={initialValues} layout="vertical" disabled={busy} inert={busy} onValuesChange={handleFormValuesChange}>
                <Form.Item name="capabilityConfig" noStyle>
                    <CapabilityConfigField />
                </Form.Item>
                <Form.Item name="enabled" noStyle>
                    <EnabledConfigField />
                </Form.Item>
                <Tabs
                    activeKey={activeSection}
                    onChange={(key) => setActiveSection(key as EditorSection)}
                    animated={false}
                    items={[
                        {
                            key: "identity",
                            label: "基本信息",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="模型身份" description="区分产品侧展示标识与上游实际调用 ID。" />
                                        <div className="admin-model-editor-section-content admin-model-identity-grid admin-model-identity-grid-with-icon">
                                            <Form.Item name="modelKey" label="产品模型标识" rules={[{ required: true, whitespace: true, message: "请输入产品模型标识" }]}>
                                                <Input
                                                    prefix={
                                                        <span className="grid size-6 place-items-center">
                                                            <ModelIcon model={modelKey} />
                                                        </span>
                                                    }
                                                    placeholder="例如：seedance-2-5"
                                                />
                                            </Form.Item>
                                            <Form.Item name="providerModelKey" label="上游模型 ID" tooltip="实际发送给供应商；留空时使用产品模型标识。">
                                                <Input placeholder="留空则使用产品模型标识" />
                                            </Form.Item>
                                            <Form.Item name="displayName" label="后台显示名称" tooltip="仅用于后台识别，不改变调用 ID。">
                                                <Input placeholder="不填则使用模型标识" />
                                            </Form.Item>
                                            <Form.Item name="icon" label="模型 Logo">
                                                <ModelIconPicker />
                                            </Form.Item>
                                        </div>
                                    </section>
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="能力与协议" description="先选任务类型，再选择对应的调用协议；更换后请核对参数与价格。" />
                                        <div className="admin-model-editor-section-content admin-model-protocol-grid">
                                            <Form.Item name="capability" label="模型能力" rules={[{ required: true }]}>
                                                <Segmented
                                                    block
                                                    options={[
                                                        { label: "文本", value: "text" },
                                                        { label: "图片", value: "image" },
                                                        { label: "视频", value: "video" },
                                                        { label: "音频", value: "audio" },
                                                    ]}
                                                />
                                            </Form.Item>
                                            <Form.Item className="admin-model-protocol-field" name="protocol" label="调用协议" rules={[{ validator: async (_, value) => validateChannelModelProtocol(form.getFieldValue("capability"), value, protocols) }]}>
                                                <ModelProtocolBrowser disabled={busy} capability={modelCapability} protocols={protocols} loading={protocolLoading} error={protocolError} />
                                            </Form.Item>
                                            {protocolError && (
                                                <Alert
                                                    type="error"
                                                    showIcon
                                                    title="协议目录读取失败"
                                                    description={protocolError}
                                                    action={
                                                        <Button size="small" onClick={onRetryProtocols}>
                                                            重试
                                                        </Button>
                                                    }
                                                />
                                            )}
                                        </div>
                                    </section>
                                </div>
                            ),
                        },
                        {
                            key: "capabilities",
                            label: "能力与参数",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    {configurationChanged && <Alert type="warning" showIcon title="能力或协议已变更" description="引用与参数已恢复为新协议默认值，旧规格条件已在切换能力时清除。价格与计费方式保留，请在保存前核对。" />}{" "}
                                    {modelCapability === "text" || modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-references">
                                            <SectionHeading title="引用与限制" description="按媒体类型纵向配置数量、大小、时长及通用约束。" />
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="references"
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        form.setFieldValue("capabilityConfig", next);
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "image" || modelCapability === "video" ? (
                                        <section className="admin-model-editor-section admin-model-editor-section-stacked admin-model-editor-parameters">
                                            <SectionHeading title="协议参数" description="配置可发送参数、支持值与默认值；仅影响当前模型。" />
                                            <div className="admin-model-editor-section-content">
                                                <ModelCapabilityEditor
                                                    capability={modelCapability}
                                                    model={providerModelKey || modelKey}
                                                    protocol={form.getFieldValue("protocol")}
                                                    section="protocol"
                                                    value={capabilityConfig}
                                                    onChange={(next) => {
                                                        dirtyRef.current = true;
                                                        form.setFieldValue("capabilityConfig", next);
                                                    }}
                                                />
                                            </div>
                                        </section>
                                    ) : null}
                                    {modelCapability === "audio" && <Alert type="info" title="音频模型无需额外配置引用与参数" description="调用协议和积分定价仍需在对应分组中配置。" />}
                                </div>
                            ),
                        },
                        {
                            key: "pricing",
                            label: "积分定价",
                            forceRender: true,
                            children: (
                                <div className="admin-model-editor-tab-content">
                                    {configurationChanged && <Alert type="warning" showIcon title="请核对定价" description="能力或协议已变更。请重新检查规格条件、计费方式和金额；不会自动转换价格单位。" />}{" "}
                                    <section className="admin-model-editor-section">
                                        <SectionHeading title="用户积分价格" description="默认只需填写一个统一价格；需要区分生成方式、质量或尺寸时，再添加规格价格。" />
                                        <div className="admin-model-editor-section-content">
                                            <Form.List
                                                name="priceTiers"
                                                rules={[
                                                    {
                                                        validator: async (_, value) => {
                                                            validateChannelModelPrices({ capability: form.getFieldValue("capability"), protocol: form.getFieldValue("protocol"), priceTiers: value });
                                                        },
                                                    },
                                                ]}
                                            >
                                                {(fields, { add, remove }, { errors }) => (
                                                    <div className="space-y-3">
                                                        {fields.map((field, index) => (
                                                            <PriceTierFields
                                                                key={field.key}
                                                                index={field.name}
                                                                ordinal={index + 1}
                                                                form={form}
                                                                capability={modelCapability}
                                                                protocol={modelProtocol}
                                                                capabilityConfig={capabilityConfig}
                                                                onDirty={() => {
                                                                    dirtyRef.current = true;
                                                                }}
                                                                onRemove={() => remove(field.name)}
                                                            />
                                                        ))}
                                                        <Button className="admin-model-editor-add-tier" type="dashed" block icon={<Plus className="size-4" />} onClick={() => add(defaultPriceTier(hasDefaultPriceTier ? "advanced" : "default"))}>
                                                            {hasDefaultPriceTier ? "新增规格价格" : "新增统一默认价格"}
                                                        </Button>
                                                        <Form.ErrorList errors={errors} />
                                                    </div>
                                                )}
                                            </Form.List>
                                        </div>
                                    </section>
                                </div>
                            ),
                        },
                    ]}
                />
            </Form>
        </Modal>
    );
}

function SectionHeading({ title, description }: { title: string; description: string }) {
    return (
        <header className="admin-model-editor-section-heading">
            <h2>{title}</h2>
            <p>{description}</p>
        </header>
    );
}
function CapabilityConfigField(_: { value?: ModelCapabilityConfig; onChange?: (value: ModelCapabilityConfig) => void }) {
    return null;
}
function EnabledConfigField(_: { value?: boolean; onChange?: (value: boolean) => void }) {
    return null;
}
