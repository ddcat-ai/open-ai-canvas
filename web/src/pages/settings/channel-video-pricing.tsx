import { useState } from "react";
import { App, Button, InputNumber, Segmented, Select } from "antd";
import { FlaskConical } from "lucide-react";

import { testChannelModelConnection } from "@/lib/model-connection-test";
import { MODEL_PROTOCOL_OPTIONS, modelProtocolCapability, modelProtocolDefinition, modelProtocolLabel, type ModelProtocol } from "@/lib/model-protocols";
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
                <div><div className="text-xs font-medium">模型请求协议</div><div className="mt-0.5 text-[var(--fs-tiny)] text-foreground/42">测试会发起真实请求并可能产生供应商费用；视频价格仅用于成本记录</div></div>
                <span className="text-[var(--fs-tiny)] text-foreground/35">{channel.models.length} 个模型</span>
            </div>
            <div className="divide-y divide-border/60 rounded-md border border-border/70">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const cost = channel.modelCosts?.find((item) => item.model === model);
                    const protocol = cost?.protocol || defaultProtocolForModel(channel, model);
                    const capability = cost?.capability || modelProtocolCapability(protocol) || "text";
                    const billingMode = cost?.billingMode || "fixed_request";
                    return (
                        <div key={model} className="grid gap-2 px-2.5 py-2.5 lg:grid-cols-[minmax(140px,1fr)_minmax(280px,1.6fr)_176px_160px_96px] lg:items-center">
                            <div className="min-w-0"><div className="truncate text-xs font-medium" title={model}>{model}</div><div className="mt-0.5 truncate font-mono text-[var(--fs-tiny)] text-foreground/40" title={modelProtocolDefinition(protocol)?.create}>{modelProtocolDefinition(protocol)?.create}</div></div>
                            <Select<ModelProtocol>
                                size="small"
                                value={protocol}
                                options={MODEL_PROTOCOL_OPTIONS}
                                onChange={(value) => updateCost(model, { protocol: value, capability: modelProtocolCapability(value) || capability, billingMode: modelProtocolCapability(value) === "video" ? billingMode : "fixed_request" })}
                            />
                            {capability === "video" ? <Segmented size="small" block value={billingMode} options={[{ label: "按次", value: "fixed_request" }, { label: "按秒", value: "per_second" }]} onChange={(value) => updateCost(model, { billingMode: value as ModelCost["billingMode"] })} /> : <span className="text-center text-[var(--fs-tiny)] text-foreground/35">{modelProtocolLabel(protocol)}</span>}
                            {capability === "video" ? <InputNumber size="small" min={0} max={1_000_000} precision={6} step={0.1} className="w-full" placeholder={billingMode === "per_second" ? "每秒价格" : "每次价格"} addonAfter={`积分/${billingMode === "per_second" ? "秒" : "次"}`} value={cost ? cost.unitPriceMicrocredits / 1_000_000 : null} onChange={(value) => updateCost(model, { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })} /> : <span />}
                            <Button size="small" icon={<FlaskConical className="size-3.5" />} loading={testingModel === model} disabled={Boolean(testingModel && testingModel !== model)} onClick={() => void testModel(model, capability, protocol)}>测试</Button>
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
