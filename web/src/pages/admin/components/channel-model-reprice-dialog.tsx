import { useState } from "react";
import { Alert, App, Button, InputNumber, Select, Table } from "antd";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { repriceAdminChannelModels, type ChannelModel } from "@/services/api/wallet";
import { specificationLabel } from "./channel-model-cost-summary";
import { formatModelMargin, formatModelPrice, modelRepricePayload, modelRepriceRows, parseSaleInput, previewModelRepricing, type ModelRepriceRow } from "./channel-model-pricing";

export function ChannelModelRepriceDialog({ channelId, channelName, items, onClose, onSaved }: { channelId: string; channelName: string; items: ChannelModel[]; onClose: () => void; onSaved: () => Promise<void> }) {
    const { message } = App.useApp();
    const [margin, setMargin] = useState<number | null>(null);
    const [decimalPlaces, setDecimalPlaces] = useState(2);
    const [rows, setRows] = useState(() => modelRepriceRows(items));
    const [calculationError, setCalculationError] = useState("");
    const [saving, setSaving] = useState(false);
    let validationError = "";
    try {
        modelRepricePayload(items, rows);
    } catch (cause) {
        validationError = cause instanceof Error ? cause.message : "销售价无效";
    }
    const original = new Map(modelRepriceRows(items).map((row) => [row.key, row.sale]));
    const changed = rows.filter((row) => {
        try {
            return parseSaleInput(row.sale) !== parseSaleInput(original.get(row.key) ?? null);
        } catch {
            return false;
        }
    }).length;
    const recalculate = (nextMargin: number | null, places: number) => {
        setMargin(nextMargin);
        setDecimalPlaces(places);
        if (nextMargin === null) {
            setCalculationError("");
            return;
        }
        try {
            setRows(modelRepriceRows(previewModelRepricing(items, nextMargin, places)));
            setCalculationError("");
        } catch (cause) {
            setCalculationError(cause instanceof Error ? cause.message : "无法计算销售价");
        }
    };
    const save = async () => {
        if (validationError || calculationError || !changed || saving) return;
        setSaving(true);
        try {
            const result = await repriceAdminChannelModels(channelId, modelRepricePayload(items, rows));
            message.success(`已保存 ${result.updated} 个模型的销售价`);
        } catch (cause) {
            message.error(cause instanceof Error ? cause.message : "统一调价失败");
            setSaving(false);
            return;
        }
        try {
            await onSaved();
        } catch {
            message.warning("价格已保存，但列表刷新失败，请手动刷新");
        } finally {
            setSaving(false);
            onClose();
        }
    };
    return (
        <AdminModal
            title={`统一调价 · ${items.length} 个模型`}
            open
            centered
            width={1180}
            rootClassName="admin-model-reprice-modal"
            onCancel={onClose}
            closable={!saving}
            mask={{ closable: !saving }}
            keyboard={!saving}
            confirmLoading={saving}
            cancelButtonProps={{ disabled: saving }}
            okButtonProps={{ disabled: Boolean(validationError || calculationError) || !changed }}
            okText={`保存销售价${changed ? `（${changed} 项）` : ""}`}
            onOk={() => void save()}
        >
            <div className="admin-model-reprice">
                <div className="admin-model-reprice-controls">
                    <div className="admin-model-reprice-field">
                        <label htmlFor="reprice-margin">目标利润率</label>
                        <InputNumber id="reprice-margin" aria-label="目标利润率" size="large" value={margin} onChange={(value) => recalculate(value, decimalPlaces)} min={0} max={99.99} step={1} suffix="%" placeholder="输入百分比" disabled={saving} />
                    </div>
                    <div className="admin-model-reprice-field">
                        <label htmlFor="reprice-decimals">保留小数位</label>
                        <Select
                            id="reprice-decimals"
                            aria-label="保留小数位"
                            size="large"
                            value={decimalPlaces}
                            disabled={saving}
                            onChange={(value) => recalculate(margin, value)}
                            options={Array.from({ length: 7 }, (_, value) => ({ value, label: `${value} 位小数` }))}
                        />
                    </div>
                    <Button size="large" disabled={saving || margin === null} onClick={() => recalculate(margin, decimalPlaces)}>
                        重新计算
                    </Button>
                    <div className="admin-model-reprice-formula">
                        <strong>按成本计算，四舍五入</strong>
                        <span>新售价 = 成本价 ÷（1 − 利润率）</span>
                    </div>
                </div>
                <p className="admin-model-reprice-note">修改利润率、小数位或点击「重新计算」会按成本重算全部规格售价，覆盖手动修改。计算后可继续单独编辑，保存以输入框的最终值为准。</p>
                <div className="admin-model-reprice-list-heading">
                    <strong>模型价格</strong>
                    <span>
                        {rows.length} 个计费项 · 已修改 {changed} 项
                    </span>
                </div>
                <ChannelModelRepriceTable
                    items={items}
                    rows={rows}
                    channelName={channelName}
                    decimalPlaces={decimalPlaces}
                    disabled={saving}
                    onSaleChange={(key, value) => setRows((current) => current.map((entry) => (entry.key === key ? { ...entry, sale: value, manual: true } : entry)))}
                />
                {calculationError || validationError ? <Alert type="warning" showIcon title={calculationError || validationError} /> : null}
                <p className="admin-model-reprice-note">仅修改已启用规格的售价，不改变成本或启停状态。四舍五入及手动修改可能使实际利润率偏离目标；价格配置发生变化时整批拒绝保存，请刷新后重试。</p>
            </div>
        </AdminModal>
    );
}

