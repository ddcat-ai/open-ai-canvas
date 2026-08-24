import { describe, expect, test } from "bun:test";

import { modelProtocolSupportsTokenBilling } from "../src/lib/model-protocols";

describe("model protocol Token billing", () => {
    test("supports text models and Volcengine Ark video only", () => {
        expect(modelProtocolSupportsTokenBilling("text", "chat-completion")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-ark-video")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-jimeng-video")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("video", "newapi")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("image", "volcengine-ark-image")).toBe(false);
    });
});
