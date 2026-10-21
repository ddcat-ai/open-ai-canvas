import type { WithdrawAccountInfo, WithdrawMethod } from "@/services/api/invite";

export function normalizeInviteCode(value: string) {
    return value.trim().toUpperCase().slice(0, 16);
}

export function formatMicroYuan(microYuan: number) {
    return (microYuan / 1_000_000).toFixed(2);
}

export function yuanToFen(value: string): number | null {
    const trimmed = value.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const [whole, fraction = ""] = trimmed.split(".");
    const fen = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    return Number.isSafeInteger(fen) && fen > 0 ? fen : null;
}

/** Monetary actions accept whole cents; "all" must never round above the balance. */
export function spendableRewardYuan(microYuan: number) {
    return (Math.floor(Math.max(0, microYuan) / 10_000) / 100).toFixed(2);
}

export function rewardAmountState(value: string, availableMicroYuan: number, minFen: number) {
    const amountFen = yuanToFen(value);
    const belowMin = amountFen !== null && amountFen < minFen;
    const overBalance = amountFen !== null && amountFen * 10_000 > availableMicroYuan;
    return {
        amountFen,
        belowMin,
        overBalance,
        valid: amountFen !== null && !belowMin && !overBalance,
    };
}

export function withdrawalAccountError(method: WithdrawMethod, info: WithdrawAccountInfo) {
    if (method === "bank") {
        if (!info.bankName?.trim()) return "请填写开户行";
        if (!info.cardNumber?.trim()) return "请填写银行卡号";
        if (!info.holderName?.trim()) return "请填写持卡人姓名";
    } else {
        if (!info.account?.trim()) return "请填写收款账号";
        if (!info.realName?.trim()) return "请填写实名姓名";
    }
    return "";
}

export const invitationStatusLabels = {
    pending: "待审核",
    approved: "已通过",
    frozen: "已冻结",
} as const;

export const withdrawalStatusLabels = { 0: "审核中", 1: "已驳回", 2: "已成功" } as const;
