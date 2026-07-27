import { InputNumber, Segmented } from "antd";

import { modelOptionName, type ModelChannel } from "@/stores/use-config-store";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

export function ChannelVideoPricing({ channel, onChange }: { channel: ModelChannel; onChange: (costs: ModelCost[]) => void }) {
    if (!isVideoChannel(channel) || !channel.models.length) return null;

    const updateCost = (model: string, patch: Partial<ModelCost>) => {
        const current = channel.modelCosts?.find((item) => item.model === model) || {
            model,
            capability: "video" as const,
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 0,
        };
        const next = [...(channel.modelCosts || []).filter((item) => item.model !== model), { ...current, ...patch, model, capability: "video" as const }];
        onChange(next.filter((item) => channel.models.includes(item.model)));
    };

    return (
        <div className="mt-3 border-t border-border/70 pt-3">
            <div className="mb-2 flex items-center justify-between gap-3">
                <div><div className="text-xs font-medium">视频模型价格</div><div className="mt-0.5 text-[10px] text-foreground/42">仅用于记录自定义渠道成本，不扣平台积分</div></div>
                <span className="text-[10px] text-foreground/35">{channel.models.length} 个模型</span>
            </div>
            <div className="divide-y divide-border/60 rounded-md border border-border/70">
                {channel.models.map((rawModel) => {
                    const model = modelOptionName(rawModel);
                    const cost = channel.modelCosts?.find((item) => item.model === model);
                    const billingMode = cost?.billingMode || "fixed_request";
                    return (
                        <div key={model} className="grid gap-2 px-2.5 py-2 sm:grid-cols-[minmax(0,1fr)_176px_160px] sm:items-center">
                            <span className="truncate text-xs font-medium" title={model}>{model}</span>
                            <Segmented
                                size="small"
                                block
                                value={billingMode}
                                options={[{ label: "按次", value: "fixed_request" }, { label: "按秒", value: "per_second" }]}
                                onChange={(value) => updateCost(model, { billingMode: value as ModelCost["billingMode"] })}
                            />
                            <InputNumber
                                size="small"
                                min={0}
                                max={1_000_000}
                                precision={6}
                                step={0.1}
                                className="w-full"
                                placeholder={billingMode === "per_second" ? "每秒价格" : "每次价格"}
                                addonAfter={`积分/${billingMode === "per_second" ? "秒" : "次"}`}
                                value={cost ? cost.unitPriceMicrocredits / 1_000_000 : null}
                                onChange={(value) => updateCost(model, { unitPriceMicrocredits: Math.round(Number(value || 0) * 1_000_000) })}
                            />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function isVideoChannel(channel: ModelChannel) {
    return channel.interfaceType === "newapi" || channel.interfaceType === "newapi-channel-1" || channel.interfaceType === "newapi-channel-2" || channel.interfaceType === "xai-video";
}
