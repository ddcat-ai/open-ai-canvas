import { expect, test } from "bun:test";
import { apiClient } from "../src/services/api/request";
import { usePetPreference } from "../src/stores/use-pet-preference";
import type { PetPreference } from "../src/services/api/appearance";

test("first account load waits for its choice, background refresh stays visible, and late account responses are ignored", async () => {
    const original = apiClient.defaults.adapter;
    const pending: Array<(preference: PetPreference) => void> = [];
    apiClient.defaults.adapter = (config) =>
        new Promise((resolve) => {
            pending.push((preference) => resolve({ data: { code: 0, data: { preference }, msg: "" }, status: 200, statusText: "OK", headers: {}, config }));
        });
    const preference = (modelId: string): PetPreference => ({ modelId, scale: 100, locked: false, hidden: false, revision: 1 });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    try {
        const first = usePetPreference.getState().load("test-pet-account-a");
        expect(usePetPreference.getState().resolved).toBe(false);
        await usePetPreference.getState().load("test-pet-account-a", true);
        await tick();
        expect(pending).toHaveLength(1);
        pending.shift()!(preference("builtin-orb"));
        await first;
        expect(usePetPreference.getState().resolved).toBe(true);
        expect(usePetPreference.getState().preference.modelId).toBe("builtin-orb");

        const refresh = usePetPreference.getState().load("test-pet-account-a", true);
        expect(usePetPreference.getState().resolved).toBe(true);
        expect(usePetPreference.getState().preference.modelId).toBe("builtin-orb");
        await usePetPreference.getState().load("test-pet-account-a", true);
        await tick();
        expect(pending).toHaveLength(1);
        const late = pending.shift()!;
        const second = usePetPreference.getState().load("test-pet-account-b");
        expect(usePetPreference.getState().resolved).toBe(false);
        await tick();
        pending.shift()!(preference("account-b-pet"));
        await second;
        late(preference("stale-account-a-pet"));
        await refresh;
        expect(usePetPreference.getState().scope).toBe("test-pet-account-b");
        expect(usePetPreference.getState().preference.modelId).toBe("account-b-pet");
        expect(usePetPreference.getState().resolved).toBe(true);
    } finally {
        apiClient.defaults.adapter = original;
        await usePetPreference.getState().load("guest");
    }
});
