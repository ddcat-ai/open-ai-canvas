import { afterEach, describe, expect, test } from "bun:test";

import { getRemoteCanvasProject } from "../src/services/api/user-data";
import { apiClient } from "../src/services/api/request";
import type { CanvasProject } from "../src/stores/canvas/use-canvas-store";

const originalAdapter = apiClient.defaults.adapter;

afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
});

describe("conditional canvas reads", () => {
    test("reuses a verified project when the server returns 304", async () => {
        const known = {
            id: "canvas-1",
            title: "Cached canvas",
            revision: 4,
            updatedAt: "2026-09-28T12:00:00.000Z",
        } as CanvasProject;
        let requestEtag = "";
        apiClient.defaults.adapter = async (config) => {
            const headers = config.headers as { get?: (name: string) => string | undefined; [key: string]: unknown } | undefined;
            requestEtag = String(headers?.get?.("If-None-Match") ?? headers?.["If-None-Match"] ?? "");
            return { config, status: 304, statusText: "Not Modified", headers: {}, data: null };
        };

        await expect(getRemoteCanvasProject(known.id, known)).resolves.toEqual({ project: known, notModified: true });
        expect(requestEtag).toBe('"canvas-4"');
    });
});
