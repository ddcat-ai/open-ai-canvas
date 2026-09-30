import { Alert, Button, Form, Input, InputNumber, Segmented, Switch, type FormInstance } from "antd";
import { Trash2 } from "lucide-react";
import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import type { ModelCapabilityChoice as EditableCapability } from "@/components/model-protocol-picker";
import type { ChannelModelFormValues as FormValues } from "./channel-model-editor-form";
import { normalizeUpstreamModelKey } from "./channel-model-price-tier-form";
import { CreditCostFields } from "./credit-cost-fields";
import { Select } from "@/components/ui/base/select";

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
    const tokenEnabled = modelProtocolSupportsTokenBilling(capability, protocol);
    const isVideo = capability === "video";
    const isImage = capability === "image";
    return (
        <article className="admin-price-tier-card">
            <header className="admin-price-tier-card-header">
                <Form.Item name={[index, "priceConfigured"]} hidden valuePropName="checked">
                    <Switch />
                </Form.Item>
                <Form.Item name={[index, "enabled"]} hidden valuePropName="checked">
                    <Switch />
                </Form.Item>
                <div className="admin-price-tier-card-heading">
                    <span className="admin-price-tier-card-index">{String(ordinal).padStart(2, "0")}</span>
                    <div className="admin-price-tier-card-heading-copy">
                        <div className="admin-price-tier-card-title">{matchMode === "default" ? "默认价格" : `规格价格 ${ordinal}`}</div>
                        <div className="admin-price-tier-card-summary">{matchMode === "default" ? "所有请求使用同一价格" : isVideo ? "按生成方式与分辨率匹配" : "按生成方式、质量或尺寸匹配"}</div>
                    </div>
                </div>
                <div className="admin-price-tier-card-actions">
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
                    <Button type="text" danger aria-label={`删除价格档 ${ordinal}`} icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
                        删除
                    </Button>
                </div>
            </header>
            <div className="admin-price-tier-card-body">
                <section className="admin-price-tier-mode-row">
                    <div className="admin-price-tier-panel-heading">
                        <div>
                            <h3>适用范围</h3>
                            <p>选择全部请求，或按生成规格精确匹配。</p>
                        </div>
                    </div>
                    <Form.Item className="admin-price-tier-mode-control mb-0" name={[index, "matchMode"]} rules={[{ required: true }]}>
                        <Segmented
                            block
                            aria-label="价格规则适用范围"
                            options={[
                                { label: "统一价格", value: "default" },
                                { label: "按规格定价", value: "advanced" },
                            ]}
                        />
                    </Form.Item>
                </section>
                <div className={`admin-price-tier-workspace ${matchMode === "default" ? "is-default" : "is-advanced"}`}>
                    {matchMode !== "default" && (
                        <section className="admin-price-tier-panel admin-price-tier-conditions-panel">
                            <div className="admin-price-tier-panel-heading">
                                <div>
                                    <h3>匹配条件</h3>
                                    <p>符合以下条件时使用这条价格，精确规则优先。</p>
                                </div>
                            </div>
                            <div className="admin-price-tier-match-grid">
                                <Form.Item className="mb-0" name={[index, "operation"]} label="生成方式" rules={[{ required: true, message: "请选择生成方式" }]}>
                                    <Select options={operationOptions(capability)} />
                                </Form.Item>
                                {isVideo ? (
                                    <Form.Item className="mb-0" name={[index, "resolution"]} label="分辨率" rules={[{ required: true, message: "请选择分辨率" }]}>
                                        <Select options={[{ label: "任意分辨率", value: "*" }, ...resolutionOptions.map((value) => ({ label: value.toUpperCase(), value }))]} />
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
                        </section>
                    )}
                    <section className="admin-price-tier-panel admin-price-tier-selling-panel">
                        <div className="admin-price-tier-panel-heading">
                            <div>
                                <h3>销售价格</h3>
                                <p>设置用户完成一次生成实际消耗的积分。</p>
                            </div>
                        </div>
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
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "inputTokenPrice"]} label="输入 / 百万 Token" rules={[{ required: true, message: "请输入输入 Token 价格" }]}>
                                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                        </Form.Item>
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "outputTokenPrice"]} label="输出 / 百万 Token" rules={[{ required: true, message: "请输入输出 Token 价格" }]}>
                                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                        </Form.Item>
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "cachedTokenPrice"]} label="缓存 / 百万 Token" rules={[{ required: true, message: "请输入缓存 Token 价格" }]}>
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
                            <div className="admin-price-tier-helper" role="note">
                                <strong>视频 Token 计费</strong>
                                <span>估算：宽 × 高 × 24 帧/秒 ×（输出时长 + 参考视频时长）÷ 1024；优先按上游有效用量结算，无用量时使用公式，授权预留 10% 会在结算后补扣或退回。</span>
                            </div>
                        ) : null}
                        <CreditCostFields index={index} form={form} billingMode={billingMode} isVideo={isVideo} />
                    </section>
                </div>
                {staleTierUpstream ? (
                    <Alert
                        className="admin-price-tier-alert"
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
        </article>
    );
}

function operationOptions(capability: EditableCapability | undefined) {
    const options = [{ label: "任意生成方式", value: "*" }];
    if (capability === "image") return [...options, { label: "文生图", value: "text_to_image" }, { label: "图生图", value: "image_to_image" }];
    if (capability === "video") return [...options, { label: "文生视频", value: "text_to_video" }, { label: "图生视频", value: "image_to_video" }, { label: "视频生视频", value: "video_to_video" }];
    if (capability === "text") return [...options, { label: "文本生成", value: "text_generation" }];
    return options;
}
