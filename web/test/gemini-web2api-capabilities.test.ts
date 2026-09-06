import assert from "node:assert/strict";
import test from "node:test";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities.ts";

test("Gemini Web2API image does not expose unsupported generation controls", () => {
    const image = defaultModelCapabilityConfig("gemini-web2api-image", "gemini-image").image!;
    assert.equal(image.size.parameter, "none");
    assert.equal(image.maxOutputs, 1);
    assert.equal(image.quality.supported, false);
    assert.equal(image.references.maskSupported, false);
    assert.equal(image.transparentBackground.supported, false);
    assert.equal(image.responseFormat.supported, false);
    assert.equal(image.outputFormat.supported, false);
});
