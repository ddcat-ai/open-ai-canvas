import { afterEach, expect, test } from "bun:test";
import type { ReactElement } from "react";

import { createUserColumns } from "../src/pages/admin/users/users-columns";
import type { AdminRowAction } from "../src/pages/admin/components/admin-ui";
import { exitUserImpersonation, getAuthSession, startAdminUserImpersonation, type AdminUser } from "../src/services/api/auth";
import { apiClient } from "../src/services/api/request";
import { useUserStore } from "../src/stores/use-user-store";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    useUserStore.getState().clearSession();
});

test("only the primary admin sees entry for an active ordinary user", async () => {
    const target = { id: "user", username: "creator", displayName: "Creator", role: "user", status: "active" } as AdminUser;
    let entered = "";
    const actionsFor = (user: AdminUser, allowed = true) => {
        const columns = createUserColumns({
            actorId: "admin", canImpersonateUsers: allowed, visibleColumns: new Set(["actions"]),
            onView() {}, onEdit() {}, async onToggleStatus() {},
            async onImpersonate(selected) { entered = selected.id; },
        });
        const column = columns[0] as { render: (value: unknown, user: AdminUser, index: number) => ReactElement<{ actions: AdminRowAction[] }> };
        return column.render(null, user, 0).props.actions.find((action) => action.key === "impersonate");
    };
    const entry = actionsFor(target);
    expect(entry?.label).toBe("进入");
    expect(entry?.confirm?.description).toContain("修改会真实保存");
    await entry?.onClick();
    expect(entered).toBe(target.id);
    expect(actionsFor(target, false)).toBeUndefined();
    expect(actionsFor({ ...target, status: "disabled" })).toBeUndefined();
    expect(actionsFor({ ...target, role: "admin" })).toBeUndefined();
    expect(actionsFor({ ...target, id: "admin" })).toBeUndefined();
});

test("entry and exit use POST and invalidate cached session identity", async () => {
    let userId = "admin";
    const requests: string[] = [];
    apiClient.defaults.adapter = async (config) => {
        requests.push(`${config.method} ${config.url}`);
        if (config.url === "/admin/users/user%2Fone/impersonation") userId = "user/one";
        if (config.url === "/auth/impersonation/exit") userId = "admin";
        return { data: { code: 0, data: { user: { id: userId } }, msg: "ok" }, status: 200, statusText: "OK", headers: {}, config };
    };
    expect((await getAuthSession()).user?.id).toBe("admin");
    await startAdminUserImpersonation("user/one");
    expect((await getAuthSession()).user?.id).toBe("user/one");
    await exitUserImpersonation();
    expect((await getAuthSession()).user?.id).toBe("admin");
    expect(requests).toEqual([
        "get /auth/session", "post /admin/users/user%2Fone/impersonation", "get /auth/session",
        "post /auth/impersonation/exit", "get /auth/session",
    ]);
});

test("clearing the session removes impersonation privileges and actor", () => {
    useUserStore.getState().setImpersonation({ actorDisplayName: "Admin", actorUsername: "admin" }, true);
    useUserStore.getState().clearSession();
    expect(useUserStore.getState().canImpersonateUsers).toBe(false);
    expect(useUserStore.getState().impersonation).toBeNull();
});
