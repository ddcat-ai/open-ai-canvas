import { describe, expect, test } from "bun:test";
import { warmPreloadResources } from "../src/lib/module-preload";

describe("warmPreloadResources", () => {
    test("handles empty urls cleanly", async () => {
        await expect(warmPreloadResources([])).resolves.toBeUndefined();
    });
});
