import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { apiClient } from "../src/services/api/request";
import { loadProfileSession } from "../src/services/profile-session";
import { useUserStore, type LocalUser } from "../src/stores/use-user-store";

const originalUser: LocalUser = { id: "profile-user", username: "user", displayName: "User", role: "user", status: "active", avatarMode: "default", avatarPreset: "person" };

test("profile refresh synchronizes avatars while rejecting stale account and cancelled responses", async () => {
    const originalRequest = apiClient.request;
    const previousUser = useUserStore.getState().user;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    try {
        for (const scenario of ["refresh", "switched-account", "wrong-user", "cancelled", "failure"] as const) {
            useUserStore.getState().setUser(originalUser);
            let respond!: (value: unknown) => void;
            let reject!: (reason: Error) => void;
            apiClient.request = (() =>
                new Promise((resolve, fail) => {
                    respond = resolve;
                    reject = fail;
                })) as typeof apiClient.request;
            const key = ["user-profile", scenario];
            const request = client.fetchQuery({ queryKey: key, queryFn: ({ signal }) => loadProfileSession(originalUser.id, signal) }).catch((error) => error);
            if (scenario === "switched-account") useUserStore.getState().setUser({ ...originalUser, id: "other-user" });
            if (scenario === "cancelled") {
                await client.cancelQueries({ queryKey: key });
                useUserStore.getState().setUser({ ...originalUser, avatarPreset: "cat" });
            }
            if (scenario === "failure") reject(new Error("profile unavailable"));
            else respond({ data: { code: 0, data: { user: { ...originalUser, id: scenario === "wrong-user" ? "unexpected-user" : originalUser.id, avatarPreset: "robot" } }, msg: "ok" }, status: 200 });
            await request;
            await Promise.resolve();
            const stored = useUserStore.getState().user;
            expect(stored?.id).toBe(scenario === "switched-account" ? "other-user" : originalUser.id);
            expect(stored?.avatarPreset).toBe(scenario === "refresh" ? "robot" : scenario === "cancelled" ? "cat" : "person");
        }
    } finally {
        await client.cancelQueries();
        client.clear();
        apiClient.request = originalRequest;
        useUserStore.setState({ user: previousUser });
    }
});
