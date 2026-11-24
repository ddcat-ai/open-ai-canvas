import { useEffect, useState } from "react";
import "./capability-template-panel.css";
import { Alert, App, Button, Form, Input, type FormInstance } from "antd";
import { Select } from "@/components/ui/base/select";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { useUserStore } from "@/stores/use-user-store";
import type { ModelProtocolDefinition } from "@/lib/model-protocols";
import type { ReferenceMediaTransport } from "@/lib/media-transport";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { AdminModal } from "../ui/overlays";
import { MediaTransportFields } from "./media-transport-fields";
import type { ChannelModelFormValues } from "./channel-model-editor-form";
import { applyCapabilityTemplate, capabilityTemplateReason, capabilityTemplates, priceSelectorIssues } from "./channel-model-templates";
import {
    assertCapabilityTemplateScope,
    CAPABILITY_TEMPLATES_CHANGED,
    capabilitySnapshot,
    capabilityTemplatesKey,
    readCapabilityTemplates,
    saveCapabilityTemplate,
    templateCapabilityForModel,
    type CapabilitySnapshot,
    type SavedCapabilityTemplate,
} from "./saved-capability-templates";

type Props = { form: FormInstance<ChannelModelFormValues>; protocols: ModelProtocolDefinition[]; channelMediaTransport?: ReferenceMediaTransport; disabled?: boolean; onApplied: (action: "apply" | "undo") => void };
type Draft = { name: string; config: CapabilitySnapshot; template?: SavedCapabilityTemplate };

function load(scope: string) {
    try {
        return { templates: readCapabilityTemplates(scope), error: "" };
    } catch (error) {
        return { templates: [] as SavedCapabilityTemplate[], error: error instanceof Error ? error.message : "无法读取能力模板" };
    }
}

export function CapabilityTemplatePanel(props: Props) {
    const scope = useUserStore((state) => state.user?.id || "guest");
    const capability = Form.useWatch("capability", { form: props.form, preserve: true });
    return <ScopedCapabilityTemplates key={`${scope}:${capability}`} {...props} scope={scope} />;
}

