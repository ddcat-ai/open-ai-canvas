import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Live2DAvatar } from "../src/components/canvas/live2d-avatar";

function renderLoadingAvatar(reducedMotion = false) {
    return renderToStaticMarkup(<Live2DAvatar url="/api/public/appearance/live2d/model-id/model.model3.json" width={165} height={220} reducedMotion={reducedMotion} fallback={<span data-default-avatar>默认球</span>} />);
}

test("Live2D first render shows loading rather than the failure fallback", () => {
    const markup = renderLoadingAvatar();
    expect(markup).not.toContain("data-default-avatar");
    expect(markup).not.toContain("默认球");
    expect(markup).toContain('role="status"');
    expect(markup).toContain("正在加载 Live2D 模型");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("visibility:hidden");
    expect(markup).toContain("width:165px;height:220px");
});

test("Live2D loading respects reduced motion without showing the default avatar", () => {
    expect(renderLoadingAvatar()).toContain("motion-safe:animate-spin");
    const markup = renderLoadingAvatar(true);
    expect(markup).not.toContain("animate-spin");
    expect(markup).not.toContain("data-default-avatar");
    expect(markup).toContain("正在加载 Live2D 模型");
});
