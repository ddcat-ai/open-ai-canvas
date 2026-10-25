export function discountLabel(basisPoints?: number, source?: string): string | undefined {
    if (!Number.isInteger(basisPoints) || basisPoints! <= 0 || basisPoints! >= 10000) return undefined;
    return `${source === "user" ? "专属" : ""}${(basisPoints! / 1000).toLocaleString("zh-CN", { maximumFractionDigits: 3 })}折`;
}

export function creditPrice(amountMicrocredits: number): string {
    return (amountMicrocredits / 1_000_000).toLocaleString("zh-CN", { maximumFractionDigits: 6 });
}

export function displayedDiscount(final: number, original?: number): number | undefined {
    if (original == null || !Number.isFinite(original) || original <= 0 || !Number.isFinite(final) || final <= 0 || final >= original) return undefined;
    return Math.round(final / original * 10000);
}
