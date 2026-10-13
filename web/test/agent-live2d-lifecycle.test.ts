import { expect, test } from "bun:test";

import panelSource from "../src/components/canvas/canvas-cloud-agent-panel.tsx" with { type: "text" };
import partsSource from "../src/components/canvas/canvas-cloud-agent-panel-parts.tsx" with { type: "text" };
import avatarSource from "../src/components/canvas/live2d-avatar.tsx" with { type: "text" };

test("Live2D launcher remains mounted while the Agent panel is open", () => {
    expect(panelSource).toContain("<AgentLauncher");
    expect(panelSource).toContain("hidden={open}");
    expect(panelSource).not.toContain("{!open ? <AgentLauncher");
    expect(partsSource).toContain("hidden = false");
    expect(partsSource).toContain('display: "none"');
});

test("launcher waits for appearance configuration before displaying the default orb", () => {
    expect(partsSource).toContain("const appearanceResolved = useAppearanceStore((state) => state.resolved)");
    expect(partsSource).toContain(") : appearanceResolved ? (");
    expect(partsSource).toContain("正在加载助手形象");
});

test("Live2D fallback is reserved for load or render failures, not initial loading", () => {
    expect(avatarSource).toContain("{failed ? (");
    expect(avatarSource).toContain(") : !ready ? (");
    expect(avatarSource).not.toContain("{failed || !ready ? <span");
    expect(avatarSource).toContain("setFailed(true)");
    expect(avatarSource).toContain("callbacks.current.onError?.");
});
