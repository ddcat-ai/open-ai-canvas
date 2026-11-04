import { useEffect, useState } from "react";
import { App, Button, Segmented, Tag } from "antd";
import { ChevronRight, FlaskConical, Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";

import { translate } from "@/i18n";
import { ModelEditorModal } from "@/components/model-editor-modal";
import { ModelProtocolBrowser } from "@/components/model-protocol-browser";
import { testChannelModelConnection } from "@/lib/model-connection-test";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, modelProtocolDefinition, type ModelProtocol, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { modelOptionName, type ModelChannel } from "@/stores/use-config-store";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelModelSettings({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    const { t } = useTranslation();
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
    const [editorTab, setEditorTab] = useState("protocol");
    const [protocolLoading, setProtocolLoading] = useState(true);
    const [protocolError, setProtocolError] = useState("");
    const [activeModel, setActiveModel] = useState<string | null>(null);
    const [availableProtocols, setAvailableProtocols] = useState<ModelProtocolDefinition[]>([]);

    useEffect(() => {
        let active = true;
        void fetchPluginProviderCatalog("user.custom-channel").then((items) => { if (active) setAvailableProtocols(items); })
            .catch((error) => { if (active) setProtocolError(error instanceof Error ? error.message : t("account.settings.modelConfig.protocolLoadFailed")); })
            .finally(() => { if (active) setProtocolLoading(false); });
        return () => { active = false; };
    }, []);

    if (!channel.models.length) return null;

    const updateCost = (model: string, patch: Partial<ModelCost>) => {
        const defaultProtocol = defaultProtocolForModel(model, availableProtocols);
        const defaultCap = modelProtocolCapability(defaultProtocol, availableProtocols) || inferCapabilityFromModel(model);
        const current = channel.modelCosts?.find((item) => item.model === model) || {
            model,
            capability: defaultCap,
            protocol: defaultProtocol,
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 0,
            capabilityConfig: defaultModelCapabilityConfig(defaultProtocol, model),
        };
        const next = [...(channel.modelCosts || []).filter((item) => item.model !== model), { ...current, ...patch, model }];
        onChange(next.filter((item) => channel.models.includes(item.model)));
    };

    const testModel = async (model: string, capability: ModelCost["capability"], protocol: ModelProtocol) => {
        setTestingModel(model);
        try {
            const detail = await testChannelModelConnection(channel, model, capability, protocol);
            message.success(t("account.settings.modelConfig.testPassed", { detail }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("account.settings.modelConfig.testFailed"));
        } finally {
            setTestingModel("");
        }
    };

    const activeModelCost = activeModel ? channel.modelCosts?.find((item) => item.model === activeModel) : undefined;
    const inferredProtocol = activeModel ? defaultProtocolForModel(activeModel, availableProtocols) : "";
    const activeProtocol = activeModelCost?.protocol || inferredProtocol;
    const activeCapability = activeModelCost?.capability || modelProtocolCapability(activeProtocol, availableProtocols) || (activeModel ? inferCapabilityFromModel(activeModel) : "text");

    return (
        <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs font-medium">{t("account.settings.modelConfig.title")}</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">{t("account.settings.modelConfig.description")}</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/35">{t("account.settings.modelConfig.modelCount", { count: channel.models.length })}</span>
            </div>
            <div className="space-y-2">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const cost = channel.modelCosts?.find((item) => item.model === model);
                    const protocol = cost?.protocol || defaultProtocolForModel(model, availableProtocols);
                    const capability = cost?.capability || modelProtocolCapability(protocol, availableProtocols) || inferCapabilityFromModel(model);
                    const displayName = cost?.displayName?.trim() || model;
                    return (
                        <div key={model} className="flex min-w-0 items-center gap-3 rounded-md bg-surface-active px-3 py-2 transition-colors hover:bg-surface-hover">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.045] text-foreground/65">
                                <Settings2 className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium" title={displayName === model ? model : `${displayName} (${model})`}>
                                    {displayName}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2">
                                    <Tag className="mr-0 text-[var(--fs-tiny)]" bordered={false}>
                                        {capabilityLabel(capability)}
                                    </Tag>
                                    <span className="truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={modelProtocolDefinition(protocol, availableProtocols)?.create}>
                                        {modelProtocolDefinition(protocol, availableProtocols)?.create || t("account.settings.modelConfig.protocolPending")}
                                    </span>
                                </div>
                            </div>
                            <Button type="text" size="small" icon={<ChevronRight className="size-4" />} iconPosition="end" onClick={() => { setEditorTab("protocol"); setActiveModel(model); }}>
                                {t("account.settings.modelConfig.configure")}
                            </Button>
                        </div>
                    );
                })}
            </div>
            <ModelEditorModal
                open={Boolean(activeModel)}
                busy={Boolean(testingModel)}
                title={t("account.settings.modelConfig.editTitle")}
                subtitle={activeModel || ""}
                activeKey={editorTab}
                onTabChange={setEditorTab}
                onClose={() => setActiveModel(null)}
                footer={
                    <div className="model-editor-footer">
                        <span className="text-xs text-foreground/50">{t("account.settings.channels.autoSave")}</span>
                        <div className="model-editor-footer-actions">
                            <Button
                                icon={<FlaskConical className="size-4" />}
                                loading={Boolean(testingModel)}
                                disabled={!activeProtocol || protocolLoading || Boolean(protocolError)}
                                onClick={() => { if (activeModel && activeProtocol) void testModel(activeModel, activeCapability, activeProtocol); }}
                            >
                                {t("account.settings.modelConfig.test")}
                            </Button>
                            <Button type="primary" disabled={Boolean(testingModel)} onClick={() => setActiveModel(null)}>{t("account.payment.done")}</Button>
                        </div>
                    </div>
                }
                items={activeModel ? [
                    {
                        key: "protocol",
                        label: t("account.settings.modelConfig.tabBasic"),
                        children: <div className="space-y-4" inert={Boolean(testingModel)}>
                            <section className="space-y-2">
                                <div className="text-xs font-medium">{t("account.settings.modelConfig.capability")}</div>
                                <Segmented<ModelCapabilityChoice>
                                    block
                                    options={[{ label: t("account.settings.modelConfig.capabilities.text"), value: "text" }, { label: t("account.settings.modelConfig.capabilities.image"), value: "image" }, { label: t("account.settings.modelConfig.capabilities.video"), value: "video" }, { label: t("account.settings.modelConfig.capabilities.audio"), value: "audio" }]}
                                    value={activeCapability}
                                    onChange={(nextCapability) => {
                                        const nextProtocol = availableProtocols.find((item) => item.value === activeProtocol && item.capability === nextCapability)?.value || availableProtocols.find((item) => item.capability === nextCapability && item.enabled !== false)?.value || defaultProtocolForCapability(nextCapability, availableProtocols);
                                        updateCost(activeModel, {
                                            protocol: nextProtocol,
                                            capability: nextCapability,
                                            billingMode: "fixed_request",
                                            unitPriceMicrocredits: 0,
                                            capabilityConfig: nextCapability === "text" || nextCapability === "image" || nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel) : undefined,
                                        });
                                    }}
                                />
                            </section>
                            <section className="space-y-2">
                                <div className="text-xs font-medium">{t("account.settings.modelConfig.protocol")}</div>
                                <ModelProtocolBrowser
                                    loading={protocolLoading}
                                    error={protocolError}
                                    capability={activeCapability}
                                    value={activeProtocol}
                                    protocols={availableProtocols}
                                    onChange={(nextProtocol) => updateCost(activeModel, {
                                        protocol: nextProtocol,
                                        billingMode: "fixed_request",
                                        unitPriceMicrocredits: 0,
                                        capabilityConfig: activeCapability === "text" || activeCapability === "image" || activeCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel) : undefined,
                                    })}
                                />
                            </section>
                        </div>,
                    },
                    {
                        key: "capabilities",
                        label: t("account.settings.modelConfig.tabCapabilities"),
                        children: <div inert={Boolean(testingModel)}>
                            {activeCapability === "text" || activeCapability === "image" || activeCapability === "video" ? (
                                <ModelCapabilityEditor
                                    capability={activeCapability}
                                    model={activeModel}
                                    value={activeModelCost?.capabilityConfig || defaultModelCapabilityConfig(activeProtocol, activeModel)}
                                    protocol={activeProtocol}
                                    workflows={modelProtocolDefinition(activeProtocol, availableProtocols)?.workflows}
                                    imageParameters={modelProtocolDefinition(activeProtocol, availableProtocols)?.imageParameters}
                                    onChange={(capabilityConfig) => updateCost(activeModel, { capabilityConfig })}
                                />
                            ) : <p className="text-xs text-foreground/50">{t("account.settings.modelConfig.noParameters")}</p>}
                        </div>,
                    },
                ] : []}
            />
        </div>
    );
}

