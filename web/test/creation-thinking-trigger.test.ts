import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

test("home thinking is directly draggable without opening a menu", () => {
    const source = readFileSync(new URL("../src/pages/create/creation-workspace.tsx", import.meta.url), "utf8");
    const control = source.slice(source.indexOf("function ThinkingControl("), source.indexOf("function DurationMenu("));
    expect(control).toContain("<ThinkingLevelSlider");
    expect(control).toContain("onChange={onChange}");
    expect(control).not.toContain("<Popover");
    expect(control).not.toContain("<button");
});

test("Agent chat composer exposes the same thinking control as settings", () => {
    const parts = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel-parts.tsx", import.meta.url), "utf8");
    const composer = parts.slice(parts.indexOf("export function ComposerControls("), parts.indexOf("export function ApprovalCard("));
    expect(composer).toContain("<ThinkingLevelSlider");
    expect(composer).toContain("onChange={onReasoningModeChange}");
    expect(composer).toContain('className="agent-thinking-popover"');
    expect(composer).toContain('className="agent-thinking-trigger"');
    expect(composer).toContain("aria-expanded={thinkingOpen}");
    expect(composer).not.toContain('className="agent-composer-thinking"');
    const panel = readFileSync(new URL("../src/components/canvas/canvas-cloud-agent-panel.tsx", import.meta.url), "utf8");
    const wiring = panel.slice(panel.indexOf("<ComposerControls"));
    expect(wiring).toContain("reasoningMode={reasoningMode}");
    expect(wiring).toContain("onReasoningModeChange={setReasoningMode}");
});
