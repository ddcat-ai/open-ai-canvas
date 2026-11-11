import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("index.html boot recovery", () => {
    test("has boot recovery timeout handler in index.html", () => {
        const html = readFileSync(resolve(import.meta.dir, "../index.html"), "utf8");
        expect(html).toContain("boot-recovery");
        expect(html).toContain("MutationObserver");
    });
});
