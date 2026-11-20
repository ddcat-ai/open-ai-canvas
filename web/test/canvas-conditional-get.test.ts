import { afterEach, describe, expect, test } from "bun:test";

import { getRemoteCanvasProject, getRemoteUserDataSnapshot } from "../src/services/api/user-data";
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
            chatSessions: [],
        } as CanvasProject;
        let requestEtag = "";
        apiClient.defaults.adapter = async (config) => {
            const headers = config.headers as { get?: (name: string) => string | undefined; [key: string]: unknown } | undefined;
            requestEtag = String(headers?.get?.("If-None-Match") ?? headers?.["If-None-Match"] ?? "");
            return { config, status: 304, statusText: "Not Modified", headers: {}, data: null };
        };

        const result = await getRemoteCanvasProject(known.id, known);
        expect(result).toEqual({ project: known, notModified: true });
        expect(result.project).toBe(known);
        expect(requestEtag).toBe('"canvas-4"');
    });

    for (const mode of ["get", "conditional", "not-modified", "snapshot"] as const) {
        test(`${mode}: normalizes omitted sessions at the read boundary without mutating the response`, async () => {
            const raw = { id: "canvas-1", revision: 4, nodes: [], connections: [] } as unknown as CanvasProject;
            apiClient.defaults.adapter = async (config) => ({
                config,
                status: mode === "not-modified" ? 304 : 200,
                statusText: "OK",
                headers: {},
                data: mode === "not-modified" ? null : { code: 0, data: mode === "snapshot" ? { projects: [raw], assets: [] } : { project: raw } },
            });
            const project = mode === "snapshot" ? (await getRemoteUserDataSnapshot()).projects[0] : (await getRemoteCanvasProject(raw.id, mode === "get" ? undefined : raw)).project;
            expect(project.chatSessions).toEqual([]);
            expect(raw.chatSessions).toBeUndefined();
            expect(project.nodes).toBe(raw.nodes);
        });

        test(`${mode}: rejects corrupt non-array sessions`, async () => {
            const raw = { id: "canvas-1", revision: 4, chatSessions: {} } as unknown as CanvasProject;
            apiClient.defaults.adapter = async (config) => ({
                config,
                status: mode === "not-modified" ? 304 : 200,
                statusText: "OK",
                headers: {},
                data: mode === "not-modified" ? null : { code: 0, data: mode === "snapshot" ? { projects: [raw], assets: [] } : { project: raw } },
            });
            await expect(mode === "snapshot" ? getRemoteUserDataSnapshot() : getRemoteCanvasProject(raw.id, mode === "get" ? undefined : raw)).rejects.toThrow("画布会话数据格式无效");
        });
    }

    test("keeps an existing sessions array and its contents unchanged", async () => {
        const sessions = [{ id: "chat", title: "会话", messages: [{ role: "user", content: "保留内容" }] }];
        const project = { id: "canvas-1", chatSessions: sessions } as unknown as CanvasProject;
        apiClient.defaults.adapter = async (config) => ({ config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { project } } });
        expect((await getRemoteCanvasProject(project.id)).project.chatSessions).toBe(sessions);
    });
});
