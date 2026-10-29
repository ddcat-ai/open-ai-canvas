import { Alert, Button, Form, Input, InputNumber, Segmented, Switch, type FormInstance } from "antd";
import { Trash2 } from "lucide-react";
import type { ModelCapabilityConfig } from "@/lib/model-capabilities";
import { modelProtocolSupportsTokenBilling, type ModelProtocol } from "@/lib/model-protocols";
import type { ModelCapabilityChoice as EditableCapability } from "@/components/model-protocol-picker";
import type { ChannelModelFormValues as FormValues } from "./channel-model-editor-form";
import { normalizeUpstreamModelKey } from "./channel-model-price-tier-form";
import { CreditCostFields } from "./credit-cost-fields";
import { priceCurrencyUnit } from "@/services/api/user-groups";
import { Select } from "@/components/ui/base/select";
import { ImageParameterInput } from "@/components/image-parameter-fields";
import { imageResolutionTiers } from "@/lib/image-size-presets";
// 价格档分辨率按后端保存口径（2k→1440p、4k→2160p）取值，已存档位才能正确回显。
import { normalizeTierResolution } from "@/lib/model-pricing";

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
    const priceUnit = priceCurrencyUnit(Form.useWatch("priceCurrency", form));
    const matchMode = Form.useWatch(["priceTiers", index, "matchMode"], form) || "default";
    const priceConfigured = Form.useWatch(["priceTiers", index, "priceConfigured"], form) !== false;
    const tierEnabled = Form.useWatch(["priceTiers", index, "enabled"], form) !== false;
    const tierUpstream = normalizeUpstreamModelKey(Form.useWatch(["priceTiers", index, "providerModelKey"], form));
    // 统一价格档不展示上游键输入，但历史数据可能固化了独立键；它与模型级不一致时会
    // 静默改变实际发往供应商的模型，必须显式提示并允许一键恢复“跟随模型默认”。
    const staleTierUpstream = matchMode === "default" && tierUpstream && modelUpstream && tierUpstream !== modelUpstream ? tierUpstream : "";
    const video = capabilityConfig?.video;
    const image = capabilityConfig?.image;
    const resolutionOptions = Array.from(new Set([...(video?.resolutions || []), ...(protocol === "autodl-comfyui" ? video?.fixedScreenSpec?.resolutions || [] : [])]));
    const tokenEnabled = modelProtocolSupportsTokenBilling(capability, protocol);
    const isVideo = capability === "video";
    const isAudio = capability === "audio";
    const isDurationPriced = isVideo || isAudio;
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
                        <div className="admin-price-tier-card-summary">{matchMode === "default" ? "所有请求使用同一价格" : isVideo ? "按生成方式与分辨率匹配" : "按生成方式、画质、分辨率或尺寸匹配"}</div>
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
                                        <Select options={[{ label: "任意分辨率", value: "*" }, ...resolutionOptions.map((value) => ({ label: value.toUpperCase(), value: normalizeTierResolution(value) }))]} />
                                    </Form.Item>
                                ) : null}
                                {isVideo && video?.processing ? (
                                    <Form.Item className="mb-0" name={[index, "fpsBand"]} label="输出帧率档" tooltip="视频处理按输出帧率分档计价；保持原帧率时按 ≤30fps 档预扣">
                                        <Select options={fpsBandOptions} />
                                    </Form.Item>
                                ) : null}
                                {isImage && image?.parameters
                                    ? image.parameters
                                          .filter((field) => field.enabled !== false && field.pricing)
                                          .map((field) => (
                                              <Form.Item key={field.name} className="mb-0" name={[index, "imageSelector", field.name]} label={field.label}>
                                                  <ImagePriceParameterInput field={field} />
                                              </Form.Item>
                                          ))
                                    : null}
                                {isImage && !image?.parameters && (image?.resolution?.supported || (image && imageResolutionTiers(image).length > 0)) ? (
                                    <Form.Item className="mb-0" name={[index, "imageResolution"]} label="上游分辨率" rules={[{ required: true, message: "请选择上游分辨率" }]}>
                                        <Select
                                            options={[
                                                { label: "任意分辨率", value: "*" },
                                                ...[...new Set([...(image?.resolution?.supported ? image.resolution.values : imageResolutionTiers(image!)), "1.5k"])].map((value) => ({ label: value.toUpperCase(), value })),
                                            ]}
                                        />
                                    </Form.Item>
                                ) : null}
                                {isImage && !image?.parameters && image?.quality.supported ? (
                                    <Form.Item className="mb-0" name={[index, "quality"]} label="画质" rules={[{ required: true, message: "请选择画质" }]}>
                                        <Select options={[{ label: "任意画质", value: "*" }, ...image.quality.values.map((value) => ({ label: value.toUpperCase(), value }))]} />
                                    </Form.Item>
                                ) : null}
                                {isImage && !image?.parameters && image?.size.parameter !== "none" ? (
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
                                <p>{priceUnit === "积分" ? "设置用户完成一次生成实际消耗的积分。" : `按 ${priceUnit} 填写售价，扣费时按用户分组兑换比例换算为积分。`}</p>
                            </div>
                        </div>
                        <div className="admin-price-tier-billing-grid">
                            <Form.Item className="admin-price-tier-billing-mode mb-0" name={[index, "billingMode"]} label="计费方式" rules={[{ required: true }]}>
                                <Segmented
                                    className="w-full"
                                    options={[
                                        { label: "按次", value: "fixed_request" },
                                        { label: "按秒", value: "per_second", disabled: !isDurationPriced },
                                        { label: isVideo ? "视频 Token" : "Token", value: "token", disabled: !tokenEnabled },
                                    ]}
                                />
                            </Form.Item>
                            {billingMode === "token" ? (
                                isVideo ? (
                                    <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "outputTokenPrice"]} label={`${priceUnit} / 百万视频 Token`} rules={[{ required: true, message: "请输入视频 Token 价格" }]}>
                                        <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                    </Form.Item>
                                ) : (
                                    <div className="admin-price-tier-token-grid">
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "inputTokenPrice"]} label={`输入 ${priceUnit} / 百万 Token`} rules={[{ required: true, message: "请输入输入 Token 价格" }]}>
                                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                        </Form.Item>
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "outputTokenPrice"]} label={`输出 ${priceUnit} / 百万 Token`} rules={[{ required: true, message: "请输入输出 Token 价格" }]}>
                                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                        </Form.Item>
                                        <Form.Item className="admin-price-tier-unit-price mb-0" name={[index, "cachedTokenPrice"]} label={`缓存 ${priceUnit} / 百万 Token`} rules={[{ required: true, message: "请输入缓存 Token 价格" }]}>
                                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                                        </Form.Item>
                                    </div>
                                )
                            ) : (
                                <Form.Item
                                    className="admin-price-tier-unit-price mb-0"
                                    name={[index, "unitPrice"]}
                                    label={billingMode === "per_second" ? `每秒售价（${priceUnit}）` : `每次售价（${priceUnit}）`}
                                    rules={[{ required: true, message: "请输入售价" }]}
                                >
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

function ImagePriceParameterInput({ field, value, onChange }: { field: import("@/lib/image-parameters").ImageParameter; value?: string; onChange?: (value?: string) => void }) {
    // 分辨率字段始终提供 1.5K：声明式 Seedream 档位包含它，旧定价也需要能选中。
    if (field.name === "imageResolution") {
        const standardChoices = ["1k", "1.5k", "2k", "4k"];
        const values = field.values?.length ? [...new Set([...field.values.map(String), "1.5k"])] : standardChoices;
        return <Select allowClear placeholder="任意" value={value} options={[{ label: "任意分辨率", value: "*" }, ...values.map((v) => ({ label: v.toUpperCase(), value: v }))]} onChange={onChange} />;
    }
    const typed = value === undefined || value === "" || value === "*" ? undefined : field.type === "boolean" ? value === "true" : field.type === "number" || field.type === "integer" ? Number(value) : value;
    if (field.type === "boolean")
        return (
            <Select
                allowClear
                placeholder="任意"
                value={value}
                options={[
                    { label: "开启", value: "true" },
                    { label: "关闭", value: "false" },
                ]}
                onChange={onChange}
            />
        );
    return <ImageParameterInput field={field} value={typed} onChange={(next) => onChange?.(next === undefined ? undefined : String(next))} />;
}

const fpsBandOptions = [
    { label: "任意帧率", value: "*" },
    { label: "≤30fps", value: "le30" },
    { label: "30–60fps", value: "le60" },
    { label: "60–120fps", value: "le120" },
];

function operationOptions(capability: EditableCapability | undefined) {
    const options = [{ label: "任意生成方式", value: "*" }];
    if (capability === "image") return [...options, { label: "文生图", value: "text_to_image" }, { label: "图生图", value: "image_to_image" }];
    if (capability === "video") return [...options, { label: "文生视频", value: "text_to_video" }, { label: "图生视频", value: "image_to_video" }, { label: "视频生视频", value: "video_to_video" }, { label: "画质增强", value: "enhance" }];
    if (capability === "text") return [...options, { label: "文本生成", value: "text_generation" }];
    return options;
}
