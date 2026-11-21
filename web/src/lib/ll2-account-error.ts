/**
 * LL2 的 403 不只是「没权限」：余额不足、模型分组未开通都会返回 403。
 * 这里统一把网关原文翻成人话，避免把「余额不足」误报成「Key 没权限」。
 */
export function ll2ForbiddenMessage(payload: unknown, fallback: string): string {
    const record = payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
    const error = record.error && typeof record.error === "object" ? (record.error as Record<string, unknown>) : {};
    const detail = String((typeof record.message === "string" && record.message) || (typeof record.msg === "string" && record.msg) || (typeof error.message === "string" && error.message) || "").trim();

    const balance = /(?:预扣费额度|余额不足|额度不足|insufficient|quota|balance)/i.test(detail);
    if (balance) {
        const remaining = detail.match(/剩余额度\s*[:：]?\s*¥?\s*([\d.]+)/i)?.[1];
        const required = detail.match(/预扣费额度\s*[:：]?\s*¥?\s*([\d.]+)/i)?.[1];
        const amounts = [remaining && `当前剩余 ¥${remaining}`, required && `本次需要预扣 ¥${required}`].filter(Boolean).join("，");
        return `LL2 账户余额不足${amounts ? `：${amounts}` : ""}。请到 LL2 控制台充值后再试`;
    }

    if (/(?:没有调用|无权|权限|permission|model_not_found|无可用渠道|no available channel|分组)/i.test(detail)) {
        return `这个 Key 没有调用该模型的权限，请到 LL2 控制台确认${detail ? `（${detail}）` : ""}`;
    }

    return detail ? `LL2 拒绝本次请求（HTTP 403）：${detail}` : fallback;
}
