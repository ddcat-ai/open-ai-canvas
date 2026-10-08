import { expect, test } from "bun:test";

import panelSource from "../src/components/canvas/canvas-cloud-agent-panel.tsx" with { type: "text" };
import partsSource from "../src/components/canvas/canvas-cloud-agent-panel-parts.tsx" with { type: "text" };

test("Live2D launcher remains mounted while the Agent panel is open", () => {
    expect(panelSource).toContain("<AgentLauncher");
    expect(panelSource).toContain("hidden={open}");
    expect(panelSource).not.toContain("{!open ? <AgentLauncher");
    expect(partsSource).toContain("hidden = false");
    expect(partsSource).toContain('display: "none"');
});
