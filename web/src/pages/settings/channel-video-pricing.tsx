import { useEffect, useState } from "react";
import { App, Button, Drawer, InputNumber, Segmented, Tag } from "antd";
import { ChevronRight, FlaskConical, Settings2 } from "lucide-react";

import { testChannelModelConnection } from "@/lib/model-connection-test";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, modelProtocolDefinition, modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import { fetchProtocolCatalog } from "@/services/api/protocols";
import { modelOptionName, type ModelChannel } from "@/stores/use-config-store";
import { useTranslation } from "react-i18next";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelModelSettings({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    const { t } = useTranslation("canvas");
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
    const [activeModel, setActiveModel] = useState<string | null>(null);
    const [availableProtocols, setAvailableProtocols] = useState<import("@/lib/model-protocols").ModelProtocolDefinition[]>([]);
    useEffect(() => {
        void fetchProtocolCatalog("user.custom-channel").then(setAvailableProtocols).catch(() => setAvailableProtocols([]));
    }, []);
    if (!channel.models.length) return null;

    const updateCost = (model: string, patch: Partial<ModelCost>) => {
        const current = channel.modelCosts?.find((item) => item.model === model) || {
            model,
            capability: modelProtocolCapability(defaultProtocolForModel(channel, model), availableProtocols) || "text",
            protocol: defaultProtocolForModel(channel, model),
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 0,
            capabilityConfig: defaultModelCapabilityConfig(defaultProtocolForModel(channel, model), model),
        };
        const next = [...(channel.modelCosts || []).filter((item) => item.model !== model), { ...current, ...patch, model }];
        onChange(next.filter((item) => channel.models.includes(item.model)));
    };

    const testModel = async (model: string, capability: ModelCost["capability"], protocol: ModelProtocol) => {
        setTestingModel(model);
        try {
            const detail = await testChannelModelConnection(channel, model, capability, protocol);
            message.success(t("settings:model-test-passed-param", { detail: detail }));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("settings:model-test-failed"));
        } finally {
            setTestingModel("");
        }
    };

    const activeModelCost = activeModel ? channel.modelCosts?.find((item) => item.model === activeModel) : undefined;
    const activeProtocol = activeModel ? activeModelCost?.protocol || defaultProtocolForModel(channel, activeModel) : undefined;
    const activeCapability = activeModel ? activeModelCost?.capability || modelProtocolCapability(activeProtocol, availableProtocols) || "text" : undefined;
    const activeBillingMode = activeModelCost?.billingMode || "fixed_request";
    const activeTokenBillingSupported = modelProtocolSupportsTokenBilling(activeCapability, activeProtocol);

    return (
        <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs font-medium">{t("settings:model-capabilities-and-request-protocols-2")}</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">{t("settings:uses-the-same-capability-catalog-as-the-admin-console-tests-send-real-re")}</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/35">
                    {channel.models.length} {t("settings:models-2")}
                </span>
            </div>
            <div className="space-y-2">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const cost = channel.modelCosts?.find((item) => item.model === model);
                    const protocol = cost?.protocol || defaultProtocolForModel(channel, model);
                    const capability = cost?.capability || modelProtocolCapability(protocol, availableProtocols) || "text";
                    const billingMode = cost?.billingMode || "fixed_request";
                    const displayName = cost?.displayName?.trim() || model;
                    return (
                        <div key={model} className="flex min-w-0 items-center gap-3 rounded-md bg-surface-active px-3 py-2.5 transition-colors hover:bg-surface-hover">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md bg-foreground/[.045] text-foreground/65">
                                <Settings2 className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium" title={displayName === model ? model : `${displayName} (${model})`}>
                                    {displayName}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                    <Tag className="mr-0 text-[var(--fs-tiny)]" bordered={false}>
                                        {capabilityLabel(capability)}
                                    </Tag>
                                    <span className="truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={modelProtocolDefinition(protocol, availableProtocols)?.create}>
                                        {modelProtocolDefinition(protocol, availableProtocols)?.create || t("settings:request-protocol-not-configured-yet")}
                                    </span>
                                </div>
                            </div>
                            <Button type="text" size="small" icon={<ChevronRight className="size-4" />} iconPosition="end" onClick={() => setActiveModel(model)}>
                                {t("settings:configure-usage")}
                            </Button>
                        </div>
                    );
                })}
            </div>
            <Drawer
                title={activeModel ? t("settings:param-usage-settings", { activeModel: activeModel }) : t("settings:model-usage-settings")}
                open={Boolean(activeModel)}
                onClose={() => setActiveModel(null)}
                size="min(720px, 100vw)"
                destroyOnHidden
                extra={
                    activeModel && activeCapability && activeProtocol ? (
                        <Button
                            size="small"
                            icon={<FlaskConical className="size-3.5" />}
                            loading={testingModel === activeModel}
                            disabled={Boolean(testingModel && testingModel !== activeModel)}
                            onClick={() => void testModel(activeModel, activeCapability, activeProtocol)}
                        >
                            {t("settings:test-model")}
                        </Button>
                    ) : null
                }
            >
                {activeModel && activeCapability && activeProtocol ? (
                    <div className="space-y-4">
                        <div className="rounded-md bg-surface-active px-3 py-2.5">
                            <div className="text-xs font-medium">{t("settings:model-capabilities-and-request-protocols-2")}</div>
                            <div className="mt-1 text-[var(--fs-tiny)] text-foreground/45">{t("settings:these-settings-apply-only-to-this-model-on-this-channel-and-sync-to-gene")}</div>
                        </div>
                        <section className="space-y-2">
                            <div className="text-xs font-medium">{t("settings:model-capabilities")}</div>
                            <CapabilityCardPicker
                                value={activeCapability}
                                onChange={(nextCapability) => {
                                    const nextProtocol = availableProtocols.find((item) => item.value === activeProtocol && item.capability === nextCapability)?.value || availableProtocols.find((item) => item.capability === nextCapability)?.value;
                                    if (!nextProtocol) return;
                                    updateCost(activeModel, {
                                        protocol: nextProtocol,
                                        capability: nextCapability,
                                        billingMode:
                                            activeBillingMode === "per_second" && nextCapability === "video" ? "per_second" : activeBillingMode === "token" && modelProtocolSupportsTokenBilling(nextCapability, nextProtocol) ? "token" : "fixed_request",
                                        capabilityConfig: nextCapability === "image" || nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel) : undefined,
                                    });
                                }}
                            />
                        </section>
                        {availableProtocols.length ? (
                            <section className="space-y-2">
                                <div className="text-xs font-medium">{t("settings:request-protocol")}</div>
                                <ProtocolCardPicker
                                    capability={activeCapability}
                                    value={activeProtocol}
                                    protocols={availableProtocols}
                                    onChange={(nextProtocol) =>
                                        updateCost(activeModel, {
                                            protocol: nextProtocol,
                                            billingMode: activeBillingMode === "token" && !modelProtocolSupportsTokenBilling(activeCapability, nextProtocol) ? "fixed_request" : activeBillingMode,
                                            capabilityConfig: activeCapability === "image" || activeCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel) : undefined,
                                        })
                                    }
                                />
                            </section>
                        ) : null}
                        {activeCapability === "video" ? (
                            <div className="space-y-2">
                                <div className="text-xs font-medium">{t("settings:billing-basis")}</div>
                                <div className="grid gap-2 lg:grid-cols-[176px_1fr]">
                                    <Segmented
                                        size="small"
                                        block
                                        value={activeBillingMode}
                                        options={[
                                            { label: t("settings:per-request"), value: "fixed_request" },
                                            { label: t("settings:per-second"), value: "per_second" },
                                            { label: "Token", value: "token", disabled: !activeTokenBillingSupported },
                                        ]}
                                        onChange={(value) => updateCost(activeModel, { billingMode: value as ModelCost["billingMode"] })}
                                    />
                                    <InputNumber
                                        size="small"
                                        min={0}
                                        max={1_000_000}
                                        precision={6}
                                        step={0.1}
                                        className="w-full"
                                        placeholder={activeBillingMode === "token" ? t("settings:price-per-million-video-tokens") : activeBillingMode === "per_second" ? t("settings:price-per-second") : t("settings:price-per-request")}
                                        addonAfter={`积分/${activeBillingMode === "token" ? t("settings:million-tokens") : activeBillingMode === "per_second" ? t("settings:s") : t("settings:requests")}`}
                                        value={activeModelCost ? (activeBillingMode === "token" ? activeModelCost.outputTokenPriceMicrocredits || 0 : activeModelCost.unitPriceMicrocredits) / 1_000_000 : null}
                                        onChange={(value) =>
                                            updateCost(activeModel, activeBillingMode === "token" ? { outputTokenPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) } : { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })
                                        }
                                    />
                                </div>
                                {activeBillingMode === "token" ? <div className="text-[var(--fs-tiny)] text-foreground/45">{t("settings:billed-by-usage-completion-tokens-in-the-volcano-ark-task-query-response")}</div> : null}
                            </div>
                        ) : null}
                        {activeCapability === "image" || activeCapability === "video" ? (
                            <ModelCapabilityEditor
                                capability={activeCapability}
                                model={activeModel}
                                value={activeModelCost?.capabilityConfig || defaultModelCapabilityConfig(activeProtocol, activeModel)}
                                protocol={activeProtocol}
                                onChange={(capabilityConfig) => updateCost(activeModel, { capabilityConfig })}
                            />
                        ) : null}
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function defaultProtocolForModel(channel: ModelChannel, model: string): ModelProtocol {
    return channel.interfaceType || "";
}

function capabilityLabel(value: ModelCost["capability"]) {
    const { t } = useTranslation("canvas");
    return { text: t("settings:text"), image: t("settings:image"), video: t("settings:video"), audio: t("settings:audio"), "": t("settings:pending-config") }[value] || t("settings:pending-config");
}
