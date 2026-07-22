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
    unitPriceMicrocredits: number;
};

function modelCreditCost(modelCosts: ModelCreditCost[] | undefined, model: string) {
    const microcredits = modelCosts?.find((item) => item.model === model)?.unitPriceMicrocredits;
    return microcredits === undefined ? null : microcredits / 1_000_000;
}

export function formatCredits(value: number, maximumFractionDigits = 6) {
    return (value / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits });
}

export function requestCreditCost(options: { channelMode: string; modelCosts?: ModelCreditCost[]; model: string; count?: string | number }) {
    if (options.channelMode !== "remote") return null;
    const unitCredits = modelCreditCost(options.modelCosts, options.model);
    const count = Math.max(1, Math.floor(Math.abs(Number(options.count)) || 1));
    return unitCredits === null ? null : unitCredits * count;
}
