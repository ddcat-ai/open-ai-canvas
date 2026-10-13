import { expect, test } from "bun:test";

import { defaultFeatureAvailability } from "../src/stores/use-user-store";

test("new workbench entries stay closed until the backend explicitly opens them", () => {
    expect(defaultFeatureAvailability.imageWorkbenchEnabled).toBe(false);
    expect(defaultFeatureAvailability.videoWorkbenchEnabled).toBe(false);
});
