import { Check } from "lucide-react";

import { BANNER_NOTICE_TYPES, normalizeBannerNoticeType, type BannerNoticeType } from "@/lib/announcements/banner-notice";

/**
 * 通知类型选择：每种类型决定通知条底色，卡片上直接铺真实底色条，
 * 免得用「蓝色 / 橙色」这种文字去描述一个已经看得见的颜色。
 */
export function BannerNoticeTypeSelector({ value, onChange }: { value: string; onChange: (type: BannerNoticeType) => void }) {
    const active = normalizeBannerNoticeType(value);

    return (
        <div className="admin-banner-type-grid" role="radiogroup" aria-label="通知类型">
            {BANNER_NOTICE_TYPES.map((type) => {
                const selected = active === type.key;
                return (
                    <button
                        key={type.key}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-banner-type={type.key}
                        className={`admin-banner-type-card${selected ? " is-active" : ""}`}
                        onClick={() => onChange(type.key)}
                    >
                        <span className="admin-banner-type-card-name">
                            {type.label}
                            {selected ? <Check className="admin-banner-type-card-check size-3.5" aria-hidden="true" /> : null}
                        </span>
                        <span className="admin-banner-type-card-hint">{type.hint}</span>
                        {/* 真实底色条：颜色来自该类型 token，随当前主题解析 */}
                        <span className="admin-banner-type-card-preview" aria-hidden="true">
                            <span className="truncate">{type.label}通知效果预览</span>
                        </span>
                    </button>
                );
            })}
        </div>
    );
}
