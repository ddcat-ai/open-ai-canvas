import { formatLocale } from "@/lib/format-locale";
import type { ComponentProps } from "react";
import { Coins } from "lucide-react";

export function CreditSymbol({ className, ...props }: ComponentProps<"span">) {
    return (
        <span {...props} className={`inline-flex items-center justify-center ${className || ""}`}>
            <Coins className="size-[1em]" strokeWidth={2.2} />
        </span>
    );
}

export type ModelCreditCost = {
    model: string;
    pricePolicy?: "channel" | "unified";
    billingMode: "fixed_request" | "per_second" | "token";
    unitPriceMicrocredits: number;
};

function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    return modelCosts?.find((item) => item.model === model) || null;
}

export function formatCredits(value: number, maximumFractionDigits = 6) {
    return (value / 1_000_000).toLocaleString(formatLocale(), { maximumFractionDigits });
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number; seconds?: string | number }) {
    if (options.channelMode !== "remote") return null;
    const cost = modelCreditCost(options.modelCosts, options.model);
    if (!cost) return null;
    // 跟随供应价格的前台模型只有后端完成能力路由后才能确定价格，前端不展示误导性预估。
    if (cost.pricePolicy === "channel") return null;
    // Token 订单由服务端按请求体预授权并在 usage 返回后结算，前端不展示无依据的固定价格。
    if (cost.billingMode === "token") return null;
    const quantity = cost.billingMode === "per_second" ? Math.max(1, Math.floor(Math.abs(Number(options.seconds)) || 1)) : Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return (cost.unitPriceMicrocredits / 1_000_000) * quantity;
}
