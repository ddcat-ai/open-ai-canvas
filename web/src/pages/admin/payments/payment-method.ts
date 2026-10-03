export function paymentTypeLabel(payType: string): string {
    switch (payType) {
        case "alipay": return "支付宝";
        case "wechat": return "微信支付";
        case "qq": return "QQ 钱包";
        case "usdt": return "USDT";
        default: return payType || "未确定";
    }
}
