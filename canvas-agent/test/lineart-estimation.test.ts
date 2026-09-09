import assert from "node:assert/strict";
import { test } from "node:test";

import { createLineartEstimationHttpModule, LineartRuntimeError, resolveLineartRuntimePaths, validateLineartDataUrl } from "../src/modules/lineart-estimation-http.js";

test("lineart runtime module declares signed status and run routes", () => {
    const module = createLineartEstimationHttpModule();
    assert.equal(module.descriptor.id, "lineart-estimation");
    assert.deepEqual(module.descriptor.scopes, ["lineart:status", "lineart:run"]);
    assert.deepEqual(module.routes.map((route) => `${route.method} ${route.path}`), [
        "GET /lineart-estimation/status",
        "POST /lineart-estimation/run",
    ]);
    module.dispose?.();
});

test("lineart input guard accepts image data URLs and rejects unsafe input", () => {
    assert.doesNotThrow(() => validateLineartDataUrl("data:image/png;base64,AQID"));
    assert.throws(
        () => validateLineartDataUrl("data:text/plain;base64,AQID"),
        (error: unknown) => error instanceof LineartRuntimeError && error.code === "lineart_input_invalid" && error.statusCode === 400,
    );
});

test("lineart runtime paths honor explicit project and Python overrides", () => {
    const paths = resolveLineartRuntimePaths({
        CANVAS_PROJECT_ROOT: "C:\\lineart-project",
        CANVAS_DEPTH_PYTHON: "C:\\lineart-project\\venv\\python.exe",
        CANVAS_LINEART_HF_HOME: "C:\\lineart-cache",
        CANVAS_LINEART_MODEL_ID: "example/lineart-model",
    });
    assert.equal(paths.pythonPath, "C:\\lineart-project\\venv\\python.exe");
    assert.equal(paths.hfHome, "C:\\lineart-cache");
    assert.equal(paths.modelId, "example/lineart-model");
    assert.equal(paths.configured, false);
});
