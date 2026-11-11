import { expect, test } from "bun:test";
import { apiKeyStatus } from "../src/services/api/api-keys";
import { apiDocumentationBaseURL, modelCallExample } from "../src/pages/api-docs/api-examples";

test("Model examples use catalog defaults without inventing unsupported options", () => {
    const example = modelCallExample("https://canvas.example/api", "c::v", "video", "示例站点", {
        id: "c::v",
        name: "video",
        capability: "video",
        parameters: {
            duration: { type: "integer", default: 8, enum: [8, 12] },
            generateAudio: { type: "boolean", required: true, default: false },
            resolution: { type: "string", default: "1080p" },
            watermark: { type: "boolean" },
        },
    });
    expect(example).toContain('"duration": 8');
    expect(example).toContain('"generateAudio": false');
    expect(example).toContain('"resolution": "1080p"');
    expect(example).not.toContain('"watermark"');
    expect(example).not.toContain('"aspectRatio"');
});

test("Documentation withholds calls missing required parameters", () => {
    const model = {
        id: "c::image",
        name: "image",
        capability: "image" as const,
        parameters: { aspectRatio: { type: "string", required: true, enum: ["16:9", "1:1"] } },
    };
    expect(modelCallExample("https://canvas.example/api", model.id, model.capability, "示例站点", model)).toBeNull();
});

test("Key state respects revocation and the expiry boundary", () => {
    const expiresAt = "2027-01-01T00:00:00Z";
    const boundary = Date.parse(expiresAt);
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, boundary)).toBe("active");
    expect(apiKeyStatus({ revokedAt: null, expiresAt }, boundary - 1)).toBe("active");
    expect(apiKeyStatus({ revokedAt: null, expiresAt }, boundary)).toBe("expired");
    expect(apiKeyStatus({ revokedAt: expiresAt, expiresAt: null }, boundary)).toBe("revoked");
});

test("Documentation resolves relative and absolute deployed API roots", () => {
    expect(apiDocumentationBaseURL("/api", "https://canvas.example")).toBe("https://canvas.example/api");
    expect(apiDocumentationBaseURL("https://backend.example/base/", "https://canvas.example")).toBe("https://backend.example/base");
});

test.skipIf(process.platform === "win32")("Copied curl executes with intact flags and JSON without running shell content from the model", () => {
    const brandName = "示例 ' $(printf injected)";
    const example = modelCallExample("https://canvas.example/api", "channel::O'Hara", "text", brandName);
    const result = Bun.spawnSync(["/bin/sh", "-c", `curl() { printf '%s\\0' "$@"; }; export CANVAS_API_KEY=example; ${example}`]);
    const args = new TextDecoder().decode(result.stdout).split("\0").filter(Boolean);
    expect(result.exitCode).toBe(0);
    expect(args).toHaveLength(8);
    expect(args[1]).toBe("https://canvas.example/api/model-calls");
    expect(args[3]).toBe("Authorization: Bearer example");
    const request = JSON.parse(args[7]);
    expect(request).toMatchObject({ model: "channel::O'Hara", parameters: { thinking: false } });
    expect(request.messages.at(-1).content).toBe(`用一句话介绍${brandName}。`);
});
