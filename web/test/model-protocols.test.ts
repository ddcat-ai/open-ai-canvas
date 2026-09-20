import { describe, expect, test } from "bun:test";

import { modelProtocolSupportsTokenBilling } from "../src/lib/model-protocols";

describe("model protocol Token billing", () => {
    test("supports text and every video protocol", () => {
        expect(modelProtocolSupportsTokenBilling("text", "chat-completion")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-ark-video")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-ark-agent-plan-video")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "volcengine-jimeng-video")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "newapi-channel-2")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "newapi")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video", "custom-video-protocol")).toBe(true);
        expect(modelProtocolSupportsTokenBilling("video")).toBe(true);
    });

    test("does not enable Token billing for image, audio or unselected capabilities", () => {
        expect(modelProtocolSupportsTokenBilling("image", "volcengine-ark-image")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("image", "volcengine-ark-agent-plan-image")).toBe(false);
        expect(modelProtocolSupportsTokenBilling("audio", "speech")).toBe(false);
        expect(modelProtocolSupportsTokenBilling(undefined, "volcengine-ark-video")).toBe(false);
    });
});