function inferCapabilityFromModel(model: string): ModelCapabilityChoice {
    const lower = model.toLowerCase();
    if (
        lower.includes("seedream") ||
        lower.includes("image") ||
        lower.includes("dall-e") ||
        lower.includes("dalle") ||
        lower.includes("flux") ||
        lower.includes("imagen") ||
        lower.includes("banana") ||
        lower.includes("midjourney") ||
        lower.includes("sdxl") ||
        lower.includes("stable-diffusion")
    ) {
        return "image";
    }
    if (
        lower.includes("video") ||
        lower.includes("sora") ||
        lower.includes("veo") ||
        lower.includes("kling") ||
        lower.includes("seedance") ||
        lower.includes("minimax") ||
        lower.includes("hailuo") ||
        lower.includes("pika") ||
        lower.includes("runway") ||
        lower.includes("omni") ||
        lower.includes("cogvideo") ||
        lower.includes("wan")
    ) {
        return "video";
    }
    if (
        lower.includes("audio") ||
        lower.includes("tts") ||
        lower.includes("voice") ||
        lower.includes("speech") ||
        lower.includes("sound") ||
        lower.includes("music")
    ) {
        return "audio";
    }
    return "text";
}

function defaultProtocolForCapability(capability: ModelCapabilityChoice, availableProtocols: ModelProtocolDefinition[]): ModelProtocol {
    const standardProtocols: Record<string, string[]> = {
        text: ["chat-completion", "openai-response"],
        image: ["openai-image"],
        video: ["newapi-channel-2", "newapi"],
        audio: ["openai-audio"],
    };
    const preferred = standardProtocols[capability] || [];
    for (const id of preferred) {
        if (availableProtocols.some((p) => p.value === id && p.enabled !== false)) {
            return id;
        }
    }
    const matched = availableProtocols.find((p) => p.capability === capability && p.enabled !== false);
    if (matched) return matched.value;
    const fallbackMap: Record<string, string> = {
        text: "chat-completion",
        image: "openai-image",
        video: "newapi-channel-2",
        audio: "openai-audio",
    };
    return fallbackMap[capability] || "chat-completion";
}

function defaultProtocolForModel(model: string, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    const capability = inferCapabilityFromModel(model);
    return defaultProtocolForCapability(capability, availableProtocols);
}

function capabilityLabel(value: ModelCost["capability"]) {
    return translate(value && ["text", "image", "video", "audio"].includes(value) ? `account.settings.modelConfig.capabilities.${value}` : "account.settings.modelConfig.capabilities.pending");
}
