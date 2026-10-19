import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import panelSource from "../src/components/canvas/canvas-cloud-agent-panel.tsx" with { type: "text" };
const launcherSource = readFileSync(new URL("../src/components/canvas/pet-launcher.tsx", import.meta.url), "utf8");

// 同一路径一旦被 text 加载器注册，bun 1.3.9 的模块缓存会让其它测试的具名导入失效，这里直接读源码文本。
const avatarSource = readFileSync(new URL("../src/components/canvas/live2d-avatar.tsx", import.meta.url), "utf8");

test("Live2D launcher remains mounted while the Agent panel is open", () => {
    expect(panelSource).toContain("<AgentLauncher");
    expect(panelSource).toContain("hidden={open}");
    expect(panelSource).not.toContain("{!open ? <AgentLauncher");
    expect(launcherSource).toContain("hidden = false");
    expect(launcherSource).toContain('display: "none"');
});

test("launcher waits for appearance configuration before displaying the default orb", () => {
    const appearanceSource = readFileSync(new URL("../src/hooks/use-pet-appearance.ts", import.meta.url), "utf8");
    expect(appearanceSource).toContain("resolved = useAppearanceStore((s) => s.resolved)");
    expect(appearanceSource).toContain("resolved: resolved && store.scope === scope && store.resolved");
    expect(launcherSource).toContain("resolved } = usePetAppearance()");
    expect(launcherSource).toContain("{resolved ? (");
    expect(launcherSource).toContain("正在加载助手形象");
});

test("Live2D fallback is reserved for load or render failures, not initial loading", () => {
    expect(avatarSource).toContain("{failed ? (");
    expect(avatarSource).toContain(") : !ready ? (");
    expect(avatarSource).not.toContain("{failed || !ready ? <span");
    expect(avatarSource).toContain("setFailed(true)");
    expect(avatarSource).toContain("callbacks.current.onError?.");
});
