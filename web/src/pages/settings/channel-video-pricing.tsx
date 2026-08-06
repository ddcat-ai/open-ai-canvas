import { useState } from "react";
import { App, Button, Drawer, InputNumber, Segmented, Tag } from "antd";
import { ChevronRight, FlaskConical, Settings2 } from "lucide-react";

import { testChannelModelConnection } from "@/lib/model-connection-test";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { CapabilityCardPicker, ProtocolCardPicker } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { MODEL_PROTOCOLS, modelProtocolCapability, modelProtocolDefinition, type ModelProtocol } from "@/lib/model-protocols";
import { modelMatchesCapability, modelOptionName, type ModelChannel } from "@/stores/use-config-store";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelModelSettings({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
    const [activeModel, setActiveModel] = useState<string | null>(null);
    if (!channel.models.length) return null;

    const updateCost = (model: string, patch: Partial<ModelCost>) => {
        const current = channel.modelCosts?.find((item) => item.model === model) || {
            model,
            capability: modelProtocolCapability(defaultProtocolForModel(channel, model)) || "text",
            protocol: defaultProtocolForModel(channel, model),
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 0,
            capabilityConfig: defaultModelCapabilityConfig(defaultProtocolForModel(channel, model)),
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
    const activeProtocol = activeModel ? activeModelCost?.protocol || defaultProtocolForModel(channel, activeModel) : undefined;
    const activeCapability = activeModel ? activeModelCost?.capability || modelProtocolCapability(activeProtocol) || "text" : undefined;
    const activeBillingMode = activeModelCost?.billingMode || "fixed_request";

    return (
        <div className="mt-3 border-t border-border/70 pt-3">
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
                    const protocol = cost?.protocol || defaultProtocolForModel(channel, model);
                    const capability = cost?.capability || modelProtocolCapability(protocol) || "text";
                    const billingMode = cost?.billingMode || "fixed_request";
                    return (
                        <div key={model} className="flex min-w-0 items-center gap-3 rounded-md border border-border/70 bg-background/45 px-3 py-2.5">
                            <span className="grid size-8 shrink-0 place-items-center rounded-md border border-border/70 bg-muted/35 text-foreground/65">
                                <Settings2 className="size-4" />
                            </span>
                            <div className="min-w-0 flex-1">
                                <div className="truncate text-xs font-medium" title={model}>
                                    {model}
                                </div>
                                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5">
                                    <Tag className="mr-0 text-[var(--fs-tiny)]" bordered={false}>
                                        {capabilityLabel(capability)}
                                    </Tag>
                                    <span className="truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={modelProtocolDefinition(protocol)?.create}>
                                        {modelProtocolDefinition(protocol)?.create || "待配置请求协议"}
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
                        <Button
                            size="small"
                            icon={<FlaskConical className="size-3.5" />}
                            loading={testingModel === activeModel}
                            disabled={Boolean(testingModel && testingModel !== activeModel)}
                            onClick={() => void testModel(activeModel, activeCapability, activeProtocol)}
                        >
                            测试模型
                        </Button>
                    ) : null
                }
            >
                {activeModel && activeCapability && activeProtocol ? (
                    <div className="space-y-4">
                        <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2.5">
                            <div className="text-xs font-medium">模型能力与请求协议</div>
                            <div className="mt-1 text-[var(--fs-tiny)] text-foreground/45">这些设置只影响当前渠道的这个模型，保存后会同步到生成校验。</div>
                        </div>
                        <section className="space-y-2">
                            <div className="text-xs font-medium">模型能力</div>
                            <CapabilityCardPicker
                                value={activeCapability}
                                onChange={(nextCapability) => {
                                    const nextProtocol = MODEL_PROTOCOLS.find((item) => item.value === activeProtocol && item.capability === nextCapability)?.value || MODEL_PROTOCOLS.find((item) => item.capability === nextCapability)?.value;
                                    if (!nextProtocol) return;
                                    updateCost(activeModel, {
                                        protocol: nextProtocol,
                                        capability: nextCapability,
                                        billingMode: nextCapability === "video" ? activeBillingMode : "fixed_request",
                                        capabilityConfig: nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol) : undefined,
                                    });
                                }}
                            />
                        </section>
                        <section className="space-y-2">
                            <div className="text-xs font-medium">请求协议</div>
                            <ProtocolCardPicker
                                capability={activeCapability}
                                value={activeProtocol}
                                onChange={(nextProtocol) => updateCost(activeModel, { protocol: nextProtocol, capabilityConfig: activeCapability === "video" ? defaultModelCapabilityConfig(nextProtocol) : undefined })}
                            />
                        </section>
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
                                        placeholder={activeBillingMode === "per_second" ? "每秒价格" : "每次价格"}
                                        addonAfter={`积分/${activeBillingMode === "per_second" ? "秒" : "次"}`}
                                        value={activeModelCost ? activeModelCost.unitPriceMicrocredits / 1_000_000 : null}
                                        onChange={(value) => updateCost(activeModel, { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })}
                                    />
                                </div>
                            </div>
                        ) : null}
                        {activeCapability === "video" ? (
                            <ModelCapabilityEditor value={activeModelCost?.capabilityConfig || defaultModelCapabilityConfig(activeProtocol)} protocol={activeProtocol} onChange={(capabilityConfig) => updateCost(activeModel, { capabilityConfig })} />
                        ) : null}
                    </div>
                ) : null}
            </Drawer>
        </div>
    );
}

function defaultProtocolForModel(channel: ModelChannel, model: string): ModelProtocol {
    if (channel.interfaceType) return channel.interfaceType;
    if (channel.apiFormat === "gemini" && modelMatchesCapability(model, "video")) return "gemini-veo";
    if (modelMatchesCapability(model, "video")) return "newapi";
    if (modelMatchesCapability(model, "image")) return "openai-image";
    return "chat-completion";
}

function capabilityLabel(value: ModelCost["capability"]) {
    return { text: "文本", image: "图片", video: "视频", audio: "音频", "": "待配置" }[value] || "待配置";
}
