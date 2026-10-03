import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelDefaultGrid } from "../src/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot } from "../src/stores/use-config-store";

function renderGrid(scope: "system" | "user" = "system", channelLabel = "多图一致性") {
    const channel = createModelChannel({
        id: "provider",
        name: "供应渠道",
        scope,
        models: ["h3-multi"],
        modelCosts: [{
            model: "h3-multi",
            displayName: "MiniMax H3",
            channelLabel,
            capability: "video",
            billingMode: "per_second",
            unitPriceMicrocredits: 200_000,
        }],
    });
    const config = normalizeConfigSnapshot({ config: {
        ...defaultConfig, channels: [channel], videoModel: "provider::h3-multi",
    } }).config;
    return renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);
}

test("system cards show the second-level channel label above the first-level model name", () => {
    const markup = renderGrid();
    expect(markup).toContain('font-semibold">多图一致性</span>');
    expect(markup).toContain('max-w-full truncate">MiniMax H3</span>');
    expect(markup).toContain('aria-checked="true"');
    expect(markup).toContain('model-default-price">0.2 /秒</span>');
    expect(markup).toContain('model-default-option-scope">系统</span>');
});

test("missing second-level labels fall back to the channel name", () => {
    const markup = renderGrid("system", "   ");
    expect(markup).toContain('font-semibold">供应渠道</span>');
    expect(markup).toContain('max-w-full truncate">MiniMax H3</span>');
});

test("custom cards retain model titles and channel subtitles", () => {
    const markup = renderGrid("user");
    expect(markup).toContain('font-semibold">MiniMax H3</span>');
    expect(markup).toContain('max-w-full truncate">供应渠道</span>');
    expect(markup).toContain('model-default-option-scope">自定义</span>');
});
