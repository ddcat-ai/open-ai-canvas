import { expect, test } from "bun:test";

import { apiClient } from "@/services/api/request";
import { listAddedSkills } from "@/services/api/skills";

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
