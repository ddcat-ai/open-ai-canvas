import { Alert, Button, Form, Input, InputNumber, Segmented, Select, Switch, type FormInstance } from "antd";
import { Trash2 } from "lucide-react";
import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import type { ModelCapabilityChoice as EditableCapability } from "@/components/model-protocol-picker";
import type { ChannelModelFormValues as FormValues } from "./channel-model-editor-form";
import { normalizeUpstreamModelKey } from "./channel-model-price-tier-form";
import { CreditCostFields } from "./credit-cost-fields";

export function PriceTierFields({
    index,
    ordinal,
    form,
    capability,
    protocol,
    capabilityConfig,
    modelUpstream,
    onDirty,
    onRemove,
}: {
    index: number;
    ordinal: number;
    form: FormInstance<FormValues>;
    capability: EditableCapability | undefined;
    protocol: ModelProtocol | undefined;
    capabilityConfig?: ModelCapabilityConfig;
    modelUpstream: string;
    onDirty: () => void;
    onRemove: () => void;
}) {
    const billingMode = Form.useWatch(["priceTiers", index, "billingMode"], form) || "fixed_request";
    const matchMode = Form.useWatch(["priceTiers", index, "matchMode"], form) || "default";
    const priceConfigured = Form.useWatch(["priceTiers", index, "priceConfigured"], form) !== false;
    const tierEnabled = Form.useWatch(["priceTiers", index, "enabled"], form) !== false;
    const tierUpstream = normalizeUpstreamModelKey(Form.useWatch(["priceTiers", index, "providerModelKey"], form));
    // 统一价格档不展示上游键输入，但历史数据可能固化了独立键；它与模型级不一致时会
    // 静默改变实际发往供应商的模型，必须显式提示并允许一键恢复“跟随模型默认”。
    const staleTierUpstream = matchMode === "default" && tierUpstream && modelUpstream && tierUpstream !== modelUpstream ? tierUpstream : "";
    const video = capabilityConfig?.video;
    const resolutionOptions = video?.resolutions || [];
    const durationOptions = video?.duration.selection === "enum" ? video.duration.values || [] : [];
    const tokenEnabled = modelProtocolSupportsTokenBilling(capability, protocol);
    const isVideo = capability === "video";
    const isImage = capability === "image";
    return (
        <div className="admin-price-tier-card">
            <div className="admin-price-tier-card-header">
                <div>
                    <div className="text-sm font-medium">{matchMode === "default" ? "默认价格" : `规格价格 ${ordinal}`}</div>
                </div>
                <div className="admin-price-tier-controls">
                    <Form.Item name={[index, "priceConfigured"]} hidden valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <Form.Item name={[index, "enabled"]} hidden valuePropName="checked">
                        <Switch />
                    </Form.Item>
                    <div className="admin-price-tier-toggle">
                        <span title="关闭后保留配置，但不参与用户请求及计费匹配">可供用户使用</span>
                        <Switch
                            aria-label="可供用户使用"
                            checked={priceConfigured && tierEnabled}
                            onChange={(checked) => {
                                onDirty();
                                form.setFieldValue(["priceTiers", index, "priceConfigured"], checked);
                                form.setFieldValue(["priceTiers", index, "enabled"], checked);
                            }}
                        />
                    </div>
                </div>
                <Button type="text" danger aria-label={`删除价格档 ${ordinal}`} icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
                    删除
                </Button>
            </div>
            <div className="admin-price-tier-card-body">
                <div className="admin-price-tier-block admin-price-tier-match-block">
                    <Form.Item className="mb-0" name={[index, "matchMode"]} label="定价方式" tooltip="默认价格适用于所有请求；按规格配置时，精确规则优先。" rules={[{ required: true }]}>
                        <Segmented
                            block
                            options={[
                                { label: "统一价格", value: "default" },
                                { label: "按规格定价", value: "advanced" },
                            ]}
                        />
                    </Form.Item>
                </div>
                <div className="admin-price-tier-block admin-price-tier-billing-block">
                    <div className="mb-2 text-sm font-medium">销售价格</div>
                    <div className="admin-price-tier-billing-grid">
                        <Form.Item className="admin-price-tier-billing-mode mb-0" name={[index, "billingMode"]} label="计费方式" rules={[{ required: true }]}>
                            <Segmented
                                className="w-full"
                                options={[
                                    { label: "按次", value: "fixed_request" },
                                    { label: "按秒", value: "per_second", disabled: !isVideo },
                                    { label: isVideo ? "视频 Token" : "Token", value: "token", disabled: !tokenEnabled },
                                ]}
                            />
                        </Form.Item>
                        {billingMode === "token" ? (
                            isVideo ? (
                                <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "outputTokenPrice"]} label="积分 / 百万视频 Token" rules={[{ required: true, message: "请输入视频 Token 价格" }]}>
                                    <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                </Form.Item>
                            ) : (
                                <div className="admin-price-tier-token-grid">
                                    <Form.Item className="mb-0" name={[index, "inputTokenPrice"]} label="输入 / 百万 Token" rules={[{ required: true, message: "请输入输入价格" }]}>
                                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                    <Form.Item className="mb-0" name={[index, "outputTokenPrice"]} label="输出 / 百万 Token" rules={[{ required: true, message: "请输入输出价格" }]}>
                                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                    <Form.Item className="mb-0" name={[index, "cachedTokenPrice"]} label="缓存 / 百万 Token" rules={[{ required: true, message: "请输入缓存价格" }]}>
                                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                </div>
                            )
                        ) : (
                            <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "unitPrice"]} label={billingMode === "per_second" ? "每秒消耗积分" : "每次消耗积分"} rules={[{ required: true, message: "请输入积分价格" }]}>
                                <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                            </Form.Item>
                        )}
                    </div>
                    {isVideo && billingMode === "token" ? (
                        <p className="mb-0 mt-2 text-xs text-foreground/60">
                            所有视频模型均支持 Token 计费，统一按火山引擎模式计算：宽 × 高 × 24 帧/秒 ×（输出时长 + 参考视频时长）÷ 1024。优先按成功任务返回的有效用量结算，未返回用量时按公式结算。平台额外预留 10%，不计入公式结算；最终可能补扣或退回差额。0 表示免费；有声、无声或参考视频可分别配置规格价格。
                        </p>
                    ) : null}
                </div>
                <CreditCostFields index={index} form={form} billingMode={billingMode} isVideo={isVideo} />
                {matchMode !== "default" && (
                    <div className="admin-price-tier-match-grid">
                        <Form.Item className="mb-0" name={[index, "operation"]} label="生成方式" rules={[{ required: true, message: "请选择生成方式" }]}>
                            <Select options={operationOptions(capability)} />
                        </Form.Item>
                        {isVideo ? (
                            <Form.Item className="mb-0" name={[index, "resolution"]} label="分辨率" rules={[{ required: true, message: "请选择分辨率" }]}>
                                <Select options={[{ label: "任意分辨率", value: "*" }, ...resolutionOptions.map((value) => ({ label: value.toUpperCase(), value }))]} />
                            </Form.Item>
                        ) : null}
                        {isVideo ? (
                            <Form.Item className="mb-0" name={[index, "videoSeconds"]} label="时长" rules={[{ required: true, message: "请输入时长" }]}>
                                {durationOptions.length ? <Select options={[{ label: "任意时长", value: 0 }, ...durationOptions.map((value) => ({ label: `${value} 秒`, value }))]} /> : <InputNumber className="w-full" min={0} precision={0} />}
                            </Form.Item>
                        ) : null}
                        {isVideo ? (
                            <Form.Item className="mb-0" name={[index, "videoGenerateAudio"]} label="生成音频" rules={[{ required: true, message: "请选择音频条件" }]}>
                                <Select options={[{ label: "任意音频", value: "*" }, { label: "有声", value: "true" }, { label: "无声", value: "false" }]} />
                            </Form.Item>
                        ) : null}
                        {isVideo ? (
                            <Form.Item className="mb-0" name={[index, "imageCount"]} label="参考图数量" rules={[{ required: true, message: "请输入参考图数量" }]}>
                                <InputNumber className="w-full" min={0} max={9} precision={0} placeholder="0 表示任意数量" />
                            </Form.Item>
                        ) : null}
                        {isImage ? (
                            <Form.Item className="mb-0" name={[index, "quality"]} label="质量/分辨率" rules={[{ required: true, message: "请选择质量或分辨率" }]}>
                                <Select
                                    options={[
                                        { label: "任意质量", value: "*" },
                                        { label: "1K", value: "1k" },
                                        { label: "2K", value: "2k" },
                                        { label: "4K", value: "4k" },
                                    ]}
                                />
                            </Form.Item>
                        ) : null}
                        {isImage ? (
                            <Form.Item className="mb-0" name={[index, "size"]} label="画幅/尺寸">
                                <Input placeholder="任意，或 1:1、16:9、1024x1024" />
                            </Form.Item>
                        ) : null}
                        <Form.Item className="admin-price-tier-upstream mb-0" name={[index, "providerModelKey"]} label="命中后使用的上游模型 ID">
                            <Input placeholder="留空则使用模型默认上游 ID" />
                        </Form.Item>
                    </div>
                )}
                {staleTierUpstream ? (
                    <Alert
                        type="warning"
                        showIcon
                        title="该统一价格档仍指向独立上游模型 ID"
                        description={`命中此档的请求会优先使用「${staleTierUpstream}」，而不是模型默认上游「${modelUpstream}」。`}
                        action={
                            <Button
                                size="small"
                                onClick={() => {
                                    onDirty();
                                    form.setFieldValue(["priceTiers", index, "providerModelKey"], "");
                                }}
                            >
                                清除并跟随模型
                            </Button>
                        }
                    />
                ) : null}
            </div>
        </div>
    );
}

function operationOptions(capability: EditableCapability | undefined) {
    const options = [{ label: "任意生成方式", value: "*" }];
    if (capability === "image") return [...options, { label: "文生图", value: "text_to_image" }, { label: "图生图", value: "image_to_image" }];
    if (capability === "video") return [...options, { label: "文生视频", value: "text_to_video" }, { label: "图生视频", value: "image_to_video" }, { label: "视频生视频", value: "video_to_video" }];
    if (capability === "text") return [...options, { label: "文本生成", value: "text_generation" }];
    return options;
}
