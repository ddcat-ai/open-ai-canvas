import { Popover } from "antd";
import { Info } from "lucide-react";
import { creditPrice, discountLabel, displayedDiscount } from "@/lib/price-discount";
import type { LogicalModelQuote } from "@/services/api/logical-models";

export function DiscountPrice({ price, original, basisPoints, source }: { price: string; original?: string; basisPoints?: number; source?: string }) {
    const label = original && original !== price ? discountLabel(basisPoints, source) : undefined;
    return <span className="inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 gap-y-1 tabular-nums">
        <span className="font-semibold">{price}</span>
        {label ? <><s className="text-foreground/45 font-normal" aria-label={`官方原价 ${original}`}>{original}</s><span className="rounded px-1 py-0.5 text-[10px] leading-tight font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">{label}</span></> : null}
    </span>;
}

export function QuotePrice({ quote }: { quote: LogicalModelQuote }) {
    const original = quote.originalAmountMicrocredits;
    return <DiscountPrice price={`${quote.estimated ? "预估 " : ""}${creditPrice(quote.amountMicrocredits)} 积分`} original={original != null && original > quote.amountMicrocredits ? `${quote.estimated ? "预估 " : ""}${creditPrice(original)} 积分` : undefined} basisPoints={displayedDiscount(quote.amountMicrocredits, original)} source={quote.multiplierSource} />;
}

export function QuotePriceDetails({ quote, showPlain = false, iconOnly = false }: { quote?: LogicalModelQuote | null; showPlain?: boolean; iconOnly?: boolean }) {
    if (!quote) return null;
    const label = discountLabel(displayedDiscount(quote.amountMicrocredits, quote.originalAmountMicrocredits), quote.multiplierSource);
    const personal = quote.multiplierSource === "user" && quote.multiplierBasisPoints != null && quote.multiplierBasisPoints < 10000;
    if (!label && !personal && !iconOnly && !showPlain) return null;
    const content = <div className="w-60 text-sm space-y-2">
        {quote.originalAmountMicrocredits != null ? <div className="flex justify-between"><span>官方原价</span><span>{creditPrice(quote.originalAmountMicrocredits)} 积分</span></div> : null}
        {quote.regularAmountMicrocredits != null ? <div className="flex justify-between"><span>常规售价</span><span>{creditPrice(quote.regularAmountMicrocredits)} 积分</span></div> : null}
        {personal ? <div className="flex justify-between"><span>售价基础上再享</span><span>{discountLabel(quote.multiplierBasisPoints)}</span></div> : null}
        {label ? <div className="flex justify-between"><span>相对官方原价</span><span>{label}</span></div> : null}
        <div className="flex justify-between font-semibold"><span>{quote.estimated ? "预计消耗" : "本次费用"}</span><span>{creditPrice(quote.amountMicrocredits)} 积分</span></div>
        {quote.estimated ? <p className="text-xs text-foreground/55">按实际用量结算</p> : null}
    </div>;
    return <Popover trigger="click" content={content} title="费用明细"><button type="button" className={iconOnly ? "inline-flex size-6 shrink-0 items-center justify-center rounded text-foreground/75 hover:bg-foreground/5" : "inline-flex max-w-full flex-wrap items-center gap-1 text-xs text-foreground/75"} aria-label="查看费用明细" title="费用明细" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>{iconOnly ? null : <QuotePrice quote={quote} />}<Info size={13} className="shrink-0" /></button></Popover>;
}
