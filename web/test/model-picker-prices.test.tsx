import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelLabel, ModelPicker } from "../src/components/model-picker";
import { canvasThemes } from "../src/lib/canvas-theme";
import { requestCreditCost } from "../src/lib/model-pricing";
import type { ModelRequirements } from "../src/lib/model-selection";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

function fixture() {
    const channel = createModelChannel({
        id: "comfy",
        name: "Comfy",
        scope: "system",
        models: ["h3-multi"],
        modelCosts: [
            {
                model: "h3-multi",
                displayName: "MiniMax H3",
                channelLabel: "多图一致性",
                capability: "video",
                pricePolicy: "channel",
                billingMode: "per_second",
                unitPriceMicrocredits: 100_000,
                logicalPriceTiers: [480, 720].map((resolution, index) => ({
                    selector: { vquality: resolution + "p", videoSeconds: "6" },
                    resolution: resolution + "p",
                    videoSeconds: 6,
                    billingMode: "per_second",
                    unitPriceMicrocredits: (index + 1) * 100_000,
                    inputTokenPriceMicrocredits: 0,
                    outputTokenPriceMicrocredits: 0,
                    cachedTokenPriceMicrocredits: 0,
                })),
            },
        ],
    });
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], model: "comfy::h3-multi", videoModel: "comfy::h3-multi" } }).config;
}

const requirements: ModelRequirements = { capability: "video", videoSeconds: "5", options: { vquality: "1080p" } };

test("candidate rows show their configured prices instead of applying the previous model's specifications", () => {
    const config = fixture();
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const markup = renderToStaticMarkup(<ModelLabel config={config} model={config.model} capability="video" theme={theme} creationVariant showConfiguredModelName={false} requirements={requirements} showPrice showDescription />);
        expect(markup).toContain("0.1-0.2 积分/秒");
        expect(markup).not.toContain("当前规格无报价");
    }
});

test("candidate rows do not disguise missing prices as zero", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].logicalPriceTiers = [];
    const markup = renderToStaticMarkup(<ModelLabel config={config} model={config.model} capability="video" theme={canvasThemes.dark} creationVariant showConfiguredModelName={false} requirements={requirements} showPrice showDescription />);
    expect(markup).toContain("未配置");
    expect(markup).not.toContain("0 积分");
});

test("model rows preserve multiple promotional labels and colors without altering prices", () => {
    const config = fixture();
    config.channels[0].modelCosts![0].tags = [
        { text: "限时特价", color: "purple" },
        { text: "官方1折", color: "gold" },
    ];
    for (const theme of [canvasThemes.light, canvasThemes.dark]) {
        const markup = renderToStaticMarkup(<ModelLabel config={config} model={config.model} capability="video" theme={theme} creationVariant showConfiguredModelName={false} showPrice showDescription />);
        expect(markup).toContain('data-color="purple">限时特价');
        expect(markup).toContain('data-color="gold">官方1折');
        expect(markup).toContain("0.1-0.2 积分/秒");
    }
    config.channels[0].modelCosts![0].tags = [];
    const markup = renderToStaticMarkup(<ModelLabel config={config} model={config.model} capability="video" theme={canvasThemes.light} showDescription />);
    expect(markup).not.toContain('aria-label="模型标签"');
});

test("the selected model and request estimate still require an exact specification match", () => {
    const config = fixture();
    const render = (value: ModelRequirements) => renderToStaticMarkup(<ModelPicker config={config} value={config.model} capability="video" requirements={value} onChange={() => {}} />);
    expect(render(requirements)).toContain("当前规格无报价");
    const cost = (value: ModelRequirements) => requestCreditCost({ channelMode: "remote", modelCosts: config.channels[0].modelCosts, model: "h3-multi", capability: "video", config, requirements: value, seconds: "6" });
    expect(cost(requirements)).toBeNull();
    const matching = { ...requirements, videoSeconds: "6", options: { vquality: "720p" } };
    expect(render(matching)).toContain("0.2 积分/秒");
    expect(render(matching)).not.toContain("当前规格无报价");
    expect(cost(matching)).toBeCloseTo(1.2);
});
