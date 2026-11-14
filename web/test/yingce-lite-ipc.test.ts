import { describe, expect, test } from "bun:test";
import { acknowledgeYingceGeneration, readYingceGenerationJournal, requestYingceCatalog, requestYingceGeneration, resolveYingceSystemModel, serializeYingceImageForm, YingceLiteError, type YingceGenerationInput } from "../src/services/api/yingce-lite-ipc";
import { isGenerationTaskCancelled } from "../src/services/api/generation-task";
import { generationErrorMessage } from "../src/lib/generation-error";
import { defaultConfig, type ModelChannel } from "../src/stores/use-config-store";

const input: YingceGenerationInput = { channelId: "channel", providerPath: "/chat/completions", capability: "text", body: { model: "model" } };

describe("Lite generation IPC", () => {
    test("rejects journal reads and acknowledgements after the account changes", async () => {
        let scope = "alice";
        const owner = "a".repeat(64);
        await expect(
            readYingceGenerationJournal({
                getScope: () => scope,
                request: async () => {
                    scope = "bob";
                    return { ok: true, data: { owner, records: [] } };
                },
            }),
        ).rejects.toMatchObject({ reason: "auth_superseded" });
        let calls = 0;
        await expect(
            acknowledgeYingceGeneration(owner, "yingce-local:id", {
                expectedScope: "alice",
                getScope: () => scope,
                request: async () => {
                    calls++;
                    return { ok: true, data: null };
                },
            }),
        ).rejects.toMatchObject({ reason: "auth_superseded" });
        expect(calls).toBe(0);
    });
    test("serializes repeated form fields and image bytes in order", async () => {
        const form = new FormData();
        form.append("prompt", "one");
        form.append("prompt", "two");
        form.append("image", new File([new Uint8Array([1, 2, 3])], "test.png", { type: "image/png" }));
        expect(await serializeYingceImageForm(form)).toEqual([
            { name: "prompt", value: "one" },
            { name: "prompt", value: "two" },
            { name: "image", filename: "test.png", mimeType: "image/png", bytes: new Uint8Array([1, 2, 3]) },
        ]);
    });
    test("selects the exact channel and capability without falling back", () => {
        const channel = (id: string, capability: "text" | "image"): ModelChannel => ({
            id,
            name: id,
            baseUrl: `/api/${id}`,
            apiKey: "system",
            apiFormat: "openai",
            scope: "system",
            yingceChannelId: id,
            models: ["shared"],
            modelCosts: [{ model: "shared", capability, billingMode: "fixed_request", unitPriceMicrocredits: 0, available: true }],
        });
        const config = { ...defaultConfig, channels: [channel("first", "text"), channel("second", "image")], model: "second::shared" };
        expect(resolveYingceSystemModel(config, "image")).toMatchObject({ channelId: "second", modelKey: "shared" });
        expect(() => resolveYingceSystemModel(config, "text")).toThrow();
        expect(() => resolveYingceSystemModel({ ...config, model: "missing::shared" }, "image")).toThrow();
        expect(() => resolveYingceSystemModel({ ...config, model: "shared" }, "image")).toThrow();
        expect(() => resolveYingceSystemModel({ ...config, model: "second::missing" }, "image")).toThrow();
        expect(() => resolveYingceSystemModel({ ...config, channels: [{ ...channel("second", "image"), yingceChannelId: undefined }] }, "image")).toThrow();
    });

    test("validates the catalog and discards responses from an earlier account", async () => {
        let scope = "first";
        const catalog = { source: "system", channels: [{ id: "a", displayName: "A", models: [{ modelKey: "m", displayName: "M", capability: "text", available: true }] }] };
        expect(await requestYingceCatalog({ getScope: () => scope, request: async () => ({ ok: true, data: catalog }) })).toEqual(catalog);
        await expect(
            requestYingceCatalog({
                getScope: () => scope,
                request: async () => {
                    scope = "second";
                    return { ok: true, data: catalog };
                },
            }),
        ).rejects.toMatchObject({ reason: "auth_superseded" });
        await expect(requestYingceCatalog({ getScope: () => scope, request: async () => ({ ok: true, data: { source: "system", channels: [{ id: "a", models: [{}] }] } }) })).rejects.toThrow("目录响应无效");
    });

    test("sends one intent and preserves a 409 without retrying", async () => {
        let calls = 0;
        const request = async () => {
            calls++;
            return { ok: false as const, error: { message: "核对结果", status: 409, code: 40901, reason: "duplicate" } };
        };
        const error = await requestYingceGeneration(input, { request }).catch((value) => value);
        expect(error).toBeInstanceOf(YingceLiteError);
        expect(error).toMatchObject({ status: 409, code: 40901, reason: "duplicate" });
        expect(calls).toBe(1);
    });

    test("does not accept a late result after account switch", async () => {
        let scope = "first";
        const request = async () => {
            scope = "second";
            return { ok: true as const, data: { result: "old" } };
        };
        await expect(requestYingceGeneration(input, { request, getScope: () => scope })).rejects.toMatchObject({ reason: "auth_superseded" });
    });

    test("distinguishes cancellation before dispatch from stopping after dispatch", async () => {
        const controller = new AbortController();
        controller.abort();
        let calls = 0;
        const request = async () => {
            calls++;
            return { ok: true as const, data: {} };
        };
        await expect(requestYingceGeneration(input, { request, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
        expect(calls).toBe(0);
        const active = new AbortController();
        const lateRequest = async () => {
            active.abort();
            return { ok: true as const, data: {} };
        };
        await expect(requestYingceGeneration(input, { request: lateRequest, signal: active.signal })).rejects.toMatchObject({ reason: "outcome_unknown" });
    });

    test("reports an interrupted IPC as unknown outcome", async () => {
        await expect(
            requestYingceGeneration(input, {
                request: async () => {
                    throw new Error("disconnected");
                },
            }),
        ).rejects.toMatchObject({ reason: "outcome_unknown" });
    });

    test("keeps an unknown outcome visible even after cancellation and explains a conflict", () => {
        const controller = new AbortController();
        controller.abort();
        const unknown = new YingceLiteError("断开", { reason: "outcome_unknown" });
        expect(isGenerationTaskCancelled(unknown, controller.signal)).toBe(false);
        expect(generationErrorMessage(unknown)).toContain("状态未知");
        expect(generationErrorMessage(new YingceLiteError("冲突", { status: 409, reason: "conflict" }))).toContain("核对结果");
        expect(isGenerationTaskCancelled(new DOMException("cancelled", "AbortError"), controller.signal)).toBe(true);
    });

    test("preserves a gateway unknown outcome after the user stops waiting", async () => {
        const controller = new AbortController();
        const error = await requestYingceGeneration(input, {
            signal: controller.signal,
            request: async () => {
                return { ok: false as const, error: { message: "核对结果", status: 502, code: 50201, reason: "upstream_failure", outcomeUnknown: true } };
            },
        }).catch((value) => value);
        expect(error).toMatchObject({ status: 502, code: 50201, reason: "upstream_failure", outcomeUnknown: true });
        controller.abort();
        expect(isGenerationTaskCancelled(error, controller.signal)).toBe(false);
        expect(generationErrorMessage(error)).toContain("状态未知");
    });
});
