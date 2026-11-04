import { Check, Minus, Plus, RotateCcw, Sparkles, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { imageSizeLabel } from "./catalog";
import { CommerceHint } from "./commerce-hint";
import { automaticMarketingSelections, marketingCategories, marketingMaterialById, marketingMaterials, parseMarketingSelections, recommendMarketingSelections, type MarketingSelection } from "./marketing-materials";

export function MarketingMaterialPicker({ draft, ratios, onChange, onClose }: { draft: EcommerceDraft; ratios: string[]; onChange: (selections: MarketingSelection[]) => void; onClose: () => void }) {
    const [category, setCategory] = useState<string>(() => marketingMaterialById.get(parseMarketingSelections(draft)[0]?.id)?.category || marketingCategories[0]);
    const available = ratios.length ? ratios : [draft.ratio];
    const savedSelections = parseMarketingSelections(draft);
    const selections = automaticMarketingSelections(savedSelections, available, draft.ratio);
    const selected = new Map(selections.map((item) => [item.id, item]));
    const count = selections.reduce((sum, item) => sum + item.count, 0);
    useEffect(() => {
        if ((draft.typeOptions?.materialPlan || "[]") !== JSON.stringify(selections)) onChange(selections);
    }, [draft.typeOptions?.materialPlan, available.join("|"), draft.ratio]);
    const update = (id: string, change: (entry: MarketingSelection | undefined) => MarketingSelection | undefined) => {
        const next = change(selected.get(id));
        onChange([...selections.filter((item) => item.id !== id), ...(next ? [next] : [])]);
    };
    return (
        <div className="commerce-material-picker" aria-label="营销物料配置">
            <nav className="commerce-material-categories" aria-label="物料分类">
                {marketingCategories.map((name) => {
                    const selectedCount = selections.filter((entry) => marketingMaterialById.get(entry.id)?.category === name).reduce((sum, entry) => sum + entry.count, 0);
                    return (
                        <CommerceHint key={name} text={category === name ? `正在配置${name}，可选最多 15 张。` : `切换至${name}，当前品类的选择将清空。`} placement="right">
                            <button
                                type="button"
                                aria-current={category === name ? "true" : undefined}
                                onClick={() => {
                                    if (category !== name) {
                                        setCategory(name);
                                        if (count) onChange([]);
                                    }
                                }}
                            >
                                {name}
                                {selectedCount ? ` (${selectedCount})` : ""}
                            </button>
                        </CommerceHint>
                    );
                })}
            </nav>
            <div className="commerce-material-main">
                <header>
                    <div className="commerce-material-actions">
                        <CommerceHint text="根据商品描述，从当前品类推荐适合的物料。">
                            <button type="button" onClick={() => onChange(recommendMarketingSelections([draft.instruction, draft.productName, draft.scene].join(" "), category, available))}>
                                <Sparkles size={14} />
                                智能选择
                            </button>
                        </CommerceHint>
                        <CommerceHint text="清空当前物料，重新挑选创作组合。">
                            <button type="button" onClick={() => onChange([])} disabled={!count}>
                                <RotateCcw size={14} />
                                重置
                            </button>
                        </CommerceHint>
                        <span>
                            已选 {count}
                            <i> / 15</i>
                        </span>
                    </div>
                    <CommerceHint text="收起物料配置，已选内容会保留。">
                        <button type="button" className="commerce-material-close" aria-label="关闭物料配置" onClick={onClose}>
                            <X size={15} />
                        </button>
                    </CommerceHint>
                </header>
                <div className="commerce-material-grid">
                    {marketingMaterials
                        .filter((item) => item.category === category)
                        .map((item) => {
                            const choice = selected.get(item.id);
                            const active = Boolean(choice);
                            const autoSelection = automaticMarketingSelections([{ id: item.id, count: 1, ratio: item.ratio }], available, draft.ratio)[0];
                            const visibleRatio = imageSizeLabel(choice?.ratio || autoSelection.ratio);
                            return (
                                <div key={item.id} className={`commerce-material-tile${active ? " is-selected" : ""}`}>
                                    <CommerceHint text={active ? `取消${item.name}，会移除该物料的全部图片。` : count >= 15 ? "已达到 15 张上限，先减少其他物料。" : `选择${item.name}，默认生成 1 张，比例自动匹配当前模型。`}>
                                        <button
                                            type="button"
                                            className="commerce-material-select"
                                            aria-pressed={active}
                                            aria-label={`${active ? "取消" : "选择"}${item.name}`}
                                            disabled={!active && count >= 15}
                                            onClick={() => update(item.id, (entry) => (entry ? undefined : autoSelection))}
                                        >
                                            <span className="commerce-material-check">{active ? <Check size={13} strokeWidth={2.6} /> : null}</span>
                                            <span>{item.name}</span>
                                        </button>
                                    </CommerceHint>
                                    {active ? (
                                        <div className="commerce-material-controls">
                                            <CommerceHint text={`将${item.name}减少到 ${Math.max(1, choice!.count - 1)} 张。`}>
                                                <button type="button" aria-label={`${item.name}减少一张`} disabled={choice!.count <= 1} onClick={() => update(item.id, (entry) => (entry && entry.count > 1 ? { ...entry, count: entry.count - 1 } : entry))}>
                                                    <Minus size={13} />
                                                </button>
                                            </CommerceHint>
                                            <span>{choice!.count}</span>
                                            <CommerceHint text={count >= 15 ? "已达到 15 张上限。" : `为${item.name}增加 1 张。`}>
                                                <button type="button" aria-label={`${item.name}增加一张`} disabled={count >= 15} onClick={() => update(item.id, (entry) => (entry ? { ...entry, count: entry.count + 1 } : undefined))}>
                                                    <Plus size={13} />
                                                </button>
                                            </CommerceHint>
                                        </div>
                                    ) : null}
                                    <span className="commerce-material-ratio" aria-label={`${item.name}自动比例 ${visibleRatio}`}>
                                        {visibleRatio}
                                    </span>
                                </div>
                            );
                        })}
                </div>
                <p>各类型按当前图片模型自动匹配比例，最多选择 15 张。</p>
            </div>
        </div>
    );
}
