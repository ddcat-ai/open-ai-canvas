import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

import { LL2_PRICE_DISCLAIMER, ll2EstimateCNY, ll2ModelById } from "@/lib/ll2-models";

type LL2PriceHintProps = {
    model: string;
    mode: string;
    seconds: string | number;
};

/**
 * 提交生成前的人民币价格提示。
 * 只做「按官网示例折算」的预估，不冒充实际扣费；文本模型不显示固定单次价。
 */
export function LL2PriceHint({ model, mode, seconds }: LL2PriceHintProps) {
    const duration = Number(seconds) || 5;
    const known = ll2ModelById(model);
    const estimate = ll2EstimateCNY(model, duration);

    if (mode === "text" || known?.category === "text") {
        return (
            <div className="ll2-price-hint is-usage">
                <span className="ll2-price-hint-main">按 Token 用量计费</span>
                <span className="ll2-price-hint-side">
                    {known ? `${known.name} · ${known.priceText} / 1M Token` : "无固定单次价"}
                    <Link to="/models">全部价格 <ArrowUpRight className="size-3" /></Link>
                </span>
            </div>
        );
    }

    if (!estimate) {
        return (
            <div className="ll2-price-hint is-usage">
                <span className="ll2-price-hint-main">选好模型就能看到本次花多少钱</span>
                <span className="ll2-price-hint-side">
                    <Link to="/models">模型广场 · 21 个模型价格 <ArrowUpRight className="size-3" /></Link>
                </span>
            </div>
        );
    }

    return (
        <div className="ll2-price-hint" title={estimate.basis}>
            <span className="ll2-price-hint-main">
                <span className="ll2-price-hint-label">本次预计</span>
                <strong>{estimate.label}</strong>
                <span className="ll2-price-hint-meta">
                    {estimate.model.name} · {duration} 秒
                </span>
            </span>
            <span className="ll2-price-hint-side">
                <span>{LL2_PRICE_DISCLAIMER}</span>
                <Link to="/models">全部价格 <ArrowUpRight className="size-3" /></Link>
            </span>
        </div>
    );
}
