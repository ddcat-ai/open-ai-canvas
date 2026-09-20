import { Form, InputNumber, Switch, type FormInstance } from "antd";
import type { ChannelModelFormValues } from "./channel-model-editor-form";

export function CreditCostFields({ index, form, billingMode, isVideo }: { index: number; form: FormInstance<ChannelModelFormValues>; billingMode: string; isVideo: boolean }) {
    const configured = Form.useWatch(["priceTiers", index, "costConfigured"], form) === true;
    const fields =
        billingMode === "token"
            ? isVideo
                ? [["costOutputTokenPrice", "积分 / 百万视频 Token"]]
                : [
                      ["costInputTokenPrice", "输入 / 百万 Token"],
                      ["costOutputTokenPrice", "输出 / 百万 Token"],
                      ["costCachedTokenPrice", "缓存 / 百万 Token"],
                  ]
            : [["costUnitPrice", billingMode === "per_second" ? "积分 / 秒" : "积分 / 次"]];
    return (
        <section className="admin-price-tier-cost-panel" aria-label="积分成本设置">
            <header className="admin-price-tier-cost-header">
                <div className="admin-price-tier-cost-heading">
                    <div className="admin-price-tier-cost-title">
                        <span>积分成本</span>
                        <span className="admin-price-tier-cost-badge">仅管理员可见</span>
                    </div>
                    <p>按当前计费方式填写成本，不影响用户售价。</p>
                </div>
                <Form.Item className="admin-price-tier-cost-switch mb-0" name={[index, "costConfigured"]} valuePropName="checked">
                    <Switch aria-label="配置积分成本价" />
                </Form.Item>
            </header>
            {configured ? (
                <div className={billingMode === "token" && !isVideo ? "admin-price-tier-cost-grid admin-price-tier-cost-token-grid" : "admin-price-tier-cost-grid"}>
                    {fields.map(([field, label]) => (
                        <Form.Item key={field} className="mb-0" name={[index, field]} label={label} rules={[{ required: true, message: "请输入积分成本价" }]}>
                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                        </Form.Item>
                    ))}
                </div>
            ) : null}
        </section>
    );
}
