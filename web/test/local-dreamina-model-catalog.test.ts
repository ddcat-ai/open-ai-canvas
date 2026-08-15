import { expect, test } from "bun:test";

import { getDreaminaModelCatalog } from "../src/services/local-dreamina-model-catalog";
import { LocalRuntimeClientError } from "../src/services/local-runtime-session";

test("Dreamina model discovery reads only the signed Runtime catalog", async () => {
    const requests: string[] = [];
    const catalog = await getDreaminaModelCatalog({
        async request(path) {
            requests.push(path);
            return new Response(
                JSON.stringify({
                    ok: true,
                    provider: "dreamina-cli",
                    accountBinding: "a".repeat(64),
                    sessionEpoch: 3,
                    models: [
                        {
                            provider: "dreamina-cli",
                            id: "seedance2.0mini",
                            displayName: "seedance2.0mini",
                            modality: "video",
                            operations: ["text-to-video", "image-to-video", "reference-to-video"],
                            adapterSupported: true,
                            accountEntitlement: "unknown",
                            currentlyObservedAvailable: "unknown",
                            settings: { aliases: [], aspects: ["16:9"], maxReferenceImages: 9, minDuration: 4, maxDuration: 15, tiers: ["720p"] },
                            source: "runtime-execution-contract",
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            );
        },
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({
        adapterSupported: true,
        accountEntitlement: "unknown",
        currentlyObservedAvailable: "unknown",
    });
    expect(catalog[0]?.settings.minDuration).toBe(4);
    expect(requests).toEqual(["/dreamina/models"]);
});

test("Dreamina model discovery returns its authenticated cache scope with one signed GET", async () => {
    const { getDreaminaModelCatalogSnapshot } = await import("../src/services/local-dreamina-model-catalog");
    let requests = 0;
    const snapshot = await getDreaminaModelCatalogSnapshot({
        async request() {
            requests += 1;
            return catalogResponse();
        },
    });

    expect(requests).toBe(1);
    expect(snapshot).toMatchObject({ accountBinding: "a".repeat(64), sessionEpoch: 3 });
    expect(snapshot.models).toHaveLength(1);
});

test("Dreamina model discovery treats a signed scope denial as an error, never a successful empty catalog", async () => {
    await expect(
        getDreaminaModelCatalog({
            async request() {
                return new Response(
                    JSON.stringify({
                        ok: false,
                        code: "scope_denied",
                        message: "public failure",
                    }),
                    { status: 403, headers: { "content-type": "application/json" } },
                );
            },
        }),
    ).rejects.toThrow("Dreamina model catalog is unavailable");
});

test("Dreamina catalog recovery replaces an obsolete 401/403 session and retries only the safe GET once", async () => {
    const module = await import("../src/services/local-dreamina-model-catalog").catch(() => ({}));
    const recover = (
        module as {
            getDreaminaModelCatalogWithSessionRecovery?: (client: { request(path: string, init?: RequestInit): Promise<Response>; connect(signal?: AbortSignal): Promise<{ state: string }>; revokeLocalSession(): void }) => Promise<unknown[]>;
        }
    ).getDreaminaModelCatalogWithSessionRecovery;
    expect(typeof recover).toBe("function");
    if (!recover) return;

    for (const rejectedStatus of [401, 403]) {
        const requests: Array<{ path: string; method: string }> = [];
        let revoked = 0;
        let connected = 0;
        const models = await recover({
            async request(path, init) {
                requests.push({ path, method: String(init?.method) });
                if (requests.length === 1) {
                    return new Response(JSON.stringify({ ok: false }), { status: rejectedStatus });
                }
                return catalogResponse();
            },
            async connect() {
                connected += 1;
                return { state: "connected" };
            },
            revokeLocalSession() {
                revoked += 1;
            },
        });

        expect(models).toHaveLength(1);
        expect(requests).toEqual([
            { path: "/dreamina/models", method: "GET" },
            { path: "/dreamina/models", method: "GET" },
        ]);
        expect({ revoked, connected }).toEqual({ revoked: 1, connected: 1 });
    }
});

test("Dreamina catalog snapshot recovery preserves the authenticated cache scope after one safe reconnect", async () => {
    const module = await import("../src/services/local-dreamina-model-catalog").catch(() => ({}));
    const recover = (
        module as {
            getDreaminaModelCatalogSnapshotWithSessionRecovery?: (client: {
                request(path: string, init?: RequestInit): Promise<Response>;
                connect(signal?: AbortSignal): Promise<{ state: string }>;
                revokeLocalSession(): void;
            }) => Promise<{ accountBinding: string; sessionEpoch: number; models: unknown[] }>;
        }
    ).getDreaminaModelCatalogSnapshotWithSessionRecovery;
    expect(typeof recover).toBe("function");
    if (!recover) return;

    let requests = 0;
    let revoked = 0;
    let connected = 0;
    const snapshot = await recover({
        async request() {
            requests += 1;
            if (requests === 1) return new Response(JSON.stringify({ ok: false }), { status: 401 });
            return catalogResponse();
        },
        async connect() {
            connected += 1;
            return { state: "connected" };
        },
        revokeLocalSession() {
            revoked += 1;
        },
    });

    expect(snapshot).toMatchObject({ accountBinding: "a".repeat(64), sessionEpoch: 3 });
    expect(snapshot.models).toHaveLength(1);
    expect({ requests, revoked, connected }).toEqual({ requests: 2, revoked: 1, connected: 1 });
});

test("Dreamina catalog recovery reconnects once when the browser rejects an expired session before fetch", async () => {
    const { getDreaminaModelCatalogWithSessionRecovery } = await import("../src/services/local-dreamina-model-catalog");
    let requests = 0;
    let revoked = 0;
    let connected = 0;

    const models = await getDreaminaModelCatalogWithSessionRecovery({
        async request() {
            requests += 1;
            if (requests === 1) throw new LocalRuntimeClientError("session_required", "public failure", 401);
            return catalogResponse();
        },
        async connect() {
            connected += 1;
            return { state: "connected" as const };
        },
        revokeLocalSession() {
            revoked += 1;
        },
    });

    expect(models).toHaveLength(1);
    expect({ requests, revoked, connected }).toEqual({ requests: 2, revoked: 1, connected: 1 });
});

test("effective config projects an asynchronously arriving Dreamina catalog without persisting the local channel", async () => {
    const module = await import("../src/stores/use-config-store").catch(() => ({}));
    const project = (
        module as {
            effectiveConfigWithDreamina?: (
                config: typeof import("../src/stores/use-config-store").defaultConfig,
                state: "idle" | "loading" | "ready" | "error",
                models: Array<Record<string, unknown>>,
            ) => typeof import("../src/stores/use-config-store").defaultConfig;
        }
    ).effectiveConfigWithDreamina;
    expect(typeof project).toBe("function");
    if (!project) return;

    const { defaultConfig } = await import("../src/stores/use-config-store");
    const pending = project(defaultConfig, "loading", []);
    const ready = project(defaultConfig, "ready", [
        {
            provider: "dreamina-cli",
            id: "seedance2.0mini",
            displayName: "seedance2.0mini",
            modality: "video",
            operations: ["text-to-video", "image-to-video", "reference-to-video"],
            adapterSupported: true,
            accountEntitlement: "unknown",
            currentlyObservedAvailable: "unknown",
            settings: { aliases: [], aspects: ["16:9"], maxReferenceImages: 9, minDuration: 4, maxDuration: 15, tiers: ["720p"] },
            source: "runtime-execution-contract",
        },
    ]);

    expect(pending.videoModels).not.toContain("local:dreamina-cli:seedance2.0mini");
    expect(ready.videoModels).toContain("local:dreamina-cli:seedance2.0mini");
    expect(defaultConfig.channels.some((channel) => channel.id === "local:dreamina-cli")).toBe(false);
});

test("effective config removes custom channels when administrators disable them", async () => {
    const { createModelChannel, effectiveConfigForCustomChannels, normalizeConfigSnapshot } = await import("../src/stores/use-config-store");
    const config = normalizeConfigSnapshot({
        config: {
            channels: [
                createModelChannel({ id: "system-1", scope: "system", name: "系统渠道", baseUrl: "/api/ai/system/system-1", apiKey: "system", models: ["system-model"], modelCosts: [{ model: "system-model", capability: "text", billingMode: "fixed_request", unitPriceMicrocredits: 0 }] }),
                createModelChannel({ id: "custom-1", scope: "user", name: "自定义渠道", baseUrl: "https://example.com", apiKey: "private-key", models: ["custom-model"] }),
            ],
        },
    }).config;

    const effective = effectiveConfigForCustomChannels(config, false);
    expect(effective.channels.map((channel) => channel.id)).toEqual(["system-1"]);
    expect(effective.models).toContain("system-1::system-model");
    expect(effective.models).not.toContain("custom-1::custom-model");
    expect(config.channels.map((channel) => channel.id)).toEqual(["system-1", "custom-1"]);
});

function catalogResponse() {
    return new Response(
        JSON.stringify({
            ok: true,
            provider: "dreamina-cli",
            accountBinding: "a".repeat(64),
            sessionEpoch: 3,
            models: [
                {
                    provider: "dreamina-cli",
                    id: "seedance2.0mini",
                    displayName: "seedance2.0mini",
                    modality: "video",
                    operations: ["text-to-video", "image-to-video", "reference-to-video"],
                    adapterSupported: true,
                    accountEntitlement: "unknown",
                    currentlyObservedAvailable: "unknown",
                    settings: { aliases: [], aspects: ["16:9"], maxReferenceImages: 9, minDuration: 4, maxDuration: 15, tiers: ["720p"] },
                    source: "runtime-execution-contract",
                },
            ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
    );
}
