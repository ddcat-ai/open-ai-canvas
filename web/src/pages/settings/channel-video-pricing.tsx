import { useEffect, useState } from "react";
import { App, Button, Drawer, InputNumber, Segmented, Tag } from "antd";
import { ChevronRight, FlaskConical, Settings2 } from "lucide-react";

import { testChannelModelConnection } from "@/lib/model-connection-test";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker, type ModelCapabilityChoice } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, modelProtocolDefinition, modelProtocolSupportsTokenBilling, type ModelProtocol, type ModelProtocolDefinition } from "@/lib/model-protocols";
import { fetchPluginProviderCatalog } from "@/services/api/plugin-catalog";
import { modelOptionName, type ModelChannel } from "@/stores/use-config-store";
import { buildModelProtocolPatch } from "./channel-model-protocol-preset";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelModelSettings({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
    const [activeModel, setActiveModel] = useState<string | null>(null);
    const [availableProtocols, setAvailableProtocols] = useState<ModelProtocolDefinition[]>([]);

    useEffect(() => {
        void fetchPluginProviderCatalog("user.custom-channel").then(setAvailableProtocols).catch(() => setAvailableProtocols([]));
    }, []);

    if (!channel.models.length) return null;

    const updateCost = (model: string, patch: Partial<ModelCost>) => {
        const defaultProtocol = defaultProtocolForModel(channel, model, availableProtocols);
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
            message.success(`模型测试通过：${detail}`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "模型测试失败");
        } finally {
            setTestingModel("");
        }
    };

    const activeModelCost = activeModel ? channel.modelCosts?.find((item) => item.model === activeModel) : undefined;
    const inferredProtocol = activeModel ? defaultProtocolForModel(channel, activeModel, availableProtocols) : "";
    const activeProtocol = activeModelCost?.protocol || inferredProtocol;
    const activeCapability = activeModelCost?.capability || modelProtocolCapability(activeProtocol, availableProtocols) || (activeModel ? inferCapabilityFromModel(activeModel) : "text");
    const activeBillingMode = activeModelCost?.billingMode || "fixed_request";
    const activeTokenBillingSupported = modelProtocolSupportsTokenBilling(activeCapability, activeProtocol);

    return (
        <div className="mt-4">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                    <div className="text-xs font-medium">模型能力与请求协议</div>
                    <div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">与运营后台使用同一能力目录；测试会发起真实请求并可能产生供应商费用</div>
                </div>
                <span className="text-[var(--fs-tiny)] text-foreground/35">{channel.models.length} 个模型</span>
            </div>
            <div className="space-y-2">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const cost = channel.modelCosts?.find((item) => item.model === model);
                    const protocol = cost?.protocol || defaultProtocolForModel(channel, model, availableProtocols);
                    const capability = cost?.capability || modelProtocolCapability(protocol, availableProtocols) || inferCapabilityFromModel(model);
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
                                        {modelProtocolDefinition(protocol, availableProtocols)?.create || "待配置请求协议"}
                                    </span>
                                </div>
                            </div>
                            <Button type="text" size="small" icon={<ChevronRight className="size-4" />} iconPosition="end" onClick={() => setActiveModel(model)}>
                                配置使用
                            </Button>
                        </div>
                    );
                })}
            </div>
            <Drawer
                title={activeModel ? `${activeModel} · 使用配置` : "模型使用配置"}
                open={Boolean(activeModel)}
                onClose={() => setActiveModel(null)}
                size="min(720px, 100vw)"
                destroyOnHidden
                extra={
                    activeModel && activeCapability && activeProtocol ? (
                        <div className="flex items-center gap-2">
                            <Button
                                size="small"
                                icon={<FlaskConical className="size-3.5" />}
                                loading={testingModel === activeModel}
                                disabled={Boolean(testingModel && testingModel !== activeModel)}
                                onClick={() => void testModel(activeModel, activeCapability, activeProtocol)}
                            >
                                测试模型
                            </Button>
                            <Button
                                type="primary"
                                size="small"
                                onClick={() => {
                                    message.success(`${activeModel} 配置已自动保存`);
                                    setActiveModel(null);
                                }}
                            >
                                完成
                            </Button>
                        </div>
                    ) : (
                        <Button
                            type="primary"
                            size="small"
                            onClick={() => {
                                if (activeModel) message.success(`${activeModel} 配置已自动保存`);
                                setActiveModel(null);
                            }}
                        >
                            完成
                        </Button>
                    )
                }
                footer={
                    <div className="flex items-center justify-between py-1">
                        <span className="flex items-center gap-1.5 text-xs text-foreground/50">
                            <span className="size-1.5 rounded-full bg-emerald-500" />
                            更改已实时自动保存到渠道配置
                        </span>
                        <Button
                            type="primary"
                            size="small"
                            onClick={() => {
                                if (activeModel) message.success(`${activeModel} 配置已生效`);
                                setActiveModel(null);
                            }}
                        >
                            完成配置并关闭
                        </Button>
                    </div>
                }
            >
                {activeModel ? (
                    <div className="space-y-4">
                        <div className="rounded-md bg-surface-active px-3 py-2.5">
                            <div className="text-xs font-medium">模型能力与请求协议</div>
                            <div className="mt-1 text-[var(--fs-tiny)] text-foreground/45">这些设置只影响当前渠道的这个模型，保存后会同步到生成校验。</div>
                        </div>
                        <section className="space-y-2">
                            <div className="text-xs font-medium">模型能力</div>
                            <CapabilityCardPicker
                                value={activeCapability}
                                onChange={(nextCapability) => {
                                    const nextProtocol = availableProtocols.find((item) => item.value === activeProtocol && item.capability === nextCapability)?.value || availableProtocols.find((item) => item.capability === nextCapability && item.enabled !== false)?.value || defaultProtocolForCapability(nextCapability, availableProtocols);
                                    updateCost(activeModel, {
                                        protocol: nextProtocol,
                                        capability: nextCapability,
                                        billingMode: activeBillingMode === "per_second" && nextCapability === "video" ? "per_second" : activeBillingMode === "token" && modelProtocolSupportsTokenBilling(nextCapability, nextProtocol) ? "token" : "fixed_request",
                                        capabilityConfig: nextCapability === "image" || nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol, activeModel) : undefined,
                                    });
                                }}
                            />
                        </section>
                        {availableProtocols.length ? (
                            <section className="space-y-2">
                                <div className="text-xs font-medium">请求协议</div>
                                <ProtocolCardPicker
                                    capability={activeCapability}
                                    value={activeProtocol}
                                    protocols={availableProtocols}
                                    onChange={(nextProtocol) => {
                                        const result = buildModelProtocolPatch({
                                            model: activeModel,
                                            capability: activeCapability,
                                            protocol: nextProtocol,
                                            billingMode: activeBillingMode,
                                            definitions: availableProtocols,
                                        });
                                        if (!result.patch) {
                                            message.warning(result.preset.incompatibleReason || "当前模型不支持该请求协议");
                                            return;
                                        }
                                        updateCost(activeModel, result.patch);
                                    }}
                                />
                            </section>
                        ) : null}
                        {activeCapability === "video" ? (
                            <div className="space-y-2">
                                <div className="text-xs font-medium">计费方式</div>
                                <div className="grid gap-2 lg:grid-cols-[176px_1fr]">
                                    <Segmented
                                        size="small"
                                        block
                                        value={activeBillingMode}
                                        options={[
                                            { label: "按次", value: "fixed_request" },
                                            { label: "按秒", value: "per_second" },
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
                                        placeholder={activeBillingMode === "token" ? "每百万视频 Token 价格" : activeBillingMode === "per_second" ? "每秒价格" : "每次价格"}
                                        addonAfter={`积分/${activeBillingMode === "token" ? "百万 Token" : activeBillingMode === "per_second" ? "秒" : "次"}`}
                                        value={activeModelCost ? (activeBillingMode === "token" ? (activeModelCost.outputTokenPriceMicrocredits || 0) : activeModelCost.unitPriceMicrocredits) / 1_000_000 : null}
                                        onChange={(value) => updateCost(activeModel, activeBillingMode === "token" ? { outputTokenPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) } : { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })}
                                    />
                                </div>
                                {activeBillingMode === "token" ? <div className="text-[var(--fs-tiny)] text-foreground/45">按火山方舟任务查询响应的 usage.completion_tokens 结算。</div> : null}
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

function defaultProtocolForModel(channel: ModelChannel, model: string, availableProtocols: ModelProtocolDefinition[] = []): ModelProtocol {
    if (channel.interfaceType) {
        return channel.interfaceType;
    }
    const capability = inferCapabilityFromModel(model);
    return defaultProtocolForCapability(capability, availableProtocols);
}

function capabilityLabel(value: ModelCost["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value] || "待配置";
}
