import { describe, expect, it } from "bun:test";
import { agentApprovalMatchesSettings, agentApprovalModel, agentApprovalModelSelection, agentImageApproval } from "../src/lib/canvas/agent-media-approval";
import { createModelChannel, defaultConfig, encodeChannelModel } from "../src/stores/use-config-store";

describe("image generation approval settings", () => {
    const args = { mode: "image", prompt: "保持参考图产品外观", size: "1024x1024", quality: "high", channelId: "platform", channelModelKey: "gpt-image-2", referenceNodeIds: ["product"] };
    it("reads both SSE approval requests and restored run snapshots", () => {
        const event = agentImageApproval({ toolName: "generate_media", arguments: args });
        const restored = agentImageApproval({ call: { function: { name: "generate_media", arguments: JSON.stringify(args) } } });
        expect(event).toEqual(restored);
        expect(restored?.referenceNodeIds).toEqual(["product"]);
        expect(restored?.quality).toBe("high");
    });
    it("does not enable image settings for other tools or invalid arguments", () => {
        expect(agentImageApproval({ toolName: "canvas_apply_ops", arguments: args })).toBeNull();
        expect(agentImageApproval({ toolName: "generate_media", arguments: { ...args, mode: "video" } })).toBeNull();
        expect(agentImageApproval({ toolName: "generate_media", arguments: "{" })).toBeNull();
    });
    it("does not treat another tab's different approval settings as a successful retry", () => {
        expect(agentApprovalMatchesSettings(args, args)).toBe(true);
        expect(agentApprovalMatchesSettings(args, { ...args, quality: "low" })).toBe(false);
        expect(agentApprovalMatchesSettings(args, { logicalModelId: "other", size: args.size, quality: args.quality })).toBe(false);
    });
    it("switches between logical and channel models without retaining the previous selector", () => {
        const cost = { model: "gpt-image-2", capability: "image" as const, billingMode: "fixed_request" as const, unitPriceMicrocredits: 1, priceConfigured: true };
        const config = { ...defaultConfig, channels: [
            createModelChannel({ id: "platform", scope: "system", models: [cost.model], modelCosts: [cost] }),
            createModelChannel({ id: "managed", scope: "system", models: [cost.model], modelCosts: [{ ...cost, logicalModelId: "logical-image" }] }),
            createModelChannel({ id: "personal", scope: "custom", models: [cost.model], modelCosts: [cost] }),
        ] };
        const logical = agentApprovalModelSelection(config, encodeChannelModel("managed", cost.model));
        expect(logical).toEqual({ logicalModelId: "logical-image" });
        expect(agentApprovalModel(config, { ...logical, size: args.size, quality: args.quality })).toBe(encodeChannelModel("managed", cost.model));
        const channel = agentApprovalModelSelection(config, encodeChannelModel("platform", cost.model));
        expect(channel).toEqual({ channelId: "platform", channelModelKey: cost.model });
        expect(agentApprovalModel(config, { ...channel, size: args.size, quality: args.quality })).toBe(encodeChannelModel("platform", cost.model));
        expect(() => agentApprovalModelSelection(config, encodeChannelModel("personal", cost.model))).toThrow("平台模型");
        expect(agentApprovalModel(config, { logicalModelId: "removed", size: args.size, quality: args.quality })).toBe("");
    });
});
