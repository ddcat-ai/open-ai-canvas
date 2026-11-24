import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ThinkingLevelSlider } from "../src/components/thinking-level-slider";
import type { ThinkingLevel } from "../src/lib/text-thinking";

const levels: ThinkingLevel[] = ["off", "low", "high", "max"];
const noop = () => {};

test("slider uses supported discrete positions and marks max distinctly", () => {
    const html = renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="max" resolvedLevel="max" onChange={noop} />);
    expect(html).toContain('type="range"');
    expect(html).toContain('max="4"');
    expect(html).toContain('value="4"');
    expect(html).not.toContain("<button");
    expect(html).toContain('aria-valuetext="极限"');
    expect(html).toContain('data-tone="max"');
    expect(html).not.toContain("极简");
    expect(html).not.toContain("标准");
});

test("model default remains distinct from its effective level", () => {
    const html = renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="auto" resolvedLevel="high" onChange={noop} />);
    expect(html).toContain('aria-valuetext="默认"');
    expect(html).toContain('value="0"');
    expect(html).not.toContain("<button");
});

test("off, unavailable and disabled states remain explicit", () => {
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="off" onChange={noop} />)).toContain('data-tone="off"');
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={levels} value="max" disabled onChange={noop} />)).toContain("disabled");
    expect(renderToStaticMarkup(<ThinkingLevelSlider levels={[]} value="auto" onChange={noop} />)).not.toContain('type="range"');
});
