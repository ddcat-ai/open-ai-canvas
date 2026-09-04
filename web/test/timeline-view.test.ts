import { describe, expect, it } from "bun:test";

import {
  getTimelinePxPerMs,
  getTimelineVisualEndMs,
  getTimelineTrackWidth,
} from "../src/lib/timeline/timeline-view";

describe("timeline-view pxPerMs 独立性", () => {
  it("pxPerMs 仅由缩放级别决定，不随时长漂移", () => {
    expect(getTimelinePxPerMs(1)).toBeCloseTo(0.096, 6);
    expect(getTimelinePxPerMs(2)).toBeCloseTo(0.192, 6);
    expect(getTimelinePxPerMs(1)).toBe(getTimelinePxPerMs(1));
  });

  it("拖动末片段（visualEndMs 增长）时 pxPerMs 保持恒定，轨道随内容等比扩展", () => {
    const pxBefore = getTimelinePxPerMs(1);
    const endBefore = getTimelineVisualEndMs([
      { startMs: 0, durationMs: 1000 },
      { startMs: 2000, durationMs: 500 },
    ]);
    // 模拟末片段向右拖 1 秒：startMs 2000 -> 3000
    const endAfter = getTimelineVisualEndMs([
      { startMs: 0, durationMs: 1000 },
      { startMs: 3000, durationMs: 500 },
    ]);
    const pxAfter = getTimelinePxPerMs(1);

    expect(endAfter).toBeGreaterThan(endBefore);
    expect(pxAfter).toBe(pxBefore);
    // 手势映射 deltaMs = deltaPx / pxPerMs，pxPerMs 恒定意味着同一位移映射到同一毫秒数
    const deltaPx = 96;
    expect(deltaPx / pxBefore).toBeCloseTo(deltaPx / pxAfter, 6);
  });

  it("面板公式：轨道宽度随时长等比扩展（pxPerMs 恒定）", () => {
    // 面板内部公式：trackWidth = max(viewport, ceil(visualEndMs * pxPerMs))
    const pxPerMs = getTimelinePxPerMs(1);
    const trackW = (endMs: number) => Math.max(0, Math.ceil(endMs * pxPerMs));
    // 时长 1500 -> 3500，宽度按同比例放大（等比），而非阶梯跳变
    expect(trackW(3500) / trackW(1500)).toBeGreaterThan(2);
  });
});
