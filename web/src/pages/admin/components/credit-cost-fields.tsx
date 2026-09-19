import { Form, InputNumber, Switch, type FormInstance } from "antd";
import type { ChannelModelFormValues } from "./channel-model-editor-form";

export function CreditCostFields({ index, form, billingMode, isVideo }: { index: number; form: FormInstance<ChannelModelFormValues>; billingMode: string; isVideo: boolean }) {
    const configured = Form.useWatch(["priceTiers", index, "costConfigured"], form) === true;
    const fields = billingMode === "token"
        ? isVideo
            ? [["costOutputTokenPrice", "积分 / 百万视频 Token"]]
            : [["costInputTokenPrice", "输入 / 百万 Token"], ["costOutputTokenPrice", "输出 / 百万 Token"], ["costCachedTokenPrice", "缓存 / 百万 Token"]]
        : [["costUnitPrice", billingMode === "per_second" ? "积分 / 秒" : "积分 / 次"]];
    return <div className="admin-price-tier-block">
        <Form.Item name={[index, "costConfigured"]} label="积分成本价（仅管理员可见）" valuePropName="checked" extra="按当前价格档的计费方式核算成本，不影响用户售价；开启并填 0 表示零成本。">
            <Switch aria-label="配置积分成本价" />
        </Form.Item>
        {configured ? <div className={billingMode === "token" && !isVideo ? "admin-price-tier-token-grid" : "admin-price-tier-billing-grid"}>
            {fields.map(([field, label]) => <Form.Item key={field} className="mb-0" name={[index, field]} label={label} rules={[{ required: true, message: "请输入积分成本价" }]}>
                <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
            </Form.Item>)}
        </div> : null}
    </div>;
}
