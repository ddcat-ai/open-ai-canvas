import { expect, test } from "bun:test";

import { createCreationSubmitGate } from "../src/pages/create/creation-submit-gate";

test("creation submit gate rejects a second submit until the first submit releases it", () => {
    const gate = createCreationSubmitGate();

    expect(gate.tryAcquire()).toBe(true);
    expect(gate.tryAcquire()).toBe(false);

    gate.release();

    expect(gate.tryAcquire()).toBe(true);
});