export function ChannelModelRepriceTable({
    items,
    rows,
    channelName,
    decimalPlaces,
    disabled,
    onSaleChange,
}: {
    items: ChannelModel[];
    rows: ModelRepriceRow[];
    channelName: string;
    decimalPlaces: number;
    disabled: boolean;
    onSaleChange: (key: string, value: string | null) => void;
}) {
    const byModel = new Map<string, ModelRepriceRow[]>();
    for (const row of rows) {
        const group = byModel.get(row.model.id) ?? [];
        group.push(row);
        byModel.set(row.model.id, group);
    }
    return (
        <Table<ChannelModel>
            className="admin-model-reprice-table"
            rowKey="id"
            dataSource={items}
            pagination={false}
            tableLayout="fixed"
            scroll={{ x: 1040 }}
            locale={{ emptyText: "暂无所选模型" }}
            columns={[
                { title: "模型展示名", width: 180, render: (_, model) => <strong>{model.displayName || model.modelKey}</strong> },
                {
                    title: "渠道展示名（上游模型ID）",
                    width: 220,
                    render: (_, model) => (
                        <div className="admin-model-reprice-identity">
                            <span>{model.channelLabel || channelName}</span>
                            <small className="admin-monospace">{model.providerModelKey || model.modelKey}</small>
                        </div>
                    ),
                },
                // One model per table row; the shared grid keeps each specification and its prices aligned even when labels wrap.
                {
                    title: "规格",
                    width: 140,
                    onCell: () => ({ colSpan: 3, className: "admin-model-reprice-spec-cell" }),
                    render: (_, model) => (
                        <div className="admin-model-reprice-specs">
                            {(byModel.get(model.id) ?? []).map((row) => {
                                let sale: number | undefined;
                                try {
                                    sale = parseSaleInput(row.sale);
                                } catch {
                                    /* Incomplete input remains visible and blocks saving. */
                                }
                                const cost = row.tier.costPricing?.configured ? row.tier.costPricing[row.field.key] : undefined;
                                return (
                                    <div key={row.key} className="admin-model-reprice-spec-row">
                                        <div className="admin-model-reprice-identity">
                                            <span>{specificationLabel(row.tier)}</span>
                                            {row.field.label && <small>{row.field.label}</small>}
                                            {row.tier.providerModelKey && row.tier.providerModelKey !== (model.providerModelKey || model.modelKey) && <small className="admin-monospace">上游：{row.tier.providerModelKey}</small>}
                                        </div>
                                        <div className="admin-model-reprice-identity">
                                            <span>{cost === undefined ? "未配置成本" : formatModelPrice(cost)}</span>
                                            <small>积分 / {row.field.unit}</small>
                                        </div>
                                        <div className="admin-model-reprice-sale">
                                            <InputNumber<string>
                                                stringMode
                                                aria-label={`${model.displayName || model.modelKey} ${specificationLabel(row.tier)} ${row.field.label} 销售价`}
                                                size="middle"
                                                value={row.sale}
                                                min="0"
                                                step={String(10 ** -decimalPlaces)}
                                                disabled={disabled}
                                                status={sale === undefined ? "error" : undefined}
                                                onChange={(value) => onSaleChange(row.key, value)}
                                            />
                                            <small>
                                                {row.manual ? "手动修改 · " : ""}利润率 {formatModelMargin(cost, sale)}
                                            </small>
                                        </div>
                                    </div>
                                );
                            })}
                            {!byModel.get(model.id)?.length && <div className="admin-model-reprice-no-spec">暂无已启用规格</div>}
                        </div>
                    ),
                },
                { title: "成本价", width: 160, onCell: () => ({ colSpan: 0 }) },
                { title: "销售价（积分）", width: 340, onCell: () => ({ colSpan: 0 }) },
            ]}
        />
    );
}
