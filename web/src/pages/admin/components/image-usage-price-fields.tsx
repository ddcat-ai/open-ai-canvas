import { Button, Form, InputNumber, type FormInstance } from "antd";
import type { ChannelModelFormValues } from "./channel-model-editor-form";
import { seedream55OfficialPricing } from "@/lib/image-usage-pricing";

export function ImageUsagePriceFields({ index, form, unit, cost = false }: { index: number; form: FormInstance<ChannelModelFormValues>; unit: string; cost?: boolean }) {
    const key = cost ? "costImagePricing" : "imagePricing";
    return (
        <div className="admin-price-tier-token-grid">
            <Form.Item name={[index, key, "inputPrice"]} label={`输入图 ${unit} / 张`} rules={[{ required: true, message: "请输入输入图单价，免费请填写 0" }]}>
                <InputNumber min={0} max={1_000_000} precision={6} className="w-full" />
            </Form.Item>
            <Form.Item name={[index, key, "freeInputImages"]} label="免费输入张数" initialValue={0} rules={[{ required: true }]}>
                <InputNumber min={0} max={128} precision={0} className="w-full" />
            </Form.Item>
            <Form.List name={[index, key, "outputTiers"]}>
                {(fields, { add, remove }) => (
                    <div className="flex flex-col gap-3">
                        {fields.map((field) => (
                            <div key={field.key} className="flex flex-wrap items-end gap-2">
                                <Form.Item name={[field.name, "maxPixels"]} label="输出像素上限（含边界；0 为不限）" rules={[{ required: true }]} className="mb-0">
                                    <InputNumber min={0} max={100_000_000} precision={0} />
                                </Form.Item>
                                <Form.Item name={[field.name, "unitPrice"]} label={`输出图 ${unit} / 张`} rules={[{ required: true }]} className="mb-0">
                                    <InputNumber min={0} max={1_000_000} precision={6} />
                                </Form.Item>
                                <Button onClick={() => remove(field.name)} aria-label="删除输出像素档位">
                                    删除
                                </Button>
                            </div>
                        ))}
                        <Button onClick={() => add({ maxPixels: null, unitPrice: null })} disabled={fields.length >= 16}>
                            添加输出像素档位
                        </Button>
                    </div>
                )}
            </Form.List>
            <div className="admin-price-tier-helper" role="note">
                <span>输出按每张图片的实际宽 × 高匹配递增档位；底图和图层分别计费。提交时预留费用上限，完成后按实际用量结算。</span>
                {!cost && unit === "CNY" ? <Button onClick={() => form.setFieldValue(["priceTiers", index, key], seedream55OfficialPricing())}>填入 Seedream 5.5 官方公开价</Button> : null}
            </div>
        </div>
    );
}
