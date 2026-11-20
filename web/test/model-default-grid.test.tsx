import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelDefaultGrid } from "../src/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, modelOptionsFromChannels, type AiConfig, type ModelCapability, type ModelChannel } from "../src/stores/use-config-store";

type ModelCost = NonNullable<ModelChannel["modelCosts"]>[number];

function cost(model: string, capability: ModelCapability, displayName?: string, channelLabel?: string): ModelCost {
    return { model, capability, displayName, channelLabel, billingMode: "fixed_request", unitPriceMicrocredits: 100_000 };
}

function fixture(channels: ModelChannel[], defaults: Partial<AiConfig> = {}): AiConfig {
    return { ...defaultConfig, channels, models: modelOptionsFromChannels(channels), ...defaults };
}

function cards(config: AiConfig) {
    return renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />).match(/<button\b[^>]*role="radio"[^>]*>[\s\S]*?<\/button>/g) || [];
}

test("default cards show picker second-level model names alongside their product groups", () => {
    const modelCosts = [cost("text-sku", "text", "GPT", "GPT-4o"), cost("image-sku", "image", "大香蕉", "大香蕉 Pro"), cost("video-sku", "video", "Seedance", "Seedance 2.0 Fast"), cost("audio-sku", "audio", "语音", "语音 HD")];
    const config = fixture([createModelChannel({ id: "platform", scope: "system", models: modelCosts.map((item) => item.model), modelCosts })], { textModel: "platform::text-sku" });
    const options = cards(config);
    expect(options).toHaveLength(4);
    for (const item of modelCosts) {
        const card = options.find((option) => option.includes(`title="${item.channelLabel}"`))!;
        expect(card).toContain(`>${item.channelLabel}</span>`);
        expect(card).toContain(`>${item.displayName}</span>`);
        expect(card).not.toContain(`>${item.model}</span>`);
    }
    expect(options.find((option) => option.includes('title="GPT-4o"'))).toContain('aria-checked="true"');
    expect(options.filter((option) => option.includes('aria-checked="true"'))).toHaveLength(1);
});

test("system variants in the same product retain distinct second-level labels and selection", () => {
    const modelCosts = [cost("h3-fast", "video", "MiniMax H3", "高速版"), cost("h3-multi", "video", "MiniMax H3", "多图一致性")];
    const config = fixture([createModelChannel({ id: "platform", scope: "system", models: modelCosts.map((item) => item.model), modelCosts })], { videoModel: "platform::h3-multi" });
    const options = cards(config);
    expect(options).toHaveLength(2);
    expect(options[0]).toContain('title="高速版"');
    expect(options[0]).toContain('aria-checked="false"');
    expect(options[1]).toContain('title="多图一致性"');
    expect(options[1]).toContain('aria-checked="true"');
    expect(options.every((option) => option.includes('title="MiniMax H3"'))).toBe(true);
});

test("personal channels preserve configured model names and distinguish matching names by channel", () => {
    const channels = ["个人渠道 A", "个人渠道 B"].map((name, index) => createModelChannel({ id: `personal-${index}`, name, scope: "user", models: ["text-sku"], modelCosts: [cost("text-sku", "text", "GPT-4o", "渠道备注")] }));
    const options = cards(fixture(channels, { textModel: "personal-1::text-sku" }));
    expect(options).toHaveLength(2);
    for (const [index, option] of options.entries()) {
        expect(option).toContain('title="GPT-4o"');
        expect(option).toContain(channels[index].name);
        expect(option).not.toContain("渠道备注");
    }
    expect(options[1]).toContain('aria-checked="true"');
});

test("managed logical models use their configured model label rather than a route label", () => {
    const modelCosts = [{ ...cost("logical-text", "text", "GPT-4.1", "自动路由"), logicalModelId: "logical-1" }];
    const options = cards(fixture([createModelChannel({ id: "managed", scope: "system", models: ["logical-text"], modelCosts })]));
    expect(options[0]).toContain('title="GPT-4.1"');
    expect(options[0]).not.toContain("自动路由");
    expect(options[0]).not.toContain("logical-text");
});

test("missing labels fall back to recognizable model names without channel encoding", () => {
    const platform = createModelChannel({ id: "platform", scope: "system", models: ["unknown-text"], modelCosts: [cost("unknown-text", "text", " ", " ")] });
    const personal = createModelChannel({ id: "personal", name: "个人渠道", scope: "user", models: ["custom-text"] });
    const options = cards(fixture([platform, personal]));
    expect(options[0]).toContain('title="unknown-text"');
    expect(options[0]).toContain("未分类");
    expect(options[0]).not.toContain("platform::unknown-text");
    expect(options[1]).toContain('title="custom-text"');
    expect(options[1]).toContain("个人渠道");
    expect(options[1]).not.toContain("personal::custom-text");
});
