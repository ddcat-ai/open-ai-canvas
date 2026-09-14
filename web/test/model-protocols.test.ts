import { describe, expect, test } from "bun:test";

import { builtinProtocolCapability, modelProtocolCapability, modelProtocolSupportsTokenBilling } from "../src/lib/model-protocols";

describe("model protocol Token billing", () => {
    test("supports text models and Volcengine Ark video only", () => {
        expect(modelProtocolSupportsTokenBilling("text", "chat-completion")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-ark-video")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-jimeng-video")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("video", "newapi")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("image", "volcengine-ark-image")).toBe(false);
    });
});

describe("builtin protocol capability fallback", () => {
    test("recognizes media capability from builtin protocol IDs without a plugin catalog", () => {
        expect(builtinProtocolCapability("minimax-video")).toBe("video");
        expect(builtinProtocolCapability("volcengine-ark-video")).toBe("video");
        expect(builtinProtocolCapability("gemini-veo")).toBe("video");
        expect(builtinProtocolCapability("newapi")).toBe("video");
        expect(builtinProtocolCapability("xai-video")).toBe("video");
        expect(builtinProtocolCapability("openai-image")).toBe("image");
        expect(builtinProtocolCapability("gemini-image")).toBe("image");
        expect(builtinProtocolCapability("openai-audio")).toBe("audio");
        expect(builtinProtocolCapability("chat-completion")).toBe("text");
        expect(builtinProtocolCapability("openai-response")).toBe("text");
        expect(builtinProtocolCapability(undefined)).toBeUndefined();
    });

    test("modelProtocolCapability honors an explicit catalog before the builtin fallback", () => {
        const definition = { value: "minimax-video", label: "MiniMax", capability: "video" as const, create: "POST", contentType: "application/json", media: "" };
        expect(modelProtocolCapability("minimax-video", [definition])).toBe("video");
        // A custom catalog that re-scopes a protocol wins over the builtin guess.
        const reclassified = { value: "minimax-video", label: "Text alias", capability: "text" as const, create: "POST", contentType: "application/json", media: "" };
        expect(modelProtocolCapability("minimax-video", [reclassified])).toBe("text");
        // Without any catalog the builtin self-describing ID is used.
        expect(modelProtocolCapability("minimax-video")).toBe("video");
        expect(modelProtocolCapability("chat-completion")).toBe("text");
    });

    test("does not classify unknown protocol IDs as media", () => {
        expect(builtinProtocolCapability("my-custom-unknown")).toBeUndefined();
        expect(modelProtocolCapability("my-custom-unknown")).toBeUndefined();
    });
});
