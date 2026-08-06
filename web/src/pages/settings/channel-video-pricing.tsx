import { useState } from "react";
import { App, Button, InputNumber, Segmented } from "antd";
import { FlaskConical } from "lucide-react";

import { testChannelModelConnection } from "@/lib/model-connection-test";
import { ModelCapabilityEditor } from "@/components/model-capability-editor";
import { ModelCapabilityProtocolModal } from "@/components/model-protocol-picker";
import { defaultModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolCapability, modelProtocolDefinition, type ModelProtocol } from "@/lib/model-protocols";
import { modelMatchesCapability, modelOptionName, type ModelChannel } from "@/stores/use-config-store";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelModelSettings({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    const { message } = App.useApp();
    const [testingModel, setTestingModel] = useState("");
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

    return (
        <div className="mt-3 border-t border-border/70 pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div><div className="text-xs font-medium">模型能力与请求协议</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">与运营后台使用同一能力目录；测试会发起真实请求并可能产生供应商费用</div></div>
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
                        <div key={model} className="rounded-md border border-border/70 bg-background/45 p-2.5">
                            <div className="flex min-w-0 items-center justify-between gap-2">
                                <div className="min-w-0"><div className="truncate text-xs font-medium" title={model}>{model}</div><div className="mt-0.5 truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={modelProtocolDefinition(protocol)?.create}>{modelProtocolDefinition(protocol)?.create}</div></div>
                                <Button size="small" icon={<FlaskConical className="size-3.5" />} loading={testingModel === model} disabled={Boolean(testingModel && testingModel !== model)} onClick={() => void testModel(model, capability, protocol)}>测试</Button>
                            </div>
                            <div className="mt-2 space-y-2">
                                <ModelCapabilityProtocolModal
                                    value={{ capability, protocol }}
                                    onChange={({ capability: nextCapability, protocol: nextProtocol }) => updateCost(model, { protocol: nextProtocol, capability: nextCapability, billingMode: nextCapability === "video" ? billingMode : "fixed_request", capabilityConfig: nextCapability === "video" ? defaultModelCapabilityConfig(nextProtocol) : undefined })}
                                />
                                {capability === "video" ? <div className="grid gap-2 lg:grid-cols-[176px_1fr]"><Segmented size="small" block value={billingMode} options={[{ label: "按次", value: "fixed_request" }, { label: "按秒", value: "per_second" }]} onChange={(value) => updateCost(model, { billingMode: value as ModelCost["billingMode"] })} /><InputNumber size="small" min={0} max={1_000_000} precision={6} step={0.1} className="w-full" placeholder={billingMode === "per_second" ? "每秒价格" : "每次价格"} addonAfter={`积分/${billingMode === "per_second" ? "秒" : "次"}`} value={cost ? cost.unitPriceMicrocredits / 1_000_000 : null} onChange={(value) => updateCost(model, { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })} /></div> : null}
                                {capability === "video" ? <ModelCapabilityEditor value={cost?.capabilityConfig || defaultModelCapabilityConfig(protocol)} protocol={protocol} onChange={(capabilityConfig) => updateCost(model, { capabilityConfig })} /> : null}
                            </div>
                        </div>
                    );
                })}
            </div>
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
