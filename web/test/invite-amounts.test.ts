import { describe, expect, test } from "bun:test";

import { invitationStatusLabels, normalizeInviteCode, rewardAmountState, spendableRewardYuan, withdrawalAccountError, withdrawalStatusLabels, yuanToFen } from "../src/lib/invite";

describe("邀请奖励金额", () => {
    test("按整数分解析金额，拒绝额外小数、指数、负数及非安全整数", () => {
        expect(yuanToFen(" 1.01 ")).toBe(101);
        expect(yuanToFen("0.29")).toBe(29);
        expect(yuanToFen("10.1")).toBe(1010);
        expect(yuanToFen("0001.00")).toBe(100);
        for (const value of ["", "0", "0.00", "-1", "+1", "1.006", "1e3", "NaN", "Infinity", "1abc", "9007199254740992"]) {
            expect(yuanToFen(value)).toBeNull();
        }
    });

    test("全部提现和划转向下取整至分，不把 1.006 元取成 1.01 元", () => {
        expect(spendableRewardYuan(1_006_000)).toBe("1.00");
        expect(spendableRewardYuan(1_999_999)).toBe("1.99");
        expect(spendableRewardYuan(9_999)).toBe("0.00");
        expect(spendableRewardYuan(10_000)).toBe("0.01");
        expect(spendableRewardYuan(0)).toBe("0.00");
        expect(spendableRewardYuan(-1)).toBe("0.00");
    });

    test("最小金额及余额以整数比较，最低和全部金额均可提交", () => {
        expect(rewardAmountState("1.00", 1_006_000, 100)).toEqual({ amountFen: 100, belowMin: false, overBalance: false, valid: true });
        expect(rewardAmountState("1.01", 1_006_000, 100)).toEqual({ amountFen: 101, belowMin: false, overBalance: true, valid: false });
        expect(rewardAmountState("0.99", 1_006_000, 100).belowMin).toBe(true);
        expect(rewardAmountState("0.99", 1_006_000, 100).valid).toBe(false);
        expect(rewardAmountState("invalid", 1_006_000, 100).valid).toBe(false);
    });
});

describe("邀请和提现输入状态", () => {
    test("邀请码统一大小写并限制到服务端支持长度", () => {
        expect(normalizeInviteCode(" abCd12 ")).toBe("ABCD12");
        expect(normalizeInviteCode("")).toBe("");
        expect(normalizeInviteCode("abcdefghijklmnopq")).toBe("ABCDEFGHIJKLMNOP");
    });

    test("提现方式要求对应的实名收款字段", () => {
        expect(withdrawalAccountError("wechat", {})).toContain("收款账号");
        expect(withdrawalAccountError("alipay", { account: "pay@example.test", realName: " " })).toContain("实名姓名");
        expect(withdrawalAccountError("wechat", { account: "account", realName: "张三" })).toBe("");
        expect(withdrawalAccountError("bank", { account: "account", realName: "张三" })).toContain("开户行");
        expect(withdrawalAccountError("bank", { bankName: "测试银行", cardNumber: "62220000", holderName: "张三" })).toBe("");
    });

    test("邀请关系与提现状态分别展示，提现通过表示管理员已确认线下打款", () => {
        expect(invitationStatusLabels).toEqual({ pending: "待审核", approved: "已通过", frozen: "已冻结" });
        expect(withdrawalStatusLabels).toEqual({ 0: "审核中", 1: "已驳回", 2: "已成功" });
    });
});
