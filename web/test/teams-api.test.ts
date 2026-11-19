import { afterEach, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { QueryClient } from "@tanstack/react-query";
import { apiClient, ApiError } from "../src/services/api/request";
import { createPersonalAssetPublication } from "../src/services/team-asset-publication";
import { transferTeamCredits } from "../src/services/api/teams";
import { workspacePath, workspaceApiPath } from "../src/lib/workspace-routes";
import { parseTeamCreditAmount, teamKeys } from "../src/lib/team-query-keys";
import { setActiveUserScope } from "../src/lib/user-scope";

const originalAdapter = apiClient.defaults.adapter;
afterEach(() => {
    apiClient.defaults.adapter = originalAdapter;
    setActiveUserScope(null);
});

describe("team publication and identity boundaries", () => {
    test.each(["", "space-a", "space-b"])("shared task transport and persistent keys in workspace '%s'", (space) => {
        const run = Bun.spawnSync([process.execPath, "test", "./test/fixtures/workspace-session.harness.ts"], { cwd: resolve(import.meta.dir, ".."), env: { ...process.env, TEST_WORKSPACE: space }, timeout: 20_000 });
        if (run.exitCode !== 0) throw new Error(run.stderr.toString() || run.stdout.toString());
    });

    test("publishes the full cross-page selection in bounded batches, reporting unsynced and unsupported sources", async () => {
        setActiveUserScope("alice");
        const selected = Array.from({ length: 43 }, (_, index) => `asset-${index}`);
        const batches: { assetIds: string[]; idempotencyKey: string }[] = [];
        apiClient.defaults.adapter = async (config) => {
            expect(config.headers.get("X-Canvas-Expected-User")).toBe("alice");
            const source = config.url?.startsWith("/assets/") ? config.url.slice(8) : undefined;
            if (source === "local-only") return { config, status: 404, statusText: "Not Found", headers: {}, data: { code: 404, msg: "not found" } };
            if (source) return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { asset: { id: source, kind: source === "entity" ? "entity" : "text", status: source === "archived" ? "archived" : "confirmed" } } } };
            expect(config.url).toBe("/teams/team-a/asset-publications");
            const input = JSON.parse(String(config.data));
            batches.push(input);
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { results: input.assetIds.map((sourceAssetId: string) => ({ sourceAssetId, asset: { id: `team-${sourceAssetId}`, teamId: "team-a" } })) } } };
        };
        const results = await createPersonalAssetPublication("team-a", [...selected, "local-only", "entity", "archived", selected[0]], "share-operation")();
        expect(batches.map((batch) => batch.assetIds.length)).toEqual([20, 20, 3]);
        expect(batches.flatMap((batch) => batch.assetIds)).toEqual(selected);
        expect(batches.map((batch) => batch.idempotencyKey)).toEqual(["share-operation:0", "share-operation:1", "share-operation:2"]);
        expect(results.filter((result) => result.asset)).toHaveLength(43);
        expect(results.filter((result) => result.error).map((result) => result.sourceAssetId)).toEqual(["local-only", "entity", "archived"]);
        expect(results.find((result) => result.sourceAssetId === "local-only")?.error?.reason).toBe("source_not_synced");
    });

    test("does not publish after the authenticated user changes during source verification", async () => {
        setActiveUserScope("alice");
        let publications = 0;
        apiClient.defaults.adapter = async (config) => {
            if (config.url?.includes("asset-publications")) publications++;
            setActiveUserScope("bob");
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { asset: { id: "a", kind: "text" } } } };
        };
        await expect(createPersonalAssetPublication("team-a", ["a"], "share")()).rejects.toMatchObject({ name: "AbortError" });
        expect(publications).toBe(0);
    });

    test("preserves an uncertain publication request identity when retried", async () => {
        const keys: string[] = [];
        const sourceBatches: string[][] = [];
        let sourceSynced = false;
        apiClient.defaults.adapter = async (config) => {
            if (config.url === "/assets/local-only" && !sourceSynced) return { config, status: 404, statusText: "Not Found", headers: {}, data: { code: 404, msg: "not found" } };
            if (config.url?.startsWith("/assets/")) return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { asset: { id: "a", kind: "text" } } } };
            const body = JSON.parse(String(config.data));
            keys.push(body.idempotencyKey);
            sourceBatches.push(body.assetIds);
            if (keys.length === 1) throw Object.assign(new Error("Network Error"), { isAxiosError: true, code: "ERR_NETWORK" });
            return { config, status: 200, statusText: "OK", headers: {}, data: { code: 0, data: { results: [{ sourceAssetId: "a", asset: { id: "published" } }] } } };
        };
        const publish = createPersonalAssetPublication("team", ["a", "local-only"], "same-operation");
        await expect(publish()).rejects.toThrow();
        sourceSynced = true;
        const results = await publish();
        expect(results[0].asset?.id).toBe("published");
        expect(results[1].error?.reason).toBe("source_not_synced");
        expect(keys).toEqual(["same-operation:0", "same-operation:0"]);
        expect(sourceBatches).toEqual([["a"], ["a"]]);
    });

    test("team writes carry explicit destinations and propagate rejected revisions and allocations", async () => {
        setActiveUserScope("member");
        const requests: { path?: string; body: Record<string, unknown> }[] = [];
        apiClient.defaults.adapter = async (config) => {
            expect(config.headers.get("X-Canvas-Expected-User")).toBe("member");
            requests.push({ path: config.url, body: JSON.parse(String(config.data)) });
            return { config, status: 409, statusText: "Conflict", headers: {}, data: { code: 409, reason: "conflict", msg: "revision or balance changed" } };
        };
        expect(workspacePath("/canvas/project", "team/a")).toBe("/teams/team%2Fa/canvas/project");
        expect(workspaceApiPath("/canvas-projects/project/operations", "team/a")).toBe("/teams/team%2Fa/workspace/canvas-projects/project/operations");
        await expect(transferTeamCredits("team/a", { action: "allocate", membershipId: "membership/c", amountMicrocredits: 1200000, idempotencyKey: "transfer" })).rejects.toBeInstanceOf(ApiError);
        expect(requests[0]).toEqual({ path: "/teams/team%2Fa/members/membership%2Fc/allocate", body: { amountMicrocredits: 1200000, idempotencyKey: "transfer" } });
    });

    test("removing one workspace cache keeps other teams and users intact", () => {
        const client = new QueryClient();
        const a = [...teamKeys.space("alice", "a"), "assets"];
        const b = [...teamKeys.space("alice", "b"), "assets"];
        const other = [...teamKeys.space("bob", "a"), "assets"];
        client.setQueryData(a, ["a-asset"]);
        client.setQueryData(b, ["b-asset"]);
        client.setQueryData(other, ["other-asset"]);
        client.removeQueries({ queryKey: teamKeys.space("alice", "a") });
        expect(client.getQueryData(a)).toBeUndefined();
        expect(client.getQueryData(b)).toEqual(["b-asset"]);
        expect(client.getQueryData(other)).toEqual(["other-asset"]);
        client.clear();
    });

    test("credit entry preserves microcredit precision and refuses invalid or overflowing amounts", () => {
        expect(parseTeamCreditAmount("0.000001")).toBe(1);
        expect(parseTeamCreditAmount("12.345678")).toBe(12345678);
        expect(parseTeamCreditAmount("9007199254.740991")).toBe(Number.MAX_SAFE_INTEGER);
        for (const invalid of ["0", "-1", "1e6", "NaN", "0.0000001", "9007199254.740992", "1.2.3"]) expect(parseTeamCreditAmount(invalid)).toBeUndefined();
    });
});
