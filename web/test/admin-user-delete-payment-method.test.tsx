import { expect, test } from "bun:test";
import type { ReactElement } from "react";
import { createUserColumns, userColumnOptions } from "../src/pages/admin/users/users-columns";
import { paymentTypeLabel } from "../src/pages/admin/payments/payment-method";
import type { AdminUser } from "../src/services/api/auth";

test("disabled accounts still expose the real delete action", () => {
    const user = { id: "user-1", username: "user", status: "disabled" } as AdminUser;
    const columns = createUserColumns({ actorId: "admin-1", visibleColumns: new Set(userColumnOptions.map((item) => item.key)), onView: () => {}, onEdit: () => {}, onToggleStatus: async () => {}, onDelete: async () => {} });
    const actionColumn = columns.find((column) => column.key === "actions");
    const element = actionColumn?.render?.(null, user, 0) as ReactElement<{ actions: Array<{ key: string; disabled?: boolean; confirm?: unknown }> }>;
    const action = element.props.actions.find((item) => item.key === "delete");
    expect(action?.disabled).toBe(false);
    expect(action?.confirm).toBeUndefined();
});

test("payment method labels use configured payType and preserve unknown state", () => {
    expect(paymentTypeLabel("alipay")).toBe("支付宝");
    expect(paymentTypeLabel("wechat")).toBe("微信支付");
    expect(paymentTypeLabel("qq")).toBe("QQ 钱包");
    expect(paymentTypeLabel("custom")).toBe("custom");
    expect(paymentTypeLabel("")).toBe("未确定");
});