function ScopedCapabilityTemplates({ form, protocols, channelMediaTransport, disabled, onApplied, scope }: Props & { scope: string }) {
    const { message } = App.useApp();
    Form.useWatch([], { form, preserve: true });
    const values: ChannelModelFormValues = form.getFieldsValue(true);
    const [library, setLibrary] = useState(() => load(scope));
    const [selected, setSelected] = useState<string>();
    const [previous, setPrevious] = useState<CapabilitySnapshot>();
    const [draft, setDraft] = useState<Draft>();
    const templates = library.templates.filter((item) => item.capability === values.capability);
    const saved = templates.find((item) => item.id === selected);
    const builtin = capabilityTemplates.find((item) => item.id === selected);
    const title = saved?.name || builtin?.name;
    let preview: CapabilitySnapshot | undefined,
        reason = "";
    try {
        if (saved) preview = templateCapabilityForModel(saved, values);
        else if (builtin) preview = capabilitySnapshot(applyCapabilityTemplate(builtin.id, values));
    } catch (error) {
        reason = error instanceof Error ? error.message : "模板不可用";
    }
    const conflicts = preview ? priceSelectorIssues({ ...values, ...preview, protocols }) : [];
    const unavailable = disabled || Boolean(library.error) || values.capability === "audio";
    useEffect(() => {
        const refresh = () => setLibrary(load(scope));
        const changed = (event: Event) => {
            if ((event as CustomEvent).detail === scope) refresh();
        };
        const storage = (event: StorageEvent) => {
            if (event.key === null || event.key === capabilityTemplatesKey(scope)) refresh();
        };
        window.addEventListener(CAPABILITY_TEMPLATES_CHANGED, changed);
        window.addEventListener("storage", storage);
        return () => {
            window.removeEventListener(CAPABILITY_TEMPLATES_CHANGED, changed);
            window.removeEventListener("storage", storage);
        };
    }, [scope]);
    const perform = (action: () => void) => {
        try {
            assertCapabilityTemplateScope(scope);
            action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "能力模板操作失败");
        }
    };
    const currentPreview = () => {
        const current = form.getFieldsValue(true);
        if (builtin) return capabilitySnapshot(applyCapabilityTemplate(builtin.id, current));
        const latest = readCapabilityTemplates(scope).find((item) => item.id === selected);
        if (!latest || latest.revision !== saved?.revision) throw new Error("模板已变更，请重新选择并核对");
        return templateCapabilityForModel(latest, current);
    };
    const begin = (mode: "new" | "current" | "edit") =>
        perform(() => {
            const current = form.getFieldsValue(true);
            const config = mode === "edit" ? currentPreview() : capabilitySnapshot(mode === "new" ? { capability: current.capability, capabilityConfig: defaultModelCapabilityConfig() } : current);
            setDraft({ name: mode === "edit" ? title || "" : "", config, template: mode === "edit" ? saved : undefined });
        });
    const apply = (config: CapabilitySnapshot) => {
        form.setFieldValue("capabilityConfig", structuredClone(config.capabilityConfig));
    };
    return (
        <section className="admin-model-editor-section" aria-label="能力模板">
            <header className="admin-model-editor-section-heading">
                <h2>能力模板</h2>
                <p>保存在本机，应用后保存模型生效。</p>
            </header>
            <div className="admin-model-editor-section-content space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                    <Select
                        ariaLabel="选择能力模板"
                        placeholder="选择模板"
                        className="min-w-48 flex-1"
                        value={selected}
                        disabled={unavailable}
                        options={[...templates.map((item) => ({ value: item.id, label: item.name })), ...capabilityTemplates.map((item) => ({ value: item.id, label: `${item.name}（内置）`, disabled: Boolean(capabilityTemplateReason(item.id, values)) }))]}
                        onChange={(value) => setSelected(String(value))}
                    />
                    <Button
                        aria-label="应用能力模板"
                        disabled={unavailable || !preview}
                        onClick={() =>
                            perform(() => {
                                const next = currentPreview();
                                setPrevious(structuredClone({ capabilityConfig: form.getFieldValue("capabilityConfig") }));
                                apply(next);
                                onApplied("apply");
                            })
                        }
                    >
                        应用
                    </Button>
                    <Button aria-label="新增能力模板" disabled={unavailable} onClick={() => begin("new")}>
                        新增
                    </Button>
                    <Button aria-label="编辑能力模板" disabled={unavailable || !preview} onClick={() => begin("edit")}>
                        编辑
                    </Button>
                    <Button aria-label="将当前能力保存为模板" disabled={unavailable} onClick={() => begin("current")}>
                        存为模板
                    </Button>
                    {previous ? (
                        <Button
                            aria-label="撤销能力模板"
                            disabled={disabled}
                            onClick={() =>
                                perform(() => {
                                    apply(previous);
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
                {!protocols.some((item) => item.value === values.protocol && item.enabled !== false) ? <Alert type="warning" title="当前协议不可用，请先启用或选择协议" /> : null}
                {reason ? <Alert type="warning" title={reason} /> : null}
                {conflicts.length ? (
                    <Alert
                        type="warning"
                        title="与当前定价冲突"
                        description={
                            <ul>
                                {conflicts.map((issue) => (
                                    <li key={issue}>{issue}</li>
                                ))}
                            </ul>
                        }
                    />
                ) : null}
            </div>
            {draft ? (
                <CapabilityTemplateEditor
                    scope={scope}
                    draft={draft}
                    capability={values.capability as SavedCapabilityTemplate["capability"]}
                    channelMediaTransport={channelMediaTransport}
                    disabled={disabled}
                    onClose={() => setDraft(undefined)}
                    onSaved={(item) => {
                        setSelected(item.id);
                        setDraft(undefined);
                        message.success("能力模板已保存");
                    }}
                />
            ) : null}
        </section>
    );
}

function CapabilityTemplateEditor({
    scope,
    draft,
    capability,
    channelMediaTransport,
    disabled,
    onClose,
    onSaved,
}: {
    scope: string;
    draft: Draft;
    capability: SavedCapabilityTemplate["capability"];
    channelMediaTransport?: ReferenceMediaTransport;
    disabled?: boolean;
    onClose: () => void;
    onSaved: (template: SavedCapabilityTemplate) => void;
}) {
    const [config, setConfig] = useState(draft.config);
    const [name, setName] = useState(draft.name);
    const [error, setError] = useState("");
    const save = () => {
        try {
            onSaved(saveCapabilityTemplate(scope, name, { capability, ...config }, draft.template));
        } catch (cause) {
            setError(cause instanceof Error ? cause.message : "请检查模板配置");
        }
    };
    return (
        <AdminModal
            open
            title={draft.template ? "编辑能力模板" : "新增能力模板"}
            width={960}
            className="admin-capability-template-modal"
            onCancel={onClose}
            footer={
                <>
                    <Button onClick={onClose}>取消</Button>
                    <Button type="primary" disabled={disabled} onClick={save}>
                        保存
                    </Button>
                </>
            }
        >
            <div className="admin-capability-template-content space-y-4">
                <label className="block space-y-2">
                    <span>名称</span>
                    <Input aria-label="能力模板名称" value={name} maxLength={48} disabled={disabled} onChange={(event) => setName(event.target.value)} />
                </label>
                {error ? <Alert type="error" title={error} /> : null}
                <section className="space-y-3">
                    <h3 className="font-medium">引用与限制</h3>
                    <MediaTransportFields channel={channelMediaTransport || {}} value={config.capabilityConfig?.mediaTransport} onChange={(mediaTransport) => setConfig({ ...config, capabilityConfig: { ...config.capabilityConfig!, mediaTransport } })} />
                    <ModelCapabilityEditor
                        capability={capability}
                        templateEditing
                        value={config.capabilityConfig}
                        section="references"
                        disabled={disabled}
                        onChange={(next) => setConfig({ ...config, capabilityConfig: { ...next, mediaTransport: config.capabilityConfig?.mediaTransport } })}
                    />
                </section>
                <section className="space-y-3">
                    <h3 className="font-medium">能力参数</h3>
                    <ModelCapabilityEditor
                        capability={capability}
                        templateEditing
                        value={config.capabilityConfig}
                        section="protocol"
                        disabled={disabled}
                        onChange={(next) => setConfig({ ...config, capabilityConfig: { ...next, mediaTransport: config.capabilityConfig?.mediaTransport } })}
                    />
                </section>
            </div>
        </AdminModal>
    );
}
