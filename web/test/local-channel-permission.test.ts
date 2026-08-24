import { afterEach, describe, expect, test } from "bun:test";
import axios from "axios";

import { desktopLocalChannelUiVisible } from "../src/lib/desktop-local-channel";
import { fetchChannelModels } from "../src/services/api/image";
import { channelRequest } from "../src/services/api/custom-channel-relay";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { channelConnectionSignature, createModelChannel, defaultConfig, normalizeConfigSnapshot, resolveModelRequestConfig, type ModelChannel } from "../src/stores/use-config-store";
import { defaultFeatureAvailability, useUserStore } from "../src/stores/use-user-store";

const originalAxiosPost = axios.post;
const originalWindow = globalThis.window;

afterEach(() => {
    axios.post = originalAxiosPost;
    useUserStore.setState({ features: defaultFeatureAvailability });
    if (originalWindow === undefined) delete (globalThis as { window?: Window }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
});

function setLocalChannelRuntime(desktopLocalChannelsEnabled: boolean, hostname: string) {
    useUserStore.setState({ features: { ...defaultFeatureAvailability, desktopLocalChannelsEnabled } });
    Object.defineProperty(globalThis, "window", { configurable: true, value: { location: { hostname } } });
}

function forgedLocalGenerationConfig() {
    const channel = createModelChannel({
        id: "local",
        name: "Local",
        baseUrl: "http://127.0.0.1:8000",
        apiKey: "test-key",
        apiFormat: "openai",
        models: ["local-model"],
        allowLocalChannel: true,
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "local::local-model", textModel: "local::local-model" } }).config;
}

describe("允许本机渠道前端请求合同", () => {
    test("默认关闭，旧持久化记录回退 false，新记录 true 可回显并进入请求配置", () => {
        const legacy = createModelChannel({ id: "legacy", name: "Legacy", baseUrl: "https://example.com", apiKey: "key", models: ["model"] });
        expect(legacy.allowLocalChannel).toBe(false);

        const local = createModelChannel({ id: "local", name: "Local", baseUrl: "http://127.0.0.1:8000", apiKey: "key", models: ["model"], allowLocalChannel: true });
        const normalized = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [local], model: "local::model", textModel: "local::model" } }).config;
        expect(normalized.channels[0]?.allowLocalChannel).toBe(true);
        setLocalChannelRuntime(true, "127.0.0.1");
        expect(resolveModelRequestConfig(normalized, "local::model").allowLocalChannel).toBe(true);
        setLocalChannelRuntime(false, "127.0.0.1");
        expect(resolveModelRequestConfig(normalized, "local::model").allowLocalChannel).toBe(false);
    });

    test("UI 只在 Backend capability=true 且页面文本 host 精确 loopback 时显示", () => {
        expect(desktopLocalChannelUiVisible(true, "127.0.0.1")).toBe(true);
        expect(desktopLocalChannelUiVisible(true, "localhost")).toBe(true);
        for (const hostname of ["localhost.", "x.localhost", "127.0.0.2", "::1", "0.0.0.0", "192.168.1.5", "canvas.example.com"]) {
            expect(desktopLocalChannelUiVisible(true, hostname)).toBe(false);
        }
        expect(desktopLocalChannelUiVisible(false, "127.0.0.1")).toBe(false);
        expect(desktopLocalChannelUiVisible(false, "localhost")).toBe(false);
    });

    test("channelConnectionSignature 包含 allowLocalChannel，切换后旧模型拉取结果会失效", () => {
        const channel = createModelChannel({ id: "local", name: "Local", baseUrl: "http://127.0.0.1:8000", apiKey: "key", models: ["model"] });
        expect(channelConnectionSignature(channel)).not.toBe(channelConnectionSignature({ ...channel, allowLocalChannel: true }));
    });

    test("实际生成配置与 relay 在运行时重新投影 forged persisted local flag", () => {
        const config = forgedLocalGenerationConfig();

        setLocalChannelRuntime(false, "127.0.0.1");
        const capabilityClosed = backendProviderConfig(config);
        expect(capabilityClosed.allowLocalChannel).toBe(false);
        expect(channelRequest(capabilityClosed, "http://127.0.0.1:8000/v1/responses").headers["x-canvas-allow-local-channel"]).toBeUndefined();

        setLocalChannelRuntime(true, "canvas.example.com");
        const remotePage = backendProviderConfig(config);
        expect(remotePage.allowLocalChannel).toBe(false);
        expect(channelRequest(remotePage, "http://127.0.0.1:8000/v1/responses").headers["x-canvas-allow-local-channel"]).toBeUndefined();

        setLocalChannelRuntime(true, "localhost");
        const desktop = backendProviderConfig(config);
        expect(desktop.allowLocalChannel).toBe(true);
        const request = channelRequest(desktop, "http://127.0.0.1:8000/v1/responses", { "Content-Type": "application/json" });
        expect(request.headers["x-canvas-allow-local-channel"]).toBe("1");
        expect(request.headers["x-canvas-upstream-base-url"]).toBe("http://127.0.0.1:8000/");
    });

    test("登录态模型拉取同样消费运行时投影而不是 forged persisted flag", async () => {
        const bodies: Record<string, unknown>[] = [];
        axios.post = (async (_url: string, body: Record<string, unknown>) => {
            bodies.push(body);
            return { data: { code: 0, data: { models: [{ id: "local-model" }] }, msg: "ok" } };
        }) as typeof axios.post;
        const channel: ModelChannel = forgedLocalGenerationConfig().channels[0];

        setLocalChannelRuntime(false, "127.0.0.1");
        await fetchChannelModels(channel, true);
        expect(bodies.at(-1)?.allowLocalChannel).toBe(false);

        setLocalChannelRuntime(true, "canvas.example.com");
        await fetchChannelModels(channel, true);
        expect(bodies.at(-1)?.allowLocalChannel).toBe(false);

        setLocalChannelRuntime(true, "127.0.0.1");
        await fetchChannelModels(channel, true);
        expect(bodies.at(-1)?.allowLocalChannel).toBe(true);
    });

    test("custom relay 最终边界也会压掉直接伪造的 local flag", () => {
        const config = {
            baseUrl: "http://127.0.0.1:8000",
            apiKey: "test-key",
            apiFormat: "openai" as const,
            allowLocalChannel: true,
        };
        setLocalChannelRuntime(false, "127.0.0.1");
        expect(channelRequest(config, "http://127.0.0.1:8000/v1/responses").headers["x-canvas-allow-local-channel"]).toBeUndefined();

        setLocalChannelRuntime(true, "localhost");
        expect(channelRequest(config, "http://127.0.0.1:8000/v1/responses").headers["x-canvas-allow-local-channel"]).toBe("1");
    });

    test("非法自定义渠道 Base URL 返回可读错误，而不是原生 URL 异常", () => {
        expect(() => channelRequest({ baseUrl: "api.example.com/v1", apiKey: "key", apiFormat: "openai" }, "api.example.com/v1/images/generations")).toThrow("domain:param-is-invalid-enter-a-full-url-e-g-https-api-example-com-v1");
    });

    test("非法上游请求地址返回可读错误", () => {
        expect(() => channelRequest({ baseUrl: "https://api.example.com/v1", apiKey: "key", apiFormat: "openai" }, "api.example.com/v1/images/generations")).toThrow("domain:param-is-invalid-enter-a-full-url-e-g-https-api-example-com-v1");
    });
});
