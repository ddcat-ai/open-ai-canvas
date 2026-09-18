import { afterEach, expect, spyOn, test } from "bun:test";
import { ApiError, http } from "../src/services/api/request";
import { exportAdminPaymentOrders, exportAdminPaymentReconciliations, exportAdminPaymentReconciliationItems } from "../src/services/api/payments";

let raw: ReturnType<typeof spyOn> | undefined;
afterEach(() => raw?.mockRestore());

test("payment exports pass filters without pagination and preserve downloaded bytes", async () => {
    const blob = new Blob(["\uFEFF订单号,金额\r\n'000000000000000001,10.01\r\n"], { type: "text/csv" });
    raw = spyOn(http, "raw").mockResolvedValue({ data: blob } as never);
    expect(await exportAdminPaymentOrders({ keyword: "alice", providerId: "wechat-native", timeField: "paid", from: "2026-09-01", to: "2026-09-17" })).toBe(blob);
    expect(raw.mock.calls[0][0]).toMatchObject({ url: "/admin/payments/orders/export.csv", responseType: "blob", params: { keyword: "alice", timeField: "paid", from: "2026-09-01", to: "2026-09-17" } });
    expect(raw.mock.calls[0][0].params).not.toHaveProperty("page");
    await exportAdminPaymentReconciliations({ status: "failed" });
    expect(raw.mock.calls[1][0]).toMatchObject({ url: "/admin/payments/reconciliations/export.csv", params: { status: "failed" } });
    await exportAdminPaymentReconciliationItems("run/id", "abnormal");
    expect(raw.mock.calls[2][0]).toMatchObject({ url: "/admin/payments/reconciliations/run%2Fid/items/export.csv", params: { result: "abnormal" } });
});

test("payment downloads expose JSON Blob error messages instead of saving an error CSV", async () => {
    const error = new ApiError("Request failed", { status: 400, cause: { response: { data: new Blob([JSON.stringify({ code: 400, msg: "单次最多导出 10000 行，请缩小筛选范围后重试", reason: "bad_request" })], { type: "application/json" }) } } });
    raw = spyOn(http, "raw").mockRejectedValue(error);
    await expect(exportAdminPaymentOrders({})).rejects.toMatchObject({ status: 400, code: 400, reason: "bad_request", message: "单次最多导出 10000 行，请缩小筛选范围后重试" });
});

test("payment downloads retain non-JSON errors and cancellation", async () => {
    const error = new ApiError("后端服务暂时不可用", { status: 502, cause: { response: { data: new Blob(["<html>Bad gateway</html>"]) } } });
    raw = spyOn(http, "raw").mockRejectedValue(error);
    await expect(exportAdminPaymentOrders({})).rejects.toBe(error);
    const cancelled = new DOMException("请求已取消", "AbortError");
    raw.mockRejectedValue(cancelled);
    await expect(exportAdminPaymentOrders({})).rejects.toBe(cancelled);
});
