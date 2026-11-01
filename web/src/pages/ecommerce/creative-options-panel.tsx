import { Select } from "antd";
import type { EcommerceDraft } from "@/services/api/ecommerce";
import { commerceAllowsText, creativeControlFields, normalizeCreativeOptions } from "./creative-controls";
import { ecommerceTypeConfig } from "./type-config";
import { commercePlatformListingMain } from "./platform-style";

export function CreativeOptionsPanel({ draft, onChange }: { draft: EcommerceDraft; onChange: (patch: Partial<EcommerceDraft>) => void }) {
    const selected = normalizeCreativeOptions(draft);
    const platformNoText = commercePlatformListingMain(draft.platform, draft.imageType, draft.typeOptions?.purpose);
    const fixedNoText = Boolean(ecommerceTypeConfig[draft.imageType]?.noText) || draft.cloneOptions?.copyMode === "none" || platformNoText;
    const allowsText = commerceAllowsText(draft);
    return (
        <section className="ecommerce-creative-options" aria-label="文案与视觉参数">
            <div className="ecommerce-creative-heading">
                <strong>文案与视觉</strong>
                <p>选择会用于商品分析、文案策划与每张图片的生成。</p>
            </div>
            <div className="ecommerce-creative-grid">
                {creativeControlFields.map((field) => (
                    <label className="ecommerce-field" key={field.key}>
                        <span>{field.label}</span>
                        <Select<string>
                            aria-label={field.label}
                            value={!allowsText && field.key === "textMode" ? "none" : selected[field.key]}
                            options={field.options}
                            disabled={field.key === "textMode" ? fixedNoText : !allowsText && ["copyTone", "fontStyle", "informationDensity"].includes(field.key)}
                            onChange={(value) => onChange({ creativeOptions: { ...selected, [field.key]: value }, ...(field.key === "textMode" ? { noText: value === "none" } : {}) })}
                        />
                    </label>
                ))}
            </div>
            {!allowsText ? (
                <p className="ecommerce-creative-note">
                    {platformNoText
                        ? "所选平台的 listing 主图须为纯白无字，只保留商品本身的 Logo 与包装原文；副图、A+ 等可添加文案。"
                        : fixedNoText
                          ? "当前创作类型为纯图，保留商品本身的 Logo 与包装原文。"
                          : "已选择纯图无字。文案与字体设置保留，切回图文模式后生效。"}
                </p>
            ) : (
                <p className="ecommerce-creative-note">只上传商品图也可策划。规格、功能与性能数值以已核实资料为准。</p>
            )}
        </section>
    );
}
