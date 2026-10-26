import { expect, test } from "bun:test";

import { apiClient } from "@/services/api/request";
import { addSkill, deleteSkill, listAddedSkills } from "@/services/api/skills";

test("added Skills retries a transient backend proxy failure", async () => {
    const original = apiClient.request;
    let attempts = 0;
    apiClient.request = (async () => {
        attempts += 1;
        if (attempts === 1) {
            throw {
                isAxiosError: true,
                message: "Request failed with status code 502",
                response: { status: 502, data: "Bad Gateway", headers: {} },
            };
        }
        return { data: { code: 0, data: { skills: [] }, msg: "ok" }, status: 200, headers: {} };
    }) as typeof apiClient.request;

    try {
        await expect(listAddedSkills()).resolves.toEqual({ skills: [] });
        expect(attempts).toBe(2);
    } finally {
        apiClient.request = original;
    }
});

test("#888 a fresh catalog bypasses cached and pending reads after deletion", async () => {
    const original = apiClient.request;
    const envelope = (skills: unknown[]) => ({ data: { code: 0, data: { skills }, msg: "ok" }, status: 200, headers: {} });
    let reads = 0;
    let release: ((value: unknown) => void) | undefined;
    apiClient.request = (async (config) => {
        if (config.method !== "get") return envelope([]);
        reads++;
        if (reads === 1) return envelope([{ skillId: "deleted", isAdded: true }]);
        if (reads === 3) return new Promise((resolve) => { release = resolve; });
        return envelope([]);
    }) as typeof apiClient.request;
    try {
        await addSkill("deleted");
        await listAddedSkills();
        expect((await listAddedSkills({ fresh: true })).skills).toEqual([]);
        await deleteSkill("deleted");
        const pending = listAddedSkills();
        expect((await listAddedSkills({ fresh: true })).skills).toEqual([]);
        release?.(envelope([{ skillId: "deleted", isAdded: true }]));
        expect((await pending).skills).toEqual([]);
        expect((await listAddedSkills()).skills).toEqual([]);
    } finally {
        release?.(envelope([]));
        apiClient.request = original;
    }
});

test("a pending skills response cannot replace the cache after installation", async () => {
    const original = apiClient.request;
    let resolveStale: ((value: unknown) => void) | undefined;
    const staleResponse = new Promise((resolve) => { resolveStale = resolve; });
    let reads = 0;
    const envelope = (skills: unknown[]) => ({ data: { code: 0, data: { skills }, msg: "ok" }, status: 200, headers: {} });
    apiClient.request = (async (config) => {
        if (config.method === "post") return envelope([]);
        reads += 1;
        return reads === 1 ? staleResponse : envelope([{ skillId: "preset", isAdded: true }]);
    }) as typeof apiClient.request;

    try {
        await addSkill("preset"); // Invalidate a cache left by another reader.
        const pending = listAddedSkills();
        await addSkill("preset");
        const fresh = await listAddedSkills();
        resolveStale?.(envelope([]));
        expect((await pending).skills).toEqual(fresh.skills);
        expect(fresh.skills).toEqual([{ skillId: "preset", isAdded: true }]);
        expect((await listAddedSkills()).skills).toEqual(fresh.skills);
        expect(reads).toBe(2);
    } finally {
        resolveStale?.(envelope([]));
        apiClient.request = original;
    }
});
