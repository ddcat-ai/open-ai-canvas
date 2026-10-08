import { describe, expect, test } from "bun:test";

import { cn } from "@/lib/utils";

describe("M9 clean-room utility contract", () => {
    test("keeps conditional class values", () => {
        expect(cn("root", false && "hidden", ["active", null], { selected: true, muted: false })).toBe("root active selected");
    });

    test("lets tailwind-merge resolve conflicting utilities", () => {
        expect(cn("px-2", "px-6", "text-sm")).toBe("px-6 text-sm");
    });

    test("returns an empty string when no class is enabled", () => {
        expect(cn(undefined, null, false)).toBe("");
    });
});
