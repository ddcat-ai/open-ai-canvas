import { expect, test } from "bun:test";
import { adminDensityStorageKey, normalizeAdminDensity } from "../src/pages/admin/components/admin-density";
import { logBillingLabel, logStatus, normalizeLogView } from "../src/pages/admin/logs/log-view";

test("后台默认紧凑，密度偏好按账号隔离且拒绝无效值", () => {
    expect(normalizeAdminDensity(null)).toBe("compact");
    expect(normalizeAdminDensity("invalid")).toBe("compact");
    expect(normalizeAdminDensity("comfortable")).toBe("comfortable");
    expect(adminDensityStorageKey("ops:a")).not.toBe(adminDensityStorageKey("ops:b"));
    expect(adminDensityStorageKey("ops:a")).toContain("ops%3Aa");
});

test("请求视图默认排障，全部字段和账务仍可单独读取", () => {
    expect(normalizeLogView(null)).toBe("troubleshoot");
    expect(normalizeLogView("unknown")).toBe("troubleshoot");
    expect(normalizeLogView("billing")).toBe("billing");
    expect(normalizeLogView("all")).toBe("all");
});

test("供应商进行中与失败状态优先于 HTTP 成功，失败不会变绿", () => {
    expect(logStatus({ status: "succeeded", providerStatus: "RUNNING" }).tone).toBe("warning");
    for (const providerStatus of ["failed", "cancelled", "canceled", "expired"]) {
        expect(logStatus({ status: "succeeded", providerStatus }).tone).toBe("error");
    }
    expect(logStatus({ status: "failed", providerStatus: "running" }).tone).toBe("error");
    expect(logStatus({ status: "succeeded" }).tone).toBe("success");
});

test("账务视图区分不计费、未扣积分、预授权与真实结算", () => {
    expect(logBillingLabel({ billable: false, billingAvailable: false })).toBe("不计费");
    expect(logBillingLabel({ billable: true, billingAvailable: false, billingStatus: "settled" })).toBe("未扣积分");
    expect(logBillingLabel({ billable: true, billingAvailable: true })).toBe("已预授权");
    expect(logBillingLabel({ billable: true, billingAvailable: true, billingStatus: "refunded" })).toBe("已退回");
    expect(logBillingLabel({ billable: true, billingAvailable: true, billingStatus: "uncertain" })).toBe("待核对");
});
