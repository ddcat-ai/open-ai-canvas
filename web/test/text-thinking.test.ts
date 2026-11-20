import { describe, expect, test } from "bun:test";
import { LEGACY_TEXT_THINKING_CONFIG, resolveThinkingLevel, thinkingLevelsFor, thinkingPresetConfig, withThinkingLevels, type TextThinkingConfig } from "../src/lib/text-thinking";

const levels: TextThinkingConfig = { mode: "levels", levels: ["off", "low", "high", "max"], default: "high", switch: { kind: "thinking-type" }, intensity: { kind: "effort" } };
const always: TextThinkingConfig = { mode: "always", levels: ["low", "high"], switch: { kind: "none" }, intensity: { kind: "gemini-level" } };

// 与后端 TestResolveThinkingLevel 同一组用例，前后端归一规则必须一致。
describe("resolveThinkingLevel", () => {
    test.each([
        [levels, "auto", "high"],
        [levels, undefined, "high"],
        [levels, "deep", "high"],
        [levels, "medium", "low"],
        [levels, "minimal", "low"],
        [levels, "off", "off"],
        [always, "off", "low"],
        [always, "max", "high"],
        [{ mode: "none", switch: { kind: "none" }, intensity: { kind: "none" } } as TextThinkingConfig, "high", ""],
        [undefined, "high", ""],
    ] as const)("%#", (config, requested, expected) => {
        expect(resolveThinkingLevel(config as TextThinkingConfig | undefined, requested)).toBe(expected);
    });

    test("legacy models keep the old off/medium toggle", () => {
        expect(thinkingLevelsFor(LEGACY_TEXT_THINKING_CONFIG)).toEqual(["off", "medium"]);
        expect(resolveThinkingLevel(LEGACY_TEXT_THINKING_CONFIG, "auto")).toBe("off");
        expect(resolveThinkingLevel(LEGACY_TEXT_THINKING_CONFIG, "high")).toBe("medium");
    });

    test("removing a level prunes its mappings, budget and default without mutating the model", () => {
        const source = thinkingPresetConfig("openai-gpt5")!;
        source.default = "max";
        source.intensity.budgets = { low: 1024, max: 16000 };
        const next = withThinkingLevels(source, ["high", "off", "low"]);
        expect(next.levels).toEqual(["off", "low", "high"]);
        expect(next.default).toBe("");
        expect(next.intensity.values).toEqual({});
        expect(next.intensity.budgets).toEqual({ low: 1024 });
        expect(source.intensity.values!.max).toBe("xhigh");
        expect(source.intensity.budgets.max).toBe(16000);
    });

    test("Claude adaptive cannot be disabled and deep does not select max", () => {
        const config = thinkingPresetConfig("claude-adaptive")!;
        expect(thinkingLevelsFor(config)).not.toContain("off");
        expect(resolveThinkingLevel(config, "off")).toBe("low");
        expect(resolveThinkingLevel(config, "deep")).toBe("high");
        expect(resolveThinkingLevel(config, "auto")).toBe("");
    });

    test("preset configs are independent copies", () => {
        const first = thinkingPresetConfig("openai-gpt5")!;
        first.intensity.values!.max = "changed";
        expect(thinkingPresetConfig("openai-gpt5")!.intensity.values!.max).toBe("xhigh");
    });
});
