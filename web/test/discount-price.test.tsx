import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DiscountPrice, QuotePrice, QuotePriceDetails } from "../src/components/discount-price";
import { discountLabel } from "../src/lib/price-discount";
import type { LogicalModelQuote } from "../src/services/api/logical-models";

const quote: LogicalModelQuote = { logicalModelId: "", billingMode: "fixed_request", quantity: 1, originalAmountMicrocredits: 10000000, amountMicrocredits: 8000000, multiplierBasisPoints: 8000, multiplierSource: "user", estimated: false };

test("discount language preserves precision and distinguishes personal offers", () => {
    expect(discountLabel(5000)).toBe("5折");
    expect(discountLabel(8500)).toBe("8.5折");
    expect(discountLabel(8765, "user")).toBe("专属8.765折");
    for (const value of [undefined, 0, -1, 10000, 12000, NaN, 0.5]) expect(discountLabel(value)).toBeUndefined();
});

test("quote shows the backend original price and final price without multiplying twice", () => {
    const html = renderToStaticMarkup(<QuotePrice quote={quote} />);
    expect(html).toContain("8 积分");
    expect(html).toContain("10 积分</s>");
    expect(html).toContain("专属8折");
    expect(html).not.toContain("6.4");
});

test("missing original, unchanged prices and surcharges never imply a discount", () => {
    for (const patch of [{ originalAmountMicrocredits: undefined }, { amountMicrocredits: 10000000 }, { amountMicrocredits: 12000000, multiplierBasisPoints: 12000 }]) {
        const html = renderToStaticMarkup(<QuotePrice quote={{ ...quote, ...patch }} />);
        expect(html).not.toContain("<s ");
        expect(html).not.toContain("折");
        expect(renderToStaticMarkup(<QuotePriceDetails quote={{ ...quote, ...patch, multiplierSource: "sale" }} />)).toBe("");
    }
});

test("estimated and tiny prices keep their meaning and precision", () => {
    const html = renderToStaticMarkup(<QuotePrice quote={{ ...quote, estimated: true, billingMode: "token", originalAmountMicrocredits: 2, amountMicrocredits: 1, multiplierBasisPoints: 5000 }} />);
    expect(html).toContain("预估 0.000001 积分");
    expect(html).toContain("预估 0.000002 积分</s>");
    expect(renderToStaticMarkup(<DiscountPrice price="0 积分" original="0 积分" basisPoints={8000} />)).not.toContain("折");
});
