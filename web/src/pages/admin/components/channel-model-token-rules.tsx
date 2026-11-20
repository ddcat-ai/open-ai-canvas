import { useState } from "react";
import { Button, Checkbox, Form, Input, InputNumber, Switch, type FormInstance } from "antd";
import { Plus, Trash2 } from "lucide-react";
import { Select } from "@/components/ui/base/select";
import { priceCurrencyUnit } from "@/services/api/user-groups";
import type { ChannelModelFormValues as FormValues } from "./channel-model-editor-form";
import { validateTokenPriceRules } from "./channel-model-editor-form";
import { defaultTokenPriceRule, tokenRuleClockMinutes, tokenRulesMatchingNow, type PriceTierFormValues, type TokenPriceRuleFormValues } from "./channel-model-price-tier-form";

const weekdayOptions = ["一", "二", "三", "四", "五", "六", "日"].map((label, index) => ({ label, value: index + 1 }));

/**
 * 文本 Token 价格档的分时与上下文价格。规则挂在某个 Token 价格档上：时段按任务创建时的上海时间锁定，
 * 上下文档位按上游真实输入 Token 结算；按顺序取首条命中，未命中时用该价格档的基础 Token 单价。
 */
export function TokenPriceRulesSection({ form, onDirty }: { form: FormInstance<FormValues>; onDirty: () => void }) {
    const tiers: PriceTierFormValues[] = Form.useWatch("priceTiers", form) || [];
    const priceUnit = priceCurrencyUnit(Form.useWatch("priceCurrency", form));
    const tokenTierIndexes = tiers.flatMap((tier, index) => (tier?.billingMode === "token" ? [index] : []));
    const [preferredTier, setPreferredTier] = useState<number>();
    const tierIndex = preferredTier !== undefined && tokenTierIndexes.includes(preferredTier) ? preferredTier : tokenTierIndexes[0];
    const rules: TokenPriceRuleFormValues[] = Form.useWatch(["priceTiers", tierIndex ?? 0, "tokenRules"], form) || [];
    const enabled = Form.useWatch(["priceTiers", tierIndex ?? 0, "tokenRulesEnabled"], form) === true;
    if (tierIndex === undefined) return null;
    const tier = tiers[tierIndex];
    const matching = tokenRulesMatchingNow(rules);
    const statusLabel = !enabled ? "未启用，全部按基础价" : matching.length ? `当前时段命中第 ${matching.map((index) => index + 1).join("、")} 条` : "当前时段未命中，按基础价";
    return (
        <section className="admin-model-editor-section" aria-label="分时与上下文价格">
            <div className="admin-token-rules-header">
                <header className="admin-model-editor-section-heading">
                    <h2>分时与上下文价格</h2>
                    <p>按上海时间的时段和输入 Token 区间设置独立 Token 价格；任务创建时锁定时段，结算时按上游真实输入 Token 选档，都未命中时使用基础价格。</p>
                </header>
                <div className="admin-price-tier-toggle">
                    <span>启用扩展</span>
                    <Form.Item noStyle name={["priceTiers", tierIndex, "tokenRulesEnabled"]} valuePropName="checked">
                        <Switch aria-label="启用分时与上下文价格" onChange={onDirty} />
                    </Form.Item>
                </div>
            </div>
            <div className="admin-model-editor-section-content admin-token-rules-content">
                <div className="admin-token-rules-toolbar">
                    {tokenTierIndexes.length > 1 ? (
                        <label className="admin-token-rules-tier-picker">
                            <span>Token 基础价格档</span>
                            <Select value={tierIndex} onChange={(value) => setPreferredTier(Number(value))} options={tokenTierIndexes.map((index) => ({ value: index, label: tierLabel(tiers[index], index) }))} />
                        </label>
                    ) : (
                        <span className="admin-token-rules-tier-name">基础价格档：{tierLabel(tier, tierIndex)}</span>
                    )}
                    <span className="admin-price-tier-cost-badge" role="status">
                        {statusLabel}
                    </span>
                </div>
                <Form.List
                    name={["priceTiers", tierIndex, "tokenRules"]}
                    rules={[
                        {
                            validator: async (_, value) => {
                                validateTokenPriceRules(form.getFieldValue(["priceTiers", tierIndex]), value);
                            },
                        },
                    ]}
                >
                    {(fields, { add, remove }, { errors }) => (
                        <div className="admin-price-tier-list-shell">
                            {fields.length ? (
                                <div className="admin-price-tier-list" aria-label="分时与上下文价格规则">
                                    {fields.map((field, ordinal) => (
                                        <TokenPriceRuleCard
                                            key={field.key}
                                            form={form}
                                            path={["priceTiers", tierIndex, "tokenRules", field.name]}
                                            name={field.name}
                                            ordinal={ordinal + 1}
                                            priceUnit={priceUnit}
                                            onDirty={onDirty}
                                            onRemove={() => {
                                                onDirty();
                                                remove(field.name);
                                            }}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <p className="admin-token-rules-empty">还没有规则。添加后可按星期、时段和输入上下文长度设置不同单价，例如夜间优惠价或长上下文加价。</p>
                            )}
                            <div className="admin-price-tier-list-footer">
                                <Button
                                    className="admin-model-editor-add-tier"
                                    type="dashed"
                                    block
                                    icon={<Plus className="size-4" />}
                                    onClick={() => {
                                        onDirty();
                                        add(defaultTokenPriceRule(tier));
                                    }}
                                >
                                    添加时段档位
                                </Button>
                                <Form.ErrorList errors={errors} />
                            </div>
                        </div>
                    )}
                </Form.List>
            </div>
        </section>
    );
}

function tierLabel(tier: PriceTierFormValues | undefined, index: number) {
    return `${String(index + 1).padStart(2, "0")} · ${tier?.matchMode === "default" ? "默认 Token 价格档" : "规格 Token 价格档"}`;
}

function TokenPriceRuleCard({ form, path, name, ordinal, priceUnit, onDirty, onRemove }: { form: FormInstance<FormValues>; path: (string | number)[]; name: number; ordinal: number; priceUnit: string; onDirty: () => void; onRemove: () => void }) {
    const rule: TokenPriceRuleFormValues | undefined = Form.useWatch(path, form);
    const enabled = rule?.enabled !== false;
    const min = rule?.minInputTokens || 0;
    const max = rule?.maxInputTokens || 0;
    const summary = max > 0 ? `输入 ${min.toLocaleString("zh-CN")} – ${max.toLocaleString("zh-CN")} Token` : `输入 ${min.toLocaleString("zh-CN")} Token 以上`;
    return (
        <article className="admin-price-tier-card">
            <header className="admin-price-tier-card-header">
                <div className="admin-price-tier-card-heading">
                    <span className="admin-price-tier-card-index">{String(ordinal).padStart(2, "0")}</span>
                    <div className="admin-price-tier-card-heading-copy">
                        <div className="admin-price-tier-card-title">{enabled ? "参与计费" : "不参与计费"}</div>
                        <div className="admin-price-tier-card-summary">{summary}</div>
                    </div>
                </div>
                <div className="admin-price-tier-card-actions">
                    <Form.Item noStyle name={[name, "enabled"]} valuePropName="checked">
                        <Switch aria-label={`规则 ${ordinal} 参与计费`} onChange={onDirty} />
                    </Form.Item>
                    <Button type="text" danger aria-label={`删除规则 ${ordinal}`} icon={<Trash2 className="size-3.5" />} onClick={onRemove}>
                        删除
                    </Button>
                </div>
            </header>
            <div className="admin-token-rule-body">
                <div className="admin-token-rule-column">
                    <Form.Item className="mb-0" name={[name, "weekdays"]} label="星期" rules={[{ required: true, type: "array", min: 1, message: "请至少选择一天" }]}>
                        <Checkbox.Group options={weekdayOptions} />
                    </Form.Item>
                    <div className="admin-token-rule-pair">
                        <Form.Item className="mb-0" name={[name, "start"]} label="开始" rules={[{ validator: async (_, value) => clockRule(value, false) }]}>
                            <Input inputMode="numeric" maxLength={5} placeholder="00:00" />
                        </Form.Item>
                        <Form.Item className="mb-0" name={[name, "end"]} label="结束" rules={[{ validator: async (_, value) => clockRule(value, true) }]}>
                            <Input inputMode="numeric" maxLength={5} placeholder="24:00" />
                        </Form.Item>
                    </div>
                </div>
                <div className="admin-token-rule-column">
                    <span className="admin-token-rule-label">输入上下文</span>
                    <div className="admin-token-rule-range">
                        <span aria-hidden>≥</span>
                        <Form.Item noStyle name={[name, "minInputTokens"]}>
                            <InputNumber aria-label="输入上下文下限（含）" className="w-full" min={0} precision={0} step={1000} />
                        </Form.Item>
                        <span>Token</span>
                    </div>
                    <div className="admin-token-rule-range">
                        <span aria-hidden>&lt;</span>
                        <Form.Item noStyle name={[name, "maxInputTokens"]}>
                            <InputNumber aria-label="输入上下文上限（不含），留空不限" className="w-full" min={1} precision={0} step={1000} placeholder="不限制" />
                        </Form.Item>
                        <span>Token</span>
                    </div>
                </div>
                <div className="admin-token-rule-prices">
                    {(
                        [
                            ["inputTokenPrice", "输入"],
                            ["outputTokenPrice", "输出"],
                            ["cachedTokenPrice", "缓存读取"],
                            ["cacheWriteTokenPrice", "缓存写入"],
                        ] as const
                    ).map(([field, label]) => (
                        <Form.Item key={field} className="admin-price-tier-unit-price mb-0" name={[name, field]} label={`${label} ${priceUnit} / 百万 Token`} rules={[{ required: true, message: `请输入${label}价格` }]}>
                            <InputNumber className="w-full" min={0} max={1_000_000} precision={6} step={0.1} />
                        </Form.Item>
                    ))}
                </div>
            </div>
        </article>
    );
}

function clockRule(value: unknown, end: boolean) {
    if (tokenRuleClockMinutes(String(value ?? ""), end) === null) throw new Error(end ? "格式 HH:MM，最晚 24:00" : "格式 HH:MM，00:00–23:59");
}
